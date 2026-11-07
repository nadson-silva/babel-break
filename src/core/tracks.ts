/**
 * Trilhas de foco (M3) — lógica pura e determinística.
 *
 * Uma trilha é um mini-currículo nivelado: muda o **domínio do vocabulário e as
 * situações**, nunca a sequência gramatical. É aqui que moram as regras que
 * garantem isso: normalização do esboço vindo da IA, cadência de cenário
 * (roleplay a cada 3ª lição de foco) e o mix de recomendação (`focusMix`), que
 * ordena sugestões sem virar cota diária.
 *
 * Os bancos abaixo também dão trilha, cenário e rubrica **sem IA**, para o app
 * continuar útil com um modelo local fraco ou offline.
 */
import type { CefrLevel } from '../shared/types'
import { clampLevel, levelIndex } from './cefr'
import type { ScenarioFeedbackOutput, ScenarioOutput, TrackPlanOutput } from './schemas'

export type TrackBucket = 'interview' | 'travel' | 'work' | 'exam' | 'general'

export interface TrackSuggestion {
  title: string
  objective: string
  goalTag: TrackBucket
}

/** Sugestões do onboarding e da tela de trilhas (campo livre sempre disponível). */
export const TRACK_SUGGESTIONS: TrackSuggestion[] = [
  { title: 'Entrevista para dev', objective: 'entrevista para desenvolvedor', goalTag: 'interview' },
  { title: 'Daily standup', objective: 'reunião diária e status de projeto no trabalho', goalTag: 'work' },
  { title: 'Viagem', objective: 'aeroporto, hotel e passeios em viagem', goalTag: 'travel' },
  { title: 'IELTS', objective: 'preparação para a prova IELTS', goalTag: 'exam' },
  { title: 'Conversação do dia a dia', objective: 'conversar sobre assuntos do dia a dia', goalTag: 'general' }
]

interface TermSeed {
  term: string
  translation: string
  example: string
}

interface LessonSeed {
  title: string
  objective: string
  terms: TermSeed[]
}

interface BucketSeed {
  goalTag: TrackBucket
  title: string
  keywords: string[]
  lessons: LessonSeed[]
  scenario: ScenarioOutput
}

function terms(...rows: [string, string, string][]): TermSeed[] {
  return rows.map(([term, translation, example]) => ({ term, translation, example }))
}

/**
 * Banco de domínios escritos à mão. A gramática fica no nível do aluno; o que
 * muda aqui é vocabulário e situação — é isso que impede uma trilha de
 * entrevista entregar C1 para alguém em A2.
 */
const BUCKETS: Record<TrackBucket, BucketSeed> = {
  interview: {
    goalTag: 'interview',
    title: 'Entrevista para dev',
    keywords: ['entrevista', 'entrevist', 'dev ', 'desenvolvedor', 'vaga', 'emprego', 'hiring', 'job'],
    lessons: [
      {
        title: 'Apresente-se em 60 segundos',
        objective: 'falar de quem você é profissionalmente em uma resposta curta',
        terms: terms(
          ['background', 'trajetória', 'I have a background in backend work.'],
          ['maintain', 'manter', 'I maintain two internal services.'],
          ['stack', 'conjunto de tecnologias', 'My main stack is Node and Postgres.'],
          ['own', 'ser responsável por', 'I own the payments module.'],
          ['currently', 'atualmente', 'I currently work as a mid-level developer.']
        )
      },
      {
        title: 'Fale de um projeto real',
        objective: 'descrever um projeto, seu papel e o resultado',
        terms: terms(
          ['lead', 'liderar', 'I led the migration to Kubernetes.'],
          ['migrate', 'migrar', 'We migrated the legacy monolith.'],
          ['latency', 'latência', 'We cut latency by forty percent.'],
          ['scale', 'escalar', 'The service scales to a million requests.'],
          ['rollback', 'reverter a publicação', 'We had a rollback on Friday.']
        )
      },
      {
        title: 'Erros, decisões e trade-offs',
        objective: 'contar um problema técnico e o que você aprendeu',
        terms: terms(
          ['trade-off', 'contrapartida', 'The main trade-off was speed versus accuracy.'],
          ['bottleneck', 'gargalo', 'The database was the bottleneck.'],
          ['root cause', 'causa raiz', 'The root cause was a missing index.'],
          ['incident', 'incidente', 'I handled a production incident last month.'],
          ['follow up', 'dar sequência', 'I followed up with the QA team.']
        )
      },
      {
        title: 'Trabalho em equipe e feedback',
        objective: 'falar de colaboração, code review e conflitos',
        terms: terms(
          ['code review', 'revisão de código', 'I keep code reviews short and kind.'],
          ['pair', 'programar em par', 'I pair with a junior twice a week.'],
          ['deadline', 'prazo', 'We shipped before the deadline.'],
          ['disagree', 'discordar', 'I disagreed with the design, and we talked it through.'],
          ['constructive', 'construtivo', 'I give constructive feedback.']
        )
      },
      {
        title: 'Perguntas sobre você',
        objective: 'responder a perguntas comportamentais com exemplos',
        terms: terms(
          ['strength', 'ponto forte', 'My strength is debugging under pressure.'],
          ['weakness', 'ponto a melhorar', 'My weakness is estimating too optimistically.'],
          ['motivate', 'motivar', 'What motivates me is shipping real products.'],
          ['expectation', 'expectativa', 'My salary expectation is flexible.'],
          ['onboard', 'iniciar na empresa', 'I onboarded new developers twice.']
        )
      },
      {
        title: 'Pergunte sobre a vaga',
        objective: 'fazer perguntas claras ao final da entrevista',
        terms: terms(
          ['team setup', 'formato do time', 'Can you tell me about the team setup?'],
          ['growth path', 'caminho de crescimento', 'What does the growth path look like?'],
          ['remote', 'remoto', 'Is this role fully remote?'],
          ['process', 'processo', 'How does your release process work?'],
          ['next step', 'próximo passo', 'What is the next step in the process?']
        )
      }
    ],
    scenario: {
      persona: 'entrevistador técnico de uma empresa de tecnologia, calmo e objetivo',
      setting: 'uma entrevista técnica de nível pleno por videochamada',
      successCriteria: [
        'apresentar sua trajetória em 3 ou 4 frases',
        'descrever um projeto com papel próprio e resultado',
        'contar um problema técnico e como resolveu',
        'fazer pelo menos uma pergunta sobre a vaga'
      ],
      openingLine: 'Hi! Thanks for joining. Could you start by telling me a bit about yourself?'
    }
  },
  travel: {
    goalTag: 'travel',
    title: 'Viagem',
    keywords: ['viagem', 'viajar', 'travel', 'aeroporto', 'hotel', 'turismo', 'férias'],
    lessons: [
      {
        title: 'No aeroporto',
        objective: 'falar com check-in, portão e embarque',
        terms: terms(
          ['boarding pass', 'cartão de embarque', 'Here is my boarding pass.'],
          ['gate', 'portão', 'Which gate does my flight leave from?'],
          ['delay', 'atraso', 'My flight has a two-hour delay.'],
          ['luggage', 'bagagem', 'I have one piece of luggage.'],
          ['aisle', 'corredor', 'I would like an aisle seat.']
        )
      },
      {
        title: 'No hotel',
        objective: 'fazer check-in, pedir informações e relatar problemas',
        terms: terms(
          ['reservation', 'reserva', 'I have a reservation under Silva.'],
          ['check out', 'se hospedar / sair', 'What time is check-out?'],
          ['elevator', 'elevador', 'The elevator is on the right.'],
          ['air conditioning', 'ar-condicionado', 'The air conditioning is not working.'],
          ['towels', 'toalhas', 'Could I get extra towels?']
        )
      },
      {
        title: 'Comida e pedidos',
        objective: 'pedir em restaurante e entender o cardápio',
        terms: terms(
          ['menu', 'cardápio', 'Could I see the menu, please?'],
          ['spicy', 'apimentado', 'Is this dish spicy?'],
          ['bill', 'conta', 'The bill, please.'],
          ['tip', 'gorjeta', 'Do we leave a tip here?'],
          ['vegetarian', 'vegetariano', 'I am vegetarian today.']
        )
      },
      {
        title: 'Pedindo informação',
        objective: 'perguntar direções e entender a resposta',
        terms: terms(
          ['block', 'quarteirão', 'It is two blocks from here.'],
          ['cross', 'cruzar', 'Cross the street and turn left.'],
          ['nearby', 'por perto', 'Is there a metro station nearby?'],
          ['fare', 'tarifa', 'How much is the fare?'],
          ['round trip', 'ida e volta', 'One round trip, please.']
        )
      },
      {
        title: 'Compras e serviços',
        objective: 'negociar preços, trocas e horários',
        terms: terms(
          ['receipt', 'recibo', 'Can I have a receipt?'],
          ['exchange', 'trocar', 'I would like to exchange this shirt.'],
          ['size', 'tamanho', 'Do you have a bigger size?'],
          ['discount', 'desconto', 'Is there any discount?'],
          ['open', 'aberto', 'Are you open on Sundays?']
        )
      },
      {
        title: 'Imprevistos',
        objective: 'explicar um problema e pedir ajuda',
        terms: terms(
          ['lost', 'perdido', 'I lost my passport.'],
          ['stolen', 'roubado', 'My phone was stolen.'],
          ['embassy', 'embaixada', 'Where is the Brazilian embassy?'],
          ['insurance', 'seguro', 'I have travel insurance.'],
          ['urgent', 'urgente', 'This is urgent, sorry.']
        )
      }
    ],
    scenario: {
      persona: 'atendente de hotel prestativo, falando devagar e com frases simples',
      setting: 'o check-in de um hotel, com uma reserva que não aparece no sistema',
      successCriteria: [
        'dizer o nome da reserva e as datas',
        'explicar que a reserva não consta',
        'pedir uma alternativa (quarto ou solução)',
        'confirmar preço e horário de saída'
      ],
      openingLine: 'Good evening! Welcome to our hotel. Do you have a reservation with us?'
    }
  },
  work: {
    goalTag: 'work',
    title: 'Inglês no trabalho',
    keywords: ['trabalho', 'work', 'standup', 'reunião', 'meeting', 'empresa', 'colega', 'office'],
    lessons: [
      {
        title: 'Apresentando seu status',
        objective: 'falar o que fez, o que fará e o que está travando',
        terms: terms(
          ['yesterday', 'ontem', 'Yesterday I finished the login flow.'],
          ['today', 'hoje', 'Today I will write tests for it.'],
          ['blocked', 'travado', 'I am blocked on the API token.'],
          ['unblock', 'destravar', 'Can you unblock me after lunch?'],
          ['estimate', 'estimativa', 'My estimate is two days.']
        )
      },
      {
        title: 'Entendendo e confirmando',
        objective: 'confirmar o que entendeu sem parecer perdido',
        terms: terms(
          ['clarify', 'esclarecer', 'Could you clarify that last point?'],
          ['meaning', 'significado', 'Do you mean the client or the server?'],
          ['recap', 'resumir', 'Let me recap: we ship on Friday.'],
          ['note down', 'anotar', 'Let me note that down.'],
          ['ping', 'chamar no chat', 'Ping me if anything changes.']
        )
      },
      {
        title: 'Concordando e discordando',
        objective: 'dar opinião sem quebrar o tom profissional',
        terms: terms(
          ['agree', 'concordar', 'I agree with the first part.'],
          ['rather', 'preferiria', 'I would rather keep it simple.'],
          ['concern', 'preocupação', 'My concern is the timeline.'],
          ['compromise', 'meio-termo', 'Can we find a compromise?'],
          ['follow your lead', 'seguir a decisão de vocês', 'I am fine either way — follow your lead.']
        )
      },
      {
        title: 'Prazos e escopo',
        objective: 'negociar prazo e cortar escopo com clareza',
        terms: terms(
          ['deadline', 'prazo', 'The deadline is next Wednesday.'],
          ['scope', 'escopo', 'That is out of scope for now.'],
          ['push back', 'empurrar o prazo', 'Can we push this back a week?'],
          ['prioritize', 'priorizar', 'We should prioritize the fix.'],
          ['dependency', 'dependência', 'We have a dependency on the vendor.']
        )
      },
      {
        title: 'Escrito: mensagens e e-mails',
        objective: 'escrever mensagens curtas e objetivas',
        terms: terms(
          ['heads-up', 'aviso rápido', 'Just a heads-up: the build is red.'],
          ['follow-up', 'seguimento', 'This is a follow-up on yesterday’s thread.'],
          ['asap', 'o quanto antes', 'Could you review this asap?'],
          ['loop in', 'colocar na conversa', 'Please loop in the QA lead.'],
          ['wrap up', 'encerrar', 'Let me wrap up this point.']
        )
      },
      {
        title: 'Apresentando seu trabalho',
        objective: 'explicar uma entrega em 2 minutos',
        terms: terms(
          ['demo', 'demonstração', 'I will show a short demo.'],
          ['highlight', 'destacar', 'I want to highlight one number.'],
          ['result', 'resultado', 'The result was ten percent fewer errors.'],
          ['next quarter', 'próximo trimestre', 'Next quarter we add monitoring.'],
          ['questions', 'perguntas', 'Any questions before I stop?']
        )
      }
    ],
    scenario: {
      persona: 'tech lead em uma reunião diária de time, direto e amigável',
      setting: 'o daily standup por videochamada, com você sendo o próximo a falar',
      successCriteria: [
        'dizer o que fez ontem',
        'dizer o que fará hoje',
        'mencionar um bloqueio e pedir ajuda',
        'confirmar o prazo ou o próximo passo'
      ],
      openingLine: 'Morning! You are next on the standup. What did you work on yesterday?'
    }
  },
  exam: {
    goalTag: 'exam',
    title: 'Preparação para IELTS',
    keywords: ['ielts', 'toefl', 'prova', 'exam', 'certificado', 'band'],
    lessons: [
      {
        title: 'Fale de você e do seu lugar',
        objective: 'responder à primeira parte do speaking sem monossílabos',
        terms: terms(
          ['used to', 'eu costumava', 'I used to play football every weekend.'],
          ['quite', 'bastante', 'It is quite close to my office.'],
          ['depend on', 'depender de', 'It depends on the weather.'],
          ['enjoy', 'gostar de', 'I really enjoy cooking at night.'],
          ['all day', 'o dia todo', 'I worked on it all day.']
        )
      },
      {
        title: 'Descrevendo uma imagem',
        objective: 'descrever o que vê com ordem e conectores',
        terms: terms(
          ['in the foreground', 'em primeiro plano', 'In the foreground there are two children.'],
          ['looks like', 'parece que', 'It looks like a market day.'],
          ['probably', 'provavelmente', 'They are probably on holidays.'],
          ['next to', 'ao lado de', 'Next to the bus there is a bike.'],
          ['from what I can see', 'pelo que posso ver', 'From what I can see, nobody is working.']
        )
      },
      {
        title: 'Opinião e justificativa',
        objective: 'defender uma opinião em 40 segundos',
        terms: terms(
          ['in my view', 'na minha visão', 'In my view, public transport should be free.'],
          ['because of', 'por causa de', 'Because of the cost, many people drive.'],
          ['on the other hand', 'por outro lado', 'On the other hand, it needs investment.'],
          ['for example', 'por exemplo', 'For example, my city did it last year.'],
          ['overall', 'no geral', 'Overall, the benefits are bigger.']
        )
      },
      {
        title: 'Comparando passado e futuro',
        objective: 'falar de mudanças ao longo do tempo',
        terms: terms(
          ['used to be', 'costumava ser', 'It used to be a small town.'],
          ['has become', 'tornou-se', 'It has become quite international.'],
          ['by then', 'até lá', 'By then, prices will have risen.'],
          ['in ten years', 'em dez anos', 'In ten years, most people will work remotely.'],
          ['hardly', 'dificilmente / quase não', 'Hardly anyone walks to work now.']
        )
      },
      {
        title: 'Escrevendo com coesão',
        objective: 'escrever um parágrafo com conectores corretos',
        terms: terms(
          ['however', 'no entanto', 'However, the data says otherwise.'],
          ['therefore', 'portanto', 'Therefore, we need another approach.'],
          ['although', 'embora', 'Although it is costly, it works.'],
          ['in addition', 'além disso', 'In addition, it saves time.'],
          ['compared with', 'comparado com', 'Compared with last year, results improved.']
        )
      },
      {
        title: 'Simulando a prova oral',
        objective: 'sustentar 2 minutos de fala sobre um tema',
        terms: terms(
          ['to be honest', 'para ser sincero', 'To be honest, I have never tried it.'],
          ['what I mean is', 'o que quero dizer é', 'What I mean is that it takes time.'],
          ['come to think of it', 'pensando bem', 'Come to think of it, I did enjoy it.'],
          ['I would say', 'eu diria', 'I would say it is worth trying.'],
          ['that reminds me', 'isso me lembra', 'That reminds me of a trip I took.']
        )
      }
    ],
    scenario: {
      persona: 'examinador de speaking do IELTS, educado e neutro, pedindo extensão nas respostas',
      setting: 'a parte 1 e a parte 2 de uma prova de speaking',
      successCriteria: [
        'responder com 2 ou 3 frases, não só uma palavra',
        'falar por cerca de um minuto sobre o tema dado',
        'usar pelo menos dois conectores (because, however, although)',
        'corrigir a si mesmo sem parar de falar'
      ],
      openingLine: 'Good afternoon. Let us start with a simple question. Do you work or are you a student?'
    }
  },
  general: {
    goalTag: 'general',
    title: 'Conversação do dia a dia',
    keywords: [],
    lessons: [
      {
        title: 'Quebrando o gelo',
        objective: 'começar uma conversa e sustentar 5 frases',
        terms: terms(
          ['how was your weekend', 'como foi seu fim de semana', 'How was your weekend?'],
          ['kind of', 'mais ou menos', 'It was kind of tiring.'],
          ['actually', 'na verdade', 'Actually, I stayed home.'],
          ['same here', 'igualzinho', 'Same here — I needed the rest.'],
          ['long time no see', 'quanto tempo', 'Long time no see!']
        )
      },
      {
        title: 'Falando de rotina',
        objective: 'descrever seu dia com advérbios de frequência',
        terms: terms(
          ['usually', 'geralmente', 'I usually wake up at seven.'],
          ['hardly ever', 'quase nunca', 'I hardly ever watch TV.'],
          ['once a week', 'uma vez por semana', 'I go to the gym once a week.'],
          ['in the morning', 'de manhã', 'I check my phone in the morning.'],
          ['after work', 'depois do trabalho', 'After work I cook something simple.']
        )
      },
      {
        title: 'Contando algo que já aconteceu',
        objective: 'narrar um fato passado com passado simples',
        terms: terms(
          ['last week', 'semana passada', 'I visited my parents last week.'],
          ['on time', 'no horário', 'The train left on time.'],
          ['forgot', 'esqueci', 'I forgot my umbrella again.'],
          ['turned out', 'acabou sendo', 'It turned out to be a great day.'],
          ['still', 'ainda', 'I still do not know the answer.']
        )
      },
      {
        title: 'Fazendo planos',
        objective: 'propor e reagir a um convite',
        terms: terms(
          ['would rather', 'prefiro', 'I would rather stay in.'],
          ['how about', 'que tal', 'How about Saturday morning?'],
          ['sounds good', 'combinado', 'Sounds good to me.'],
          ['rain check', 'remarcar', 'Can I take a rain check?'],
          ['count me in', 'conta comigo', 'Count me in!']
        )
      },
      {
        title: 'Gosto e desgosto',
        objective: 'falar do que gosta sem confundir boring/bored',
        terms: terms(
          ['I am bored', 'estou entediado', 'I am bored with this series.'],
          ['it is boring', 'é entediante', 'The meeting is boring.'],
          ['I am interested in', 'tenho interesse em', 'I am interested in photography.'],
          ['my favorite', 'meu favorito', 'My favorite food is pasta.'],
          ['I cannot stand', 'não suporto', 'I cannot stand loud music.']
        )
      },
      {
        title: 'Pedindo e oferecendo ajuda',
        objective: 'fazer pedidos educados e reagir a eles',
        terms: terms(
          ['could you', 'você poderia', 'Could you help me with this?'],
          ['do you mind', 'se importa', 'Do you mind if I open the window?'],
          ['no problem', 'sem problema', 'No problem, take your time.'],
          ['let me', 'deixe-me', 'Let me carry that for you.'],
          ['I appreciate it', 'agradeço', 'I really appreciate it.']
        )
      }
    ],
    scenario: {
      persona: 'um colega de trabalho simpático tomando café com você',
      setting: 'a copa do escritório, nos dez minutos antes de a equipe se reunir',
      successCriteria: [
        'puxar assunto sobre o fim de semana',
        'fazer uma pergunta para manter a conversa',
        'contar algo breve sobre sua rotina',
        'encerrar a conversa com naturalidade'
      ],
      openingLine: 'Hey! Good to see you. How was your weekend?'
    }
  }
}

const MAX_LESSONS = 8

/** Detecta o domínio a partir do texto livre do aluno (PT ou EN). */
export function detectBucket(objective: string): TrackBucket {
  const text = ` ${objective.toLowerCase()} `
  for (const bucket of Object.values(BUCKETS)) {
    if (bucket.keywords.some((keyword) => text.includes(keyword))) return bucket.goalTag
  }
  return 'general'
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || fallback
}

/**
 * Normaliza o esboço vindo da IA: limita a 4–8 lições, remove duplicatas e
 * garante goalTag/tag legível. O nível da trilha é o nível do aluno — trilha
 * não promove ninguém.
 */
export function normalizeTrackPlan(input: {
  raw: unknown
  objective: string
  level: CefrLevel
}): TrackPlanOutput {
  const bucket = detectBucket(input.objective)
  const seed = BUCKETS[bucket]
  const raw = (input.raw ?? {}) as Partial<TrackPlanOutput>

  const rawLessons = Array.isArray(raw.lessons) ? raw.lessons : []
  const lessons = rawLessons
    .map((lesson, index) => {
      const fallbackLesson = seed.lessons[index % seed.lessons.length]
      const title = (lesson?.title ?? '').trim() || fallbackLesson.title
      const objective = (lesson?.objective ?? '').trim() || fallbackLesson.objective
      const vocabulary = (Array.isArray(lesson?.focusVocabulary) ? lesson.focusVocabulary : [])
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 10)

      return {
        title: title.slice(0, 80),
        objective: objective.slice(0, 160),
        focusVocabulary: vocabulary.length > 0 ? vocabulary : fallbackLesson.terms.slice(0, 6).map((term) => term.term)
      }
    })
    .filter((lesson, index, all) => all.findIndex((entry) => entry.title === lesson.title) === index)

  // Esboço raquítico (modelo fraco cortando pela metade) é completado do banco
  // local: uma trilha sempre tem de 4 a 8 lições revisáveis.
  const filled = [...lessons]
  for (const seedLesson of seed.lessons) {
    if (filled.length >= 4) break
    if (filled.some((lesson) => lesson.title === seedLesson.title)) continue
    filled.push({
      title: seedLesson.title,
      objective: seedLesson.objective,
      focusVocabulary: seedLesson.terms.slice(0, 6).map((term) => term.term)
    })
  }

  return {
    title: (raw.title ?? '').trim() || seed.title,
    goalTag: slug(raw.goalTag ?? '', bucket),
    lessons: filled.slice(0, MAX_LESSONS)
  }
}

/** Trilha determinística: mesma máquina de lições, sem gastar token. */
export function fallbackTrackPlan(input: { objective: string; level: CefrLevel }): TrackPlanOutput {
  const bucket = detectBucket(input.objective)
  const seed = BUCKETS[bucket]

  return {
    title: seed.title,
    goalTag: seed.goalTag,
    lessons: seed.lessons.slice(0, MAX_LESSONS).map((lesson) => ({
      title: lesson.title,
      objective: lesson.objective,
      focusVocabulary: lesson.terms.map((term) => term.term)
    }))
  }
}

/** Vocabulário-alvo da lição da trilha, já com tradução (fallback local). */
export function trackTerms(bucket: TrackBucket, index: number): TermSeed[] {
  const lesson = BUCKETS[bucket].lessons[index % BUCKETS[bucket].lessons.length]
  return lesson.terms
}

/** Mesma coisa, mas aceitando a `goalTag` vinda do esboço (IA pode inventar uma). */
export function fallbackTrackVocabulary(goalTag: string | null | undefined, index: number): TermSeed[] {
  const bucket: TrackBucket = goalTag && goalTag in BUCKETS ? (goalTag as TrackBucket) : detectBucket(goalTag ?? '')
  return trackTerms(bucket, index)
}

export function isScenarioLesson(index: number, total: number): boolean {
  if (total <= 0) return false
  // Roleplay ao fechar a trilha e a cada 3ª lição de foco.
  return index === total - 1 || (index + 1) % 3 === 0
}

/**
 * Rubrica determinística do roleplay, usada quando a IA está indisponível.
 * Sem modelo não dá para julgar o *sentido* da tarefa, então ela é honesta sobre
 * isso: conteúdo mede participação (turnos e extensão útil da fala) e língua
 * mede a densidade de correções do caderno. O checklist volta vazio — a UI diz
 * que a rubrica é aproximada em vez de fingir que verificou critério por critério.
 */
export function scenarioFeedbackFrom(input: {
  studentTurns: string[]
  criteria: string[]
  corrections: number
  words: number
}): ScenarioFeedbackOutput {
  const speech = input.studentTurns.join(' ').toLowerCase()
  const turns = input.studentTurns.filter((turn) => turn.trim().length > 0).length

  const participation = Math.min(1, (turns / 3) * 0.6 + Math.min(1, input.words / 120) * 0.4)
  const contentScore = round(participation)

  const density = input.words > 0 ? input.corrections / Math.max(8, input.words / 8) : 0
  const languageScore = round(Math.max(0.2, Math.min(1, 1 - density / 4)))

  const touched = input.criteria.filter((criterion) =>
    criterionWords(criterion).some((word) => speech.includes(word))
  ).length

  return {
    contentScore,
    languageScore,
    feedback: [
      turns < 3
        ? 'Poucas falas suas no roleplay: na próxima, responda e devolva uma pergunta ao personagem.'
        : `Você sustentou ${turns} falas no cenário (${input.words} palavras).`,
      touched > 0
        ? `Assuntos da tarefa reconhecidos na sua fala: ${touched} de ${input.criteria.length}.`
        : 'A rubrica local não julga o sentido da tarefa — ela mede participação. Faça de novo e cite o assunto pedido.',
      input.corrections === 0
        ? 'Nenhum erro de língua foi registrado.'
        : `A língua teve ${input.corrections} correção(ões): elas já estão no seu caderno.`
    ].join(' '),
    criteriaMet: [],
    bestPhrases: [],
    followUpDrill:
      input.corrections > 0
        ? 'Refaça por escrito suas três melhores falas do roleplay, aplicando as correções do caderno.'
        : 'Repita o mesmo cenário falando uma frase a mais em cada resposta.'
  }
}

/** Palavras-contentor de um critério, para o checklist quando ele é verificável. */
export function criterionWords(criterion: string): string[] {
  return criterion
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5)
}

/** Cenário do banco local: mesma forma que a IA precisa devolver. */
export function fallbackScenario(bucket: TrackBucket): ScenarioOutput {
  const seed = BUCKETS[bucket]
  return {
    persona: seed.scenario.persona,
    setting: seed.scenario.setting,
    successCriteria: seed.scenario.successCriteria,
    openingLine: seed.scenario.openingLine
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Mistura lição base e lição de foco nas **recomendações**. A proporção usa o
 * histórico recente de escolhas para chegar perto de `focusMix` sem virar cota:
 * se o aluno ignora a trilha, a base não é punida; se ele só quer a trilha, a
 * base deixa de ser empurrada.
 */
export function pickRecommendationOrigin(input: {
  focusMix: number
  history: ('base' | 'focus')[]
  hasFocus: boolean
  hasBase: boolean
}): 'base' | 'focus' | null {
  if (!input.hasFocus && !input.hasBase) return null
  if (!input.hasFocus) return 'base'
  if (!input.hasBase) return 'focus'

  const mix = clamp(input.focusMix, 0, 1)
  if (mix <= 0) return 'base'
  if (mix >= 1) return 'focus'

  const window = input.history.slice(-6)
  const focusTaken = window.filter((entry) => entry === 'focus').length
  const total = Math.max(window.length, 1)

  return focusTaken / total < mix ? 'focus' : 'base'
}

/** Nível recomendado para as lições da trilha: o do aluno, sem subir degrau. */
export function trackLessonLevel(level: CefrLevel): CefrLevel {
  return clampLevel(level)
}

export function levelRangeFrom(level: CefrLevel): string {
  const index = levelIndex(level)
  return index === 0 ? 'A1–A2' : `${level}–${nextName(index)}`
}

function nextName(index: number): CefrLevel {
  const names: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1']
  return names[Math.min(index + 1, names.length - 1)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

