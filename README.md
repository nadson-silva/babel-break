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

**M5 concluído** — produto:

- [x] Painel de **Progresso**: tempo praticado (dias com prática, nunca streak), vocabulário com
      retenção estimada pelo FSRS, caderno agregado, trilhas com rubrica separada e a fila de
      conteúdo reportado
- [x] **Pré-geração** em fila ociosa: gera a próxima lição provável antes de você pedi-la,
      com IA disponível, uma chamada por vez, sem competir com o aluno e sem gastar token
      no que já está em cache
- [x] **Cache primeiro**: lição aquecida abre como leitura (sem IA, sem espera, offline);
      sem IA o ciclo não regenera nada — ele espera
- [x] **Comportamento offline**: sonda de disponibilidade do provedor com banner honesto
      ("o que ainda funciona: cache, revisão e o banco de correções"), chip na sidebar e
      eventos empurrados pelo main (sem polling)
- [x] **Reportar conteúdo ruim** com efeito real: exercício sai da prática (e é reposto),
      explicação é reescrita na próxima abertura, correção contestada sai do foco das
      lições — tudo reversível, tudo registrado no banco local
- [x] **Empacotamento** electron-builder → AppImage + .deb (`npm run dist`), com as
      migrações do Drizzle via `extraResources` e o binding nativo fora do asar
- [x] **Eval por idioma** (`scripts/eval.mjs --lang en|es|ja|ar`): ~20 tarefas golden por
      idioma medindo JSON inválido, contrato, acurácia de correção, escrita (CJK/RTL) e
      latência; `--offline` roda a linha de base determinística
- [x] Lapidação do M4: texto gerado no processo main (recapitulação de fechamento,
      rótulos de intervalo do FSRS, cards, motivo da sugestão, erros de geração) agora sai
      no idioma das explicações do perfil — sem dicionário para o idioma, cai em inglês

**M6 (pré-v2) aplicada em 2026-11-07** — rede de proteção (boot com recuperação de banco,
log rotativo, ErrorBoundary, CI com gate de eval), bugs do loop (fila de revisão, fechamento de
conversa, mutex de geração, timeout/backoff em toda chamada de IA), contratos versionados
(`promptVersion`/`schemaVersion`, zod em todos os canais IPC, FK + índices). Pendências honestas
registradas no [PLAN §12](./PLAN.md).

**V2 aplicada em 2026-11-07** — voz, múltiplos perfis e backup portável:

- [x] **Prática de voz**: ouvir a frase (TTS do provedor, com voz do sistema como reserva),
      repetir no microfone e receber **score de pronúncia** palavra por palavra — a nota vem do
      alinhamento entre a frase-alvo e a transcrição, e o que o app ouviu aparece na tela
- [x] Novo tipo de exercício de escuta (`listen_repeat`) e de fala (`speak_sentence`), com
      caminho determinístico (funciona em qualquer idioma cujo conteúdo exista)
- [x] `listening`/`speaking` alimentam o painel de Progresso na mesma escala do resto
- [x] Áudio sintetizado fica em cache no SQLite: a mesma frase na mesma voz não regasta token
- [x] **Geração longa virou job nomeado**: progresso com rótulo, cancelamento na tela e no
      trocar de perfil, deadline em tudo (lição, currículo, trilha, voz)
- [x] **Múltiplos perfis**: cada aluno com idioma, caderno, SRS, conversas e progresso próprios,
      seletor na sidebar, e toda fronteira IPC validando posse (`profile:list/switch/create/update/delete`)
- [x] **Backup portável** por perfil: arquivo JSON com carimbo de versão, conferido antes de
      escrever, importado como perfil novo com ids remapeados (chave do Gemini nunca viaja)
- [x] **Lembrete opcional** (dias + horário, só com revisão vencida de verdade) — continua sem
      streak, meta ou culpa
- [x] Modelos **por papel** (rápido para corrigir, forte para gerar, modelo e voz de TTS/ASR) e
      retenção do FSRS configurável
- [x] **Verificação de versão**: o app avisa quando existe release nova e abre o download — não
      se atualiza sozinho
- [ ] Windows/macOS seguem sem validação (tudo acima foi construído e testado em Linux)

## Voz e pronúncia (V2)

A voz depende do provedor, e o app diz qual metade existe em cada caso:

| Provedor | Ouvir a frase | Falar e ser pontuado |
| --- | --- | --- |
| **Gemini** | ✅ TTS (`gemini-2.5-flash-preview-tts`, 30 vozes) | ✅ transcrição + score de pronúncia |
| **Ollama** | ⚠️ voz do sistema (se o SO tiver vozes) | ❌ sem ASR — nada de nota inventada |

Como funciona o score: o áudio sai do navegador como **WAV PCM16 mono 16 kHz**, o provedor
transcreve, e `core/pronunciation.ts` alinha a transcrição com a frase-alvo (respeitando a
escrita do idioma: espaço, CJK com `Intl.Segmenter`, RTL, diacríticos que definem a palavra).
Palavra quase certa recebe crédito parcial; a confiança cai em frase curta; a transcrição
aparece na tela para você discordar com o texto na frente. Tudo determinístico e testável — a IA
só converte som em texto, quem dá a nota é o app.

## Rede de proteção da M6 (auditoria → correção)

A auditoria de 2026-11-07 abriu o milestone **M6 — pré-v2** e o checklist completo (com o que
ficou para a v2) vive em [PLAN.md §12](./PLAN.md). O que a M6 consertou, visível para quem usa:

- a fila de revisão não pula mais cards (o índice interno do `ReviewQueue` saiu de cena; o
  array da tela é a fonte da verdade — com teste de interação dos 4 consumidores);
- fechar uma conversa **não** encerra a sessão de outra, e o fechamento é idempotente (um
  fechamento, um recap — sem dupla reestimativa de nível);
- "Encerrar sessão" abandona a sessão guiada de verdade;
- "I know where he is" não é mais "corrigida" para "I know where is he" (a regra de inversão só
  pega pergunta direta), e todo o banco passou por testes de falso positivo;
- toda chamada de IA tem deadline (`AbortSignal.timeout`), streaming conta no `aiInFlight`
  (a pré-geração para de competir com o aluno) e 429 não é mais retentado;
- conteúdo em cache é carimbado com `promptVersion`/`schemaVersion` — versão divergente vira
  `stale` e regenera (o shim do M4 foi removido);
- falha de envio no chat mostra o erro na bolha em vez de deixar "Pensando…" eterno;
- banco corrompido produz **tela de recuperação com backup** (quarentena em
  `userData/recovery/` + snapshot pré-migração em `userData/backups/`), nunca app sem janela;
- `main.log` rotativo em userData + `npm run eval` com exit code no CI; zod nos 57 canais IPC
  (payload inválido é recusado antes de tocar no disco); `LICENSE`, `CHANGELOG.md` e `lint`
  existem.

O que a auditoria confirmou estar sólido, e que a M6 preservou: typecheck limpo (agora com
`noUncheckedIndexedAccess` no runtime), migrações aditivas (0000–0006), zero `any`,
`contextIsolation`, e a degradação honesta quando não há IA para o idioma-alvo.

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
npm run dist       # AppImage + .deb em release/ (electron-builder)
```

### Avaliar a qualidade da IA

O plano prevê um harness manual (não é CI). Ele mede taxa de JSON inválido, contrato
violado e latência por tarefa, contra um provedor real:

```bash
node scripts/eval.mjs --ollama qwen3.5:0.8b
GEMINI_API_KEY=… node scripts/eval.mjs --gemini gemini-2.5-flash

# por idioma (~20 tarefas golden cada): placement, currículo, lição, exercícios,
# grade, tutor, trilha, cenário — mais os pares golden de correção do idioma
node scripts/eval.mjs --ollama gemma4:12b --lang es
node scripts/eval.mjs --ollama gemma4:12b --lang ja   # escrita CJK
node scripts/eval.mjs --ollama gemma4:12b --lang ar   # escrita RTL
npm run eval -- --offline                             # linha de base sem IA (npm test) — é o passo do CI
node scripts/eval.mjs --ollama gemma4:12b --n 5       # só as 5 primeiras tarefas
```

M6 (F1/F2): os contratos avaliados são os REAIS — o harness compila `src/core` em memória e
usa os mesmos prompts/schemas/banco do app; goldens de PT→EN e PT→ES saem do próprio banco
(cada forma correta é um caso "sem correção" — alucinação falha no gate). Sai JSON por run em
`eval-results/` + `history.json`, e o exit code é != 0 se contrato/acurácia/anti-alucinação
estourarem (`--min-accuracy`).

Além de JSON inválido, contrato e latência, o harness mede **acurácia de correção**
(pegou a tag esperada? a forma esperada?) e **escrita** (o texto do idioma-alvo veio em
kana/hanzi no japonês, em árabe no árabe).

Com modelo local pequeno é esperado ver contratos falharem — é exatamente o caso em que
o app degrada para o gerador determinístico (inglês) e o banco de interferência do par continua
corrigindo. Sem banco e sem IA para o idioma-alvo, o app avisa em vez de fingir que gerou.

Há também smoke tests que só rodam quando você pede, com um modelo de pé — os contratos do M3
(trilha, cenário e rubrica) e o "ensina qualquer idioma" do M4 (currículo e lição em espanhol):

```bash
LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m3.smoke.test.ts
LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m4.smoke.test.ts

# M5: aquecimento real, cache primeiro e os efeitos de reportar conteúdo ruim
LT_SMOKE=1 LT_MODEL=gemma4:12b npx vitest run src/main/m5.smoke.test.ts
```

## Empacotamento (Linux)

```bash
npm run dist            # AppImage + .deb em release/
npm run dist:appimage   # só o AppImage
npm run dist:deb        # só o .deb
npm run dist:dir        # unpacked (release/linux-unpacked) para conferir rápido
```

O AppImage é autocontido: `chmod +x release/language-teacher-0.1.0.AppImage && ./release/…`.
O `.deb` declara as dependências de GTK/NSS que o Electron precisa. Config em
`electron-builder.yml`; o ícone nasce de `build/icon.svg` — rode `npm run icons` se você
mudar o SVG (gera `build/icon.png` e `build/icons/*x*.png` com `rsvg-convert`).

O filtro `files` do `electron-builder.yml` é **ancorado na raiz** de propósito: um
`!**/dist/**` (com `**/`) tira o `dist/` de cada dependência — que é onde o código delas
mora — e o AppImage abre morrendo em `Cannot find module .../ts-fsrs/dist/index.cjs`.
`npm run dist:dir` + abrir o `release/linux-unpacked` é o jeito rápido de pegar isso.

Dois detalhes que não são cosméticos (e quebram o app se sumirem):

- as **migrações** viajam como `extraResources` — empacotado, o processo main lê
  `process.resourcesPath/drizzle`, não o repositório;
- **better-sqlite3** sai do asar (`asarUnpack`) porque o binding nativo precisa existir
  como arquivo no disco; `npmRebuild: false` basta, já que o pacote traz prebuild N-API.

Windows/macOS: a config cobre Linux; os alvos `nsis`/`dmg` ainda não foram validados.

## O que o app guarda sobre você (M5)

O painel de **Progresso** é o modelo do aluno em tela: dias com prática (não streak),
minutos por tipo de prática, vocabulário com a curva de retenção do FSRS, tags do caderno,
progresso por trilha e as duas notas do roleplay separadas. Os mecanismos por trás:

| Recurso | O que faz de fato |
|---|---|
| Pré-geração | fila ociosa (12 s sem pedir nada) aquece no máximo 2 itens por ciclo, só com IA `ok`, nunca durante uma geração sua |
| Cache | lição com conteúdo salvo abre sem tocar no provedor; `lessons.prewarmed_at` diz o que veio da fila |
| Offline | sonda o provedor (TTL 20 s), empurra `provider:event` para a UI e diz o que continua funcionando |
| Reportar ruim | `exercise` → fora da prática e reposto; `lesson_content` → reescreve na próxima abertura; `correction` → sai do foco de prompt; os demais entram na fila do painel. Todos reversíveis |

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
    db/            schema Drizzle, init, migrações e handle cru (export/import)
    profiles.ts    V2: ponteiro de perfil ativo, CRUD e cascata de apagar
    scope.ts       V2: posse de lição/exercício/card/erro/trilha/conversa numa consulta
    providers/     adaptadores Gemini e Ollama
    ai.ts          geração estruturada (JSON + validação zod)
    learning.ts    onboarding, nivelamento, currículo, lições e progresso
    tutor.ts       conversa com o tutor: correções inline, janela rolante, fechamento
    notebook.ts    caderno de erros (recorrência por tag, resolver, foco para prompts)
    review.ts      fila SRS: card por template, revisão FSRS, contadores
    guided.ts      sessão guiada de 5 etapas (estado persistido em study_sessions)
    dashboard.ts   painel de Progresso (agrega tempo, vocabulário, erros, trilhas, reports)
    reports.ts     "reportar conteúdo ruim": efeito real + registro reversível
    prewarm.ts     fila ociosa de pré-geração + estatísticas de cache
    provider-status.ts sonda de disponibilidade da IA (banner offline)
    events.ts      barramento interno (learning → prewarm) sem ciclo de imports
    jobs.ts        V2 (E9): jobs nomeados com progresso, cancelamento e deadline
    jobs-ipc.ts    V2: listar/cancelar jobs pelo renderer
    voice.ts       V2: TTS com cache, ASR + score, ditado, frases da prática e histórico
    portable.ts    V2: dump/restore de perfil com ids remapeados
    reminders.ts   V2: lembrete opt-in (Notification, uma janela = um disparo)
    updater.ts     V2: checagem de versão no GitHub Releases (informa, não instala)
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
    dashboard.ts      aritmética pura do painel (dias com prática, janelas, retenção)
    reports.ts        taxonomia e efeitos dos reports de conteúdo ruim
    runtime-text.ts   texto de runtime do main no idioma do aluno (cards, intervalos, recap)
    audio.ts          V2: WAV escrito à mão, leitura de cabeçalho, chave do cache de áudio
    pronunciation.ts  V2: score de pronúncia por alinhamento LCS (crédito parcial, confiança)
    voice.ts          V2: catálogo de vozes do provedor + instruções de TTS/ASR
    score.ts          V2 (D7): escala única — 0–1 persistido, 0–5 na estimativa
    portable.ts       V2: formato do backup (carimbo de versão, fechamento referencial, recusas)
    reminders.ts      V2: aritmética de calendário do lembrete opcional
    update.ts         V2: comparação de semver e leitura da release
  preload/         bridge segura para o renderer
  renderer/        React + Tailwind (UI PT-BR / EN via `i18n/`)
    i18n/          dicionários pt-BR.ts e en.ts + registro com troca em runtime (teste de paridade)
    lang.ts        idioma-alvo em runtime: rótulos {lang}/{native}/{pair} e dir/lang
    screens/       Home, Aulas, Trilhas, Lição, Tutor, Revisão, Caderno, Progresso, Sessão guiada,
                   Configurações, Voz, Perfis, Backup
    components/    ExercisePlayer, ReviewQueue, TutorPanel, ScenarioPanel, CorrectionList, ReportButton,
                   AiStatus, Sidebar, TargetText, SpeechControls, ProfileAvatar
    lib/           format.ts (tamanho de banco, decimal regional), audio.ts (gravar/decodificar WAV,
                   voz do sistema), jobs.ts (progresso de job + cancelar), palette.ts (cor do avatar)
  shared/          tipos compartilhados entre main e renderer
                   report-reasons.ts (taxonomia de report: menu do renderer = efeito do main)
                   i18n-languages.ts (V2/D8: idiomas da UI, checados contra os de runtime)
test/              stub do Electron para os testes de integração do processo main
scripts/eval.mjs   harness manual de qualidade de IA, por idioma
electron-builder.yml  empacotamento AppImage/.deb; build/icon.svg → ícones
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
- Limitações conhecidas: os textos gerados no processo main saem no idioma das explicações do
  perfil (`core/runtime-text.ts`: PT-BR, EN, ES, FR; demais idiomas caem em inglês). Cards já
  gravados antes desta mudança continuam com o texto com que nasceram — são histórico, não
  string de interface.

