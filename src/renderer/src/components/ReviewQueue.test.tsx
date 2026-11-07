// @vitest-environment jsdom
/**
 * M6 (B1): a fila de revisão é dirigida pelo pai — o componente mostra sempre
 * `cards[0]` e não avança índice próprio. Este teste cobre a interação
 * pai ↔ `ReviewQueue` com uma fila de 5 cards: todos os 5 são respondidos,
 * na ordem, sem pular nenhum.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { CardView, ReviewRating } from '../../../shared/types'
import { ReviewQueue } from './ReviewQueue'

function card(id: number): CardView {
  return {
    id,
    kind: 'vocab',
    front: `frente ${id}`,
    back: `verso ${id}`,
    hint: null,
    tag: null,
    lessonId: null,
    state: 'learning',
    due: Date.now(),
    dueLabel: 'agora',
    reps: 1,
    lapses: 0,
    intervals: [
      { rating: 'again', label: '<1min' },
      { rating: 'hard', label: '2d' },
      { rating: 'good', label: '4d' },
      { rating: 'easy', label: '10d' }
    ]
  }
}

/** Imita os 4 pais reais (ReviewScreen/Tutor/Lesson/Guided): responder remove o card do array. */
function ParentHarness({
  onAnswered
}: {
  onAnswered: (cardId: number, rating: ReviewRating) => void
}): JSX.Element {
  const [cards, setCards] = useState<CardView[]>(() => [1, 2, 3, 4, 5].map(card))

  async function answer(cardId: number, rating: ReviewRating): Promise<void> {
    onAnswered(cardId, rating)
    setCards((previous) => previous.filter((entry) => entry.id !== cardId))
  }

  return <ReviewQueue cards={cards} onAnswer={answer} />
}

describe('ReviewQueue ↔ pai (M6/B1)', () => {
  it('responde os 5 cards de uma fila de 5, sem pular nenhum', async () => {
    const answered: Array<{ cardId: number; rating: ReviewRating }> = []

    render(<ParentHarness onAnswered={(cardId, rating) => answered.push({ cardId, rating })} />)

    for (const expectedId of [1, 2, 3, 4, 5]) {
      // O card exibido é sempre o primeiro da fila restante.
      await waitFor(() => expect(screen.getByText(`frente ${expectedId}`)).toBeTruthy())

      fireEvent.click(screen.getByText('Mostrar resposta'))
      fireEvent.click(screen.getByText('Bom'))
      await waitFor(() => expect(answered.length).toBe(expectedId))
    }

    expect(answered.map((entry) => entry.cardId)).toEqual([1, 2, 3, 4, 5])
    expect(screen.getByText('Fila zerada')).toBeTruthy()
  })
})
