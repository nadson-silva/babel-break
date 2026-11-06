# Language Teacher — Plano de Produto e Arquitetura

> **North star:** um tutor de idiomas desktop, local-first, que **lembra do que você errou**.
> Não é "chat com uma LLM" — o valor durável é o **modelo do aluno** (caderno de erros +
> memória de vocabulário + estimativa de proficiência) que toda chamada de IA lê e atualiza.

## Decisões travadas

| Decisão | Escolha |
|---|---|
| Plataforma | Desktop — **Electron** + electron-vite |
| Idioma-alvo (v1) | **Inglês** |
| Idioma nativo / explicações | **Português (PT-BR)** |
| Idioma da interface | **Português (PT-BR)** |
| Experiência central | **Híbrida**: lições estruturadas + tutor de IA |
| Idiomas suportados | Qualquer idioma (conteúdo gerado por IA), com inglês como fixture de qualidade |
| Provedores de IA | **Ollama** (local) ou **Gemini** (nuvem) — usuário escolhe |
| Escopo v1 | MVP funcional, usuário único, sem contas/billing |
| Foco personalizado | **Trilhas de foco** (ex.: "entrevista para dev") |

---

## 1. O loop de aprendizagem

Uma sessão diária de 15–20 min, composta pelo app:

```
Onboarding → teste de nivelamento (CEFR)
        ↓
Sessão diária:
  1. Revisão    cards SRS vencidos (erros passados + vocabulário)
  2. Lição      um conceito, explicado em PT-BR, 2–3 exemplos em inglês
  3. Prática    5–8 exercícios (traduzir, cloze, ordenar, múltipla escolha, produção livre)
  4. Tutor      roleplay usando a gramática + vocabulário da lição
  5. Fechamento recapitulação de correções → novos cards + novas tags de erro → plano do dia seguinte
```

Cada etapa escreve no mesmo store: tentativas, tags de erro, estado SRS.
É isso que faz a sessão #10 diferente da #1.

## 2. O que impede de ser só um chatbot

| Mecanismo | Por que importa |
|---|---|
| **Caderno de erros** | Correções são tagueadas (`past-tense`, `gender-agreement`, `register`) e injetadas nos prompts futuros; erros recorrentes geram exercícios direcionados. |
| **Agendamento FSRS** | Usar `ts-fsrs` (algoritmo open-source moderno, melhor retenção que SM-2). Cards gerados automaticamente de vocabulário + erros. |
| **Estimativas por habilidade** | Estimativa estilo Elo por habilidade (reading/writing/listening/speaking/vocab/grammar), atualizada pelas tentativas, usada para escolher nível e restringir a geração. |
| **Cache de conteúdo** | Lições/exercícios gerados uma vez e salvos em SQLite — o app funciona offline depois e não gasta tokens regerando. |
| **Política de correção** | Configuração do usuário: recast suave / correção explícita / ambos. No nível do prompt, não da UI. |

## 3. Camada de IA

Uma interface de provedor, dois adapters, roteamento por tarefa:

```ts
interface LLMProvider {
  id: 'ollama' | 'gemini'
  listModels(): Promise<ModelInfo[]>
  stream(req: ChatRequest, onToken: (t: string) => void): Promise<ChatResult>
  generateStructured<T>(schema: ZodSchema<T>, req: PromptRequest): Promise<T>
}
```

### Tarefas e contratos de prompt

| Tarefa | Saída | Observações |
|---|---|---|
| `placement` | 8–12 itens adaptativos + pontuação | uma vez por perfil |
| `curriculum_plan` | esboço unidade → lição (JSON) | gerado **antes** das lições; lições ficam restritas a ele |
| `lesson_content` | explicação, exemplos, pontos gramaticais, vocabulário (JSON) | explicação em PT-BR, exemplos em inglês |
| `exercise_gen` | exercícios tipados com gabarito (JSON) | alimentado pela lição + principais erros |
| `grade_answer` | correto?, score, tags de erro, correção, explicação | rubrica + few-shots; corrigir texto livre é a parte ruidosa |
| `tutor_turn` | resposta em personagem + recast inline | streaming; janela rolante + resumo |
| `srs_card_gen` | cards cloze/frase | templates determinísticos preferidos |
| `track_plan` | esboço de trilha de foco (5–8 lições) | objetivos, vocabulário-alvo, cenários |
| `scenario_gen` | persona, ambientação, critérios de sucesso | modo roleplay do tutor |
| `scenario_feedback` | feedback estruturado pós-roleplay | rubrica de conteúdo separada da de língua |

### Notas de implementação

- **Saída estruturada em tudo que não é conversa.** Response schemas no Gemini; `format: json` + schema no Ollama. Validar com zod, uma retentativa, depois fallback para template determinístico.
- **Restrições de nível vão no prompt**: "use apenas vocabulário A2 exceto as 5 palavras-alvo; máximo 2 frases".
- **Auto-checagem barata de exercícios**: gerar item → pedir ao modelo para resolver → descartar se a resposta resolvida discordar do gabarito. Elimina a maioria dos itens ruins de múltipla escolha por custo quase zero.
- **Segredos fora do renderer.** Chave do Gemini no keychain do SO (`safeStorage`), todas as chamadas de provedor no processo main.
- **Mapeamento de modelo por papel** nas configurações (modelo rápido para corrigir, mais forte para gerar lições). Ollama não precisa de chave; mostrar dica "inicie `ollama serve`" quando inacessível.

## 4. Trilhas de foco (ex.: "entrevista para dev")

Um ajuste de prompt ("faça exercícios sobre entrevistas") dá resultado raso e sem memória.
Em vez disso, uma trilha de foco é um **mini-currículo persistente, nivelado e orientado a cenários**,
que compartilha o mesmo SRS e caderno de erros.

### Duas camadas de conteúdo, um loop

- **Currículo base** — progressão geral de inglês A1→C1. Nunca é pulado; garante fundamentos.
- **Trilha de foco** — vocabulário de domínio + cenários (ex.: *"Entrevista para dev"*), gerada no nível atual do aluno.

O nível continua governando a complexidade gramatical. A trilha muda **domínio de vocabulário e situações,
não a sequência gramatical** — é isso que impede um usuário de pular para linguagem de entrevista C1 estando em A2.

### Criação

1. O onboarding oferece trilhas sugeridas a partir do objetivo (Entrevista para devs, Daily standup, Viagem, IELTS) + campo livre.
2. Usuário digita, por exemplo, *"entrevista para desenvolvedor backend"* → `track_plan` gera esboço de 5–8 lições com objetivos, vocabulário-alvo e cenários.
3. Usuário **revisa/aprova o esboço** antes de comprometer — mantém o currículo coerente e barato de regerar.
4. Trilha pode ser trocada/adicionada a qualquer momento; progresso preservado por trilha.

### Compositor de sessão

```
cards SRS vencidos (todas as trilhas)
→ 70% lição base / 30% lição de foco (profile.focus_mix, ajustável)
→ a cada 3ª lição de foco = cenário de roleplay
→ checkpoint semanal = feedback de cenário + reestimativa de nível
```

Mais um caminho de **lição-relâmpago**: *"tenho entrevista amanhã"* → um cenário direcionado + lista de vocabulário, sem precisar de trilha.

### Modo cenário (tutor)

- Tutor assume uma persona (entrevistador, recrutador, colega) com um roteiro de cenário.
- Depois do roleplay: `scenario_feedback` estruturado → cumpriu a tarefa?, rubrica de conteúdo (ex.: estrutura STAR), erros de língua tagueados, 3 frases melhores, drill de follow-up.
- **Separar a rubrica**: score de conteúdo a partir de critérios de sucesso (checklist), score de língua separado. Evita que "soa fluente, não respondeu nada" tire nota boa — e torna a correção muito menos subjetiva que uma nota 1–10.

## 5. "Qualquer idioma"

Agnóstico por design, mas com uma pequena tabela `languages` de metadados para direção de escrita (RTL),
tokenização CJK para SRS e notas de prompt por idioma (tú/usted, keigo etc.).
Ressalva do MVP: segmentação CJK para cards de vocabulário é mais difusa que línguas separadas por espaço —
resolvida via extração por IA em vez de split por espaço.

## 6. Stack

- **Electron + electron-vite + React 19 + TypeScript**
- **Processo main**: `better-sqlite3` via **Drizzle ORM**, adapters de provedor, handlers IPC
- **Renderer**: React, TanStack Query/Router, Tailwind + shadcn/ui, Zustand para estado de UI
- **Pacote `core/` em TS puro**: lógica de domínio, prompts, schemas, FSRS — testável com Vitest e portável
- **Empacotamento**: electron-builder → AppImage/deb

Por que Electron em vez de Tauri: SDK do Gemini, streaming e SQLite são sem atrito no Node, sem ciclo de compilação Rust enquanto os prompts mudam diariamente.
Manter `core/` em TS puro transforma uma eventual migração para Tauri em troca de shell, não reescrita.

```
src/
  main/        db, providers, ipc, keychain
  preload/     ponte tipada
  renderer/    telas, componentes, hooks, i18n/pt-BR.ts
  core/        modelos de domínio, prompts, schemas zod, fsrs, grading
```

## 7. Modelo de dados (SQLite)

```sql
profiles        id, target_lang, native_lang, goal, cefr, focus_mix REAL default 0.3, prefs
skills_state    profile_id, skill, estimate, confidence
languages       code, name, script_direction, tokenization, prompt_notes
units           id, profile_id, title, level, position
lessons         id, unit_id, track_id NULL, title, level, content JSON,
                scenario JSON /* persona, setting, success_criteria */, version
lesson_items    id, lesson_id, kind /* vocab|grammar */, payload JSON
exercises       id, lesson_id, type, payload JSON, answer_key JSON, source
attempts        id, exercise_id, response, correct, score, latency_ms
errors          id, profile_id, category, tag, original, corrected, context, resolved_at
cards           id, profile_id, content JSON, stability, difficulty, due, reps, lapses, state
reviews         id, card_id, rating, reviewed_at
sessions        id, profile_id, date, plan JSON, summary
messages        id, conversation_id, role, content, created_at
focus_tracks    id, profile_id, title, goal_tag, level_range,
                status /* draft|active|archived */, source /* user|suggested */
track_lessons   track_id, lesson_id, position
scenario_runs   id, lesson_id, transcript_id, content_score, language_score, feedback JSON
settings        key, value  -- nunca segredos
```

## 8. Banco de interferência PT-BR (diferencial silencioso)

Semear o caderno de erros com um **banco de interferência do português brasileiro** para que correções e fixtures de eval
mirem erros reais, não genéricos:

> *"I have 25 years"* → *"I am 25"* · *"I'm agree"* · *"explain me"* · *"people is"* · *"I didn't went"* ·
> *"make a question"* · *"I am boring"* (vs *bored*) · falsos cognatos: *actually / atualmente*, *pretend / pretender* ·
> omissão de artigo (*"I am developer"*).

Essas tags alimentam `exercise_gen`, `tutor_turn` (prioridade de recast) e o harness de eval.
~20–30 pares escritos à mão bastam para ancorar a qualidade.

## 9. Telas

Onboarding (idiomas, objetivo, trilha, nível) → Nivelamento → Hoje (card de sessão) →
Player de lição → Chat com tutor (modo cenário) → Revisão (SRS) → Progresso (erros, vocabulário, streak, trilhas) →
Configurações (provedor, modelo por papel, estilo de correção, mix de foco).

## 10. Milestones

| Milestone | Entrega | Pronto quando |
|---|---|---|
| **M0 — shell** (1–2 d) | scaffold electron-vite, SQLite + migrações, configurações com provedor + chave + teste de conectividade, chat de teste em streaming | dá para conversar com Gemini **e** Ollama pelo app |
| **M1 — uma lição** (3–5 d) | onboarding, nivelamento, plano de currículo, geração de lição, player de exercícios + correção, persistência | completa uma lição gerada do início ao fim |
| **M2 — o loop** (4–6 d) | chat com tutor + correções inline, caderno de erros com banco PT-BR, cards FSRS, compositor de sessão | a sessão #2 visivelmente se adapta à #1 |
| **M3 — trilhas de foco** (3–4 d) | geração + aprovação de trilha, mix no compositor, modo cenário, feedback de cenário | "entrevista para dev" gera trilha e um roleplay com rubrica |
| **M4 — produto** (3–5 d) | dashboard, pré-geração/cache, comportamento offline, botão de reportar conteúdo ruim, empacotamento, script de eval | AppImage instalável, usável diariamente |
| **v2** | TTS + entrada de voz + score de pronúncia, múltiplos perfis, export/import | — |

A base vem antes das trilhas de propósito: trilhas reutilizam a mesma máquina de lição/exercício/SRS;
construí-las primeiro significaria construir tudo duas vezes.

## 11. Qualidade e riscos

- **Currículo incoerente** entre lições → sempre gerar o esboço da unidade primeiro, depois restringir as lições a ele; versionar prompts.
- **Correção ruidosa de texto livre** → rubrica + botão "essa correção foi injusta" que recalibra.
- **Rate limits (free tier Gemini)** → pré-gerar plano de 7 dias, enfileirar requisições, cachear agressivamente.
- **Modelos locais fracos** → tarefas pequenas com schema, retentativa, degradação graciosa.
- **Roleplay subjetivo** → rubrica de conteúdo por checklist + score de língua separado.
- **Harness de eval** a partir do M2: ~20 tarefas golden por idioma, medindo taxa de JSON inválido, latência e acurácia de correção. `scripts/eval.ts` manual, não CI.

## 12. Fora de escopo na v1

Voz/pronúncia, contas/sync, mobile, imagens, multiplayer, monetização, RAG sobre documentos.

## 13. Ajustes padrão (a menos que o usuário mude)

- `focus_mix = 0.3` (30% das sessões no tópico pedido).
