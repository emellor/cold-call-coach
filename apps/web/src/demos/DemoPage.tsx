// One demo call, as a transcript to read or to listen to: the whole
// conversation, and under each of the rep's lines the technique behind it and
// why it works there. Listening uses the browser's own voices, so it costs
// nothing. A demo from a brief is still being written when the rep lands here,
// so the page checks back until it is.
import type { DemoDetail, DemoTurn } from '@ccc/contracts';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { PauseIcon, PlayIcon, SpeakerIcon, StopIcon } from '../components/icons.tsx';
import { ApiRequestError, createCheatSheet, fetchDemo, practiseDemo } from '../lib/api.ts';
import { DIFFICULTY_STYLE, OUTCOME_CHIP } from './labels.ts';
import { READING_RATES, useCallReader } from './useCallReader.ts';

/** How often a demo still being written is checked, and for how long at most. */
export const DEMO_POLL_MS = 3_000;
export const DEMO_POLL_LIMIT_MS = 10 * 60_000;

type DemoState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; demo: DemoDetail };

const settled = (demo: DemoDetail) => demo.status === 'ready' || demo.status === 'failed';

function useDemo(id: string): DemoState {
  const [state, setState] = useState<DemoState>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    const started = Date.now();
    let timer: number | undefined;
    const load = () =>
      fetchDemo(id, abort.signal).then(
        (demo) => {
          setState({ kind: 'ready', demo });
          if (!settled(demo) && Date.now() - started < DEMO_POLL_LIMIT_MS) {
            timer = window.setTimeout(() => void load(), DEMO_POLL_MS);
          }
        },
        (error: unknown) => {
          if (abort.signal.aborted) return;
          if (error instanceof ApiRequestError && error.status === 404) {
            setState({ kind: 'missing' });
          } else {
            setState({
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    void load();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [id]);
  return state;
}

function Line(props: {
  turn: DemoTurn;
  prospectFirstName: string;
  /** Being read aloud now. */
  active: boolean;
  /** Reads the call from this line on; absent where the browser can't read aloud. */
  onListen?: () => void;
}) {
  const { turn, prospectFirstName, active, onListen } = props;
  const rep = turn.speaker === 'rep';
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [active]);
  return (
    <li
      ref={ref}
      aria-current={active ? 'true' : undefined}
      className={`rounded-lg p-3 transition-colors ${
        active ? 'bg-sky-950/60 ring-1 ring-sky-500/70' : rep ? 'bg-slate-900/60' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-medium ${rep ? 'text-sky-300' : 'text-fuchsia-300'}`}>
          {rep ? 'Rep' : prospectFirstName}
        </p>
        {onListen && (
          <button
            type="button"
            onClick={onListen}
            aria-label={`Listen from line ${turn.idx + 1}`}
            title="Listen from here"
            className="-m-1 rounded-full p-1.5 text-slate-500 hover:text-sky-300 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <PlayIcon width={14} height={14} />
          </button>
        )}
      </div>
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
  const firstName = demo.prospect?.name.split(' ')[0] ?? 'Prospect';
  const fromBrief = demo.brief !== null;
  return (
    <>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xl font-semibold">
          {demo.title ?? (fromBrief ? 'Demo call from your brief' : `Demo call ${demo.position}`)}
        </h2>
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
        {demo.angle && (
          <p className="mt-2 text-sm text-slate-400">
            <span className="text-slate-500">The rep's approach: </span>
            {demo.angle}
          </p>
        )}
        {demo.brief && (
          <div className="mt-3 text-sm">
            <p className="text-slate-500">Your brief</p>
            <p className="mt-0.5 whitespace-pre-line text-slate-300">{demo.brief}</p>
          </div>
        )}
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
      {demo.status === 'ready' && demo.brief && (
        <PrepareForTheCall demo={demo} brief={demo.brief} />
      )}
      {demo.status === 'ready' ? (
        <TheCall demo={demo} prospectFirstName={firstName} />
      ) : demo.status === 'failed' ? (
        <p className="text-slate-400">
          This demo call wasn't written: {demo.error ?? 'unknown error'}
        </p>
      ) : (
        <p role="status" className="animate-pulse text-slate-300 motion-reduce:animate-none">
          Claude is writing this call: it takes about a minute, and this page shows it as soon as
          it's ready.
        </p>
      )}
    </>
  );
}

/**
 * A demo from a brief is about a call the rep is going to make: practise it
 * against the same person, or take a cheat sheet into the real one.
 */
function PrepareForTheCall({ demo, brief }: { demo: DemoDetail; brief: string }) {
  const [, navigate] = useLocation();
  const [practice, setPractice] = useState(demo.practiceProspect);
  const [busy, setBusy] = useState<'practice' | 'sheet' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstName = demo.prospect?.name.split(' ')[0] ?? 'them';

  const run = async (what: 'practice' | 'sheet', action: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  // A man in the brief comes back as a woman with another name, so he isn't named here.
  const male = demo.prospect?.gender === 'male';
  const status =
    busy === 'practice'
      ? male
        ? 'Writing your practice prospect… about half a minute.'
        : `Adding ${firstName} to your prospects… about half a minute.`
      : busy === 'sheet'
        ? 'Writing your cheat sheet… about half a minute.'
        : practice
          ? `${practice.name} is in your prospects on the Call page.`
          : 'Practise the call yourself, live, against the same person, or take a cheat sheet into the real one. Each is one request to Claude, 5 to 10 cents.';

  return (
    <section
      aria-labelledby="prepare"
      className="rounded-xl border border-sky-900 bg-sky-950/30 p-4"
    >
      <h3 id="prepare" className="text-sm font-medium tracking-wide text-slate-300 uppercase">
        Prepare for this call
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {practice ? (
          <Link
            href={`/?prospect=${encodeURIComponent(practice.id)}`}
            className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            Practise the call with {practice.name.split(' ')[0]} →
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('practice', async () => {
                const { scenario } = await practiseDemo(demo.id);
                setPractice({ id: scenario.id, name: scenario.prospect.name });
              })
            }
            className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
          >
            Practise this call
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('sheet', async () => {
              const { id } = await createCheatSheet({ brief });
              navigate(`/cheat-sheets/${id}`);
            })
          }
          className="rounded-full border border-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
        >
          Cheat sheet for this call
        </button>
      </div>
      <p
        role="status"
        className={`mt-2 text-xs text-slate-400 ${busy ? 'animate-pulse motion-reduce:animate-none' : ''}`}
      >
        {status}
      </p>
      {!practice && male && (
        <p className="mt-1 text-xs text-slate-500">
          Practice prospects are all women for now, as the coaching is written that way: {firstName}{' '}
          becomes a woman in the same job.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
    </section>
  );
}

function TheCall({ demo, prospectFirstName }: { demo: DemoDetail; prospectFirstName: string }) {
  const reader = useCallReader({
    turns: demo.turns,
    locale: demo.prospect?.locale ?? 'en-GB',
    prospectGender: demo.prospect?.gender ?? 'female',
  });
  const { state } = reader;
  const reading = state.status === 'playing' || state.status === 'paused' ? state.line : null;
  return (
    <section aria-labelledby="the-call" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="the-call" className="text-sm font-medium tracking-wide text-slate-300 uppercase">
          The call
        </h3>
        {reader.supported ? (
          <ListenBar reader={reader} lines={demo.turns.length} />
        ) : (
          <p className="text-xs text-slate-500">This browser can't read the call aloud.</p>
        )}
      </div>
      {state.status === 'failed' && (
        <p role="alert" className="text-sm text-rose-300">
          {state.message}
        </p>
      )}
      <ol aria-label="The call" className="space-y-1">
        {demo.turns.map((turn) => (
          <Line
            key={turn.idx}
            turn={turn}
            prospectFirstName={prospectFirstName}
            active={reading === turn.idx}
            onListen={reader.supported ? () => reader.play(turn.idx) : undefined}
          />
        ))}
      </ol>
      {demo.costUsd !== null && (
        <p className="text-xs text-slate-500">Written by Claude for ${demo.costUsd.toFixed(2)}.</p>
      )}
    </section>
  );
}

const control =
  'inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400';

function ListenBar({ reader, lines }: { reader: ReturnType<typeof useCallReader>; lines: number }) {
  const { state, rate } = reader;
  const reading = state.status === 'playing' || state.status === 'paused';
  return (
    <div role="group" aria-label="Listen to the call" className="flex flex-wrap items-center gap-2">
      {state.status === 'playing' ? (
        <button type="button" onClick={reader.pause} className={control}>
          <PauseIcon width={16} height={16} /> Pause
        </button>
      ) : state.status === 'paused' ? (
        <button type="button" onClick={reader.resume} className={control}>
          <PlayIcon width={16} height={16} /> Resume
        </button>
      ) : (
        <button
          type="button"
          onClick={() => reader.play()}
          className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
        >
          <SpeakerIcon width={16} height={16} /> Listen
        </button>
      )}
      {reading && (
        <>
          <button type="button" onClick={reader.stop} className={control}>
            <StopIcon width={16} height={16} /> Stop
          </button>
          <span className="text-xs text-slate-400 tabular-nums">
            Line {state.line + 1} of {lines}
          </span>
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        Speed
        <select
          value={rate}
          onChange={(event) => reader.setRate(Number(event.target.value))}
          className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          {READING_RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
