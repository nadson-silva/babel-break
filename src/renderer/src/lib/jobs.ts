import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobEvent, JobKind } from '../../../shared/types'

/**
 * V2 (E9) — progresso de geração longa no renderer.
 *
 * O main empurra `job:event`; a tela que pediu mostra o rótulo (no idioma das
 * explicações do aluno, vindo do main) e oferece cancelar. Nada de spinner
 * mudo, nada de "será que travou?".
 */
export function useJob(kind: JobKind): { event: JobEvent | null; cancel: () => void } {
  const [event, setEvent] = useState<JobEvent | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const unsubscribe = window.api.job.onEvent((next) => {
      if (!alive.current || next.kind !== kind) return
      // Job terminado: a tela volta ao estado normal no próximo tick.
      setEvent(next.state === 'done' || next.state === 'cancelled' ? null : next)
      if (next.state === 'error') setEvent(next)
    })
    return () => {
      alive.current = false
      unsubscribe()
    }
  }, [kind])

  const cancel = useCallback((): void => {
    const id = event?.id
    if (!id) return
    void window.api.job.cancel(id).catch(() => undefined)
  }, [event?.id])

  return { event, cancel }
}

/** Barra discreta de progresso com o rótulo do job e o botão de cancelar. */
export function jobPercent(event: JobEvent | null): number {
  if (!event || event.progress == null) return 0
  return Math.round(Math.min(1, Math.max(0, event.progress)) * 100)
}
