import { z } from 'zod'

export const cefrSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1'])

export const placementQuestionSchema = z.object({
  level: cefrSchema,
  prompt: z.string().min(3),
  options: z.array(z.string().min(1)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1)
})

export const placementSchema = z.object({
  questions: z.array(placementQuestionSchema).min(8).max(12)
})

export const curriculumLessonSchema = z.object({
  title: z.string().min(2),
  objective: z.string().min(2)
})

export const curriculumUnitSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(2),
  level: cefrSchema,
  lessons: z.array(curriculumLessonSchema).min(2).max(4)
})

export const curriculumSchema = z.object({
  units: z.array(curriculumUnitSchema).min(2).max(3)
})

export const lessonContentSchema = z.object({
  title: z.string().min(2),
  level: cefrSchema,
  objective: z.string().min(2),
  explanation: z.string().min(10),
  examples: z
    .array(
      z.object({
        en: z.string().min(1),
        pt: z.string().min(1)
      })
    )
    .min(2)
    .max(6),
  grammarPoints: z
    .array(
      z.object({
        title: z.string().min(2),
        explanation: z.string().min(2),
        examples: z.array(z.string().min(1)).min(1).max(4)
      })
    )
    .min(1)
    .max(4),
  vocabulary: z
    .array(
      z.object({
        term: z.string().min(1),
        translation: z.string().min(1),
        example: z.string().min(1)
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
  'free_production'
])

export const generatedExerciseSchema = z.object({
  type: exerciseTypeSchema,
  instruction: z.string().min(2),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).default([]),
  tokens: z.array(z.string().min(1)).default([]),
  answer: z.string().min(1),
  alternatives: z.array(z.string().min(1)).default([]),
  explanation: z.string().default('')
})

export const exerciseSetSchema = z.object({
  exercises: z.array(generatedExerciseSchema).min(4).max(8)
})

export const gradeSchema = z.object({
  correct: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string().min(1),
  corrected: z.string().default(''),
  errorTags: z.array(z.string()).default([])
})

export type PlacementOutput = z.infer<typeof placementSchema>
export type CurriculumOutput = z.infer<typeof curriculumSchema>
export type LessonContentOutput = z.infer<typeof lessonContentSchema>
export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>
export type ExerciseSetOutput = z.infer<typeof exerciseSetSchema>
export type GradeOutput = z.infer<typeof gradeSchema>
