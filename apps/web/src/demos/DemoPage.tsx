// One demo call, as a transcript to read: the whole conversation, and under
// each of the rep's lines the technique behind it and why it works there.
import type { DemoDetail, DemoTurn } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { ApiRequestError, fetchDemo } from '../lib/api.ts';
import { DIFFICULTY_STYLE, OUTCOME_CHIP } from './labels.ts';

type DemoState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; demo: DemoDetail };

function useDemo(id: string): DemoState {
  const [state, setState] = useState<DemoState>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    fetchDemo(id, abort.signal).then(
      (demo) => setState({ kind: 'ready', demo }),
      (error: unknown) => {
        if (abort.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 404) setState({ kind: 'missing' });
        else
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => abort.abort();
  }, [id]);
  return state;
}

function Line({ turn, prospectFirstName }: { turn: DemoTurn; prospectFirstName: string }) {
  const rep = turn.speaker === 'rep';
  return (
    <li className={`rounded-lg p-3 ${rep ? 'bg-slate-900/60' : ''}`}>
      <p className={`text-xs font-medium ${rep ? 'text-sky-300' : 'text-fuchsia-300'}`}>
        {rep ? 'Rep' : prospectFirstName}
      </p>
      <p className="mt-1 text-slate-100">{turn.text}</p>
      {rep && (turn.technique || turn.note) && (
        <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
          {turn.technique && (
            <p className="text-xs font-medium tracking-wide text-emerald-300 uppercase">
              {turn.technique}
            </p>
          )}
          {turn.note && <p className="mt-0.5 text-slate-300">{turn.note}</p>}
        </div>
      )}
    </li>
  );
}

export function DemoPage({ id }: { id: string }) {
  const state = useDemo(id);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <Link href="/demos" className="text-sm text-sky-300 hover:underline">
          ← All demo calls
        </Link>
        {state.kind === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.kind === 'missing' && <p>No such demo call.</p>}
        {state.kind === 'error' && (
          <p role="alert" className="text-rose-300">
            Couldn't load this demo call: {state.message}
          </p>
        )}
        {state.kind === 'ready' && <Loaded demo={state.demo} />}
      </main>
    </div>
  );
}

function Loaded({ demo }: { demo: DemoDetail }) {
  const outcome = demo.outcome ? OUTCOME_CHIP[demo.outcome] : null;
  const firstName = demo.prospect?.name.split(' ')[0] ?? 'Her';
  return (
    <>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xl font-semibold">{demo.title ?? `Demo call ${demo.position}`}</h2>
        {demo.prospect && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span>
              {demo.prospect.name}, {demo.prospect.role} at {demo.prospect.company}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_STYLE[demo.prospect.difficulty]}`}
            >
              {demo.prospect.difficulty}
            </span>
          </p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {outcome && (
            <span className={`rounded-full px-2.5 py-0.5 font-medium ${outcome.style}`}>
              {outcome.label}
            </span>
          )}
          {demo.outcomeDetail && <span className="text-slate-400">{demo.outcomeDetail}</span>}
        </p>
        <p className="mt-2 text-sm text-slate-400">
          <span className="text-slate-500">The rep's approach: </span>
          {demo.angle}
        </p>
        {demo.summary && <p className="mt-3 text-slate-200">{demo.summary}</p>}
        {demo.lessons.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium tracking-wide text-slate-300 uppercase">
              What to copy
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-200 marker:text-sky-400">
              {demo.lessons.map((lesson) => (
                <li key={lesson}>{lesson}</li>
              ))}
            </ol>
          </div>
        )}
      </section>
      {demo.status !== 'ready' ? (
        <p className="text-slate-400">
          {demo.status === 'failed'
            ? `This demo call wasn't written: ${demo.error ?? 'unknown error'}`
            : 'Claude is still writing this demo call.'}
        </p>
      ) : (
        <section aria-labelledby="the-call" className="flex flex-col gap-2">
          <h3 id="the-call" className="text-sm font-medium tracking-wide text-slate-300 uppercase">
            The call
          </h3>
          <ol aria-label="The call" className="space-y-1">
            {demo.turns.map((turn) => (
              <Line key={turn.idx} turn={turn} prospectFirstName={firstName} />
            ))}
          </ol>
          {demo.costUsd !== null && (
            <p className="text-xs text-slate-500">
              Written by Claude for ${demo.costUsd.toFixed(2)}.
            </p>
          )}
        </section>
      )}
    </>
  );
}
