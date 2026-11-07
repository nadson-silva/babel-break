/**
 * Fronteira IPC validada (M6/D2).
 *
 * Todo canal `invoke` precisa de um contrato de entrada aqui — um zod tuple
 * espelhando os argumentos do `ipcRenderer.invoke` correspondente. Payload
 * inválido é **recusado antes de tocar no banco** (critério de aceite nº 8 da
 * M6), em vez de ser persistido ou virar `undefined` silencioso no handler.
 * Isto também é pré-requisito de múltiplos perfis: nada entra sem forma
 * conhecida.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { REPORT_KINDS, REPORT_REASONS } from '../shared/report-reasons'

const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const count = z.number().int().min(0).max(10_000)
const provider = z.enum(['gemini', 'ollama'])
const rating = z.enum(['again', 'hard', 'good', 'easy'])
const guidedStep = z.enum(['review', 'lesson', 'practice', 'tutor', 'recap'])
const cefr = z.enum(['A1', 'A2', 'B1', 'B2', 'C1'])
const noArgs = z.tuple([])

const practice = z.object({ correct: count, total: count })

/**
 * Contrato por canal. Os valores são zod tuples do **output** esperado pelo
 * handler; `handle()` faz a ponte `unknown → tipado` exatamente uma vez.
 */
const CHANNEL_CONTRACTS = {
  // --- app/diagnóstico -------------------------------------------------------
  'app:info': noArgs,
  'log:get-path': noArgs,
  'db:status': noArgs,
  'languages:list': noArgs,

  // --- configuração ----------------------------------------------------------
  'settings:get': noArgs,
  'settings:update': z.tuple([
    z
      .object({
        provider,
        geminiModel: z.string().max(300),
        ollamaModel: z.string().max(300),
        ollamaBaseUrl: z.string().max(500),
        correctionStyle: z.enum(['recast', 'explicit', 'both']),
        focusMix: z.number().min(0).max(1),
        uiLang: z.string().max(10),
        pregenerate: z.boolean()
      })
      .partial()
  ]),
  'settings:set-gemini-key': z.tuple([z.string().max(4_096)]),
  'settings:clear-gemini-key': noArgs,
  'provider:status': noArgs,
  'provider:probe': noArgs,
  'models:list': z.tuple([provider]),
  'provider:test': z.tuple([provider]),

  // --- perfil / placement / currículo ---------------------------------------
  'profile:get': noArgs,
  'profile:onboard': z.tuple([
    z.object({
      goal: z.string().max(500),
      cefr,
      targetLang: z.string().max(10).optional(),
      nativeLang: z.string().max(10).optional()
    })
  ]),
  'profile:reset-memory': noArgs,
  'placement:generate': z.tuple([
    z
      .union([
        z.string().max(500),
        z.object({
          goal: z.string().max(500).optional(),
          targetLang: z.string().max(10).optional(),
          nativeLang: z.string().max(10).optional()
        })
      ])
      .optional()
  ]),
  'placement:submit': z.tuple([z.array(z.number().int().min(0).max(10)).max(30)]),
  'curriculum:get': noArgs,
  'curriculum:generate': noArgs,

  // --- lição ------------------------------------------------------------------
  'lesson:open': z.tuple([id]),
  'lesson:regenerate': z.tuple([id]),
  'lesson:answer': z.tuple([
    z.object({
      exerciseId: id,
      response: z.string().max(8_000),
      latencyMs: z.number().int().min(0).max(3_600_000).optional()
    })
  ]),
  'lesson:finish': z.tuple([z.object({ lessonId: id, sessionId: id })]),
  'home:get': noArgs,

  // --- tutor / caderno / revisão / guiada ------------------------------------
  'tutor:list': noArgs,
  'tutor:latest': noArgs,
  'tutor:open': z.tuple([id]),
  'tutor:new': z.tuple([
    z
      .object({
        topic: z.string().max(300).nullable().optional(),
        lessonId: id.nullable().optional()
      })
      .optional()
  ]),
  'tutor:send': z.tuple([
    z.object({
      requestId: z.string().min(1).max(100),
      conversationId: id,
      text: z.string().max(8_000)
    })
  ]),
  'tutor:cancel': z.tuple([z.string().min(1).max(100)]),
  'tutor:close': z.tuple([id]),
  'notebook:get': noArgs,
  'notebook:resolve': z.tuple([id, z.boolean()]),
  'notebook:resolve-tag': z.tuple([z.array(z.string().max(120)).min(1).max(50)]),
  'review:state': z.tuple([z.number().int().min(1).max(200).optional()]),
  'review:answer': z.tuple([z.object({ cardId: id, rating })]),
  'review:from-errors': noArgs,
  'guided:active': noArgs,
  'guided:start': noArgs,
  'guided:step': z.tuple([guidedStep]),
  'guided:review-count': z.tuple([count]),
  'guided:practice': z.tuple([practice]),
  'guided:tutor': noArgs,
  'guided:finish': z.tuple([
    z
      .object({
        reviewDone: count.optional(),
        practice: practice.optional()
      })
      .optional()
  ]),
  'guided:abandon': noArgs,

  // --- trilhas ----------------------------------------------------------------
  'track:list': noArgs,
  'track:draft': z.tuple([
    z.object({
      objective: z.string().min(1).max(500),
      replaceId: id.optional()
    })
  ]),
  'track:revise': z.tuple([
    z.object({
      trackId: id,
      lessons: z
        .array(
          z.object({
            title: z.string().max(200),
            objective: z.string().max(500),
            focusVocabulary: z.array(z.string().max(120)).max(30)
          })
        )
        .max(40)
    })
  ]),
  'track:approve': z.tuple([id]),
  'track:discard': z.tuple([id]),
  'track:status': z.tuple([z.object({ trackId: id, status: z.enum(['active', 'archived']) })]),

  // --- cenário ----------------------------------------------------------------
  'scenario:open': z.tuple([
    z.object({
      lessonId: id.nullable().optional(),
      topic: z.string().max(300).nullable().optional()
    })
  ]),
  'scenario:finish': z.tuple([id]),
  'scenario:session': z.tuple([id]),
  'scenario:runs': z.tuple([z.number().int().min(1).max(100).optional()]),
  'scenario:refresh': z.tuple([id]),

  // --- progresso / reports / pré-geração ---------------------------------------
  'dashboard:get': noArgs,
  'report:submit': z.tuple([
    z.object({
      kind: z.enum(REPORT_KINDS),
      targetId: id.nullable(),
      reason: z.enum(REPORT_REASONS),
      note: z.string().max(1_000).optional(),
      context: z
        .object({
          text: z.string().max(2_000).optional(),
          replacement: z.string().max(2_000).optional(),
          tag: z.string().max(120).optional()
        })
        .optional()
    })
  ]),
  'report:undo': z.tuple([id]),
  'report:undo-target': z.tuple([z.enum(REPORT_KINDS), id]),
  'report:list': z.tuple([z.number().int().min(1).max(200).optional()]),
  'pregen:state': noArgs,
  'pregen:run': noArgs,
  'cache:stats': noArgs
} satisfies Record<string, z.ZodType<unknown[]>>

export type IpcChannel = keyof typeof CHANNEL_CONTRACTS

function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
    .join('; ')
}

/**
 * Registra um handler com validação obrigatória de entrada. Sem contrato →
 * erro em registro (cobrar cobertura dos 57 canais é o ponto).
 */
export function handle<Args extends unknown[]>(
  channel: IpcChannel,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => unknown
): void {
  const contract: z.ZodType<unknown[]> = CHANNEL_CONTRACTS[channel]
  ipcMain.handle(channel, (event, ...raw: unknown[]) => {
    const parsed = contract.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Payload inválido em "${channel}" — ${issuesOf(parsed.error)}`)
    }
    return handler(event, ...(parsed.data as Args))
  })
}

/** Canais cobertos pelo contrato — usado pelo teste de contrato. */
export const CONTRACTED_CHANNELS: string[] = Object.keys(CHANNEL_CONTRACTS)
