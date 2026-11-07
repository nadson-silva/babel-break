import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // O processo main importa `electron`; nos testes usamos um stub mínimo.
      electron: path.resolve(import.meta.dirname, 'test/electron-stub.ts')
    }
  },
  test: {
    // M6: testes de `.tsx` existem (interação pai ↔ ReviewQueue) — o ambiente
    // jsdom é opt-in por arquivo via `// @vitest-environment jsdom`.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node'
  }
})
