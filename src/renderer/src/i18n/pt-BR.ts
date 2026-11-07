export const ptBR = {
  app: {
    name: 'Language Teacher',
    tagline: 'Inglês para brasileiros, no seu ritmo'
  },
  nav: {
    chat: 'Chat de teste',
    settings: 'Configurações'
  },
  common: {
    save: 'Salvar alterações',
    saving: 'Salvando…',
    saved: 'Salvo',
    test: 'Testar conexão',
    testing: 'Testando…',
    refresh: 'Atualizar',
    remove: 'Remover',
    none: 'Nenhum',
    error: 'Erro'
  },
  provider: {
    gemini: 'Gemini',
    ollama: 'Ollama'
  },
  chat: {
    title: 'Chat de teste',
    subtitle: 'Valide a conexão com o provedor antes de começar o conteúdo.',
    placeholder: 'Escreva em inglês ou português…  (Enter envia, Shift+Enter quebra linha)',
    send: 'Enviar',
    stop: 'Parar',
    emptyTitle: 'Conexão pronta para testar',
    emptyBody:
      'Mande uma mensagem para confirmar que o streaming, o modelo e o banco local estão funcionando.',
    thinking: 'Pensando…',
    you: 'Você',
    tutor: 'Tutor',
    settingsHint: 'Ajuste o provedor e o modelo em Configurações.',
    openSettings: 'Abrir configurações',
    noModel: 'Nenhum modelo selecionado. Escolha um modelo em Configurações.',
    suggestions: [
      'Me explique a diferença entre "make" e "do".',
      'Corrija: "I have 25 years and I am agree with you."',
      'Vamos simular uma entrevista de emprego para dev?'
    ]
  },
  settings: {
    title: 'Configurações',
    subtitle: 'Provedor de IA, modelos, correção e armazenamento local.',
    providerTitle: 'Provedor de IA',
    providerHelp:
      'Ollama roda localmente e não custa nada. Gemini usa a nuvem e precisa de uma chave de API.',
    ollamaName: 'Ollama (local)',
    ollamaDesc: 'Privado e offline. Precisa do Ollama rodando na máquina.',
    geminiName: 'Gemini (nuvem)',
    geminiDesc: 'Melhor qualidade e mais rápido. Requer chave de API.',
    geminiKeyTitle: 'Chave da API do Gemini',
    geminiKeyHelp: 'A chave é guardada fora do banco, no armazenamento seguro do sistema.',
    geminiKeyConfigured: 'Chave configurada',
    geminiKeyMissing: 'Nenhuma chave configurada',
    geminiKeyPlaceholder: 'Cole a chave (AIza…)',
    saveKey: 'Salvar chave',
    clearKey: 'Remover chave',
    modelTitle: 'Modelo',
    modelHelp: 'Selecione um modelo disponível ou digite o identificador manualmente.',
    ollamaUrlTitle: 'Endereço do Ollama',
    ollamaUrlHelp: 'Padrão: http://127.0.0.1:11434',
    correctionTitle: 'Estilo de correção',
    correctionHelp: 'Como o tutor deve corrigir você durante as conversas.',
    correctionRecast: 'Recast suave',
    correctionExplicit: 'Explicação explícita',
    correctionBoth: 'Ambos',
    focusTitle: 'Peso do foco personalizado',
    focusHelp:
      'Quanto do conteúdo recomendado deve vir da trilha de foco (ex.: entrevista para dev). Não é uma cota diária.',
    securityTitle: 'Armazenamento seguro',
    securityOk: 'Chave criptografada pelo keyring do sistema.',
    securityBasic: 'Keyring em modo básico: a proteção é limitada.',
    securityUnavailable:
      'Sem backend de keyring disponível. A chave será salva em arquivo local com permissão 0600.',
    securityBackend: 'Backend',
    runtimeTitle: 'Sistema',
    linuxNote:
      'Linux detectado. O app roda em Wayland/Ozone automaticamente (testado em Garuda + Niri).',
    testOk: 'Conexão OK',
    testFail: 'Falha na conexão',
    modelsError: 'Não foi possível listar os modelos. Você ainda pode digitar o identificador.',
    saveFirst: 'Salve as alterações antes de testar.'
  }
} as const

export const t = ptBR
