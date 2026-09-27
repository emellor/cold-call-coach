import {
  type CallMetrics,
  type CallTurn,
  METRIC_TARGETS,
  type ReviewResult,
  type StageReview,
} from '@ccc/contracts';
import type { ReactNode } from 'react';
import { TurnLink } from './TurnLink.tsx';
import { Walkthrough } from './Walkthrough.tsx';
import { STAGE_LABELS } from './format.ts';
import { walkthrough } from './moments.ts';

interface ScorecardProps {
  review: ReviewResult;
  metrics: CallMetrics | null;
  /** The transcript, for the time of each moment. */
  turns: readonly CallTurn[];
  /** Scroll the transcript to a turn (numbered from 1). */
  onTurn: (turn: number) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-3 text-sm font-medium tracking-wide text-slate-300 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ScoreDots({ score, label }: { score: number; label: string }) {
  return (
    <span role="img" aria-label={`${label}: ${score} out of 5`} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`size-2.5 rounded-full ${n <= score ? (score >= 4 ? 'bg-emerald-400' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400') : 'bg-slate-700'}`}
        />
      ))}
    </span>
  );
}

function StageRow({ stage, onTurn }: { stage: StageReview; onTurn: (turn: number) => void }) {
  const label = STAGE_LABELS[stage.key];
  return (
    <li className="border-t border-slate-800 py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-slate-100">{label}</span>
        <ScoreDots score={stage.score} label={label} />
      </div>
      <p className="mt-1 text-sm text-slate-300">{stage.feedback}</p>
      {stage.nextTime && (
        <p className="mt-1.5 text-sm text-slate-300">
          <span className="font-medium text-emerald-300">Next time: </span>
          {stage.nextTime}
        </p>
      )}
      {stage.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {stage.evidence.map((e) => (
            <li key={`${e.turn}:${e.quote}`} className="flex items-baseline gap-2 text-sm">
              <TurnLink turn={e.turn} onTurn={onTurn} />
              <q className="text-slate-400 italic">{e.quote}</q>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Verdict = 'ok' | 'off' | null;

function DeliveryRow(props: { label: string; value: string; target: string; verdict: Verdict }) {
  const tone =
    props.verdict === 'ok'
      ? 'text-emerald-300'
      : props.verdict === 'off'
        ? 'text-amber-300'
        : 'text-slate-200';
  return (
    <tr className="border-t border-slate-800 first:border-t-0">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-slate-400">
        {props.label}
      </th>
      <td className={`py-1.5 pr-3 font-medium tabular-nums ${tone}`}>
        {props.value}
        {props.verdict === 'off' && <span className="sr-only"> (off target)</span>}
      </td>
      <td className="py-1.5 text-xs text-slate-500">{props.target}</td>
    </tr>
  );
}

const within = (value: number | null, min: number, max: number): Verdict =>
  value === null ? null : value >= min && value <= max ? 'ok' : 'off';
const atMost = (value: number | null, max: number): Verdict =>
  value === null ? null : value <= max ? 'ok' : 'off';

export function DeliveryStats({ metrics }: { metrics: CallMetrics }) {
  const t = METRIC_TARGETS;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <table className="w-full text-sm">
      <tbody>
        <DeliveryRow
          label="Talk ratio (you)"
          value={metrics.talkRatio === null ? '–' : pct(metrics.talkRatio)}
          target={`${pct(t.talkRatio.min)}–${pct(t.talkRatio.max)}`}
          verdict={within(metrics.talkRatio, t.talkRatio.min, t.talkRatio.max)}
        />
        <DeliveryRow
          label="Pace"
          value={metrics.repWpm === null ? '–' : `${metrics.repWpm} wpm`}
          target={`${t.repWpm.min}–${t.repWpm.max} wpm`}
          verdict={within(metrics.repWpm, t.repWpm.min, t.repWpm.max)}
        />
        <DeliveryRow
          label="Fillers (um, uh…)"
          value={
            metrics.fillersPerMin === null
              ? String(metrics.coreFillers)
              : `${metrics.fillersPerMin}/min (${metrics.coreFillers})`
          }
          target={`≤ ${t.fillersPerMin.max}/min`}
          verdict={atMost(metrics.fillersPerMin, t.fillersPerMin.max)}
        />
        <DeliveryRow
          label="Soft fillers (like, you know…)"
          value={String(metrics.softFillers)}
          target="trend down"
          verdict={null}
        />
        <DeliveryRow
          label="Questions"
          value={`${metrics.questionsOpen} open · ${metrics.questionsClosed} closed`}
          target="more open than closed"
          verdict={
            metrics.questionsOpen + metrics.questionsClosed === 0
              ? null
              : metrics.questionsOpen > metrics.questionsClosed
                ? 'ok'
                : 'off'
          }
        />
        <DeliveryRow
          label="Longest monologue"
          value={`${metrics.longestMonologueSec} s`}
          target={`≤ ${t.longestMonologueSec.max} s`}
          verdict={atMost(metrics.longestMonologueSec, t.longestMonologueSec.max)}
        />
        <DeliveryRow
          label="Talked over her"
          value={String(metrics.interruptions)}
          target="low"
          verdict={null}
        />
        <DeliveryRow
          label="First question"
          value={
            metrics.timeToFirstQuestionSec === null
              ? 'never'
              : `${metrics.timeToFirstQuestionSec} s in`
          }
          target="earlier is better"
          verdict={metrics.timeToFirstQuestionSec === null ? 'off' : null}
        />
      </tbody>
    </table>
  );
}

/** The post-call scorecard (PLAN.md §8.4). */
export function Scorecard({ review, metrics, turns, onTurn }: ScorecardProps) {
  return (
    <div className="flex flex-col gap-4">
      {review.priorities && review.priorities.length > 0 && (
        <Section title="Your next call">
          <ol className="list-decimal space-y-1.5 pl-5 text-slate-100 marker:text-sky-400">
            {review.priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Turn by turn">
        <Walkthrough moments={walkthrough(review)} turns={turns} onTurn={onTurn} />
        {!review.moments && (
          <p className="mt-3 text-xs text-slate-500">
            This review was written before the turn-by-turn walkthrough: review it again for the
            full version.
          </p>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Stages">
          <ul>
            {review.stages.map((stage) => (
              <StageRow key={stage.key} stage={stage} onTurn={onTurn} />
            ))}
          </ul>
        </Section>
        <div className="flex flex-col gap-4">
          {metrics && (
            <Section title="Delivery">
              <DeliveryStats metrics={metrics} />
            </Section>
          )}
          {review.strengths.length > 0 && (
            <Section title="What went well">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
                {review.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Section>
          )}
          <Section title={`Drill: ${review.drill.title}`}>
            <p className="text-sm text-slate-300">{review.drill.instructions}</p>
          </Section>
        </div>
      </div>

      <Section title="Objections">
        {review.objections.length === 0 ? (
          <p className="text-sm text-slate-400">She raised no objections you had to answer.</p>
        ) : (
          <ul className="space-y-3">
            {review.objections.map((o, i) => (
              <li key={`${o.turn}:${i}`} className="rounded-lg border border-slate-800 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <q className="font-medium text-slate-100">{o.objection}</q>
                  <span className="flex items-center gap-2">
                    <ScoreDots score={o.score} label="Your answer" />
                    <TurnLink turn={o.turn} onTurn={onTurn} />
                  </span>
                </div>
                <p className="mt-2 text-slate-400">
                  You: <q className="text-slate-300">{o.yourResponse}</q>
                </p>
                <p className="mt-1 text-slate-400">
                  Better: <q className="text-emerald-200">{o.better}</q>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
