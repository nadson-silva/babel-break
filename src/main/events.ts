/**
 * Sinalização interna do processo main (M5).
 *
 * Módulos como pré-geração e painel precisam saber *quando* o aluno terminou
 * uma lição, fechou uma conversa ou aprovou uma trilha — sem que cada um importe
 * o outro (isso criaria ciclo: learning → prewarm → learning). Aqui mora só o
 * barramento: quem emite não conhece quem escuta.
 */
export type StudentEvent =
  | 'app-ready'
  | 'lesson-finished'
  | 'conversation-closed'
  | 'scenario-finished'
  | 'track-approved'
  | 'settings-saved'
  /** V2: memória de um perfil apagada (perfil continua vivo, só esquece). */
  | 'memory-reset'
  /** V2: o aluno clicou no lembrete — a janela vem ao foco. */
  | 'reminder-opened'
  /** V2: o aluno trocou de perfil — jobs em espera e fila ociosa param no ato. */
  | 'profile-switched'
  | 'profile-deleted'

export interface StudentEventPayload {
  event: StudentEvent
  at: number
  detail?: string
  /** V2: dono do evento — com perfis múltiplos, o listener precisa saber de quem. */
  profileId?: number
}

type Listener = (payload: StudentEventPayload) => void

const listeners = new Set<Listener>()

export function onStudentEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitStudentEvent(event: StudentEvent, detail?: string, profileId?: number): void {
  const payload: StudentEventPayload = { event, at: Date.now(), detail, profileId }
  for (const listener of [...listeners]) {
    try {
      listener(payload)
    } catch (error) {
      console.warn('[events] listener falhou:', error instanceof Error ? error.message : error)
    }
  }
}

/** Visível para teste: quantos listeners estão ligados (evita vazar no reload). */
export function listenerCount(): number {
  return listeners.size
}

export function clearStudentListeners(): void {
  listeners.clear()
}
