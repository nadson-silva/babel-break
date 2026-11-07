/**
 * Texto de runtime do processo main, no idioma do aluno (M5).
 *
 * É a lapidação da pendência registrada no fim do M4: strings que **não** são de
 * interface, e sim conteúdo do modelo do aluno — card SRS, rótulo de intervalo
 * FSRS, recapitulação de fechamento, motivo da sugestão da home, mensagens de
 * erro de geração. Elas nascem no main, onde o dicionário do renderer não existe,
 * então precisam de um lugar próprio, parametrizado pelo `nativeLang` do perfil.
 *
 * Contrato: todo idioma cobre todas as chaves (coberto por teste), e um idioma
 * desconhecido cai em inglês — nunca em texto inventado.
 */
import type { PromptLocale } from './languages'

export type RuntimeTextKey =
  // cards SRS (conteúdo gravado no banco no momento da criação)
  | 'card.clozeHint'
  | 'card.vocabHint'
  | 'card.phraseFront'
  | 'card.phraseHint'
  | 'card.errorFront'
  | 'card.errorHint'
  // agendamento
  | 'due.now'
  | 'due.relative'
  | 'unit.minutes'
  | 'unit.hours'
  | 'unit.days'
  | 'unit.months'
  | 'unit.years'
  | 'rating.again'
  | 'rating.hard'
  | 'rating.good'
  | 'rating.easy'
  // fechamento de conversa / sessão guiada
  | 'recap.noCorrections'
  | 'recap.corrections'
  | 'recap.areas'
  | 'recap.scenario'
  | 'recap.cards'
  | 'recap.level'
  // sugestão da home ("próximo passo")
  | 'suggest.track'
  | 'suggest.baseUnit'
  | 'suggest.base'
  // correção local sem IA (exercício objetivo)
  | 'grade.correct'
  | 'grade.incorrect'
  // erros de geração — o app explica a degradação no idioma do aluno
  | 'error.noModel'
  | 'error.aiUnavailableCurriculum'
  | 'error.aiUnavailableContent'
  | 'error.aiUnavailableExercises'
  | 'error.aiKeptExercises'
  | 'error.exerciseRemoved'

type Templates = Record<RuntimeTextKey, string>

const PT_BR: Templates = {
  'card.clozeHint': 'Complete a frase com a palavra que significa “{translation}”.',
  'card.vocabHint': 'Diga o termo em {target}.',
  'card.phraseFront': 'Traduza para o {target}: {native}',
  'card.phraseHint': 'Fale ou escreva a frase em {target} antes de virar o card.',
  'card.errorFront': 'Corrija a frase: “{original}”',
  'card.errorHint': 'Diga a versão correta em {target} antes de virar o card.',
  'due.now': 'agora',
  'due.relative': 'em {value}',
  'unit.minutes': '{value} min',
  'unit.hours': '{value} h',
  'unit.days': '{value} d',
  'unit.months': '{value} mo',
  'unit.years': '{value} a',
  'rating.again': 'de novo',
  'rating.hard': 'difícil',
  'rating.good': 'bom',
  'rating.easy': 'fácil',
  'recap.noCorrections': 'Nenhuma correção de língua nesta sessão — você se saiu bem.',
  'recap.corrections': '{count} correções',
  'recap.areas': ', nas áreas {tags}',
  'recap.scenario': 'Cenário: tarefa {content}% · língua {language}%.',
  'recap.cards': '{count} card(s) novos na fila de revisão.',
  'recap.level': 'Seu nível foi reestimado de {from} para {to}.',
  'suggest.track': 'da sua trilha “{title}”',
  'suggest.baseUnit': 'do currículo base · {unit}',
  'suggest.base': 'do currículo base',
  'grade.correct': 'Correto!',
  'grade.incorrect': 'Ainda não. Resposta esperada: {answer}',
  'error.noModel':
    'Nenhum modelo configurado. Abra Configurações, escolha um provedor e um modelo antes de gerar conteúdo.',
  'error.aiUnavailableCurriculum':
    'A IA está indisponível e o plano de currículo offline só cobre inglês. Para montar um currículo de {target}, configure um provedor em Configurações.',
  'error.aiUnavailableContent':
    'A IA está indisponível e o gerador offline só cobre inglês (o idioma-fixture do app). Para gerar conteúdo de {target}, configure um provedor em Configurações.',
  'error.aiUnavailableExercises':
    'A IA está indisponível e o gerador offline só cobre inglês. Para gerar exercícios de {target}, configure um provedor em Configurações.',
  'error.aiKeptExercises':
    'A IA está indisponível, então os exercícios atuais foram mantidos. Tente de novo quando o provedor voltar.',
  'error.exerciseRemoved':
    'Este exercício saiu da prática porque você reportou conteúdo ruim. Abra a lição de novo para receber exercícios novos.'
}

const EN: Templates = {
  'card.clozeHint': 'Complete the sentence with the word that means “{translation}”.',
  'card.vocabHint': 'Say the term in {target}.',
  'card.phraseFront': 'Translate into {target}: {native}',
  'card.phraseHint': 'Say or write the sentence in {target} before flipping the card.',
  'card.errorFront': 'Fix the sentence: “{original}”',
  'card.errorHint': 'Say the correct version in {target} before flipping the card.',
  'due.now': 'now',
  'due.relative': 'in {value}',
  'unit.minutes': '{value} min',
  'unit.hours': '{value} h',
  'unit.days': '{value} d',
  'unit.months': '{value} mo',
  'unit.years': '{value} y',
  'rating.again': 'again',
  'rating.hard': 'hard',
  'rating.good': 'good',
  'rating.easy': 'easy',
  'recap.noCorrections': 'No language corrections in this session — you did well.',
  'recap.corrections': '{count} corrections',
  'recap.areas': ', in {tags}',
  'recap.scenario': 'Scenario: task {content}% · language {language}%.',
  'recap.cards': '{count} new card(s) in your review queue.',
  'recap.level': 'Your level was re-estimated from {from} to {to}.',
  'suggest.track': 'from your “{title}” track',
  'suggest.baseUnit': 'from the base curriculum · {unit}',
  'suggest.base': 'from the base curriculum',
  'grade.correct': 'Correct!',
  'grade.incorrect': 'Not yet. Expected answer: {answer}',
  'error.noModel':
    'No model configured. Open Settings, pick a provider and a model before generating content.',
  'error.aiUnavailableCurriculum':
    'AI is unavailable and the offline curriculum plan only covers English. To build a {target} curriculum, configure a provider in Settings.',
  'error.aiUnavailableContent':
    'AI is unavailable and the offline generator only covers English (the app’s quality fixture). To generate {target} content, configure a provider in Settings.',
  'error.aiUnavailableExercises':
    'AI is unavailable and the offline generator only covers English. To generate {target} exercises, configure a provider in Settings.',
  'error.aiKeptExercises':
    'AI is unavailable, so the current exercises were kept. Try again once the provider is back.',
  'error.exerciseRemoved':
    'This exercise left the practice because you reported bad content. Reopen the lesson to get new exercises.'
}

const ES: Templates = {
  'card.clozeHint': 'Completa la frase con la palabra que significa “{translation}”.',
  'card.vocabHint': 'Di el término en {target}.',
  'card.phraseFront': 'Traduce al {target}: {native}',
  'card.phraseHint': 'Di o escribe la frase en {target} antes de girar la ficha.',
  'card.errorFront': 'Corrige la frase: “{original}”',
  'card.errorHint': 'Di la versión correcta en {target} antes de girar la ficha.',
  'due.now': 'ahora',
  'due.relative': 'en {value}',
  'unit.minutes': '{value} min',
  'unit.hours': '{value} h',
  'unit.days': '{value} d',
  'unit.months': '{value} meses',
  'unit.years': '{value} años',
  'rating.again': 'otra vez',
  'rating.hard': 'difícil',
  'rating.good': 'bien',
  'rating.easy': 'fácil',
  'recap.noCorrections': 'Ninguna corrección de idioma en esta sesión — te fue bien.',
  'recap.corrections': '{count} correcciones',
  'recap.areas': ', en {tags}',
  'recap.scenario': 'Escenario: tarea {content}% · idioma {language}%.',
  'recap.cards': '{count} ficha(s) nueva(s) en la cola de repaso.',
  'recap.level': 'Tu nivel se recalculó de {from} a {to}.',
  'suggest.track': 'de tu ruta “{title}”',
  'suggest.baseUnit': 'del plan base · {unit}',
  'suggest.base': 'del plan base',
  'grade.correct': '¡Correcto!',
  'grade.incorrect': 'Todavía no. Respuesta esperada: {answer}',
  'error.noModel':
    'No hay modelo configurado. Abre Configuración, elige un proveedor y un modelo antes de generar contenido.',
  'error.aiUnavailableCurriculum':
    'La IA no está disponible y el plan de currículo sin conexión solo cubre inglés. Para crear un currículo de {target}, configura un proveedor en Configuración.',
  'error.aiUnavailableContent':
    'La IA no está disponible y el generador sin conexión solo cubre inglés (el idioma de referencia de la app). Para generar contenido en {target}, configura un proveedor en Configuración.',
  'error.aiUnavailableExercises':
    'La IA no está disponible y el generador sin conexión solo cubre inglés. Para generar ejercicios de {target}, configura un proveedor en Configuración.',
  'error.aiKeptExercises':
    'La IA no está disponible, así que se mantuvieron los ejercicios actuales. Inténtalo de nuevo cuando el proveedor vuelva.',
  'error.exerciseRemoved':
    'Este ejercicio salió de la práctica porque reportaste contenido malo. Abre de nuevo la lección para recibir ejercicios nuevos.'
}

const FR: Templates = {
  'card.clozeHint': 'Complétez la phrase avec le mot qui signifie “{translation}”.',
  'card.vocabHint': 'Dites le terme en {target}.',
  'card.phraseFront': 'Traduisez en {target} : {native}',
  'card.phraseHint': 'Dites ou écrivez la phrase en {target} avant de retourner la carte.',
  'card.errorFront': 'Corrigez la phrase : “{original}”',
  'card.errorHint': 'Donnez la version correcte en {target} avant de retourner la carte.',
  'due.now': 'maintenant',
  'due.relative': 'dans {value}',
  'unit.minutes': '{value} min',
  'unit.hours': '{value} h',
  'unit.days': '{value} j',
  'unit.months': '{value} mois',
  'unit.years': '{value} an(s)',
  'rating.again': 'encore',
  'rating.hard': 'difficile',
  'rating.good': 'bien',
  'rating.easy': 'facile',
  'recap.noCorrections': 'Aucune correction linguistique dans cette session — vous vous en êtes bien sorti.',
  'recap.corrections': '{count} corrections',
  'recap.areas': ', dans {tags}',
  'recap.scenario': 'Scénario : tâche {content}% · langue {language}%.',
  'recap.cards': '{count} nouvelle(s) carte(s) dans la file de révision.',
  'recap.level': 'Votre niveau a été réévalué de {from} à {to}.',
  'suggest.track': 'de votre parcours “{title}”',
  'suggest.baseUnit': 'du programme de base · {unit}',
  'suggest.base': 'du programme de base',
  'grade.correct': 'Correct !',
  'grade.incorrect': 'Pas encore. Réponse attendue : {answer}',
  'error.noModel':
    'Aucun modèle configuré. Ouvrez les Paramètres et choisissez un fournisseur et un modèle avant de générer du contenu.',
  'error.aiUnavailableCurriculum':
    "L'IA est indisponible et le plan de programme hors ligne ne couvre que l'anglais. Pour construire un programme en {target}, configurez un fournisseur dans les Paramètres.",
  'error.aiUnavailableContent':
    "L'IA est indisponible et le générateur hors ligne ne couvre que l'anglais (la langue de référence de l'app). Pour générer du contenu en {target}, configurez un fournisseur dans les Paramètres.",
  'error.aiUnavailableExercises':
    "L'IA est indisponible et le générateur hors ligne ne couvre que l'anglais. Pour générer des exercices en {target}, configurez un fournisseur dans les Paramètres.",
  'error.aiKeptExercises':
    "L'IA est indisponible, les exercices actuels ont donc été conservés. Réessayez quand le fournisseur sera de retour.",
  'error.exerciseRemoved':
    'Cet exercice a quitté la pratique parce que vous avez signalé un contenu de mauvaise qualité. Rouvrez la leçon pour recevoir de nouveaux exercices.'
}

const DICTIONARIES: Record<string, Templates> = {
  'pt-BR': PT_BR,
  en: EN,
  es: ES,
  fr: FR
}

/** Visível para teste: os idiomas de runtime que existem, de fato. */
export const RUNTIME_TEXT_LANGUAGES = Object.keys(DICTIONARIES)

export const RUNTIME_TEXT_KEYS = Object.keys(PT_BR) as RuntimeTextKey[]

function normalize(code: string | null | undefined): string {
  return (code ?? '').trim()
}

/**
 * Dicionário do idioma das explicações: 'pt' → pt-BR, 'en-US' → en, 'pt-PT' → en
 * (não existe banco de runtime para europeu — inglês é a língua neutra de fallback).
 */
export function runtimeTemplates(code: string | null | undefined): Templates {
  const wanted = normalize(code)
  if (DICTIONARIES[wanted]) return DICTIONARIES[wanted]

  const lower = wanted.toLowerCase()
  if (lower === 'pt' || lower.startsWith('pt-br')) return DICTIONARIES['pt-BR']

  const base = lower.split('-')[0]
  const exact = Object.keys(DICTIONARIES).find((key) => key.toLowerCase() === base)
  if (exact) return DICTIONARIES[exact]

  const prefix = Object.keys(DICTIONARIES).find((key) => key.toLowerCase().startsWith(`${base}-`))
  if (prefix) return DICTIONARIES[prefix]

  return DICTIONARIES.en
}

export type RuntimeVars = Record<string, string | number>

/** Frase de runtime no idioma do aluno, com `{var}` interpoladas. */
export function runtimeText(
  lang: string | null | undefined,
  key: RuntimeTextKey,
  vars: RuntimeVars = {}
): string {
  const template = runtimeTemplates(lang)[key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

/** Atalho quando o chamador só tem o par de idiomas dos prompts em mãos. */
export function runtimeTextForLocale(
  locale: PromptLocale,
  key: RuntimeTextKey,
  vars: RuntimeVars = {}
): string {
  return runtimeText(locale.native.code, key, vars)
}

/** Decimal regional ('4,5 a' em PT/ES, '4.5 y' nos demais). */
export function localizeDecimal(value: string, lang: string | null | undefined): string {
  const lower = normalize(lang).toLowerCase()
  return lower.startsWith('pt') || lower.startsWith('es') ? value.replace('.', ',') : value
}
