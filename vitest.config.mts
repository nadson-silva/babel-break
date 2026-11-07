import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // O processo main importa `electron`; nos testes usamos um stub mínimo.
      electron: path.resolve(import.meta.dirname, 'test/electron-stub.ts')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
