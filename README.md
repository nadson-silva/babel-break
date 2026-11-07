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

Próximo: M3 — trilhas de foco (geração + aprovação de trilha, mix nas recomendações, modo
cenário e feedback de cenário).

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
npm test           # testes do domínio (banco PT-BR, FSRS, adaptação, integração do loop)
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
o app degrada para o gerador determinístico (e o banco PT-BR continua corrigindo).

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
    home.ts        agregado da home (aula, conversa, revisão, caderno)
    ipc.ts         handlers de settings/provedor + registro dos módulos
    loop.ts        IPC do loop (tutor, notebook, review, guided)
    secrets.ts     safeStorage + fallback local
    settings.ts    defaults e persistência
  core/            domínio puro (testável com Vitest, portável)
    cefr.ts           níveis CEFR e mapeamento de pontuação
    interference.ts   banco de interferência PT-BR + deteção/recast determinístico
    correction.ts     fusão banco+IA e política de correção
    adapt.ts          errorFocus (o que a próxima lição mira) e reestimativa de nível
    srs.ts            templates de card + wrapper do FSRS
    prompts.ts        contratos de prompt (currículo, lição, exercício, tutor, correção)
    schemas.ts        schemas zod das saídas estruturadas
    grading.ts        correção local dos tipos objetivos
    fallback.ts       gerador determinístico de currículo, lição e exercícios
  preload/         bridge segura para o renderer
  renderer/        React + Tailwind (UI em PT-BR)
    screens/       Home, Aulas, Lição, Tutor, Revisão, Caderno, Sessão guiada, Configurações
    components/    ExercisePlayer, ReviewQueue, TutorPanel, CorrectionList, Sidebar
  shared/          tipos compartilhados entre main e renderer
test/              stub do Electron para os testes de integração do processo main
scripts/eval.mjs   harness manual de qualidade de IA
```

## Como o loop funciona (M2)

O valor do app é o **modelo do aluno**, lido e atualizado a cada interação:

```
frase do aluno ──► banco PT-BR (determinístico, offline) ─┐
                 └─► correção por IA ────────────────────┴─► fusão ─► caderno de erros
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
- **Banco antes do modelo**: 30 pares PT-BR → inglês corrigem sem rede e sem token
  (`core/interference.ts`); a IA só acrescenta o que o banco não conhece.
- **Revisão em pull**: os cards vencidos são *oferecidos* na home, na aula e na conversa. O app
  nunca cobra frequência — sem streak, sem meta, sem culpa.
- **Adaptação visível**: a lição traz o painel "Esta lição mira seus erros", os armadilhas
  PT-BR no conteúdo e cada exercício mostra as tags que treina.
- **Fechamento**: encerrar uma conversa ou sessão gera recapitulação, novos cards e, se as
  habilidades indicarem, um novo nível estimado.

