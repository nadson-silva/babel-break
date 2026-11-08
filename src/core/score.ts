/**
 * V2 — escala de score única do app (D7).
 *
 * O score persistido é **sempre 0–1** (tentativa, rubrica de cenário, pronúncia,
 * compreensão). A estimativa de habilidade (`skills_state.estimate`) vive em 0–5
 * porque é o que o nível CEFR consome. Confundir as duas escalas foi o bug
 * silencioso que a v2 não pode levar junto: voz entraria em 0–1 num sistema que
 * lê 0–5.
 *
 * Toda conversão passa por aqui. Nada de `score * 5` solto no meio do código.
 */

export const SKILL_SCALE_MAX = 5

/** Recorta para 0–1 sem NaN (modelo devolve lixo com frequência). */
export function clampScore01(value: number | null | undefined): number {
  // `NaN`/ausente é lixo: zero. `±Infinity` é lixo *direcionado*: recorta para a
  // beirada, que é o que "clamp" significa (e não recompensa quem devolveu lixo).
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Recorta para 0–5 (a escala da estimativa de habilidade). */
export function clampSkill(estimate: number | null | undefined): number {
  if (typeof estimate !== 'number' || Number.isNaN(estimate)) return 0
  return Math.min(SKILL_SCALE_MAX, Math.max(0, estimate))
}

/** Score do app → amostra de habilidade (0–5). */
export function skillSample(score: number | null | undefined): number {
  return clampScore01(score) * SKILL_SCALE_MAX
}

/** Amostra de habilidade → score do app (0–1). */
export function scoreFromSkill(estimate: number | null | undefined): number {
  return clampSkill(estimate) / SKILL_SCALE_MAX
}

/** Percenteiro para exibir ("Pronúncia: 82%"). */
export function scorePercent(score: number | null | undefined): number {
  return Math.round(clampScore01(score) * 100)
}

/**
 * Nota "certa o suficiente" de uma tentativa de voz: o mesmo piso em todo o app.
 * Abaixo disto a fala conta como erro no painel de progresso, não como acerto.
 */
export const SPEECH_PASS_SCORE = 0.7

export function speechPassed(score: number | null | undefined): boolean {
  return clampScore01(score) >= SPEECH_PASS_SCORE
}
