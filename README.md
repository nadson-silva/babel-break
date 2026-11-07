# Language Teacher

Tutor de inglês para brasileiros: app desktop local-first com aulas estruturadas e conversas
com um tutor de IA. Roda **Ollama** (local, offline) ou **Gemini** (nuvem, com chave de API).
Sem sessão diária, streak ou meta obrigatória — você estuda quando quiser.

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

Próximo: M2 — chat com tutor, correções inline no caderno de erros, cards FSRS sob demanda
e sessão guiada opcional.

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
npm run build      # build de produção em out/
npm start          # roda o build de produção
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
    ipc.ts         handlers IPC, streaming e persistência do chat
    secrets.ts     safeStorage + fallback local
    settings.ts    defaults e persistência
  core/            domínio puro (CEFR, schemas zod, prompts, correção)
  preload/         bridge segura para o renderer
  renderer/        React + Tailwind (UI em PT-BR)
  shared/          tipos compartilhados entre main e renderer
```
