import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  correctionPrompt,
  correctionStyleLabel,
  curriculumPrompt,
  exercisePrompt,
  gradePrompt,
  lessonContentPrompt,
  placementPrompt,
  promptLocale,
  scenarioFeedbackPrompt,
  scenarioGenPrompt,
  summaryPrompt,
  trackPlanPrompt,
  tutorOpenerMessage,
  tutorSystem
} from './prompts'
import { fallbackLessonContent } from './fallback'

const ja = promptLocale('ja', 'pt-BR')
const es = promptLocale('es', 'pt-BR')
const ar = promptLocale('ar', 'pt-BR')

/**
 * M4: todo prompt recebe o par de idiomas do perfil. O que o teste trava é a
 * ausência de "inglês/português" fixos fora do DEFAULT_LOCALE — um idioma
 * novo não pode herdar o vocabulário de outro dentro da instrução.
 */
describe('promptLocale', () => {
  it('default preserva o comportamento histórico PT-BR → inglês', () => {
    expect(DEFAULT_LOCALE.targetName).toBe('inglês')
    expect(DEFAULT_LOCALE.nativeName).toBe('português do Brasil')
  })

  it('resolve nomes em PT-BR para os slots de idioma', () => {
    expect(ja.targetName).toBe('japonês')
    expect(es.targetName).toBe('espanhol')
    expect(ar.targetName).toBe('árabe')
  })
})

describe('contratos parametrizados', () => {
  const content = fallbackLessonContent({ title: 'Rotina', objective: 'falar da rotina', level: 'A2' })

  it('placement pede o teste no idioma-alvo', () => {
    const prompt = placementPrompt('viagem', ja)
    expect(prompt.system).toContain('professor de japonês')
    expect(prompt.user).toContain('teste de nivelamento de japonês')
    expect(prompt.user).not.toContain('de inglês')
  })

  it('currículo cita idioma-alvo e idioma das explicações', () => {
    const prompt = curriculumPrompt({ goal: 'trabalho', level: 'B1', locale: es })
    expect(prompt.user).toContain('currículo de espanhol')
    expect(prompt.user).toContain('falante de português do Brasil')
    expect(prompt.user).toContain('em português do Brasil')
    expect(prompt.user).not.toContain('aluno brasileiro')
  })

  it('lição em japonês não menciona inglês em nenhum slot', () => {
    const prompt = lessonContentPrompt({
      title: 'Rotina no Japão',
      objective: 'descrever o dia',
      unitTitle: 'Vida diária',
      level: 'A2',
      goal: 'trabalho',
      errors: [],
      locale: ja
    })
    expect(prompt.user).toContain('pares com "target" em japonês')
    expect(prompt.user).toContain('termo em japonês')
    expect(prompt.user).toContain('armadilhas de quem fala português do Brasil')
    expect(prompt.user).toContain('Mantenha o japonês simples')
    expect(prompt.user).not.toContain('em inglês')
  })

  it('system da lição traz a restrição de escrita do idioma-alvo', () => {
    expect(lessonContentPrompt({
      title: 'X', objective: 'y', unitTitle: 'Z', level: 'A2', goal: '', errors: [], locale: ja
    }).system).toContain('não separa palavras por espaço')

    expect(placementPrompt('', ar).system).toContain('direita para a esquerda')
  })

  it('exercícios pedem segmentação própria para CJK e "traduzir ao" do idioma-alvo', () => {
    const prompt = exercisePrompt({ content, level: 'A2', goal: '', errors: [], locale: ja })
    expect(prompt.user).toContain('UNIDADES NATURAIS')
    expect(prompt.user).toContain('em japonês')
    expect(prompt.user).toContain('traduzir ao japonês')

    const spaced = exercisePrompt({ content, level: 'A2', goal: '', errors: [], locale: es })
    expect(spaced.user).toContain('palavras da frase correta EMBARALHADAS')
    expect(spaced.user).toContain('traduzir ao espanhol')
    // Tags continuam sendo convenção interna em inglês, kebab-case.
    expect(spaced.user).toContain('kebab-case em inglês')
  })

  it('correção e nivelamento de resposta falam a língua do aluno', () => {
    const grading = gradePrompt({
      type: 'translate', prompt: 'Fala sobre ontem', answer: '昨日、会議があった', alternatives: [],
      explanation: '', response: '昨日会議ある', level: 'A2', locale: ja
    })
    expect(grading.user).toContain('aluno falante de português do Brasil que estuda japonês')
    expect(grading.system).not.toContain('aluno brasileiro')

    const correction = correctionPrompt({ text: '私は学生', level: 'A2', style: 'both', errors: [], locale: ja })
    expect(correction.user).toContain('mensagem escrita em japonês')
    expect(correction.user).not.toContain('mensagem de inglês')
  })

  it('tutor escreve no idioma-alvo e explica no nativo', () => {
    const system = tutorSystem({
      level: 'B1', goal: 'viagem', style: 'recast', errors: [], vocabulary: [],
      summary: null, lesson: null, topic: null, locale: es
    })
    expect(system).toContain('tutor de espanhol')
    expect(system).toContain('Escreva em espanhol simples')
    expect(system).toContain('política')
  })

  it('recast/opener/summary seguem o par', () => {
    const context = {
      level: 'A2' as const, goal: '', style: 'both' as const, errors: [], vocabulary: [],
      summary: null, lesson: null, topic: null,
      scenario: { persona: ' Rezeptionist', setting: 'hotel', successCriteria: ['pedir conta'] },
      locale: ja
    }
    const opener = tutorOpenerMessage(context)
    expect(opener).toContain('em japonês')

    const summary = summaryPrompt({ current: null, transcript: 'x', locale: ja })
    expect(summary.user).toContain('aluno de japonês')
    expect(summary.user).toContain('frases em português do Brasil')
  })

  it('trilha, cenário e rubrica citam o idioma-alvo nos campos certos', () => {
    const track = trackPlanPrompt({ objective: 'entrevista', level: 'A2', goal: '', locale: ja })
    expect(track.user).toContain('aluno de japonês no nível A2')
    expect(track.user).toContain(`termos em japonês do domínio`)

    const scenario = scenarioGenPrompt({ lessonTitle: 'L', objective: 'O', level: 'B1', goal: '', locale: ar })
    expect(scenario.user).toContain('primeira fala do personagem, em árabe')
    expect(scenario.user).not.toContain('em inglês')

    const feedback = scenarioFeedbackPrompt({
      persona: 'p', setting: 's', criteria: ['c'], transcript: 't', level: 'A2', errors: [], locale: es
    })
    expect(feedback.user).toContain('roleplay de espanhol')
    expect(feedback.user).toContain('versão em espanhol')
  })

  it('rótulo da política de correção usa a língua nativa do perfil', () => {
    expect(correctionStyleLabel('explicit', es)).toContain('explicação em português do Brasil')
    expect(correctionStyleLabel('both', es)).toContain('explicação em português do Brasil')
  })
})
