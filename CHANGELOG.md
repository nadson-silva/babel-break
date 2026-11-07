# Changelog

Todos os mudanças notáveis deste projeto. Formato aproximado de
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), organização por
milestone do `PLAN.md`.

## [Unreleased] — M6 (pré-v2)

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
