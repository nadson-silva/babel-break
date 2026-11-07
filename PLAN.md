# Language Teacher — Plano de Produto e Arquitetura

> **North star:** um tutor de idiomas desktop, local-first, que **lembra do que você errou** e
> **respeita o seu ritmo**. Não é "chat com uma LLM" — o valor durável é o **modelo do aluno**
> (caderno de erros + memória de vocabulário + estimativa de proficiência) que toda chamada de IA
> lê e atualiza, não importa com que frequência o usuário apareça.

## Decisões travadas

| Decisão | Escolha |
|---|---|
| Plataforma | Desktop — **Electron** + electron-vite |
| Idioma-alvo (v1) | **Qualquer idioma via IA**, escolhido no onboarding (M4); **inglês** é o fixture de qualidade com conteúdo offline |
| Idioma nativo / explicações | **Português (PT-BR)** — par de idiomas do perfil; interface em PT-BR/EN |
| Idioma da interface | **Português (PT-BR)** |
| Experiência central | **Híbrida**: aulas estruturadas + conversas com tutor de IA |
| Frequência | **Livre, sob demanda** — sem sessão diária, streak ou meta obrigatória |
| Distribuição (M5) | **AppImage + .deb** (Linux); Windows/macOS validados depois |
| Idiomas suportados | Qualquer idioma (conteúdo gerado por IA), com inglês como fixture de qualidade |
| Provedores de IA | **Ollama** (local) ou **Gemini** (nuvem) — usuário escolhe |
| Escopo v1 | MVP funcional, usuário único, sem contas/billing |
| Foco personalizado | **Trilhas de foco** (ex.: "entrevista para dev") |

---

## 1. Aulas e conversas, no ritmo do usuário

O app não impõe sessão diária, streak, meta ou "plano de hoje". O usuário estuda quando e
quanto quiser; a frequência é dele. O app oferece três entradas, e nenhuma é obrigatória:

```
Onboarding → teste de nivelamento (CEFR, opcional)
        ↓
Home: "O que você quer fazer?"
  • Aula          lição estruturada do currículo base ou de uma trilha de foco
  • Conversa      chat livre ou roleplay com tema escolhido na hora
  • Sessão guiada opcional (15–20 min), só se o usuário pedir
```

Sessão guiada, quando solicitada:

```
  1. Revisão    cards SRS vencidos (o usuário pode pular)
  2. Lição      um conceito, explicado em PT-BR, 2–3 exemplos em inglês
  3. Prática    5–8 exercícios (traduzir, cloze, ordenar, múltipla escolha, produção livre)
  4. Tutor      roleplay usando a gramática + vocabulário da lição
  5. Fechamento recapitulação de correções → novos cards + novas tags de erro
```

**Recomendação, não obrigação.** A home mostra "continuar de onde parei" e um "próximo passo
sugerido" (baseado em nível, erros e SRS), mas o usuário pode abrir qualquer lição ou conversa
a qualquer momento. Lição pode ser fechada no meio; o estado fica salvo.

Cada interação escreve no mesmo store: tentativas, tags de erro, estado SRS.
É isso que faz a aula #10 diferente da #1, mesmo que entre elas passem três semanas.

## 2. O que impede de ser só um chatbot

| Mecanismo | Por que importa |
|---|---|
| **Caderno de erros** | Correções são tagueadas (`past-tense`, `gender-agreement`, `register`) e injetadas nos prompts futuros; erros recorrentes geram exercícios direcionados. |
| **Agendamento FSRS (pull)** | Usar `ts-fsrs` (algoritmo open-source moderno, melhor retenção que SM-2). Cards gerados de vocabulário + erros. Vencidos acumulam em silêncio e são oferecidos quando o usuário abre uma aula/conversa ou pede "revisar" — nunca como cobrança. |
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
| `curriculum_plan` | esboço unidade → lição (JSON) | gerado **antes** das lições; lições ficam restritas a ele; suporta geração incremental sob demanda |
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

- **Currículo base** — progressão geral de inglês A1→C1. É a espinha dorsal recomendada; garante fundamentos.
- **Trilha de foco** — vocabulário de domínio + cenários (ex.: *"Entrevista para dev"*), gerada no nível atual do aluno.

O nível continua governando a complexidade gramatical. A trilha muda **domínio de vocabulário e situações,
não a sequência gramatical** — é isso que impede que uma trilha de entrevista entregue linguagem C1 para
alguém em A2, mesmo que o usuário pule direto para ela. Pré-requisitos são **avisos**, não bloqueios.

### Criação

1. O onboarding oferece trilhas sugeridas a partir do objetivo (Entrevista para devs, Daily standup, Viagem, IELTS) + campo livre.
2. Usuário digita, por exemplo, *"entrevista para desenvolvedor backend"* → `track_plan` gera esboço de 5–8 lições com objetivos, vocabulário-alvo e cenários.
3. Usuário **revisa/aprova o esboço** antes de comprometer — mantém o currículo coerente e barato de regerar.
4. Trilha pode ser trocada/adicionada a qualquer momento; progresso preservado por trilha.

### Montagem da sessão guiada (opcional)

```
quando o usuário pede "sessão guiada":
cards SRS vencidos (todas as trilhas)
→ 70% lição base / 30% lição de foco (profile.focus_mix, ajustável)
→ a cada 3ª lição de foco = cenário de roleplay
→ ao final = feedback de cenário + reestimativa de nível
```

Fora da sessão guiada, `focus_mix` influencia apenas a **ordem das recomendações**
("próximo passo sugerido"), não uma cota diária. O usuário que só quer conversar não recebe lição.

Mais um caminho de **lição-relâmpago**: *"tenho entrevista amanhã"* → um cenário direcionado + lista de vocabulário, sem precisar de trilha.

### Modo cenário (tutor)

- Tutor assume uma persona (entrevistador, recrutador, colega) com um roteiro de cenário.
- Depois do roleplay: `scenario_feedback` estruturado → cumpriu a tarefa?, rubrica de conteúdo (ex.: estrutura STAR), erros de língua tagueados, 3 frases melhores, drill de follow-up.
- **Separar a rubrica**: score de conteúdo a partir de critérios de sucesso (checklist), score de língua separado. Evita que "soa fluente, não respondeu nada" tire nota boa — e torna a correção muito menos subjetiva que uma nota 1–10.

## 5. "Qualquer idioma"

Agnóstico por design, mas com uma pequena tabela `languages` de metadados para direção de escrita (RTL),
tokenização CJK para SRS e notas de prompt por idioma (tú/usted, keigo etc.).
Ressalva do MVP: segmentação CJK para cards de vocabulário é mais difusa que línguas separadas por espaço —
resolvida no M4 de forma determinística com `Intl.Segmenter` (Node/Electron já trazem o ICU), melhor que a
extração por IA prevista: não gasta token nem erra.

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
lesson_progress profile_id, lesson_id, status /* not_started|in_progress|completed */,
                last_opened_at, score
study_sessions  id, profile_id, kind /* lesson|conversation|guided|review */,
                started_at, ended_at, summary JSON
conversations   id, profile_id, lesson_id NULL, mode /* free|scenario */,
                topic, scenario JSON, summary
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

Onboarding (idiomas, objetivo, trilha, nível) → Nivelamento →
**Home** ("O que você quer fazer?" — Aula / Conversa / Sessão guiada; continuar de onde parei; próximo passo sugerido) →
Catálogo de lições e trilhas (navegável, sem bloqueio de pré-requisito) →
Player de lição → Chat com tutor (livre ou modo cenário) → Revisão (SRS, sob demanda) →
Progresso (erros, vocabulário, tempo praticado, trilhas — **sem streak**) →
Configurações (provedor, modelo por papel, estilo de correção, mix de foco, lembretes opcionais).

## 10. Milestones

| Milestone | Entrega | Pronto quando | Estado |
|---|---|---|---|
| **M0 — shell** (1–2 d) | scaffold electron-vite, SQLite + migrações, configurações com provedor + chave + teste de conectividade, chat de teste em streaming | dá para conversar com Gemini **e** Ollama pelo app | ✅ concluído |
| **M1 — uma lição** (3–5 d) | onboarding, nivelamento, plano de currículo, geração de lição, player de exercícios + correção, persistência | completa uma lição gerada do início ao fim | ✅ concluído |
| **M2 — o loop** (4–6 d) | chat com tutor + correções inline, caderno de erros com banco PT-BR, cards FSRS sob demanda, sessão guiada opcional, "continuar de onde parei" | a aula #2 visivelmente se adapta à #1, sem exigir frequência | ✅ concluído |
| **M3 — trilhas de foco** (3–4 d) | geração + aprovação de trilha, mix nas recomendações, modo cenário, feedback de cenário | "entrevista para dev" gera trilha e um roleplay com rubrica | ✅ concluído |
| **M4 — internacionalização** (3–5 d) | parametrização de prompts, escolha de idioma no onboarding, abstração da correção (IA vs banco manual), suporte a RTL/CJK, i18n da interface | app ensina qualquer idioma via IA, com interface traduzível | ✅ concluído |
| **M5 — produto** (3–5 d) | dashboard, pré-geração/cache, comportamento offline, botão de reportar conteúdo ruim, empacotamento, script de eval | AppImage instalável, usável em qualquer ritmo | ✅ concluído |
| **M6 — pré-v2** (3–5 d) | rede de proteção (startup + log + CI), bugs do loop, mutex de geração, timeout/backoff, `schemaVersion`, FK e índices, validação na fronteira IPC | revisão não pula card; fechar conversa A não encerra B; nenhum request de IA sem deadline; banco sobrevive a migração falha com backup; `npm run eval` com gate de regressão | ⬜ aberto |
| **v2** | TTS + entrada de voz + score de pronúncia, múltiplos perfis, export/import | — | depende do M6 |

Notas do que ficou pronto no M2: `core/interference.ts` (banco PT-BR com 30 pares, correção
determinística offline), `core/srs.ts` + `ts-fsrs` (cards por template e agendamento FSRS),
`core/adapt.ts` (o caderno vira foco de prompt e reestimativa de nível), `main/tutor.ts`
(correções inline + janela rolante com resumo), `main/guided.ts` (sessão guiada de 5 etapas),
telas Tutor/Revisão/Caderno/Sessão guiada, suíte de testes em `src/**/*.test.ts` e o harness
`scripts/eval.mjs`.

Notas do que ficou pronto no M3: `core/tracks.ts` (bancos de domínio escritos à mão para entrevista,
trabalho, viagem e IELTS — trilha, cenário e rubrica determinísticas), `main/tracks.ts` (esboço
revisável em `focus_tracks.plan`, aprovação materializa as lições no nível atual do aluno, arquivar
preserva progresso), `main/scenario.ts` (persona cacheada em `lessons.scenario`, roleplay por lição ou
por tema livre, rubrica com `contentScore`/`languageScore`/`criteriaMet` separados em `scenario_runs`),
lição de trilha restrita às palavras-alvo do domínio nos prompts de `lesson_content` e `exercise_gen`,
`focus_mix` ordenando o próximo passo da home (ordem, não cota), passo 4 da sessão guiada abrindo em
cenário quando a lição de foco pede roleplay, e tela **Trilhas** com revisão do esboço antes de
comprometer. Testes: `src/core/tracks.test.ts` e `src/main/tracks.integration.test.ts`; smoke test com
IA real em `src/main/m3.smoke.test.ts` (roda com `LT_SMOKE=1`).

Notas do que ficou pronto no M4: `core/languages.ts` (registro de 17 idiomas com direção de escrita,
tokenização e notas de prompt; tabela `languages` semeada no banco no startup), `main/locale.ts`
(par do perfil → regras, prompts e segmentação), prompts de **todas** as tarefas parametrizados por
`PromptLocale` (nada de "inglês/português" fixos fora do default; tags seguem kebab-case por contrato),
exemplos de lição viram `{target, native}` (com leitura tolerante ao formato antigo `{en, pt}`),
abstração da correção via `interferenceRulesFor(target, native)` — banco PT-BR→inglês (33 regras) +
novo PT-BR→espanhol (11 regras) como prova; par sem banco = correção 100% por IA, e o caderno mostra
isso (`bankPair`), gerador determinístico é explicitamente o fixture de inglês e degrada com erro
claro nos demais idiomas (currículo, lição, trilha e cenário), CJK com `Intl.Segmenter` na ordem de
frase/cloze/cards e `dir="auto"`/`lang` no texto-alvo (RTL sem espelhar a UI), `normalizeText`
multilíngue (preserva `\p{L}`, harakat sem destruir kana/Hangul), onboarding com passo de **idiomas**
(alvo + explicações; nivelamento já no idioma-alvo) e i18n da interface com dicionários tipados
`pt-BR`/`en`, `t` proxy e troca em runtime em Configurações. Testes: `src/core/languages.test.ts`,
`src/core/prompts.test.ts`, `src/core/grading.test.ts`, paridade i18n em
`src/renderer/src/i18n/i18n.test.ts`, integração `src/main/m4.integration.test.ts` e smoke com IA em
`src/main/m4.smoke.test.ts` (roda com `LT_SMOKE=1`). Pendências conscientes: textos gerados no main
(recap de fechamento, rótulo de intervalo FSRS) ainda saem em PT-BR: são conteúdo do modelo do
aluno gerado no main, não strings de interface — traduzi-los é lapidação para o M5.

Notas do que ficou pronto no M5: `core/dashboard.ts` (aritmética pura do painel — janelas de
7/30 dias, dias com prática em vez de streak, teto de 90 min por sessão, retenção, taxa de
lembrança) e `main/dashboard.ts` (agrega lições, vocabulário FSRS, caderno, trilhas com
`contentScore`/`languageScore` médios, reports e cache num só payload); `main/prewarm.ts`
(fila ociosa de **pré-geração**: um ciclo por vez, no máximo 2 itens, só com a sonda em `ok`,
adiada enquanto o aluno gera na tela; marca `lessons.prewarmed_at` e nunca regrava o que já
serve); `main/provider-status.ts` (sonda do provedor com TTL, empurra `provider:event` e
distingue "sem internet" de "sem IA" — Ollama local continua funcionando offline) com o banner
honesto do que segue funcionando (cache, revisão, banco de interferência); `shared/report-reasons.ts`
+ `core/reports.ts` + `main/reports.ts` (o **botão de reportar conteúdo ruim** com efeito real e
reversível: `exercise` sai da prática e volta pela fila de aquecimento, `lesson_content` envelhece o
cache e é reescrito na próxima abertura, `correction` — o "essa correção foi injusta" do §11 — tira o
erro do foco de prompt sem apagá-lo do caderno; registro em `content_reports`); `core/runtime-text.ts`
(fecha a pendência do M4: cards, rótulos de intervalo FSRS, recapitulação, motivo da sugestão e erros
de geração saem no idioma das explicações, com fallback em inglês); empacotamento electron-builder
(AppImage + .deb, migrações como `extraResources`, better-sqlite3 fora do asar) e `scripts/eval.mjs`
por idioma (`--lang en|es|ja|ar`, ~20 tarefas golden, acurácia de correção, checagem de escrita
CJK/RTL, `--offline` para a linha de base determinística). Testes: `src/core/dashboard.test.ts`,
`src/core/reports.test.ts`, `src/core/runtime-text.test.ts`, `src/main/m5.integration.test.ts`,
`src/main/bridge.contract.test.ts` e o smoke com IA real `src/main/m5.smoke.test.ts` (`LT_SMOKE=1`).

A base vem antes das trilhas de propósito: trilhas reutilizam a mesma máquina de lição/exercício/SRS;
construí-las primeiro significaria construir tudo duas vezes.

## 11. Qualidade e riscos

- **Currículo incoerente** entre lições → sempre gerar o esboço da unidade primeiro, depois restringir as lições a ele; versionar prompts.
- **Correção ruidosa de texto livre** → rubrica + botão "essa correção foi injusta" que recalibra.
- **Rate limits (free tier Gemini)** → pré-gerar o próximo conteúdo provável do usuário, enfileirar requisições, cachear agressivamente.
- **Modelos locais fracos** → tarefas pequenas com schema, retentativa, degradação graciosa.
- **Roleplay subjetivo** → rubrica de conteúdo por checklist + score de língua separado.
- **Frequência livre pode reduzir retenção** → recomendação não coercitiva ("continuar de onde parei", próximo passo sugerido), progresso visível, lembrete opt-in. Nunca streak quebrado, culpa ou meta expirada.
- **Harness de eval** a partir do M2: ~20 tarefas golden por idioma, medindo taxa de JSON inválido, latência e acurácia de correção. `scripts/eval.mjs` manual, não CI — no M5 ganhou `--lang` (en/es/ja/ar), checagem de escrita (CJK/RTL) e `--offline`.
- **Cache sem versão** → `promptVersion`/`schemaVersion` carimbado em todo conteúdo gravado; versão divergente conta como `stale` e vai pela fila de aquecimento, nunca por shim à mão.
- **Geração dupla paga em dobro** → mutex por lição (o padrão já existe em `curriculumJob`) e `aiInFlight` incluindo streaming; sem isso a pré-geração compete com o aluno.
- **Request sem deadline** → `AbortSignal.timeout` em toda chamada de IA + backoff com jitter; um request pendurado hoje trava a fila ociosa permanentemente (`inFlight` nunca volta a 0).
- **Frontera IPC confiável** → zod nos 57 canais + escopo por `profileId`; é pré-requisito de múltiplos perfis, não higiene.

## 12. Débito pré-v2 (auditoria em 2026-11-07, commit d3eac37)

A v2 (voz, múltiplos perfis, export/import) **amplifica** os itens abaixo em vez de expô-los a
zero: voz depende de deadline/cancelamento e de `schemaVersion`; múltiplos perfis dependem de
escopo por `profileId` nos handlers e de FK; export/import depende de payload versionado. Por
isso eles vêm **antes** da v2, não durante. Cada item tem a evidência em `arquivo:linha`.

Base sólida que a auditoria manda preservar: 240 testes, typecheck limpo, zero `any`, migrações
0000–0005 aditivas, `contextIsolation` correto, `parseSchedule` (`core/srs.ts`) como modelo de
leitura tolerante de JSON, e a degradação honesta para idioma ≠ inglês.

### Lote 0 — rede de proteção (barato, destrava o resto)

- [x] **B1** fila de revisão pula cards: `ReviewQueue.tsx:73` avança o índice e os 4 pais
      (`ReviewScreen.tsx:46-53`, `LessonScreen.tsx:58-65`, `TutorScreen.tsx:112-118`,
      `GuidedScreen.tsx:94-102`) também removem o card do array — um dos dois tem que ceder. Um
      teste da interação (jsdom) — hoje nenhum `.tsx` é testável (`vitest.config.mts`).
- [x] **B2** `closeConversation` filtra por `conversationId` (`tutor.ts:766-784`) e guarda
      `closedAt IS NULL`; sem dupla reestimativa em `scenario.ts:431` + `guided.ts:356`.
- [x] **B3** "Encerrar sessão" chama `guided:abandon` (`GuidedScreen.tsx:149` só renderiza o
      rótulo; `loop.ts:116` tem o handler sem call site na UI).
- [x] **C4** `whenReady().catch` + backup do `.db*` antes da migração + `integrity_check` +
      handlers de `unhandledRejection`/`uncaughtException` (`index.ts:67-81`).
- [x] **C10** log rotativo em `main.log` (userData) + canal `log:get-path`; bug report da v2
      precisa ter o que investigar (hoje: 14 `console.warn` para o nada de um AppImage).
- [x] **E1** um `ErrorBoundary` envolvendo a área de telas — há non-null assertions vivas
      (`HomeScreen.tsx:250,270,295,330`, `LessonScreen.tsx:171`) em app de janela única.
- [x] **D2** envelope `{ok,data} | {ok,error}` único + zod nos **57** canais (a validação já é o
      pré-requisito de múltiplos perfis: `reports.ts:257` e `learning.ts:961-967` não escopam).
      Feito: `ipc-contract.ts` cobre os 57 canais com recusa antes de persistir + escopo de
      perfil em undo de reports e `lesson:answer`; o envelope único adia para junto de
      `profile:create` (mudar as 57 assinaturas de retorno sem multi-perfil só gera churn).
- [x] **B9** `tutor:send` checa `result.ok` — hoje falha de pré-condição deixa "Pensando…" eterno
      (`tutor.ts:455-461`, `loop.ts:65-67`, `TutorPanel.tsx:177-191`).
- [x] **F3/F7** CI (typecheck + vitest), LICENSE, CHANGELOG, `repository:` no package.json.

### Lote 1 — consertar o loop e parar de queimar API

- [ ] **B4/B5/B6** banco de interferência: `question-word-order` (`interference.ts:334-342`) casa
      pergunta embutida correta e **insere** erro — "I know where he is" vira "I know where is he";
      advisory (`interference.ts:647-648`) **não** persiste `rule.right` como correção do aluno;
      `mergeCorrections` (`correction.ts:72-76`) compara faixas de sobreposição, não contenção de
      string; testes de falso positivo por regra.
- [ ] **B7** `normalizeText` (`grading.ts:23`) não apaga `\u0300-\u036F` para vi/fr/de (tabela por
      idioma em `core/languages.ts`); **B8** veredictos (`grading.ts:61-74`) e textos de
      `fallback.ts:354-471`/`tracks.ts:566,637-651` passam por `runtime-text` — nada de
      `'Correto!'` em português para L1 inglês.
- [ ] **C1** mutex por lição em `ensureLessonGenerated` (`learning.ts:464-749`), no formato de
      `curriculumJob` (`:320-398`); **C2** `inFlight` (`ai.ts:83,99`) também no streaming do tutor,
      senão `prewarm.ts:243` compete com quem conversa; **C3** `AbortSignal.timeout` em todo
      `GenerateRequest` + backoff com jitter e sem retentativa em 429 (`ai.ts:79`) — hoje um
      request pendurado bloqueia a pré-geração **para sempre**.
- [ ] **D1** `promptVersion`/`schemaVersion` carimbado em `lessonContent`/`exerciseSet`; cache com
      versão divergente conta como `stale` (não como shim, como foi o `en/pt → target/native` em
      `learning.ts:110-121`). **Pré-requisito de export/import.**
- [ ] **D3/D4** schemas fecham o contrato do prompt: `options.length(4)` + **`answer ∈ options`**
      (`schemas.ts:93-104`), `length(10)` em placement, `criteriaMet.length ===
      successCriteria.length`, `max` por string, e `normalizeTrackPlan` (`tracks.ts:517-570`)
      revalida no zod antes de persistir.
- [ ] **D5** delimitador (`"""…"""`) em todo texto do aluno/modelo interpolado em prompt de
      contrato JSON (`prompts.ts:87,306,367,390,410`).
- [ ] **C5/C6/C7** migração aditiva de índices nos caminhos quentes (hoje há **um** índice no
      schema inteiro, `schema.ts:146`) + FK com `ON DELETE CASCADE` nas arestas de risco
      (`attempts→exercises`, `reviews→cards`, `messages→conversations`, `lesson_items→lessons`) +
      `db.transaction` nos ~14 fluxos multi-write — o de `submitReport`/`undoReport`
      (`reports.ts:219-305`) é o que deixa estado não-annulável.
- [ ] **E4** streaming: `scrollIntoView` por token (`TutorPanel.tsx:159-161`) impede ler o que já
      passou; `ChatEvent` (`shared/types.ts:71-81`) não tem `conversationId` e o ramo de
      `corrections` (`:115-127`) ignora `requestId` — trocar de conversa no meio de um turno joga
      correção no chat errado.
- [ ] **E9** cancelamento com nome e progresso para geração longa (só o chat tem `tutor:cancel`),
      reaproveitando o padrão do `curriculumJob`.
- [ ] **B12/C9** guardas em `fallback.ts:396,464-471` (`vocab[1..3]` sem checar tamanho) e
      shuffle com seed; agregados no SQL + retenção de `reviews`/`attempts` (o painel lê tabelas
      inteiras, `dashboard.ts:93-136`).
- [ ] **F1/F2** `scripts/eval.mjs` importa os prompts/schemas reais; corrige a inversão de
      clean-sentence (`eval.mjs:626` — hoje **pontua alucinação como sucesso**: frase correta com
      `expect:''` falha quando o modelo não corrige nada); goldens derivados de `bankEntries()`;
      o golden `be-have` (`:65`) não existe no banco (`interference.ts:149` = `have-vs-be`); JSON
      de resultados com histórico e **exit code com gate**; `npm run eval`.
- [ ] **E2/E3/E5** `isComposing` nos dois inputs (`TutorPanel.tsx:246-251`,
      `TracksScreen.tsx:414` — crítico para ja/zh/ko), `role="alert"`/`aria-current`/
      `aria-pressed` (zero `aria-live` no renderer hoje), breakpoint do Tutor (940–1023px deixa o
      app sem lista de conversas: `index.ts:24` vs. `TutorScreen.tsx:129`).
- [ ] **F4/F5** `noUncheckedIndexedAccess` nos tsconfigs (teria pego `vocab[1]`,
      `PAST_TO_BASE[match[1]]`, `RATING_BY_REVIEW[rating]` em compile); `publish: null` ou
      electron-updater com o repositório **certo** — hoje `release/app-update.yml` aponta para
      `babel-break`; `.deb` com `libgtk-3-0t64`.

### Lote 2 — a v2 sobre base sólida

- [ ] **Voz**: TTS + ASR + score de pronúncia, sobre **jobs nomeados com eventos de progresso e
      cancelamento** (E9); skills `listening`/`speaking` deixando de ser linhas mortas — hoje
      `blendSkill` só roda para `grammar`/`vocab` (`learning.ts:1100-1101`) e
      `speaking`/`writing` (`scenario.ts:428-429`); escala de score única (D7); CSP/`connect-src`
      e permissão de microfone no empacotamento.
- [ ] **Múltiplos perfis**: canais `profile:create/switch/delete` (não existe nenhum entre os 57);
      **todo handler escopado por `profileId`** (Lote 0 D2); `activeProfile` explícito, nunca
      singleton de módulo.
- [ ] **Export/import**: sobre `schemaVersion` (D1) e FK (C5) — dump sem versão não é compatível,
      e linhas órfãs exportam perfil corrompido.
- [ ] **Pendências de v1 assumidas no plano**: lembretes opt-in (§11 e §14 — `grep reminder src/` é 0),
      modelo por papel (§3, notas de implementação: só `geminiModel`/`ollamaModel` hoje),
      auto-update com repositório correto (F5), Win/mac validados, `libgtk-3-0t64`, i18n
      compartilhado entre main e `runtime-text` (D8).
- [ ] **D10** reestimativa com peso por confiança, mínimo de amostras e banda morta nos bins do
      CEFR (`adapt.ts:111-143` — hoje A2↔B1 fica alternando; `C2` não existe em lugar nenhum);
      **D11** `request_retention` no FSRS e fim das suposições de enum do ts-fsrs (`srs.ts:42,186`).

### Critérios de aceite do M6 (para a v2 começar)

1. Revisar uma fila de 5 cards responde os **5** cards, com teste cobrindo a interação pai ↔
   `ReviewQueue`.
2. Fechar a conversa A não toca em `study_sessions` de B; um fechamento gera **um** recap.
3. Nenhum request de IA pode durar mais que o seu deadline; derrubar o Ollama no meio de uma
   geração não deixa `inFlight > 0` — a fila ociosa volta a andar sem reiniciar.
4. `npm run eval` roda em CI com exit code, e uma frase correta pontua como "sem correções", não
   como falha.
5. Conteúdo em cache gravado com `promptVersion` anterior é tratado como `stale`.
6. Corromper o `.db` de propósito produz tela de recuperação com backup, não app sem janela.
7. `npm run lint` + `npm test` + CI verdes; `LICENSE` e `CHANGELOG.md` existem.
8. Um handler IPC chamado com payload inválido **recusa** em vez de persistir.

## 13. Fora de escopo na v1

Voz/pronúncia, contas/sync, mobile, imagens, multiplayer, monetização, RAG sobre documentos,
gamificação punitiva (streak, ranking, metas expiradas).

## 14. Ajustes padrão (a menos que o usuário mude)

- `focus_mix = 0.3` (30% do conteúdo **recomendado** vem do tópico pedido).
- **Nenhuma meta diária, streak ou sessão obrigatória.** Sessão guiada só quando o usuário pede.
- **Lembretes desligados por padrão.** Se ativados, o usuário escolhe dias e horário; são um convite, não uma cobrança.
- SRS acumula vencidos sem penalidade e é oferecido no início de aulas/conversas, sempre pulável.
