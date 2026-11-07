# Language Teacher

Tutor de idiomas para falantes de português: app desktop local-first com aulas estruturadas e
conversas com um tutor de IA. Ensina **qualquer idioma** via IA (inglês é o fixture de qualidade,
com conteúdo extra offline). Roda **Ollama** (local, offline) ou **Gemini** (nuvem, com chave de
API). Sem sessão diária, streak ou meta obrigatória — você estuda quando quiser.

> Plano completo de produto e arquitetura: [PLAN.md](./PLAN.md)

## Status

**M0 concluído** — fundação técnica:

- [x] Shell Electron + electron-vite + React + TypeScript + Tailwind
- [x] Banco SQLite local (Drizzle ORM + migrações) com o schema completo
- [x] Provedores Gemini e Ollama com streaming, listagem de modelos e teste de conexão
- [x] Chave do Gemini em `secrets.json` via `safeStorage` (fallback 0600 com aviso)
- [x] Tela de Configurações (provedor, modelo, chave, estilo de correção, peso do foco)
- [x] Chat de teste com streaming, cancelamento, histórico e persistência

**M1 concluído** — uma lição do início ao fim:

- [x] Onboarding com objetivo e escolha de nível
- [x] Teste de nivelamento gerado por IA (10 questões, resultado estimado em CEFR)
- [x] Plano de currículo persistido (unidades e lições, geradas sob demanda)
- [x] Geração estruturada de lição: explicação em PT-BR, exemplos, gramática e vocabulário
- [x] Geração de exercícios tipados (múltipla escolha, cloze, ordenar, tradução, produção livre)
- [x] Player de lição com correção local + avaliação por IA para texto livre
- [x] Persistência de tentativas, erros, progresso e sessão de estudo
- [x] Home com "continuar de onde parei", próximo passo sugerido e catálogo de aulas
- [x] Fallback determinístico local quando o modelo não gera JSON válido (currículo, lição e exercícios)

**M2 concluído** — o loop que faz a lição #2 ser diferente da #1:

- [x] Conversa com o tutor (lista de conversas, tópico, streaming, cancelamento)
- [x] Correções inline embaixo de cada frase do aluno: trecho → forma certa, tag e explicação
- [x] Caderno de erros com recorrência (`mesmo erro 3x` vira uma linha com contador, não três)
- [x] Banco de interferência PT-BR (30 pares escritos à mão) corrigindo **offline**, sem gastar token
- [x] As tags do caderno entram nos prompts de lição, exercício e tutor; o app mostra em que está mirando
- [x] Cards SRS gerados por template (vocabulário + erros) com agendamento **FSRS** (`ts-fsrs`)
- [x] Revisão em modo pull: vencidos acumulam em silêncio, oferecidos na home/aula/conversa, sempre puláveis
- [x] Sessão guiada opcional em 5 etapas: revisão → lição → prática → tutor → fechamento
- [x] Recapitulação de correções no fechamento → novos cards + reestimativa de nível por habilidade
- [x] Resumo rolante da conversa (janela de 12 mensagens + síntese por IA, com fallback local)
- [x] Harness de avaliação manual (`scripts/eval.mjs`) e suíte de testes do domínio (`npm test`)

**M3 concluído** — trilhas de foco e modo cenário:

- [x] Trilha de foco a partir de um pedido livre ("entrevista para dev backend") ou de sugestão
- [x] Esboço **revisável antes de virar lição**: renomear, remover, reordenar, regerar, descartar
- [x] Nível da trilha = nível do aluno: a trilha muda domínio de vocabulário e situações, nunca a gramática
- [x] Lições de trilha usam o mesmo motor de lição/exercício/SRS, restrito às palavras-alvo do domínio
- [x] `focus_mix` decide a **ordem** do próximo passo (base × trilha), sem virar cota diária
- [x] Modo cenário: persona, ambientação e critérios de sucesso gerados por IA (com banco local de
      entrevista/trabalho/viagem/IELTS quando não há modelo)
- [x] Rubrica de fechamento separa **tarefa cumprida** de **língua**: dois scores + checklist por critério
- [x] 3 frases melhores do aluno viram cards SRS; o drill de follow-up volta na tela
- [x] Sessão guiada: lição escolhida pelo mix e, em lição de foco, o passo 4 já abre em roleplay
- [x] "Tenho entrevista amanhã": roleplay por tema livre, sem precisar criar trilha
- [x] Trilha arquivada preserva o progresso; reativar devolve as lições como estavam

**M4 concluído** — internacionalização:

- [x] Prompts parametrizados por par de idiomas: nada de "inglês/português" fixos — o par
      `targetLang`/`nativeLang` do perfil entra em **todo** contrato (`core/languages.ts` + `locale`)
- [x] Escolha de idioma no onboarding (inglês, espanhol, francês, japonês, árabe… 17 no registro)
      + idioma das explicações; teste de nivelamento já nasce no idioma-alvo
- [x] Abstração da correção: banco de interferência **por par** (PT-BR→inglês e PT-BR→espanhol
      escritos à mão) quando existe; para pares sem banco, a correção é 100% por IA — mesma
      interface, duas engines (`interferenceRulesFor`)
- [x] Suporte RTL/CJK: direção de escrita e tokenização por idioma (tabela `languages` semeada
      no banco), `dir="auto"` no texto do idioma-alvo, segmentação CJK com `Intl.Segmenter`
      (ordem de frase e cloze funcionam em japonês/chinês/coreano)
- [x] Normalização de correção multilíngue: gabarito compara `\p{L}/\p{N}` de qualquer escrita,
      remove diacríticos árabes/latinos sem destruir kana nem Hangul
- [x] Interface i18n: dicionários `pt-BR` e `en` completos com teste de paridade de chaves,
      seletor de idioma da interface em Configurações, sem recarregar o app
- [x] Degradação honesta: o gerador determinístico é o *fixture de inglês* do plano — sem IA e
      sem idioma-alvo inglês, o app avisa em vez de inventar conteúdo

Próximo: M5 — produto (dashboard, pré-geração/cache, offline, reportar conteúdo ruim,
empacotamento AppImage, script de eval por idioma).

## Requisitos

- Node.js 20.19+ (testado no Node 26)
- Linux (testado em Garuda + Niri/Wayland); Windows/macOS ainda não validados
- Opcional: [Ollama](https://ollama.com) para uso local, ou uma chave da API do Gemini

## Instalação

```bash
npm install
```

O `npm` 12+ bloqueia install scripts por padrão. Se o Electron ou o better-sqlite3 não
estiverem prontos, aprove os pacotes e rode o rebuild:

```bash
npm install-scripts approve better-sqlite3 esbuild
npm rebuild better-sqlite3 esbuild
node node_modules/electron/install.js
```

> O better-sqlite3 13 traz prebuilds N-API e funciona no Electron sem `electron-rebuild`.

## Desenvolvimento

```bash
npm run dev        # hot reload do renderer
npm run typecheck  # tsc nos projetos node e web
npm test           # testes do domínio (bancos por par, FSRS, adaptação, i18n, integração do loop)
npm run build      # build de produção em out/
npm start          # roda o build de produção
```

### Avaliar a qualidade da IA

O plano prevê um harness manual (não é CI). Ele mede taxa de JSON inválido, contrato
violado e latência por tarefa, contra um provedor real:

```bash
node scripts/eval.mjs --ollama qwen3.5:0.8b
GEMINI_API_KEY=… node scripts/eval.mjs --gemini gemini-2.5-flash
```

Com modelo local pequeno é esperado ver contratos falharem — é exatamente o caso em que
o app degrada para o gerador determinístico (inglês) e o banco de interferência do par continua
corrigindo. Sem banco e sem IA para o idioma-alvo, o app avisa em vez de fingir que gerou.

Há também smoke tests que só rodam quando você pede, com um modelo de pé — os contratos do M3
(trilha, cenário e rubrica) e o "ensina qualquer idioma" do M4 (currículo e lição em espanhol):

```bash
LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m3.smoke.test.ts
LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m4.smoke.test.ts
```

## Ollama (local)

```bash
ollama serve
ollama pull qwen3.5:0.8b   # ou outro modelo de sua preferência
```

No app, abra **Configurações → Provedor de IA → Ollama** e ajuste o modelo
(padrão de URL: `http://127.0.0.1:11434`). Modelos de raciocínio ("thinking") são
chamados com `think: false` para evitar respostas vazias; ainda assim, modelos menores
podem alucinar — use um modelo maior se precisar de qualidade.

## Gemini (nuvem)

1. Gere uma chave em <https://aistudio.google.com/apikey>.
2. Em **Configurações → Chave da API do Gemini**, cole e salve.
3. Selecione **Gemini** como provedor e escolha o modelo (`gemini-2.5-flash` por padrão).

A chave fica em `~/.config/language-teacher/secrets.json`, criptografada pelo keyring do
sistema quando disponível. Em ambientes sem keyring (ou com backend `basic_text`, comum em
alguns compositores Wayland), o app avisa e usa arquivo local com permissão `0600`.

## Dados locais

| Item | Caminho |
|---|---|
| Banco SQLite | `~/.config/language-teacher/language-teacher.db` |
| Segredos | `~/.config/language-teacher/secrets.json` |
| Migrações | `drizzle/` (aplicadas automaticamente na inicialização) |

Para recomeçar do zero, feche o app e remova o banco (e, se quiser, os segredos).

## Banco de dados

```bash
npm run db:generate   # gera nova migração a partir de src/main/db/schema.ts
```

As migrações rodam no startup do processo principal via `drizzle-orm/better-sqlite3/migrator`.

## Linux / Wayland

O app ativa `ozone-platform-hint=auto` e `WaylandWindowDecorations` no Linux, então roda
nativo em Wayland (Niri, GNOME, KDE, wlroots) e cai para X11/XWayland quando necessário.
Em sessões sem portal/keyring, o armazenamento seguro degrada com aviso visível na UI.

## Estrutura

```
src/
  main/            processo principal (Electron)
    db/            schema Drizzle, init e migrações
    providers/     adaptadores Gemini e Ollama
    ai.ts          geração estruturada (JSON + validação zod)
    learning.ts    onboarding, nivelamento, currículo, lições e progresso
    tutor.ts       conversa com o tutor: correções inline, janela rolante, fechamento
    notebook.ts    caderno de erros (recorrência por tag, resolver, foco para prompts)
    review.ts      fila SRS: card por template, revisão FSRS, contadores
    guided.ts      sessão guiada de 5 etapas (estado persistido em study_sessions)
    tracks.ts      trilhas de foco: esboço → revisão → aprovação → lições da trilha
    scenario.ts    modo cenário: persona do roleplay e rubrica de tarefa × língua
    locale.ts      par de idiomas do perfil → regras do banco, prompts e tokenização
    home.ts        agregado da home (aula, conversa, revisão, caderno, trilha e mix)
    ipc.ts         handlers de settings/provedor + registro dos módulos
    loop.ts        IPC do loop (tutor, notebook, review, guided)
    secrets.ts     safeStorage + fallback local
    settings.ts    defaults e persistência
  core/            domínio puro (testável com Vitest, portável)
    cefr.ts           níveis CEFR e mapeamento de pontuação
    languages.ts      registro de idiomas: direção de escrita, tokenização, notas de prompt, Intl.Segmenter
    interference.ts   bancos de interferência **por par** (PT-BR→EN com 33 regras, PT-BR→ES) + deteção/recast
    correction.ts     fusão banco+IA e política de correção (banco é opcional — par sem banco = só IA)
    adapt.ts          errorFocus (o que a próxima lição mira) e reestimativa de nível
    srs.ts            templates de card + wrapper do FSRS (cloze consciente de CJK)
    prompts.ts        contratos de prompt **parametrizados pelo par de idiomas** (currículo, lição, exercício, tutor, correção, trilha, cenário)
    schemas.ts        schemas zod das saídas estruturadas
    grading.ts        correção local dos tipos objetivos (normalização multilíngue)
    fallback.ts       gerador determinístico de currículo, lição e exercícios (fixture de inglês)
    tracks.ts         trilha determinística, cadência de cenário e mix de recomendação
  preload/         bridge segura para o renderer
  renderer/        React + Tailwind (UI PT-BR / EN via `i18n/`)
    i18n/          dicionários pt-BR.ts e en.ts + registro com troca em runtime (teste de paridade)
    lang.ts        idioma-alvo em runtime: rótulos {lang}/{native}/{pair} e dir/lang
    screens/       Home, Aulas, Trilhas, Lição, Tutor, Revisão, Caderno, Sessão guiada, Configurações
    components/    ExercisePlayer, ReviewQueue, TutorPanel, ScenarioPanel, CorrectionList, Sidebar, TargetText
  shared/          tipos compartilhados entre main e renderer
test/              stub do Electron para os testes de integração do processo main
scripts/eval.mjs   harness manual de qualidade de IA
```

## Como o loop funciona (M2)

O valor do app é o **modelo do aluno**, lido e atualizado a cada interação:

```
frase do aluno ──► banco de interferência do par (determinístico, offline) ─┐
                 └─► correção por IA ──────────────────────────────────────┴─► fusão ─► caderno de erros
                                                                         │
   ┌─────────────────────────────────────────────────────────────────────┘
   ▼
tags recorrentes ─► prompts de lição/exercício ─► "esta lição mira seus erros"
                └─► system do tutor (recast prioritário)
                └─► cards FSRS (vocabulário + erros) ─► fila de revisão silenciosa
                └─► habilidades ─► reestimativa de nível (um degrau por vez)
```

Detalhes que importam:

- **Recorrência, não lista**: o mesmo erro (tag + frase) soma `occurrences` no caderno, em vez
  de virar três linhas iguais.
- **Banco antes do modelo**: pares errado→certo escritos à mão, por par de idiomas
  (PT-BR→inglês e PT-BR→espanhol), corrigem sem rede e sem token
  (`core/interference.ts`); a IA só acrescenta o que o banco não conhece — e é ela inteira
  quando o par não tem banco.
- **Revisão em pull**: os cards vencidos são *oferecidos* na home, na aula e na conversa. O app
  nunca cobra frequência — sem streak, sem meta, sem culpa.
- **Adaptação visível**: a lição traz o painel "Esta lição mira seus erros", os armadilhas
  PT-BR no conteúdo e cada exercício mostra as tags que treina.
- **Fechamento**: encerrar uma conversa ou sessão gera recapitulação, novos cards e, se as
  habilidades indicarem, um novo nível estimado.

## Como as trilhas funcionam (M3)

Uma trilha é um **mini-currículo persistente**, não um ajuste de prompt:

```
objetivo livre ──► track_plan (IA, ou banco local de domínios) ──► esboço
                                                                        │
                                              o aluno revisa/remove/aprova
                                                                        ▼
                                            lessons + track_lessons (nível = nível do aluno)
                                                                        │
                             mesmo motor de lição/exercício/SRS do M2 ◄─┘
                                                                        │
                             a cada 3ª lição de foco e no fechamento: ◄─┘
                                                                        ▼
        scenario_gen (persona + critérios) ──► roleplay ──► scenario_feedback
                                                        ├─ contentScore  (a tarefa foi cumprida?)
                                                        └─ languageScore (a língua estava certa?)
```

Decisões que sustentam o "não é só um chatbot":

- **Aprovação antes de gravar**: o esboço vive em `focus_tracks.plan` e só vira lição quando o
  aluno aprova — regerar é barato e a trilha nunca fica incoerente com o resto.
- **Nível manda, domínio muda**: uma trilha de entrevista para A2 fala de `stack`, `latency` e
  `trade-off` com gramática de A2. Pré-requisito é aviso, nunca bloqueio.
- **`focus_mix` é ordem, não cota**: a home compara o que foi *sugerido* recentemente com o peso
  pedido e alterna base/trilha. Quem ignora a trilha não recebe cobrança; quem só quer a trilha
  não recebe lição empurrada.
- **Duas notas, não uma**: a rubrica do roleplay avalia tarefa e língua separadas. "Soa fluente,
  não respondeu nada" tira nota alta em língua e baixa em tarefa — é o que torna o feedback útil.
- **Sem IA, tudo continua**: `core/tracks.ts` traz trilha, cenário e rubrica determinísticos para
  entrevista, trabalho, viagem e IELTS; a ficha da tarefa fica na UI mesmo no modo local.
- **Cenário cacheado**: a persona nasce com a lição (seed) e é atualizada pela IA na primeira
  abertura; reabrir não regasta tokens nem troca a tarefa no meio do caminho.
- **Fechamento real**: as 3 melhores frases do aluno viram cards SRS, o drill de follow-up volta
  na tela e `speaking` entra na reestimativa de nível junto com as outras habilidades.

## Como o app ensina qualquer idioma (M4)

O par de idiomas do perfil (`nativeLang` → `targetLang`) é dado de domínio, não texto de prompt:

```
onboarding ──► profiles.target_lang / native_lang
                       │
                       ▼
        core/languages.ts (registro puro) ──► tabela languages no SQLite (metadados)
                       │
   ┌───────────────────┼──────────────────────────────┐
   ▼                   ▼                              ▼
prompts            correção                      escrita
locale no system   interferenceRulesFor(target,  scriptDirection: dir="auto" no
prompt de TODA     native) → banco manual se     texto-alvo (RTL) + tokenization:
tarefa             existir; senão [] → 100% IA    Intl.Segmenter (CJK) em ordem de
                   (fusão, tags e caderno iguais) frase, cloze, cards e contagem
```

- **Um só lugar decide o par**: `promptLocale(target, native)` injeta `targetName`/`nativeName`
  e as notas de escrita (tu/usted, desu/masu, MSA…) em todos os contratos de prompt. Tags de
  erro continuam kebab-case em inglês por contrato interno.
- **Correção é uma interface, não um banco**: o banco PT-BR→inglês (§8 do plano) ganhou irmão
  (PT-BR→espanhol) para provar a abstração; para os demais pares a passada determinística é
  vazia por design e o caderno mostra isso ("correção feita pela IA").
- **CJK sem spaces, árabe sem espelhos**: `normalizeText` preserva `\p{L}/\p{N}` de qualquer
  escrita (e não destrói o dakuten do japonês), o "ordene a frase" segmenta com `Intl.Segmenter`
  e o `dir="auto"` só se aplica ao texto do idioma ensinado — a UI PT-BR/EN continua LTR.
- **Interface traduzível, com contrato**: dicionários tipados (`pt-BR.ts`, `en.ts`) validados
  por teste de paridade de chaves; troca em runtime via Configurações.
- **Regras do jogo offline**: o gerador determinístico e o banco de domínios das trilhas são o
  *fixture de inglês* do plano. Sem IA, outro idioma-alvo recebe um erro claro — nunca frases
  inventadas em inglês.
- Limitações conhecidas: alguns textos gerados no processo main (recapitulação de fechamento,
  rótulos de intervalo do FSRS) ainda saem em PT-BR — são conteúdo do modelo do aluno, não
  strings de interface.

