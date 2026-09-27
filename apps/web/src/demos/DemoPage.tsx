// One demo call, played line by line: the current line is highlighted, and
// each of the rep's lines carries the technique behind it and why it works.
import { DEMO_GAP_MS, type DemoDetail, type DemoTurn } from '@ccc/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { ApiRequestError, demoAudioUrl, fetchDemo } from '../lib/api.ts';
import { duration } from '../review/format.ts';
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

/** Plays the voiced lines in order through one audio element, with a short gap between them. */
function usePlayer(demo: DemoDetail) {
  const audio = useRef<HTMLAudioElement>(null);
  const gap = useRef<number | undefined>(undefined);
  const voiced = useMemo(
    () => demo.turns.filter((t) => t.audioMs !== null).map((t) => t.idx),
    [demo],
  );
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => window.clearTimeout(gap.current), []);

  // Point the element at the current line, and play or pause it.
  useEffect(() => {
    const el = audio.current;
    if (!el || current === null) return;
    const src = demoAudioUrl(demo.id, current);
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    if (playing) {
      el.play()?.catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [current, playing, demo.id]);

  const playFrom = useCallback((idx: number) => {
    window.clearTimeout(gap.current);
    setCurrent(idx);
    setPlaying(true);
  }, []);

  const toggle = () => {
    window.clearTimeout(gap.current);
    if (playing) setPlaying(false);
    else if (current === null) playFrom(voiced[0] ?? 0);
    else setPlaying(true);
  };

  const onEnded = () => {
    const next = voiced[voiced.indexOf(current ?? -1) + 1];
    if (next === undefined) {
      setPlaying(false);
      setCurrent(null);
      return;
    }
    gap.current = window.setTimeout(() => setCurrent(next), DEMO_GAP_MS);
  };

  return { audio, voiced, current, playing, playFrom, toggle, onEnded };
}

function Line(props: {
  turn: DemoTurn;
  prospectFirstName: string;
  current: boolean;
  onPlay?: () => void;
}) {
  const { turn, current } = props;
  const rep = turn.speaker === 'rep';
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [current]);
  return (
    <li
      ref={ref}
      aria-current={current || undefined}
      className={`rounded-lg p-3 transition-colors ${current ? 'bg-sky-500/10 ring-1 ring-sky-500/60' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={rep ? 'font-medium text-sky-300' : 'font-medium text-fuchsia-300'}>
          {rep ? 'Rep' : props.prospectFirstName}
        </span>
        <span className="flex items-center gap-3 text-slate-500">
          {rep && turn.interest !== null && turn.patience !== null && (
            <span title="Her interest and patience after this line">
              interest {Math.round(turn.interest)} · patience {Math.round(turn.patience)}
            </span>
          )}
          {props.onPlay && (
            <button
              type="button"
              onClick={props.onPlay}
              className="rounded px-1.5 py-0.5 text-sky-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              Play from here
            </button>
          )}
        </span>
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

function Player({ demo }: { demo: DemoDetail }) {
  const { audio, voiced, current, playing, playFrom, toggle, onEnded } = usePlayer(demo);
  const firstName = demo.prospect?.name.split(' ')[0] ?? 'Her';
  const position = current === null ? null : voiced.indexOf(current) + 1;
  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/95 p-3 backdrop-blur-sm">
        <button
          type="button"
          onClick={toggle}
          disabled={!voiced.length}
          className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
        >
          {playing ? 'Pause' : current === null ? 'Play the call' : 'Resume'}
        </button>
        <p className="text-sm text-slate-400" aria-live="polite">
          {voiced.length === 0
            ? 'This demo has no audio: read it below.'
            : position === null
              ? `${voiced.length} lines`
              : `Line ${position} of ${voiced.length}`}
        </p>
        {/* One element for every line, so the browser keeps a single audio session. */}
        <audio ref={audio} onEnded={onEnded} preload="auto" className="hidden" />
      </div>
      <ol aria-label="The call" className="space-y-1">
        {demo.turns.map((turn) => (
          <Line
            key={turn.idx}
            turn={turn}
            prospectFirstName={firstName}
            current={turn.idx === current}
            {...(turn.audioMs !== null ? { onPlay: () => playFrom(turn.idx) } : {})}
          />
        ))}
      </ol>
    </>
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
          {demo.durationMs !== null && (
            <span className="text-slate-500">· {duration(demo.durationMs)}</span>
          )}
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
      <Player demo={demo} />
    </>
  );
}
