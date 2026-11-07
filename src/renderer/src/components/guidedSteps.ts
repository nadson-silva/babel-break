import type { GuidedStep } from '../../../shared/types'
import { t } from '../i18n/pt-BR'

export const GUIDED_ORDER: GuidedStep[] = ['review', 'lesson', 'practice', 'tutor', 'recap']

export function guidedStepTitle(step: GuidedStep): string {
  switch (step) {
    case 'review':
      return t.guided.stepReview
    case 'lesson':
      return t.guided.stepLesson
    case 'practice':
      return t.guided.stepPractice
    case 'tutor':
      return t.guided.stepTutor
    default:
      return t.guided.stepRecap
  }
}

export function guidedStepPosition(step: GuidedStep): number {
  return GUIDED_ORDER.indexOf(step) + 1
}
