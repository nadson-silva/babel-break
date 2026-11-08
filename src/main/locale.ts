/**
 * Ponte perfil → idiomas (M4, escopada por perfil na v2). Todo módulo do processo
 * main que gera conteúdo ou corrige texto precisa do par de idiomas **do aluno
 * dono daquilo**; nada aqui conhece IA ou UI.
 *
 * A versão antiga lia "o perfil padrão" por dentro, o que com dois perfis fazia
 * um aluno de japonês receber cards em português do perfil de inglês. Agora ou o
 * chamador passa a linha do perfil (de graça), ou passa o id (uma consulta).
 */
import { eq } from 'drizzle-orm'
import {
  interferenceRulesFor,
  hasInterferenceBank,
  type InterferenceRule
} from '../core/interference'
import {
  languageMeta,
  tokenize as tokenizeText,
  type LanguageMeta,
  type PromptLocale
} from '../core/languages'
import { promptLocale } from '../core/prompts'
import { getDb, schema } from './db'
import { activeProfileId } from './profiles'

type ProfileRow = typeof schema.profiles.$inferSelect

/** Linha do perfil por id (null = perfil inexistente; o chamador decide o erro). */
export function profileRow(profileId: number): ProfileRow | null {
  return getDb().select().from(schema.profiles).where(eq(schema.profiles.id, profileId)).get() ?? null
}

function rowOf(profile: ProfileRow | number): ProfileRow {
  const row = typeof profile === 'number' ? profileRow(profile) : profile
  if (!row) throw new Error('Perfil não encontrado.')
  return row
}

export function localeFor(profile: ProfileRow | number): PromptLocale {
  const row = rowOf(profile)
  return promptLocale(row.targetLang, row.nativeLang)
}

/** Idioma das explicações do perfil (M5): o idioma em que o main escreve texto de runtime. */
export function nativeLangFor(profile: ProfileRow | number): string {
  return rowOf(profile).nativeLang
}

export function targetMetaFor(profile: ProfileRow | number): LanguageMeta {
  return languageMeta(rowOf(profile).targetLang)
}

/** Regras do banco manual para o par do perfil; [] = correção fica toda com a IA. */
export function interferenceRulesForProfile(profile: ProfileRow | number): InterferenceRule[] {
  const row = rowOf(profile)
  return interferenceRulesFor(row.targetLang, row.nativeLang)
}

export function hasBankFor(profile: ProfileRow | number): boolean {
  const row = rowOf(profile)
  return hasInterferenceBank(row.targetLang, row.nativeLang)
}

/** Segmenta texto no idioma-alvo do perfil (espaço ou CJK via Intl.Segmenter). */
export function tokenizeFor(profile: ProfileRow | number, text: string): string[] {
  const row = rowOf(profile)
  return tokenizeText(text, row.targetLang)
}

/**
 * Versões "do perfil ativo" — para o código que ainda não tem a linha do perfil
 * em mãos. São uma consulta por chamada, não um singleton: se o perfil ativo
 * mudou entre duas chamadas, a próxima já reflete isso.
 */
export function profileLocale(): PromptLocale {
  return localeFor(activeProfileId())
}

export function profileNativeLang(): string {
  return nativeLangFor(activeProfileId())
}

export function profileTargetMeta(): LanguageMeta {
  return targetMetaFor(activeProfileId())
}

export function profileInterferenceRules(): InterferenceRule[] {
  return interferenceRulesForProfile(activeProfileId())
}

export function profileHasBank(): boolean {
  return hasBankFor(activeProfileId())
}

export function tokenizeTarget(text: string): string[] {
  return tokenizeFor(activeProfileId(), text)
}
