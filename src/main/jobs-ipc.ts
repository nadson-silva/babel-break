/**
 * V2 (E9) — superfície IPC dos jobs nomeados. A emissão de eventos é do módulo
 * `jobs.ts` (canal `job:event`); aqui só entra o que a UI pede: listar o que está
 * rodando e cancelar pelo id.
 */
import { handle } from './ipc-contract'
import { activeJobs, cancelJob } from './jobs'

export function registerJobsIpc(): void {
  handle('job:list', () => activeJobs())
  handle('job:cancel', (_event, jobId: string) => cancelJob(jobId))
}
