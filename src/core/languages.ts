/**
 * Registro de idiomas (M4) — TS puro, portável, fonte da verdade para o app
 * ensinar *qualquer* idioma.
 *
 * Cada idioma traz o que a máquina de lições precisa saber para não tratar
 * todos como se fossem inglês:
 *
 * - `promptName`: como o idioma se chama dentro dos prompts (PT-BR — a
 *   linguagem interna de prompt do app, versionada junto com eles).
 * - `scriptDirection`: RTL exige `dir="auto"` no texto-alvo (árabe, hebraico…).
 * - `tokenization`: CJK não separa palavras por espaço — afeta ordem de
 *   frases, cloze e a normalização usada na correção determinística.
 * - `promptNotes`: restrições de registro/escrita por idioma (tú/usted,
 *   keigo, MSA…) que vão direto no system prompt.
 *
 * `Intl.Segmenter` (Node 16+ com ICU completo) resolve a segmentação de
 * palavras CJK de forma determinística, sem gastar token com extração por IA.
 */

export type ScriptDirection = 'ltr' | 'rtl'

export type Tokenization = 'space' | 'cjk'

export interface LanguageMeta {
  /** BCP-47 curto ('en', 'pt-BR', 'ja', 'zh'). */
  code: string
  /** Nome em inglês — rótulo estável entre interfaces. */
  name: string
  /** Nome no próprio idioma ('English', '日本語', 'español'). */
  nativeName: string
  /** Nome em PT-BR, usado nos prompts ('inglês', 'japonês'…). */
  promptName: string
  scriptDirection: ScriptDirection
  tokenization: Tokenization
  /** Notas de prompt por idioma (registro, escrita, tratamento). */
  promptNotes?: string
}

/**
 * Lista enxuta de propósito: cobre os idiomas que um brasileiro tipicamente
 * busca e os casos extremos de escrita (RTL e CJK). A geração é por IA —
 * qualquer código BCP-47 funciona; o registro só agrega metadados.
 */
export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', name: 'English', nativeName: 'English', promptName: 'inglês', scriptDirection: 'ltr', tokenization: 'space' },
  { code: 'es', name: 'Spanish', nativeName: 'español', promptName: 'espanhol', scriptDirection: 'ltr', tokenization: 'space', promptNotes: 'Alterne tú/usted conforme o contexto; marca explícita de registro no feedback.' },
  { code: 'fr', name: 'French', nativeName: 'français', promptName: 'francês', scriptDirection: 'ltr', tokenization: 'space', promptNotes: 'Liaison e "vous" de cortesia; atenção ao gênero dos substantivos.' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', promptName: 'alemão', scriptDirection: 'ltr', tokenization: 'space', promptNotes: 'Ordem verbal (verb no fim em subordinadas) e os três gêneros.' },
  { code: 'it', name: 'Italian', nativeName: 'italiano', promptName: 'italiano', scriptDirection: 'ltr', tokenization: 'space' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', promptName: 'neerlandês', scriptDirection: 'ltr', tokenization: 'space' },
  { code: 'sv', name: 'Swedish', nativeName: 'svenska', promptName: 'sueco', scriptDirection: 'ltr', tokenization: 'space' },
  { code: 'ru', name: 'Russian', nativeName: 'русский', promptName: 'russo', scriptDirection: 'ltr', tokenization: 'space', promptNotes: 'Casos nominais; explique declinações em PT-BR, transliteração opcional.' },
  { code: 'pl', name: 'Polish', nativeName: 'polski', promptName: 'polonês', scriptDirection: 'ltr', tokenization: 'space' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', promptName: 'turco', scriptDirection: 'ltr', tokenization: 'space', promptNotes: 'Aglutinação: explique sufixos um por vez.' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', promptName: 'árabe', scriptDirection: 'rtl', tokenization: 'space', promptNotes: 'Use árabe padrão moderno (MSA) simples; escrita RTL; vocalização (harakat) opcional entre parênteses.' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', promptName: 'hebraico', scriptDirection: 'rtl', tokenization: 'space', promptNotes: 'Escrita RTL; sem vocalização por padrão.' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', promptName: 'persa', scriptDirection: 'rtl', tokenization: 'space' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', promptName: 'japonês', scriptDirection: 'ltr', tokenization: 'cjk', promptNotes: 'Padrão desu/masu; kanji comuns ao nível, com furigana (hiragana) entre parênteses quando novo.' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', promptName: 'coreano', scriptDirection: 'ltr', tokenization: 'cjk', promptNotes: 'Honoríficos: comece com o registro polite (-(스)ㅂ니다/-(아)요) e explique a diferença.' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', promptName: 'chinês', scriptDirection: 'ltr', tokenization: 'cjk', promptNotes: 'Chinês mandarim simplificado; inclua pinyin entre parênteses para todo termo novo.' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', nativeName: 'português do Brasil', promptName: 'português do Brasil', scriptDirection: 'ltr', tokenization: 'space' }
]

const BY_CODE = new Map(LANGUAGES.map((language) => [language.code.toLowerCase(), language]))

const UNKNOWN: LanguageMeta = {
  code: 'und',
  name: 'the requested language',
  nativeName: 'the requested language',
  promptName: 'o idioma pedido',
  scriptDirection: 'ltr',
  tokenization: 'space'
}

function matches(code: string, entry: LanguageMeta): boolean {
  if (entry.code.toLowerCase() === code) return true
  // 'pt' cobre 'pt-BR' como nativo, mas 'pt-BR' é entrada própria;
  // 'zh-TW' herda a metadados de 'zh', 'en-GB' herda de 'en'.
  return entry.code.toLowerCase().startsWith(`${code}-`) || code.startsWith(`${entry.code}-`)
}

/** Metadados por código, tolerando região ('zh-TW' → 'zh'). Desconhecido não quebra nada. */
export function languageMeta(code: string | null | undefined): LanguageMeta {
  const wanted = (code ?? '').trim().toLowerCase()
  if (!wanted) return UNKNOWN
  const direct = BY_CODE.get(wanted)
  if (direct) return direct

  for (const entry of LANGUAGES) {
    if (wanted === entry.code.toLowerCase().split('-')[0]) return entry
  }
  for (const entry of LANGUAGES) {
    if (matches(wanted, entry)) return entry
  }

  return { ...UNKNOWN, code: (code ?? '').trim(), name: (code ?? '').trim(), nativeName: (code ?? '').trim(), promptName: (code ?? '').trim() }
}

export function isRtl(code: string | null | undefined): boolean {
  return languageMeta(code).scriptDirection === 'rtl'
}

export function tokenizationOf(code: string | null | undefined): Tokenization {
  return languageMeta(code).tokenization
}

/**
 * Divida um texto em unidades de "palavra" segundo a escrita do idioma.
 * CJK: `Intl.Segmenter` (determinístico, sem IA); fallback por caractere.
 * Space: separação por whitespace como sempre.
 */
export function tokenize(text: string, code: string | null | undefined): string[] {
  const value = text.trim()
  if (!value) return []

  if (tokenizationOf(code) === 'cjk') {
    try {
      const segmenter = new Intl.Segmenter(value ? (code ?? undefined) : undefined, { granularity: 'word' })
      const units = [...segmenter.segment(value)]
        .filter((unit) => unit.isWordLike)
        .map((unit) => unit.segment)
      if (units.length > 0) return units
      // Frase só de pontuação/charactere: cai em caracteres não-espaço.
      return [...value.replace(/\s+/g, '')]
    } catch {
      return [...value.replace(/\s+/g, '')]
    }
  }

  return value.split(/\s+/).filter(Boolean)
}

/**
 * O gerador determinístico offline (fallback.ts) só produz conteúdo de
 * qualidade para o idioma-fixture do plano (§"qualquer idioma com inglês como
 * fixture de qualidade"). Sem IA e sem fixture, o app degrada com erro claro
 * em vez de entregar frases inventadas em outro idioma.
 */
export function deterministicContentSupported(targetLang: string | null | undefined): boolean {
  return languageMeta(targetLang).code.toLowerCase() === 'en'
}

/** Linha para semear a tabela `languages` do banco (metadados portáveis). */
export interface LanguageSeedRow {
  code: string
  name: string
  scriptDirection: ScriptDirection
  tokenization: Tokenization
  promptNotes: string | null
}

export function languageSeedRows(): LanguageSeedRow[] {
  return LANGUAGES.map((entry) => ({
    code: entry.code,
    name: entry.name,
    scriptDirection: entry.scriptDirection,
    tokenization: entry.tokenization,
    promptNotes: entry.promptNotes ?? null
  }))
}

/**
 * Par de idiomas injetado em todo builder de prompt (M4): `target` é o idioma
 * ensinado, `native` é o idioma das explicações. Os campos `*Name` já vêm
 * prontos para o texto do prompt (PT-BR, a linguagem interna versionada).
 */
export interface PromptLocale {
  target: LanguageMeta
  native: LanguageMeta
  targetName: string
  nativeName: string
}

