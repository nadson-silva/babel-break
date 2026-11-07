import type { JSX } from 'react'
import type { ScenarioFeedbackView, ScenarioView } from '../../../shared/types'
import { t } from '../i18n'
import { ReportButton } from './ReportButton'
import { TargetText } from './TargetText'

function scoreLabel(value: number): string {
  return `${Math.round(value * 100)}%`
}

function ScorePill({ label, value, accent }: { label: string; value: number; accent?: boolean }): JSX.Element {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        accent ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-panel-2'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-ink">{scoreLabel(value)}</div>
    </div>
  )
}

/** Banner do roleplay: quem o tutor é, onde vocês estão e o que a tarefa pede. */
export function ScenarioBanner({ scenario }: { scenario: ScenarioView }): JSX.Element {
  return (
    <div className="rounded-2xl border border-accent/40 bg-accent-soft/25 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-accent">
        {t.scenario.badge}
        {scenario.source === 'fallback' && (
          <span className="text-faint normal-case tracking-normal">· {t.tracks.sourceLocal}</span>
        )}
      </div>
      <div className="mt-1.5 text-sm font-semibold text-ink">
        <span className="text-[10px] uppercase tracking-wider text-faint">{t.scenario.persona}: </span>
        {scenario.persona}
      </div>
      <div className="mt-1 text-xs text-muted">
        <span className="text-[10px] uppercase tracking-wider text-faint">{t.scenario.setting}: </span>
        {scenario.setting}
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-faint">{t.scenario.criteria}</div>
        <ul className="mt-1 space-y-1">
          {scenario.successCriteria.map((criterion) => (
            <li key={criterion} className="flex gap-2 text-xs leading-relaxed text-ink">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{criterion}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Rubrica do roleplay: tarefa e língua pontuadas separadas, checklist e drill. */
export function ScenarioFeedbackPanel({ run }: { run: ScenarioFeedbackView }): JSX.Element {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className="text-[10px] uppercase tracking-wider text-faint">{t.scenario.feedbackTitle}</div>

      <div className="mt-3 flex gap-3">
        <ScorePill label={t.scenario.taskScore} value={run.contentScore} accent />
        <ScorePill label={t.scenario.languageScore} value={run.languageScore} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink">{run.feedback}</p>

      {run.criteria.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {run.criteria.map((entry) => (
            <li key={entry.criterion} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${
                  entry.met ? 'bg-accent text-accent-ink' : 'border border-line bg-panel-2 text-faint'
                }`}
              >
                {entry.met ? '✓' : '·'}
              </span>
              <span className={entry.met ? 'text-ink' : 'text-muted'}>
                {entry.criterion}{' '}
                <em className="not-italic text-[10px] uppercase tracking-wider text-faint">
                  {entry.met ? t.scenario.criteriaMet : t.scenario.criteriaPending}
                </em>
              </span>
            </li>
          ))}
        </ul>
      )}

      {run.bestPhrases.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-faint">{t.scenario.bestPhrases}</div>
          <div className="mt-2 space-y-2">
            {run.bestPhrases.map((phrase) => (
              <div key={`${phrase.original}-${phrase.improved}`} className="rounded-xl bg-panel-2 px-3 py-2">
                <TargetText className="block text-xs text-muted line-through decoration-line">{phrase.original}</TargetText>
                <TargetText className="mt-0.5 block text-sm text-ink">{phrase.improved}</TargetText>
                {phrase.reason && <div className="mt-0.5 text-[11px] text-faint">{phrase.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {run.followUpDrill && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent-soft/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-accent">{t.scenario.drill}</div>
          <div className="mt-1 text-xs leading-relaxed text-ink">{run.followUpDrill}</div>
        </div>
      )}

      <div className="mt-3">
        <ReportButton kind="scenario" targetId={run.lessonId} text={run.feedback} compact />
      </div>

      {run.source === 'fallback' && (
        <div className="mt-3 text-[11px] leading-relaxed text-faint">{t.scenario.localNotice}</div>
      )}
    </div>
  )
}
