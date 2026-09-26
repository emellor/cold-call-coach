// The live coach panel (PLAN.md §8.1–8.2), coached calls only: the stage
// tracker, the talk ratio, the monologue timer, pace, fillers and questions.
import { type CoachMetricsPayload, METRIC_TARGETS, TrackerStage } from '@ccc/contracts';
import type { ReactNode } from 'react';
import { STAGE_LABELS } from '../review/format.ts';
import { monologueTone } from './coachFormat.ts';
import type { CoachView, StageMap } from './useCall.ts';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function StageTracker({ stages }: { stages: StageMap }) {
  return (
    <ol aria-label="Call stages" className="flex flex-wrap items-center gap-1.5 text-xs">
      {TrackerStage.options.map((stage, i) => {
        const status = stages[stage];
        const tone =
          status === 'active'
            ? 'border-sky-400 bg-sky-500/20 text-sky-100'
            : status === 'done'
              ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
              : 'border-slate-700 text-slate-500';
        return (
          <li key={stage} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-slate-600">
                →
              </span>
            )}
            <span
              aria-current={status === 'active' ? 'step' : undefined}
              className={`rounded-full border px-2.5 py-1 font-medium ${tone}`}
            >
              {status === 'done' && <span aria-hidden="true">✓ </span>}
              {STAGE_LABELS[stage]}
              {status === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Tile(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-950/50 p-3">
      <p className="text-xs text-slate-400">{props.label}</p>
      <div className="mt-1 text-lg font-semibold tabular-nums">{props.children}</div>
      {props.hint && <p className="mt-0.5 text-xs text-slate-500">{props.hint}</p>}
    </div>
  );
}

const onTarget = (ok: boolean | null) =>
  ok === null ? 'text-slate-200' : ok ? 'text-emerald-300' : 'text-amber-300';

export function TalkRatio({ ratio }: { ratio: number | null }) {
  const { min, max } = METRIC_TARGETS.talkRatio;
  const ok = ratio === null ? null : ratio >= min && ratio <= max;
  return (
    <Tile label="You talking" hint={`target ${pct(min)}–${pct(max)}`}>
      <span className={onTarget(ok)}>{ratio === null ? '–' : pct(ratio)}</span>
      <div
        role="meter"
        aria-label="Your share of the talking"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
        className="relative mt-2 h-2 overflow-hidden rounded-full bg-fuchsia-500/40"
      >
        <div
          className="h-full bg-sky-400 transition-[width] duration-500"
          style={{ width: pct(ratio ?? 0) }}
        />
        {/* The target band. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 border-x border-white/70"
          style={{ left: pct(min), width: pct(max - min) }}
        />
      </div>
    </Tile>
  );
}

export function MonologueTimer(props: { current: number; longest: number }) {
  const tone = monologueTone(props.current);
  const colour =
    tone === 'over' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-300' : 'text-slate-100';
  return (
    <Tile label="Monologue" hint={`longest ${Math.round(props.longest)} s · keep under 45 s`}>
      <span className={colour} data-tone={tone}>
        {Math.floor(props.current)} s
      </span>
      {tone !== 'ok' && (
        <span className={`ml-2 text-xs font-medium ${colour}`}>
          {tone === 'over' ? 'Stop and ask a question' : 'Wrap up soon'}
        </span>
      )}
    </Tile>
  );
}

export function CoachStats({ metrics }: { metrics: CoachMetricsPayload | undefined }) {
  const { repWpm } = METRIC_TARGETS;
  const wpm = metrics?.repWpm ?? null;
  const fillersOk =
    metrics?.fillersPerMin == null
      ? null
      : metrics.fillersPerMin <= METRIC_TARGETS.fillersPerMin.max;
  const open = metrics?.questionsOpen ?? 0;
  const closed = metrics?.questionsClosed ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <TalkRatio ratio={metrics?.talkRatio ?? null} />
      <MonologueTimer
        current={metrics?.currentMonologueSec ?? 0}
        longest={metrics?.longestMonologueSec ?? 0}
      />
      <Tile label="Pace" hint={`target ${repWpm.min}–${repWpm.max} wpm`}>
        <span className={onTarget(wpm === null ? null : wpm >= repWpm.min && wpm <= repWpm.max)}>
          {wpm === null ? '–' : `${wpm} wpm`}
        </span>
      </Tile>
      <Tile label="Fillers" hint={`${metrics?.softFillers ?? 0} soft (like, you know…)`}>
        <span className={onTarget(fillersOk)}>
          {metrics?.coreFillers ?? 0} um/uh
          {metrics?.fillersPerMin != null && (
            <span className="ml-1 text-sm font-normal text-slate-400">
              ({metrics.fillersPerMin}/min)
            </span>
          )}
        </span>
      </Tile>
      <Tile label="Questions" hint="more open than closed">
        <span className={onTarget(open + closed === 0 ? null : open > closed)}>
          {open} open · {closed} closed
        </span>
      </Tile>
    </div>
  );
}

export function CoachPanel({ coach }: { coach: CoachView }) {
  return (
    <section
      aria-label="Live coach"
      className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
    >
      <StageTracker stages={coach.stages} />
      <CoachStats metrics={coach.metrics} />
    </section>
  );
}
