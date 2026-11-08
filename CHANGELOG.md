# Changelog

Todos os mudanças notáveis deste projeto. Formato aproximado de
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), organização por
milestone do `PLAN.md`.

## [Unreleased] — V2 (voz, perfis, backup)

### Added
- **Voz**: síntese (TTS), transcrição (ASR) e score de pronúncia determinístico por
  alinhamento de palavras (`core/pronunciation.ts`), com cache de áudio no SQLite
  (`audio_cache`) e degradação honesta quando o provedor não fala (Ollama).
- Novos exercícios `listen_repeat` e `speak_sentence`; as habilidades
  `listening`/`speaking` deixaram de ser linha morta no painel.
- **Jobs nomeados (E9)**: `main/jobs.ts` com progresso, cancelamento por id/perfil
  e deadline; geração de lição, currículo, esboço de trilha e voz rodam como jobs,
  com `job:event` no push e botão de cancelar na UI.
- **Múltiplos perfis**: `profile:list/switch/create/update/delete`, ponteiro de
  perfil ativo explícito em `settings` (nunca singleton de módulo), `lessons.profile_id`
  (migração 0007), seletor na sidebar e tela de Perfis. Apagar um perfil apaga só ele.
- **Backup portável versionado**: `data:export`/`data:inspect`/`data:import` com
  envelope carimbado por `format`/`schemaVersion`/`promptVersion`/`dbVersion`,
  recusa de linha órfã e de dump que mistura perfis, remapeamento de ids (inclusive
  dentro de JSON) e tela de Backup.
- **Lembrete opt-in** (§14): dias e hora escolhidos pelo aluno, um disparo por janela
  e só com fila vencida (`core/reminders.ts` + `main/reminders.ts`).
- **Modelos por papel** (§3): `quick` para corrigir/resumir, `strong` para gerar,
  além de modelos e voz separados para TTS/ASR; retenção do FSRS configurável.
- **Verificação de versão**: `update:check` lê a release pública do repositório e
  oferece o link de download — o app não se instala sozinho.

### Fixed
- Escopo por perfil em tudo que a auditoria marcou como porta aberta: `lesson:finish`,
  `notebook:resolve`, `scenario:open/refresh`, alvos de `report:*` (inclusive undo),
  `tutor:new` com `lessonId`, leitura de mensagens antes de validar a conversa,
  agregações do painel e `cacheStats` que liam a tabela inteira.
- Reestimativa de nível (D10): média ponderada por confiança, mínimo de duas
  habilidades e banda morta na fronteira — A2↔B1 não alterna mais a cada lição.
- FSRS (D11): `request_retention` como preferência e leitura de estado/nota sem
  suposição de ordem nos enums do `ts-fsrs`.
- Escala de score única (D7): 0–1 no que é persistido, 0–5 só na estimativa.
- Mensagens de chat/cenário/trilha no idioma de explicações do **perfil** (B8/D8),
  e `UI_LANGUAGES` checado contra os idiomas que o main sabe escrever.
- Permissão de microfone no Electron 45: o handler lia `requestingOrigin` (campo do *check* handler) num `details` que traz
  `securityOrigin`, então todo `getUserMedia` era negado em silêncio — `NotAllowedError: Permission denied`
  no Linux, sem diálogo do sistema. Agora a origem sai de `securityOrigin` (com fallback pelo
  `requestingUrl`), só áudio é concedido, e recusa vai para o `main.log`. Testes em
  `main/media-permissions.test.ts`.

## [0.1.0] — M6 (pré-v2)

### Added
- Contrato IPC com zod nos 57 canais: payload inválido é recusado na fronteira,
  antes de tocar no banco (`src/main/ipc-contract.ts`).
- Recuperação de banco no boot: `integrity_check` + snapshot pré-migração +
  quarentena `.db*` em `userData/recovery/` quando necessário, com tela de
  recuperação no renderer e canal `db:status` (C4).
- Log rotativo do main em `userData/main.log` + canal `log:get-path` (C10).
- `ErrorBoundary` envolvendo a área de telas (E1).
- Testes de interação jsdom (pai ↔ `ReviewQueue`) — primeiro `.tsx` testável (B1).
- CI (`lint` + `typecheck` + `vitest` + `eval --offline` com exit code),
  `LICENSE` (MIT), `CHANGELOG.md` e `repository:` no `package.json` (F3/F7).

### Fixed
- Fila de revisão não pula mais cards: o índice interno do `ReviewQueue` foi
  removido; quem avança a fila é o array dos pais (B1).
- Fechamento de conversa idempotente e escopado: fechar A não encerra as
  sessões de B; um fechamento gera um recap; guiada/cenário não reestimam o
  nível duas vezes (B2).
- "Encerrar sessão" na sessão guiada chama `guided:abandon` de verdade (B3).
- `tutor:send` propaga o resultado de pré-condição — falha de envio não deixa
  mais o bubble "Pensando…" eterno (B9).
- `report:undo` / `undo-target` escopados por perfil; `lesson:answer` recusa
  exercício de lição que não pertence ao perfil atual (D2).
- Boot com exceção mostra diálogo de erro e grava em log; `unhandledRejection`
  / `uncaughtException` registrados (C4).

## [0.1.0] — M5 (produto + distribuição)

### Added
- Pré-geração ociosa de conteúdo com mutex e estado `pregen:*`/`cache:stats`.
- Painel de Progresso (`dashboard:get`) e "reportar conteúdo ruim" com efeito
  real e undo (`report:*`).
- Sonda de disponibilidade da IA com evento `provider:event` e banner offline.
- Reset de memória do perfil; regeneração de exercícios por lição.
- `scripts/eval.mjs` com `--lang` (en/es/ja/ar), checagem de escrita (CJK/RTL)
  e `--offline`.
- Empacotamento Linux (AppImage/deb) via electron-builder.

## [0.1.0] — M4 (internacionalização)

### Added
- Registro de idiomas no banco (`languages:list`), direção de escrita e
  tokenização por idioma.
- Interface bilíngue PT-BR/EN com proxy de dicionário; textos de runtime
  (fallbacks/recaps) no idioma do aluno.

## [0.1.0] — M3 (trilhas e cenário)

### Added
- Trilhas de foco: rascunho → revisão → aprovação (`track:*`).
- Modo cenário: roleplay com persona + rubrica de tarefa × língua (`scenario:*`).

## [0.1.0] — M2 (loop de aprendizado)

### Added
- Tutor com correção inline (banco de interferência + IA) e streaming.
- Caderno de erros, SRS FSRS (`review:*`) e sessão guiada opcional (`guided:*`).
- Reestimativa de nível adaptativa por skill.

## [0.1.0] — M1 (núcleo)

### Added
- Onboarding, teste de nível, currículo por IA, lições e exercícios com
  correção determinística + fallback offline.

## [0.1.0] — M0 (fundação)

### Added
- Electron + SQLite (Drizzle) + provedores Gemini/Ollama com streaming.
