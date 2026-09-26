import type { CallDetail, CallTurn, ReviewResult } from '@ccc/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { rerunReview } from '../lib/api.ts';
import { CostSection } from './CostSection.tsx';
import { Scorecard } from './Scorecard.tsx';
import { OUTCOME_LABELS, OUTCOME_TONE, STAGE_LABELS, dateTime, duration } from './format.ts';
import { useCallDetail } from './useCallDetail.ts';

/** What the review says about each turn, shown beside it in the transcript. */
function annotations(review: ReviewResult | null): Map<number, string[]> {
  const notes = new Map<number, string[]>();
  const add = (turn: number, note: string) => notes.set(turn, [...(notes.get(turn) ?? []), note]);
  review?.topMoments.forEach((m, i) => add(m.turn, `Moment ${i + 1}`));
  review?.objections.forEach((o) => add(o.turn, 'Objection answered'));
  review?.stages.forEach((s) => s.evidence.forEach((e) => add(e.turn, STAGE_LABELS[s.key])));
  return notes;
}

function Transcript(props: {
  turns: CallTurn[];
  prospectName: string;
  review: ReviewResult | null;
  highlight: number | null;
}) {
  const notes = annotations(props.review);
  const firstName = props.prospectName.split(' ')[0] ?? props.prospectName;
  return (
    <ol className="space-y-2">
      {props.turns.map((turn) => {
        const n = turn.idx + 1;
        const rep = turn.speaker === 'rep';
        return (
          <li
            key={turn.idx}
            id={`turn-${n}`}
            className={`scroll-mt-24 rounded-lg p-2 text-sm transition-colors ${
              props.highlight === n ? 'bg-sky-500/15 ring-1 ring-sky-500/50' : ''
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{n}</span>
              <span className={rep ? 'text-sky-300' : 'text-fuchsia-300'}>
                {rep ? 'You' : firstName}
              </span>
              <span>{duration(turn.startMs)}</span>
              {(notes.get(n) ?? []).map((note) => (
                <span key={note} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  {note}
                </span>
              ))}
              {rep && turn.stateAfter && (
                <span title="Her hidden state after this turn">
                  interest {Math.round(turn.stateAfter.interest)} · patience{' '}
                  {Math.round(turn.stateAfter.patience)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-slate-200">
              {turn.text}
              {turn.interrupted && <span className="text-slate-500"> — (you cut in)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewStatusPanel(props: {
  detail: CallDetail;
  gaveUp: boolean;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const { detail, gaveUp } = props;
  const box = 'rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center';
  if (detail.call.status !== 'ended' || !detail.review) {
    return (
      <div className={box} role="status">
        <p className="font-medium">{gaveUp ? 'The call log never arrived.' : 'Saving the call…'}</p>
        <p className="mt-1 text-sm text-slate-400">
          {gaveUp
            ? 'The voice agent may have stopped mid-call; check its log.'
            : 'The voice agent sends it as soon as the call ends.'}
        </p>
      </div>
    );
  }
  const { review } = detail;
  if (review.status === 'pending' || review.status === 'running') {
    return (
      <div className={box} role="status">
        <p className="animate-pulse font-medium motion-reduce:animate-none">Reviewing…</p>
        <p className="mt-1 text-sm text-slate-400">
          Your coach is reading the call. This usually takes under half a minute.
        </p>
      </div>
    );
  }
  if (review.status === 'skipped') {
    return (
      <div className={box}>
        <p className="font-medium">No review for this call</p>
        <p className="mt-1 text-sm text-slate-400">{review.error}</p>
      </div>
    );
  }
  return (
    <div className={box} role="alert">
      <p className="font-medium text-rose-300">The review failed</p>
      <p className="mt-1 text-sm text-slate-400">{review.error ?? 'Unknown error.'}</p>
      <button
        type="button"
        onClick={props.onRerun}
        disabled={props.rerunning}
        className="mt-3 rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        Try again
      </button>
    </div>
  );
}

export function ReviewPage({ id }: { id: string }) {
  const { state, reload } = useCallDetail(id);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showTurn = useCallback((turn: number) => {
    document
      .getElementById(`turn-${turn}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(turn);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHighlight(null), 2_500);
  }, []);

  const rerun = async () => {
    setRerunning(true);
    setRerunError(null);
    try {
      await rerunReview(id);
      reload();
    } catch (error) {
      setRerunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        {state.kind === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.kind === 'missing' && (
          <p>
            No such call.{' '}
            <Link href="/calls" className="text-sky-300 underline">
              See your history
            </Link>
            .
          </p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="text-rose-300">
            Couldn't load this call: {state.message}
          </p>
        )}
        {state.kind === 'loaded' && (
          <Loaded
            detail={state.detail}
            gaveUp={state.gaveUp}
            highlight={highlight}
            onTurn={showTurn}
            onRerun={() => void rerun()}
            rerunning={rerunning}
            rerunError={rerunError}
          />
        )}
      </main>
    </div>
  );
}

function Loaded(props: {
  detail: CallDetail;
  gaveUp: boolean;
  highlight: number | null;
  onTurn: (turn: number) => void;
  onRerun: () => void;
  rerunning: boolean;
  rerunError: string | null;
}) {
  const { detail } = props;
  const { call, review } = detail;
  const result = review?.status === 'ready' ? review.result : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <h2 className="text-xl font-semibold">
            {call.scenario.prospectName}
            <span className="ml-2 text-sm font-normal text-slate-400">{call.scenario.title}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {dateTime(call.startedAt)} · {duration(call.durationMs)}
          </p>
          {call.outcome && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium ${OUTCOME_TONE[call.outcome]}`}
              >
                {OUTCOME_LABELS[call.outcome]}
              </span>
              {detail.outcomeReason && (
                <span className="text-slate-400">{detail.outcomeReason}</span>
              )}
            </p>
          )}
          {result && <p className="mt-3 max-w-2xl text-slate-200">{result.summary}</p>}
        </div>
        {result && (
          <div className="text-right">
            <p
              className="text-5xl font-semibold tabular-nums"
              aria-label={`Score ${result.overallScore} out of 100`}
            >
              {result.overallScore}
            </p>
            <p className="text-xs text-slate-500">out of 100</p>
          </div>
        )}
      </section>

      {result ? (
        <Scorecard review={result} metrics={detail.metrics} onTurn={props.onTurn} />
      ) : (
        <ReviewStatusPanel
          detail={detail}
          gaveUp={props.gaveUp}
          onRerun={props.onRerun}
          rerunning={props.rerunning}
        />
      )}
      {props.rerunError && (
        <p role="alert" className="text-sm text-rose-300">
          Couldn't restart the review: {props.rerunError}
        </p>
      )}

      {detail.turns.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="mb-3 text-sm font-medium tracking-wide text-slate-300 uppercase">
            Transcript
          </h3>
          <Transcript
            turns={detail.turns}
            prospectName={call.scenario.prospectName}
            review={result}
            highlight={props.highlight}
          />
        </section>
      )}

      {detail.cost && detail.cost.lines.length > 0 && <CostSection cost={detail.cost} />}

      {review?.status === 'ready' && (
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Reviewed by {review.model}
            {review.costUsd !== null && ` for $${review.costUsd.toFixed(3)}`}
            {result &&
              result.quotesDropped > 0 &&
              ` · ${result.quotesDropped} quote${result.quotesDropped === 1 ? '' : 's'} left out because the transcript didn't contain ${result.quotesDropped === 1 ? 'it' : 'them'}`}
          </span>
          <button
            type="button"
            onClick={props.onRerun}
            disabled={props.rerunning}
            className="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Review again
          </button>
        </footer>
      )}
    </div>
  );
}
