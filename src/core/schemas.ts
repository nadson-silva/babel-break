import { z } from 'zod'

/**
 * M6 (D1): versão do contrato de prompt e do schema de conteúdo GRAVADO.
 * Todo `lessons.content` e todo `exercises.payload` sai carimbado com estes
 * números. Conteúdo em cache com versão divergente conta como **stale** e vai
 * pela fila de aquecimento (regeneração) — nunca por shim à mão. Export/import
 * (v2) lê o carimbo antes de importar.
 */
export const PROMPT_VERSION = 1
export const SCHEMA_VERSION = 1

export const cefrSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1'])

/** M6 (D3/D4): tetos por string — o contrato do prompt fecha o tamanho, não o bom senso. */
const short = z.string().min(2).max(200)
const mid = z.string().min(1).max(600)
const long = z.string().min(1).max(4_000)

export const placementQuestionSchema = z.object({
  level: cefrSchema,
  prompt: mid,
  options: z.array(mid).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: long
})

/** Teste de nível são exatamente 10 questões — o plano fecha essa conta. */
export const placementSchema = z.object({
  questions: z.array(placementQuestionSchema).length(10)
})

export const curriculumLessonSchema = z.object({
  title: short,
  objective: mid
})

export const curriculumUnitSchema = z.object({
  title: short,
  description: mid,
  level: cefrSchema,
  lessons: z.array(curriculumLessonSchema).min(2).max(4)
})

export const curriculumSchema = z.object({
  units: z.array(curriculumUnitSchema).min(2).max(3)
})

export const lessonContentSchema = z.object({
  title: short,
  level: cefrSchema,
  objective: mid,
  explanation: long,
  /** M4: pares "target" (idioma ensinado) / "native" (idioma do aluno), sem hardcode en/pt. */
  examples: z
    .array(
      z.object({
        target: mid,
        native: mid
      })
    )
    .min(2)
    .max(6),
  grammarPoints: z
    .array(
      z.object({
        title: short,
        explanation: long,
        examples: z.array(mid).min(1).max(4)
      })
    )
    .min(1)
    .max(4),
  /**
   * Armadilhas específicas de falantes de PT-BR ligadas aos erros do aluno.
   * É o que torna visível o fato de a lição #2 ser diferente da #1.
   */
  pitfalls: z
    .array(
      z.object({
        tag: z.string().min(2).max(80),
        wrong: mid,
        right: mid,
        note: mid
      })
    )
    .max(4)
    .default([]),
  vocabulary: z
    .array(
      z.object({
        term: z.string().min(1).max(200),
        translation: z.string().min(1).max(200),
        example: mid
      })
    )
    .min(4)
    .max(10)
})

export const exerciseTypeSchema = z.enum([
  'multiple_choice',
  'cloze',
  'translate',
  'order',
  'free_production',
  // V2: voz. `listen_repeat` é ouvir e escolher; `speak_sentence` é ler em voz alta.
  'listen_repeat',
  'speak_sentence'
])

export const generatedExerciseSchema = z
  .object({
    type: exerciseTypeSchema,
    instruction: mid,
    prompt: long,
    options: z.array(mid).default([]),
    tokens: z.array(z.string().min(1).max(200)).default([]),
    answer: mid,
    alternatives: z.array(mid).default([]),
    explanation: long.default(''),
    /** Tags de erro que este exercício treina (vêm do caderno de erros). */
    targetTags: z.array(z.string().max(80)).default([])
  })
  .superRefine((exercise, ctx) => {
    // M6 (D3/D4): o contrato de múltipla escolha fecha aqui — 4 opções e a
    // resposta correta **dentro** delas. Gabarito fora das opções é exercício
    // impossível, e modelo fraco faz isso direto.
    // V2: `listen_repeat` é a mesma forma, só que a resposta vem do ouvido.
    if (exercise.type !== 'multiple_choice' && exercise.type !== 'listen_repeat') return
    if (exercise.options.length !== 4) {
      ctx.addIssue({
        code: 'custom',
        message: `${exercise.type} exige exatamente 4 opções`,
        path: ['options']
      })
    } else if (!exercise.options.includes(exercise.answer)) {
      ctx.addIssue({
        code: 'custom',
        message: 'answer precisa ser uma das options',
        path: ['answer']
      })
    }
  })

  .refine((exercise) => exercise.type !== 'speak_sentence' || exercise.answer.trim().length >= 3, {
    // V2: sem frase-alvo não há pronúncia para pontuar.
    message: 'speak_sentence precisa de uma frase para falar',
    path: ['answer']
  })

export const exerciseSetSchema = z.object({
  exercises: z.array(generatedExerciseSchema).min(4).max(8)
})

export const gradeSchema = z.object({
  correct: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(1_200),
  corrected: mid.default(''),
  errorTags: z.array(z.string().max(80)).default([])
})

/** Correção de texto livre do aluno (usada no chat com o tutor). */
export const correctionItemSchema = z.object({
  original: mid,
  corrected: mid,
  tag: z.string().min(1).max(80),
  note: mid.default('')
})

export const correctionSetSchema = z.object({
  hasErrors: z.boolean().default(false),
  corrections: z.array(correctionItemSchema).max(6).default([]),
  /** Versão natural da mesma ideia — o recast que aparece embaixo da mensagem. */
  recast: z.string().default('')
})

/** Resumo rolante de uma conversa longa, injetado no lugar das mensagens antigas. */
export const conversationSummarySchema = z.object({
  summary: z.string().min(10).max(4_000)
})

export type PlacementOutput = z.infer<typeof placementSchema>
export type CurriculumOutput = z.infer<typeof curriculumSchema>
export type LessonContentOutput = z.infer<typeof lessonContentSchema>
export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>
export type ExerciseSetOutput = z.infer<typeof exerciseSetSchema>
export type GradeOutput = z.infer<typeof gradeSchema>
export type CorrectionSetOutput = z.infer<typeof correctionSetSchema>
export type ConversationSummaryOutput = z.infer<typeof conversationSummarySchema>

export const trackPlanSchema = z.object({
  title: short,
  goalTag: z.string().min(2).max(80),
  lessons: z.array(
    z.object({
      title: short,
      objective: mid,
      focusVocabulary: z.array(z.string().min(1).max(120)).min(1).max(10)
    })
  ).min(5).max(8)
})

/**
 * M6 (D4): contrato do plano **armazenado** — o output de `normalizeTrackPlan`
 * é revalidado contra isto antes de virar `focus_tracks.plan`. O piso de
 * lições aqui é o que cabe de verdade (modelos fracos e idiomas sem banco
 * devolvem menos que as 5 pedidas); o teto e as formas, não.
 */
export const storedTrackPlanSchema = z.object({
  title: z.string().min(1).max(200),
  goalTag: z.string().min(1).max(80),
  lessons: z.array(
    z.object({
      title: z.string().min(1).max(200),
      objective: z.string().min(0).max(600),
      focusVocabulary: z.array(z.string().min(1).max(120)).max(10)
    })
  ).min(1).max(8)
})

export const scenarioSchema = z.object({
  persona: mid,
  setting: mid,
  successCriteria: z.array(z.string().min(3).max(300)).min(2).max(5),
  openingLine: mid
})

/**
 * Rubrica do roleplay: conteúdo e língua em scores separados. M6 (D4):
 * `criteriaMet` tem **exatamente** o tamanho do checklist enviado no prompt —
 * construído por fábrica porque o número de critérios é dinâmico. Sem isto o
 * modelo "esquece" um critério e a rubrica infla sozinha.
 */
export function scenarioFeedbackSchemaFor(criteriaCount: number) {
  return z.object({
    contentScore: z.number().min(0).max(1),
    languageScore: z.number().min(0).max(1),
    feedback: z.string().min(10).max(2_000),
    criteriaMet: z.array(z.boolean()).length(criteriaCount),
    bestPhrases: z
      .array(
        z.object({
          original: mid,
          improved: mid,
          reason: mid.default('')
        })
      )
      .max(3)
      .default([]),
    followUpDrill: mid.default('')
  })
}

/** Versão estática para tipagem/exportas (a validação real usa a fábrica). */
export const scenarioFeedbackSchema = scenarioFeedbackSchemaFor(2)

export type TrackPlanOutput = z.infer<typeof trackPlanSchema>
export type ScenarioOutput = z.infer<typeof scenarioSchema>
export type ScenarioFeedbackOutput = z.infer<typeof scenarioFeedbackSchema>
export type ScenarioPhrase = z.infer<typeof scenarioFeedbackSchema>['bestPhrases'][number]

