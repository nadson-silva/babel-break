/**
 * V2: permissão de microfone no processo main.
 *
 * Por que este arquivo existe: no Electron 45 o pedido de `media` chega no
 * `setPermissionRequestHandler` com `securityOrigin` (e `mediaTypes` /
 * `isMainFrame` / `requestingUrl`). `requestingOrigin` é argumento do
 * `setPermissionCheckHandler`, não do request handler — quem lê esse campo no
 * request recebe `undefined`, nega tudo, e o renderer vê
 * `NotAllowedError: Permission denied` sem nenhum diálogo do sistema no Linux
 * (o microfone é liberado pelo app, não pelo SO). A prática de voz morria em
 * silêncio exatamente assim.
 */
import type { Session } from 'electron'

/** Forma do `details` que interessa (o tipado do Electron é uma união). */
export interface MediaRequestDetails {
  isMainFrame?: boolean
  requestingUrl?: string
  securityOrigin?: string
  mediaTypes?: Array<'video' | 'audio'>
  /** Só existe no check handler; aceito aqui para não quebrar em outra versão. */
  requestingOrigin?: string
}

/** Origem declarada do pedido; na falta dela, deriva do último URL do frame. */
export function mediaOrigin(details: MediaRequestDetails): string {
  const declared = [details.securityOrigin, details.requestingOrigin].find(
    (value) => typeof value === 'string' && value.length > 0
  )
  if (declared) return declared

  const url = details.requestingUrl
  if (typeof url !== 'string' || !url) return ''
  try {
    const parsed = new URL(url)
    // `file:` tem origem opaca: `URL.origin` devolve "null", então o renderer
    // empacotado é reconhecido pelo protocolo.
    return parsed.protocol === 'file:' ? 'file://' : parsed.origin
  } catch {
    return ''
  }
}

function devRendererOrigin(): string | null {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) return null
  try {
    return new URL(devUrl).origin
  } catch {
    return null
  }
}

/**
 * Só o próprio renderer do app usa o microfone: o arquivo empacotado (`file:`),
 * o dev server em loopback, ou a origem do dev server configurada. Qualquer
 * outra origem é negada — `setWindowOpenHandler` já manda links externos para o
 * browser, então não há conteúdo remoto nesta janela.
 */
export function isLocalRendererOrigin(origin: string, devOrigin: string | null = devRendererOrigin()): boolean {
  if (!origin) return false
  // Electron manda `file:///` com barra final; `startsWith` cobre as duas formas.
  if (origin.startsWith('file://')) return true

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true

  return devOrigin != null && origin.replace(/\/$/, '') === devOrigin.replace(/\/$/, '')
}

/**
 * Concede `media` (só áudio) para o renderer local e registra a recusa no
 * `main.log` — negar em silêncio foi o que tornou este bug invisível.
 */
export function grantMediaPermissions(session: Session): void {
  session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const request = details as MediaRequestDetails

    if (permission !== 'media') {
      callback(false)
      return
    }

    const origin = mediaOrigin(request)
    const audioOnly = (request.mediaTypes ?? ['audio']).every((type) => type === 'audio')
    const granted = request.isMainFrame !== false && audioOnly && isLocalRendererOrigin(origin)

    if (!granted) {
      console.warn('[media] permissão negada', {
        origin,
        mediaTypes: request.mediaTypes,
        isMainFrame: request.isMainFrame
      })
    }
    callback(granted)
  })
}
