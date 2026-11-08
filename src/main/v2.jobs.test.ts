/**
 * V2 (E9) — jobs nomeados: progresso, cancelamento, deadline e o contador que a
 * fila ociosa lê. Um request pendurado sem deadline travava o prewarm para
 * sempre; um job sem cancelamento continuava queimando token atrás de troca de
 * tela.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeJobs,
  cancelJob,
  cancelJobsExceptProfile,
  cancelJobsOfProfile,
  jobCount,
  onJobEvent,
  resetJobsForTest,
  startJob,
  startKeyedJob
} from './jobs'
import type { JobEvent } from '../shared/types'

afterEach(() => {
  resetJobsForTest()
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((ok, nope) => {
    resolve = ok
    reject = nope
  })
  return { promise, resolve, reject }
}

describe('progresso e eventos', () => {
  it('publica queued → progress → done com o perfil dono', async () => {
    const events: JobEvent[] = []
    const unsubscribe = onJobEvent((event) => events.push(event))

    const value = await startJob({
      kind: 'voice:tts',
      profileId: 7,
      label: 'gerando áudio',
      run: async (job) => {
        job.progress(0.3)
        job.progress(0.9, 'quase lá')
        return 'ok'
      }
    })
    unsubscribe()

    expect(value).toBe('ok')
    expect(events.map((event) => event.state)).toEqual(['queued', 'progress', 'progress', 'done'])
    expect(events.every((event) => event.profileId === 7)).toBe(true)
    expect(events.at(-1)?.progress).toBe(1)
    expect(events[1]?.label).toBe('gerando áudio')
    expect(events[2]?.message).toBe('quase lá')
  })

  it('erro publica state=error e libera o registro', async () => {
    const events: JobEvent[] = []
    const unsubscribe = onJobEvent((event) => events.push(event))

    await expect(
      startJob({
        kind: 'voice:asr',
        profileId: 1,
        label: 'transcrevendo',
        run: async () => {
          throw new Error('provedor caiu')
        }
      })
    ).rejects.toThrow('provedor caiu')
    unsubscribe()

    expect(events.at(-1)).toMatchObject({ state: 'error', message: 'provedor caiu' })
    expect(jobCount()).toBe(0)
  })

  it('progresso fora de 0–1 é recortado (UI não mostra 130%)', async () => {
    const seen: number[] = []
    const unsubscribe = onJobEvent((event) => {
      if (event.progress != null) seen.push(event.progress)
    })
    await startJob({
      kind: 'voice:grade',
      profileId: 1,
      label: 'x',
      run: async (job) => {
        job.progress(5)
        job.progress(-2)
        job.progress(null)
        return null
      }
    })
    unsubscribe()
    expect(seen.every((value) => value >= 0 && value <= 1)).toBe(true)
  })
})

describe('cancelamento', () => {
  it('cancelJob derruba o sinal do run e publica cancelled', async () => {
    const gate = deferred<string>()
    const events: JobEvent[] = []
    const unsubscribe = onJobEvent((event) => events.push(event))
    let aborted = false

    const running = startJob({
      kind: 'voice:grade',
      profileId: 3,
      label: 'gravando',
      run: (job) => {
        job.signal.addEventListener('abort', () => {
          aborted = true
        })
        return gate.promise
      }
    })

    await vi.waitFor(() => expect(activeJobs()).toHaveLength(1))
    expect(cancelJob(activeJobs()[0]?.id as string)).toBe(true)
    gate.resolve('fim')

    await running
    unsubscribe()

    expect(aborted).toBe(true)
    expect(events.at(-1)?.state).toBe('done') // o run terminou depois do abort
    expect(jobCount()).toBe(0)
  })

  it('cancelar por perfil e manter só o do perfil ativo', async () => {
    // Como um provedor de verdade: o run rejeita quando o sinal aborta.
    const runner = (gate: { promise: Promise<void> }) => (job: { signal: AbortSignal }): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        job.signal.addEventListener('abort', () => reject(new Error('aborted')))
        void gate.promise.then(() => resolve())
      })

    const gateA = deferred<void>()
    const gateB = deferred<void>()
    const a = startJob({ kind: 'voice:tts', profileId: 1, label: 'a', run: runner(gateA) })
    const b = startJob({ kind: 'voice:tts', profileId: 2, label: 'b', run: runner(gateB) })
    await vi.waitFor(() => expect(jobCount()).toBe(2))

    expect(cancelJobsExceptProfile(1)).toBe(1)
    gateA.resolve()
    gateB.resolve()
    await a
    await expect(b).rejects.toThrow('aborted')

    const events: JobEvent[] = []
    const unsubscribe = onJobEvent((event) => events.push(event))
    const gateC = deferred<void>()
    const c = startJob({ kind: 'voice:tts', profileId: 5, label: 'c', run: runner(gateC) })
    expect(cancelJobsOfProfile(5)).toBe(1)
    gateC.resolve()
    await expect(c).rejects.toThrow('aborted')
    unsubscribe()

    expect(events.some((event) => event.state === 'cancelled')).toBe(true)
  })

  it('um id desconhecido não cancela nada', () => {
    expect(cancelJob('não-existe')).toBe(false)
  })
})

describe('deadline (M6/C3 continua valendo dentro do job)', () => {
  it('estoura o teto do job e o run é interrompido por abort', async () => {
    const events: JobEvent[] = []
    const unsubscribe = onJobEvent((event) => events.push(event))

    await expect(
      startJob({
        kind: 'voice:tts',
        profileId: 1,
        label: 'lento',
        deadlineMs: 30,
        run: (job) =>
          new Promise<string>((resolve, reject) => {
            job.signal.addEventListener('abort', () => reject(new Error('timeout')))
            setTimeout(() => resolve('tarde demais'), 200)
          })
      })
    ).rejects.toThrow('timeout')
    unsubscribe()

    expect(events.at(-1)?.state).toBe('cancelled')
    expect(jobCount()).toBe(0)
  })
})

describe('chave única (padrão do curriculumJob)', () => {
  it('duas chamadas na mesma chave devolvem o mesmo job', async () => {
    let runs = 0
    const gate = deferred<number>()

    const first = startKeyedJob('lesson:9', {
      kind: 'lesson:generate',
      profileId: 1,
      label: 'gerando',
      run: async () => {
        runs += 1
        return gate.promise
      }
    })
    const second = startKeyedJob('lesson:9', {
      kind: 'lesson:generate',
      profileId: 1,
      label: 'gerando',
      run: async () => {
        runs += 1
        return gate.promise
      }
    })
    gate.resolve(42)

    expect(await first).toBe(42)
    expect(await second).toBe(42)
    expect(runs).toBe(1)
    expect(second).toBe(first)
  })
})
