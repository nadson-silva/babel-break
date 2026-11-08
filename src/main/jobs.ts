/**
 * V2 (E9) — jobs nomeados com progresso, cancelamento e deadline.
 *
 * Na v1 só o chat tinha `tutor:cancel`. Geração de lição, trilha e áudio de voz
 * eram promessas soltas: o aluno fechava a tela e o request continuava (e a fila
 * ociosa, que espera `aiInFlight === 0`, competia com ele para sempre).
 *
 * Um job aqui é:
 *
 * - **nomeado**: `kind` + `label` no idioma das explicações do aluno — a UI mostra
 *   "gerando áudio da frase…" em vez de um spinner mudo;
 * - **cancelável**: por id, por perfil, ou quando o perfil ativo muda;
 * - **com deadline**: `AbortSignal.timeout` somado ao cancelamento explícito
 *   (M6/C3 continua valendo — nenhum request fica pendurado);
 * - **observável**: eventos `queued → progress → done|error|cancelled` no canal
 *   `job:event`, carimbados com o `profileId` dono (multi-perfil).
 *
 * O `run` recebe um `JobContext`: `signal` (para passar ao provedor) e
 * `progress()` (para contar etapas). Quem não sabe a progressão em números conta
 * etapas — é melhor que silêncio.
 */
import { BrowserWindow } from 'electron'
import type { JobEvent, JobKind, JobView } from '../shared/types'

export const JOB_CHANNEL = 'job:event'

/** Teto absoluto de um job: 4 min. Streaming de voz e geração de lição cabem aqui. */
export const JOB_DEADLINE_MS = 240_000

interface LiveJob {
  id: string
  kind: JobKind
  profileId: number
  label: string
  requestId?: string
  controller: AbortController
  startedAt: number
  lastProgress: number
}

const live = new Map<string, LiveJob>()
const listeners = new Set<(event: JobEvent) => void>()
let sequence = 0

function nextId(kind: JobKind): string {
  sequence += 1
  return `${kind}-${Date.now().toString(36)}-${sequence}`
}

function emit(event: JobEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // ouvinte podre não derruba o job
    }
  }
  for (const window of typeof BrowserWindow.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []) {
    if (!window.isDestroyed()) window.webContents.send(JOB_CHANNEL, event)
  }
}

/** Listener do renderer-side (o push já vai por `webContents.send`). */
export function onJobEvent(listener: (event: JobEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface JobContext {
  id: string
  signal: AbortSignal
  progress: (fraction: number | null, message?: string) => void
}

export interface StartJobInput<T> {
  kind: JobKind
  profileId: number
  label: string
  /** Correlaciona o job com um pedido do renderer (ex.: `requestId` do turno). */
  requestId?: string
  /** Teto próprio do job; padrão `JOB_DEADLINE_MS`. */
  deadlineMs?: number
  run: (context: JobContext) => Promise<T>
}

/**
 * Roda `run` como job. Resolve/rejeita como a promessa original, mas sempre
 * publica o estado final e sempre libera o registro — inclusive no caminho de
 * erro, que é justamente onde vazava request pendurado.
 */
export async function startJob<T>(input: StartJobInput<T>): Promise<T> {
  const id = nextId(input.kind)
  const controller = new AbortController()
  const timeout = AbortSignal.timeout(input.deadlineMs ?? JOB_DEADLINE_MS)
  const signal =
    typeof AbortSignal.any === 'function' ? AbortSignal.any([controller.signal, timeout]) : controller.signal

  const job: LiveJob = {
    id,
    kind: input.kind,
    profileId: input.profileId,
    label: input.label,
    requestId: input.requestId,
    controller,
    startedAt: Date.now(),
    lastProgress: 0
  }
  live.set(id, job)

  emit({ id, kind: input.kind, profileId: input.profileId, label: input.label, state: 'queued', progress: 0, at: Date.now(), requestId: input.requestId })

  const context: JobContext = {
    id,
    signal,
    progress: (fraction, message) => {
      // `null` = "andando, sem número": mantém o label e publica sem progresso.
      const value = fraction == null ? job.lastProgress : Math.min(1, Math.max(0, fraction))
      job.lastProgress = value
      emit({
        id,
        kind: input.kind,
        profileId: input.profileId,
        label: message ?? input.label,
        state: 'progress',
        progress: value,
        message,
        at: Date.now(),
        requestId: input.requestId
      })
    }
  }

  try {
    const result = await input.run(context)
    emit({ id, kind: input.kind, profileId: input.profileId, label: input.label, state: 'done', progress: 1, at: Date.now(), requestId: input.requestId, durationMs: Date.now() - job.startedAt })
    return result
  } catch (error) {
    const aborted = signal.aborted
    emit({
      id,
      kind: input.kind,
      profileId: input.profileId,
      label: input.label,
      state: aborted ? 'cancelled' : 'error',
      progress: job.lastProgress,
      message: error instanceof Error ? error.message : String(error),
      at: Date.now(),
      requestId: input.requestId,
      durationMs: Date.now() - job.startedAt
    })
    throw error
  } finally {
    live.delete(id)
  }
}

/** Cancela por id (o botão "cancelar" da tela que pediu). */
export function cancelJob(id: string): boolean {
  const job = live.get(id)
  if (!job) return false
  job.controller.abort()
  return true
}

/** Cancela todos os jobs de um perfil (troca de perfil, sair da tela). */
export function cancelJobsOfProfile(profileId: number): number {
  let cancelled = 0
  for (const job of [...live.values()]) {
    if (job.profileId === profileId) {
      job.controller.abort()
      cancelled += 1
    }
  }
  return cancelled
}

/** V2: manter só os jobs do perfil que passou a ser ativo. */
export function cancelJobsExceptProfile(profileId: number): number {
  let cancelled = 0
  for (const job of [...live.values()]) {
    if (job.profileId !== profileId) {
      job.controller.abort()
      cancelled += 1
    }
  }
  return cancelled
}

export function activeJobs(): JobView[] {
  return [...live.values()].map((job) => ({
    id: job.id,
    kind: job.kind,
    profileId: job.profileId,
    label: job.label,
    progress: job.lastProgress,
    startedAt: job.startedAt
  }))
}

export function jobCount(): number {
  return live.size
}

/**
 * Reaproveita o padrão do `curriculumJob` (M6/C1): um job vivo por chave. Se já
 * existe um rodando para a mesma chave, devolve a mesma promessa em vez de
 * pagar a geração duas vezes.
 */
const keyed = new Map<string, Promise<unknown>>()

export function startKeyedJob<T>(key: string, input: StartJobInput<T>): Promise<T> {
  const pending = keyed.get(key)
  if (pending) return pending as Promise<T>

  const job = startJob(input).finally(() => {
    keyed.delete(key)
  })
  keyed.set(key, job)
  return job
}

export function hasKeyedJob(key: string): boolean {
  return keyed.has(key)
}

/** Só para teste: estado interno limpo entre casos. */
export function resetJobsForTest(): void {
  for (const job of live.values()) job.controller.abort()
  live.clear()
  keyed.clear()
  listeners.clear()
}
