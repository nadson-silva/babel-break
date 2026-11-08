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
  | 'fb.speak.instruction'
  | 'fb.speak.explanation'
  | 'fb.listen.instruction'
  | 'fb.listen.prompt'
  | 'fb.listen.explanation'
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
  | 'error.noModelStream'
  | 'error.emptyReply'
  | 'chat.emptyMessage'
  | 'conversation.notFound'
  | 'error.aiUnavailableCurriculum'
  | 'error.aiUnavailableContent'
  | 'error.aiUnavailableExercises'
  | 'error.aiKeptExercises'
  | 'error.exerciseRemoved'
  | 'error.voiceOnly'
  | 'error.aiUnavailableScenario'
  | 'error.aiUnavailableTrack'
  // voz (v2)
  | 'voice.noTts'
  | 'voice.noAsr'
  | 'voice.micDenied'
  | 'voice.empty'
  | 'voice.scorePrefix'
  | 'voice.listenPrompt'
  | 'voice.speakPrompt'
  | 'voice.label.tts'
  | 'voice.label.asr'
  | 'voice.label.score'
  | 'job.lesson'
  | 'job.exercises'
  | 'job.curriculum'
  | 'job.track'
  | 'voice.summary.score'
  | 'voice.summary.heard'
  | 'voice.summary.noAudio'
  | 'error.voiceUnavailable'
  | 'speech.kind.speak'
  | 'speech.kind.listen'

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
  'error.noModelStream':
    'Nenhum modelo selecionado. Escolha um modelo em Configurações antes de conversar.',
  'error.emptyReply':
    'O modelo não retornou texto. Se ele usa raciocínio interno (thinking), escolha outro modelo em Configurações.',
  'chat.emptyMessage': 'Escreva no idioma que você está estudando antes de enviar.',
  'conversation.notFound': 'Conversa não encontrada.',
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
  'error.aiUnavailableScenario':
    'Sem IA disponível: o cenário determinístico offline só cobre inglês. Configure um provedor em Configurações.',
  'error.voiceOnly': 'Esta pergunta se responde falando: use o botão de microfone para gravar a frase.',
  'error.aiUnavailableTrack':
    'A IA está indisponível e o banco de trilhas offline só cobre inglês. Para montar uma trilha de {target}, configure um provedor em Configurações.',
  'voice.noTts':
    'Sem voz sintetizada: configure um provedor com síntese de fala (Gemini TTS) ou ligar a voz do sistema em Configurações.',
  'voice.noAsr':
    'Sem transcrição de fala: o provedor atual não aceita áudio. Configure o Gemini em Configurações para treinar pronúncia.',
  'voice.micDenied':
    'O microfone foi negado. Autorize o acesso nas permissões do sistema para gravar.',
  'voice.empty':
    'Não deu para ouvir nada. Fale a frase inteira, sem pressa, e tente de novo.',
  'voice.scorePrefix': 'Pronúncia: {score}% das palavras no lugar.',
  'voice.listenPrompt': 'Ouça e escolha o que você ouviu.',
  'voice.speakPrompt': 'Ouça a frase e repita em voz alta.',
  'speech.kind.speak': 'fala',
  'speech.kind.listen': 'escuta',
  'voice.label.tts': 'gerando áudio da frase',
  'voice.label.asr': 'transcrevendo sua fala',
  'voice.label.score': 'calculando o score de pronúncia',
  'job.lesson': 'gerando o conteúdo da lição',
  'job.exercises': 'gerando os exercícios',
  'job.curriculum': 'montando o currículo',
  'job.track': 'desenhando a trilha',
  'voice.summary.score': 'Pronúncia: {score}% das palavras no lugar.',
  'voice.summary.heard': 'O app ouviu: “{transcript}”.',
  'voice.summary.noAudio': 'Não deu para ouvir nada. Fale a frase inteira, sem pressa, e tente de novo.',
  'error.voiceUnavailable': 'Este provedor não tem voz (TTS/ASR). Use um provedor com fala ou a voz do sistema para ouvir.',
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
  'fb.speak.instruction': 'Leia a frase em voz alta, com pronúncia clara.',
  'fb.speak.explanation': 'Significado: {native}.',
  'fb.listen.instruction': 'Ouça a frase e escolha o que você ouviu.',
  'fb.listen.prompt': 'Toque o áudio quantas vezes precisar e marque a alternativa correta.',
  'fb.listen.explanation': 'O que se ouviu quis dizer: {native}.',
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
  'error.noModelStream': 'No model selected. Pick a model in Settings before chatting.',
  'error.emptyReply':
    'The model returned no text. If it uses internal reasoning (thinking), pick another model in Settings.',
  'chat.emptyMessage': 'Write in the language you are studying before sending.',
  'conversation.notFound': 'Conversation not found.',
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
  'error.aiUnavailableScenario':
    'No AI available: the offline scenario bank only covers English. Configure a provider in Settings.',
  'error.voiceOnly': 'This question is answered by speaking: use the microphone button to record the sentence.',
  'error.aiUnavailableTrack':
    'AI is unavailable and the offline track bank only covers English. To build a {target} track, configure a provider in Settings.',
  'voice.noTts':
    'No speech synthesis: use a provider with TTS (Gemini TTS) or turn on system voices in Settings.',
  'voice.noAsr':
    'No speech recognition: the current provider does not take audio. Configure Gemini in Settings to practice pronunciation.',
  'voice.micDenied':
    'The microphone was denied. Allow access in your system permissions to record.',
  'voice.empty':
    'Nothing could be heard. Say the whole sentence, unhurried, and try again.',
  'voice.scorePrefix': 'Pronunciation: {score}% of the words in place.',
  'voice.listenPrompt': 'Listen and choose what you heard.',
  'voice.speakPrompt': 'Listen to the sentence and repeat it out loud.',
  'speech.kind.speak': 'speaking',
  'speech.kind.listen': 'listening',
  'voice.label.tts': 'generating the sentence audio',
  'voice.label.asr': 'transcribing your speech',
  'voice.label.score': 'scoring the pronunciation',
  'job.lesson': 'generating the lesson content',
  'job.exercises': 'generating the exercises',
  'job.curriculum': 'building the curriculum',
  'job.track': 'drafting the track',
  'voice.summary.score': 'Pronunciation: {score}% of the words in place.',
  'voice.summary.heard': 'What the app heard: “{transcript}”.',
  'voice.summary.noAudio': 'Nothing could be heard. Say the whole sentence, unhurried, and try again.',
  'error.voiceUnavailable': 'This provider has no voice (TTS/ASR). Use a speech provider or the system voice to listen.',
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
  'fb.speak.instruction': 'Read the sentence out loud, with clear pronunciation.',
  'fb.speak.explanation': 'It means: {native}.',
  'fb.listen.instruction': 'Listen to the sentence and choose what you heard.',
  'fb.listen.prompt': 'Play the audio as many times as you need and pick the right option.',
  'fb.listen.explanation': 'What you heard means: {native}.',
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
  'error.noModelStream': 'No hay modelo seleccionado. Elige un modelo en Configuración antes de chatear.',
  'error.emptyReply':
    'El modelo no devolvió texto. Si usa razonamiento interno (thinking), elige otro modelo en Configuración.',
  'chat.emptyMessage': 'Escribe en el idioma que estudias antes de enviar.',
  'conversation.notFound': 'Conversación no encontrada.',
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
  'error.aiUnavailableScenario':
    'Sin IA: el banco de escenarios sin conexión solo cubre inglés. Configura un proveedor en Configuración.',
  'error.voiceOnly': 'Esta pregunta se responde hablando: usa el botón del micrófono para grabar la frase.',
  'error.aiUnavailableTrack':
    'La IA no está disponible y el banco de itinerarios sin conexión solo cubre inglés. Para crear una ruta de {target}, configura un proveedor en Configuración.',
  'voice.noTts':
    'Sin síntesis de voz: usa un proveedor con TTS (Gemini TTS) o activa la voz del sistema en Configuración.',
  'voice.noAsr':
    'Sin reconocimiento de voz: el proveedor actual no acepta audio. Configura Gemini en Configuración para practicar pronunciación.',
  'voice.micDenied':
    'El micrófono fue denegado. Permite el acceso en los permisos del sistema para grabar.',
  'voice.empty':
    'No se pudo oír nada. Di la frase completa, sin prisa, e inténtalo de nuevo.',
  'voice.scorePrefix': 'Pronunciación: {score}% de las palabras en su lugar.',
  'voice.listenPrompt': 'Escucha y elige lo que oíste.',
  'voice.speakPrompt': 'Escucha la frase y repítela en voz alta.',
  'speech.kind.speak': 'habla',
  'speech.kind.listen': 'escucha',
  'voice.label.tts': 'generando el audio de la frase',
  'voice.label.asr': 'transcribiendo tu habla',
  'voice.label.score': 'calculando la puntuación de pronunciación',
  'job.lesson': 'generando el contenido de la lección',
  'job.exercises': 'generando los ejercicios',
  'job.curriculum': 'creando el plan de estudios',
  'job.track': 'diseñando la ruta',
  'voice.summary.score': 'Pronunciación: {score}% de las palabras en su lugar.',
  'voice.summary.heard': 'La app oyó: “{transcript}”.',
  'voice.summary.noAudio': 'No se pudo oír nada. Di la frase completa, sin prisa, e inténtalo de nuevo.',
  'error.voiceUnavailable': 'Este proveedor no tiene voz (TTS/ASR). Usa un proveedor con habla o la voz del sistema para oír.',
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
  'fb.speak.instruction': 'Lee la frase en voz alta, con pronunciación clara.',
  'fb.speak.explanation': 'Significa: {native}.',
  'fb.listen.instruction': 'Escucha la frase y elige lo que oíste.',
  'fb.listen.prompt': 'Reproduce el audio tantas veces como necesites y marca la opción correcta.',
  'fb.listen.explanation': 'Lo que se oyó significa: {native}.',
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
  'error.noModelStream': 'Aucun modèle sélectionné. Choisissez un modèle dans les Paramètres avant de discuter.',
  'error.emptyReply':
    "Le modèle n'a renvoyé aucun texte. S'il utilise un raisonnement interne (thinking), choisissez un autre modèle dans les Paramètres.",
  'chat.emptyMessage': "Écrivez dans la langue étudiée avant d'envoyer.",
  'conversation.notFound': 'Conversation introuvable.',
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
  'error.aiUnavailableScenario':
    "Sans IA, la banque de scénarios hors ligne ne couvre que l'anglais. Configurez un fournisseur dans les Paramètres.",
  'error.voiceOnly': 'Cette question se répond en parlant : utilisez le bouton micro pour enregistrer la phrase.',
  'error.aiUnavailableTrack':
    "L'IA est indisponible et la banque de parcours hors ligne ne couvre que l'anglais. Pour créer un parcours en {target}, configurez un fournisseur dans les Paramètres.",
  'voice.noTts':
    'Pas de synthèse vocale : utilisez un fournisseur TTS (Gemini TTS) ou activez la voix du système dans les Paramètres.',
  'voice.noAsr':
    "Pas de reconnaissance vocale : le fournisseur actuel n'accepte pas l'audio. Configurez Gemini dans les Paramètres pour travailler la prononciation.",
  'voice.micDenied':
    'Le microphone a été refusé. Autorisez l’accès dans les permissions du système pour enregistrer.',
  'voice.empty':
    "Rien n'a pu être entendu. Dites la phrase entière, sans hâte, et réessayez.",
  'voice.scorePrefix': 'Prononciation : {score}% des mots à leur place.',
  'voice.listenPrompt': 'Écoutez et choisissez ce que vous avez entendu.',
  'voice.speakPrompt': 'Écoutez la phrase et répétez-la à voix haute.',
  'speech.kind.speak': 'parole',
  'speech.kind.listen': 'écoute',
  'voice.label.tts': "génération de l'audio de la phrase",
  'voice.label.asr': "transcription de votre parole",
  'voice.label.score': "calcul du score de prononciation",
  'job.lesson': "génération du contenu de la leçon",
  'job.exercises': 'génération des exercices',
  'job.curriculum': 'élaboration du programme',
  'job.track': 'conception du parcours',
  'voice.summary.score': "Prononciation : {score}% des mots à leur place.",
  'voice.summary.heard': "Ce que l'app a entendu : « {transcript} ».",
  'voice.summary.noAudio': "Rien n'a pu être entendu. Dites la phrase entière, sans hâte, et réessayez.",
  'error.voiceUnavailable': "Ce fournisseur n'a pas de voix (TTS/ASR). Utilisez un fournisseur vocal ou la voix du système pour écouter.",
  
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
  'fb.speak.instruction': 'Lisez la phrase à voix haute, avec une prononciation claire.',
  'fb.speak.explanation': 'Cela signifie : {native}.',
  'fb.listen.instruction': 'Écoutez la phrase et choisissez ce que vous avez entendu.',
  'fb.listen.prompt': "Jouez l'audio aussi souvent que nécessaire et cochez la bonne option.",
  'fb.listen.explanation': 'Ce que vous avez entendu signifie : {native}.',
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
