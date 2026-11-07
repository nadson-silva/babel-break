import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      'release/**',
      'drizzle/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // O TypeScript já cobre identificador indefinido em arquivos .ts.
      'no-undef': 'off',
      // Regra nova do recommended: estilo (cause de Error), não defeito.
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node }
  }
)
