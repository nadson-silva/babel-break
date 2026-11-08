/**
 * V2 — permissão de microfone no main (bug real: `NotAllowedError: Permission
 * denied` sem nenhum diálogo do sistema).
 *
 * O que precisa ficar provado:
 *
 * - o handler lê a origem no formato que o Electron 45 entrega (`securityOrigin`),
 *   e continua funcionando se outra versão mandar só `requestingUrl`;
 * - renderer local (`file:` / loopback / dev server) é liberado, origem remota
 *   não;
 * - só áudio: vídeo e outras permissiones são negados;
 * - a recusa aparece no log (negar em silêncio foi o que escondeu o bug).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { grantMediaPermissions, isLocalRendererOrigin, mediaOrigin, type MediaRequestDetails } from './media-permissions'

type RequestHandler = (
  wc: never,
  permission: string,
  callback: (granted: boolean) => void,
  details: MediaRequestDetails
) => void

/** Sessão falsa que só guarda o handler registrado. */
function captureHandler(): { handler: RequestHandler } {
  const box: { handler?: RequestHandler } = {}
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler): void => {
      box.handler = handler
    }
  }
  grantMediaPermissions(session as unknown as Session)
  return { handler: box.handler as RequestHandler }
}

/** Pedido de microfone como o Electron 45 entrega. */
function micRequest(origin: string): MediaRequestDetails {
  return { isMainFrame: true, mediaTypes: ['audio'], securityOrigin: origin, requestingUrl: `${origin}index.html` }
}

function decide(handler: RequestHandler, details: MediaRequestDetails, permission = 'media'): boolean {
  const box: { granted?: boolean } = {}
  handler(null as never, permission, (value) => {
    box.granted = value
  }, details)
  expect('granted' in box).toBe(true)
  return box.granted as boolean
}

describe('mediaOrigin', () => {
  it('pega a origem de `securityOrigin` (formato do Electron 45)', () => {
    expect(mediaOrigin(micRequest('file:///'))).toBe('file:///')
  })

  it('deriva do `requestingUrl` quando a origem não vem declarada', () => {
    expect(mediaOrigin({ requestingUrl: 'http://localhost:5173/index.html' })).toBe('http://localhost:5173')
    expect(mediaOrigin({ requestingUrl: 'file:///app/index.html' })).toBe('file://')
  })

  it('volta string vazia sem origem nem url', () => {
    expect(mediaOrigin({})).toBe('')
    expect(mediaOrigin({ requestingUrl: 'nada' })).toBe('')
  })
})

describe('isLocalRendererOrigin', () => {
  it('libera o renderer empacotado e o dev server em loopback', () => {
    expect(isLocalRendererOrigin('file:///', null)).toBe(true)
    expect(isLocalRendererOrigin('file:///app/index.html', null)).toBe(true)
    expect(isLocalRendererOrigin('http://localhost:5173/', null)).toBe(true)
    expect(isLocalRendererOrigin('http://127.0.0.1:5173/', null)).toBe(true)
  })

  it('libera a origem do dev server configurada, nega vizinha', () => {
    expect(isLocalRendererOrigin('http://192.168.0.10:5173', 'http://192.168.0.10:5173')).toBe(true)
    expect(isLocalRendererOrigin('http://192.168.0.11:5173', 'http://192.168.0.10:5173')).toBe(false)
  })

  it('nega origem remota, vazia e malformada', () => {
    expect(isLocalRendererOrigin('https://evil.example', null)).toBe(false)
    expect(isLocalRendererOrigin('', null)).toBe(false)
    expect(isLocalRendererOrigin('garbage', null)).toBe(false)
  })
})

describe('grantMediaPermissions', () => {
  it('concede o microfone do renderer local (o caso que quebrava)', () => {
    const { handler } = captureHandler()
    expect(decide(handler, micRequest('file:///'))).toBe(true)
    expect(decide(handler, micRequest('http://localhost:5173/'))).toBe(true)
  })

  it('nega origem remota e subframe', () => {
    const { handler } = captureHandler()
    expect(decide(handler, micRequest('https://evil.example'))).toBe(false)
    expect(decide(handler, { ...micRequest('file:///'), isMainFrame: false })).toBe(false)
  })

  it('nega vídeo e qualquer outra permissão', () => {
    const { handler } = captureHandler()
    expect(decide(handler, { ...micRequest('file:///'), mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(decide(handler, micRequest('file:///'), 'notifications')).toBe(false)
    expect(decide(handler, micRequest('file:///'), 'display-capture')).toBe(false)
  })

  it('registra a recusa no log em vez de negar em silêncio', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { handler } = captureHandler()
    expect(decide(handler, micRequest('https://evil.example'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[media]'), expect.objectContaining({ origin: 'https://evil.example' }))
    warn.mockRestore()
  })

  it('concede quando a única informação disponível é o url do frame', () => {
    const { handler } = captureHandler()
    expect(decide(handler, { isMainFrame: true, requestingUrl: 'file:///app/index.html' })).toBe(true)
  })
})
