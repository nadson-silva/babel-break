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
  // gerador determinístico (fallback) — enunciados no idioma do aluno (M6/B8)
  | 'fb.mcTranslation.instruction'
  | 'fb.mcTranslation.prompt'
  | 'fb.mcTranslation.explanation'
  | 'fb.cloze.instruction'
  | 'fb.cloze.explanation'
  | 'fb.order.instruction'
  | 'fb.order.prompt'
  | 'fb.order.explanation'
  | 'fb.translate.instruction'
  | 'fb.translate.explanation'
  | 'fb.free.instruction'
  | 'fb.free.prompt'
  | 'fb.free.explanation'
  | 'fb.orderFocus.instruction'
  | 'fb.orderFocus.prompt'
  | 'fb.orderFocus.explanation'
  | 'fb.spotError.instruction'
  | 'fb.spotError.prompt'
  | 'fb.spotError.explanation'
  // rubrica local do cenário (sem IA) e rótulo de trilha
  | 'rubric.fewTurns'
  | 'rubric.turns'
  | 'rubric.touched'
  | 'rubric.noJudge'
  | 'rubric.noErrors'
  | 'rubric.errors'
  | 'rubric.drillCorrections'
  | 'rubric.drillRepeat'
  | 'track.defaultTitle'
  // correção local sem IA (exercício objetivo)
  | 'grade.correct'
  | 'grade.incorrect'
  | 'grade.explanation'
  | 'grade.compare'
  | 'grade.translateCorrect'
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
  'grade.explanation': 'Ainda não. {explanation}',
  'grade.compare': 'Ainda não. Compare com a resposta esperada e tente de novo.',
  'grade.translateCorrect': 'Correto! Tradução natural.',
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
    'Este exercício saiu da prática porque você reportou conteúdo ruim. Abra a lição de novo para receber exercícios novos.',
  'fb.mcTranslation.instruction': 'Escolha a tradução correta.',
  'fb.mcTranslation.prompt': 'O que significa “{term}”?',
  'fb.mcTranslation.explanation': '“{term}” significa “{translation}”.',
  'fb.cloze.instruction': 'Complete a frase com a palavra que falta; a tradução dela está entre parênteses.',
  'fb.cloze.explanation': 'Leia a frase completa para conferir o sentido.',
  'fb.order.instruction': 'Ordene as palavras para formar a frase.',
  'fb.order.prompt': 'Monte a frase correta.',
  'fb.order.explanation': 'Observe a ordem sujeito + verbo + complemento.',
  'fb.translate.instruction': 'Traduza a frase para o {target}.',
  'fb.translate.explanation': 'Compare sua tradução com a versão em {target}.',
  'fb.free.instruction': 'Escreva uma resposta curta usando o conteúdo da lição.',
  'fb.free.prompt': 'Escreva 2 frases sobre: {topic}',
  'fb.free.explanation': 'Use o vocabulário e a estrutura que você praticou em {target}.',
  'fb.orderFocus.instruction': 'Reconstrua a frase correta (área: {tag}).',
  'fb.orderFocus.prompt': 'Monte a frase correta em {target}.',
  'fb.orderFocus.explanation': 'Forma correta: “{sentence}”.',
  'fb.spotError.instruction': 'Escolha a frase correta.',
  'fb.spotError.prompt': 'Qual destas frases está certa em {target}? (área: {tag})',
  'fb.spotError.explanation': '“{sentence}” é a forma natural.',
  'rubric.fewTurns': 'Poucas falas suas no roleplay: na próxima, responda e devolva uma pergunta ao personagem.',
  'rubric.turns': 'Você sustentou {turns} falas no cenário ({words} palavras).',
  'rubric.touched': 'Assuntos da tarefa reconhecidos na sua fala: {touched} de {total}.',
  'rubric.noJudge': 'A rubrica local não julga o sentido da tarefa — ela mede participação. Faça de novo e cite o assunto pedido.',
  'rubric.noErrors': 'Nenhum erro de língua foi registrado.',
  'rubric.errors': 'A língua teve {count} correção(ões): elas já estão no seu caderno.',
  'rubric.drillCorrections': 'Refaça por escrito suas três melhores falas do roleplay, aplicando as correções do caderno.',
  'rubric.drillRepeat': 'Repita o mesmo cenário falando uma frase a mais em cada resposta.',
  'track.defaultTitle': 'Trilha de foco',
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
  'grade.explanation': 'Not yet. {explanation}',
  'grade.compare': 'Not yet. Compare with the expected answer and try again.',
  'grade.translateCorrect': 'Correct! Natural translation.',
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
    'This exercise left the practice because you reported bad content. Reopen the lesson to get new exercises.',
  'fb.mcTranslation.instruction': 'Choose the correct translation.',
  'fb.mcTranslation.prompt': 'What does “{term}” mean?',
  'fb.mcTranslation.explanation': '“{term}” means “{translation}”.',
  'fb.cloze.instruction': 'Complete the sentence with the missing word; its translation is in parentheses.',
  'fb.cloze.explanation': 'Read the full sentence to check the meaning.',
  'fb.order.instruction': 'Put the words in order to form the sentence.',
  'fb.order.prompt': 'Build the correct sentence.',
  'fb.order.explanation': 'Note the order subject + verb + object.',
  'fb.translate.instruction': 'Translate the sentence into {target}.',
  'fb.translate.explanation': 'Compare your translation with the {target} version.',
  'fb.free.instruction': 'Write a short answer using the lesson content.',
  'fb.free.prompt': 'Write 2 sentences about: {topic}',
  'fb.free.explanation': 'Use the vocabulary and structure you practiced in {target}.',
  'fb.orderFocus.instruction': 'Rebuild the correct sentence (area: {tag}).',
  'fb.orderFocus.prompt': 'Build the correct sentence in {target}.',
  'fb.orderFocus.explanation': 'Correct form: “{sentence}”.',
  'fb.spotError.instruction': 'Choose the correct sentence.',
  'fb.spotError.prompt': 'Which of these sentences is right in {target}? (area: {tag})',
  'fb.spotError.explanation': '“{sentence}” is the natural form.',
  'rubric.fewTurns': 'Few of your lines in the roleplay: next time, answer and throw a question back at the character.',
  'rubric.turns': 'You kept {turns} lines in the scenario ({words} words).',
  'rubric.touched': 'Task topics recognized in your speech: {touched} of {total}.',
  'rubric.noJudge': 'The local rubric does not judge task meaning — it measures participation. Do it again and mention the requested topic.',
  'rubric.noErrors': 'No language errors were recorded.',
  'rubric.errors': 'Language had {count} correction(s): they are already in your error notebook.',
  'rubric.drillCorrections': 'Rewrite your three best lines from the roleplay, applying the notebook corrections.',
  'rubric.drillRepeat': 'Repeat the same scenario saying one more sentence in each answer.',
  'track.defaultTitle': 'Focus track',
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
  'grade.explanation': 'Todavía no. {explanation}',
  'grade.compare': 'Todavía no. Compara con la respuesta esperada e inténtalo de nuevo.',
  'grade.translateCorrect': '¡Correcto! Traducción natural.',
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
    'Este ejercicio salió de la práctica porque reportaste contenido malo. Abre de nuevo la lección para recibir ejercicios nuevos.',
  'fb.mcTranslation.instruction': 'Elige la traducción correcta.',
  'fb.mcTranslation.prompt': '¿Qué significa “{term}”?',
  'fb.mcTranslation.explanation': '“{term}” significa “{translation}”.',
  'fb.cloze.instruction': 'Completa la frase con la palabra que falta; su traducción está entre paréntesis.',
  'fb.cloze.explanation': 'Lee la frase completa para comprobar el sentido.',
  'fb.order.instruction': 'Ordena las palabras para formar la frase.',
  'fb.order.prompt': 'Construye la frase correcta.',
  'fb.order.explanation': 'Observa el orden sujeto + verbo + complemento.',
  'fb.translate.instruction': 'Traduce la frase al {target}.',
  'fb.translate.explanation': 'Compara tu traducción con la versión en {target}.',
  'fb.free.instruction': 'Escribe una respuesta corta usando el contenido de la lección.',
  'fb.free.prompt': 'Escribe 2 frases sobre: {topic}',
  'fb.free.explanation': 'Usa el vocabulario y la estructura que practicaste en {target}.',
  'fb.orderFocus.instruction': 'Reconstruye la frase correcta (área: {tag}).',
  'fb.orderFocus.prompt': 'Construye la frase correcta en {target}.',
  'fb.orderFocus.explanation': 'Forma correcta: “{sentence}”.',
  'fb.spotError.instruction': 'Elige la frase correcta.',
  'fb.spotError.prompt': '¿Cuál de estas frases es correcta en {target}? (área: {tag})',
  'fb.spotError.explanation': '“{sentence}” es la forma natural.',
  'rubric.fewTurns': 'Pocas intervenciones tuyas en el roleplay: la próxima vez responde y devuelve una pregunta al personaje.',
  'rubric.turns': 'Mantuviste {turns} intervenciones en el escenario ({words} palabras).',
  'rubric.touched': 'Temas de la tarea reconocidos en tu habla: {touched} de {total}.',
  'rubric.noJudge': 'La rúbrica local no juzga el sentido de la tarea: mide participación. Repítela y menciona el tema pedido.',
  'rubric.noErrors': 'No se registró ningún error de idioma.',
  'rubric.errors': 'El idioma tuvo {count} corrección(es): ya están en tu cuaderno.',
  'rubric.drillCorrections': 'Reescribe por escrito tus tres mejores intervenciones del roleplay aplicando las correcciones del cuaderno.',
  'rubric.drillRepeat': 'Repite el mismo escenario diciendo una frase más en cada respuesta.',
  'track.defaultTitle': 'Itinerario de foco',
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
  'grade.explanation': 'Pas encore. {explanation}',
  'grade.compare': 'Pas encore. Comparez avec la réponse attendue et réessayez.',
  'grade.translateCorrect': 'Correct ! Traduction naturelle.',
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
    'Cet exercice a quitté la pratique parce que vous avez signalé un contenu de mauvaise qualité. Rouvrez la leçon pour recevoir de nouveaux exercices.',
  'fb.mcTranslation.instruction': 'Choisissez la traduction correcte.',
  'fb.mcTranslation.prompt': 'Que signifie « {term} » ?',
  'fb.mcTranslation.explanation': '« {term} » signifie « {translation} ».',
  'fb.cloze.instruction': 'Complétez la phrase avec le mot manquant ; sa traduction est entre parenthèses.',
  'fb.cloze.explanation': 'Lisez la phrase complète pour vérifier le sens.',
  'fb.order.instruction': 'Ordenez les mots pour former la phrase.',
  'fb.order.prompt': 'Construisez la phrase correcte.',
  'fb.order.explanation': 'Observez l’ordre sujet + verbe + complément.',
  'fb.translate.instruction': 'Traduisez la phrase en {target}.',
  'fb.translate.explanation': 'Comparez votre traduction avec la version en {target}.',
  'fb.free.instruction': 'Écrivez une réponse courte en utilisant le contenu de la leçon.',
  'fb.free.prompt': 'Écrivez 2 phrases sur : {topic}',
  'fb.free.explanation': 'Utilisez le vocabulaire et la structure que vous avez pratiqués en {target}.',
  'fb.orderFocus.instruction': 'Reconstruisez la phrase correcte (domaine : {tag}).',
  'fb.orderFocus.prompt': 'Construisez la phrase correcte en {target}.',
  'fb.orderFocus.explanation': 'Forme correcte : « {sentence} ».',
  'fb.spotError.instruction': 'Choisissez la phrase correcte.',
  'fb.spotError.prompt': 'Laquelle de ces phrases est correcte en {target} ? (domaine : {tag})',
  'fb.spotError.explanation': '« {sentence} » est la forme naturelle.',
  'rubric.fewTurns': 'Peu de répliques de votre part dans le jeu de rôle : la prochaine fois, répondez et renvoyez une question au personnage.',
  'rubric.turns': 'Vous avez tenu {turns} répliques dans le scénario ({words} mots).',
  'rubric.touched': 'Sujets de la tâche reconnus dans votre propos : {touched} sur {total}.',
  'rubric.noJudge': 'La grille locale ne juge pas le sens de la tâche — elle mesure la participation. Refaites-la en citant le sujet demandé.',
  'rubric.noErrors': 'Aucune erreur de langue enregistrée.',
  'rubric.errors': 'La langue a reçu {count} correction(s) : elles sont déjà dans votre cahier.',
  'rubric.drillCorrections': 'Réécrivez par écrit vos trois meilleures répliques du jeu de rôle en appliquant les corrections du cahier.',
  'rubric.drillRepeat': 'Reprenez le même scénario en disant une phrase de plus dans chaque réponse.',
  'track.defaultTitle': 'Parcours cible',
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
  const direct = DICTIONARIES[wanted]
  if (direct) return direct

  const lower = wanted.toLowerCase()
  if (lower === 'pt' || lower.startsWith('pt-br')) return DICTIONARIES['pt-BR'] as Templates

  const base = lower.split('-')[0] ?? lower
  const exact = Object.keys(DICTIONARIES).find((key) => key.toLowerCase() === base)
  if (exact) return DICTIONARIES[exact] as Templates

  const prefix = Object.keys(DICTIONARIES).find((key) => key.toLowerCase().startsWith(`${base}-`))
  if (prefix) return DICTIONARIES[prefix] as Templates

  return DICTIONARIES.en as Templates
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
