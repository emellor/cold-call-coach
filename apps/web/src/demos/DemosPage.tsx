// Demo calls: model cold calls to read. An expert rep calls the prospects, a
// different approach each time, and every line the rep says carries the
// technique behind it. Generating them spends money, so the button says how
// much first.
import { type DemoSummary, MAX_DEMO_BATCH } from '@ccc/contracts';
import { useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { generateDemos, retryDemos } from '../lib/api.ts';
import { DIFFICULTY_STYLE, GENERATE_CONFIRM, OUTCOME_CHIP, STATUS_CHIP } from './labels.ts';
import { useDemos, writing } from './useDemos.ts';

function DemoCard({ demo }: { demo: DemoSummary }) {
  const chip =
    demo.outcome && demo.status === 'ready' ? OUTCOME_CHIP[demo.outcome] : STATUS_CHIP[demo.status];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono text-slate-500">#{demo.position}</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${chip.style}`}>{chip.label}</span>
      </div>
      <p className="mt-2 font-medium text-slate-100">
        {demo.title ?? `Demo call ${demo.position}`}
      </p>
      {demo.prospect && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
          <span>
            {demo.prospect.name}, {demo.prospect.role}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_STYLE[demo.prospect.difficulty]}`}
          >
            {demo.prospect.difficulty}
          </span>
        </p>
      )}
      <p className="mt-2 line-clamp-2 text-sm text-slate-400">
        <span className="text-slate-500">Approach: </span>
        {demo.angle}
      </p>
      {demo.status === 'failed' && demo.error && (
        <p className="mt-2 line-clamp-3 text-sm text-rose-300">{demo.error}</p>
      )}
      {demo.status === 'ready' && <p className="mt-2 text-xs text-sky-300">Read the call →</p>}
    </>
  );
  const card = 'block h-full rounded-xl border border-slate-800 bg-slate-900/60 p-4';
  return (
    <li>
      {demo.status === 'ready' ? (
        <Link
          href={`/demos/${demo.id}`}
          className={`${card} transition-colors hover:border-sky-600 focus-visible:outline-2 focus-visible:outline-sky-400`}
        >
          {body}
        </Link>
      ) : (
        <div className={`${card} ${demo.status === 'failed' ? '' : 'opacity-70'}`}>{body}</div>
      )}
    </li>
  );
}

/** How far the newest batch has got. */
function Progress({ demos }: { demos: readonly DemoSummary[] }) {
  const newest = demos[0]?.createdAt;
  const batch = demos.filter((d) => d.createdAt === newest);
  const ready = batch.filter((d) => d.status === 'ready').length;
  const now = batch.filter((d) => d.status === 'generating').length;
  return (
    <section
      aria-label="Progress"
      className="rounded-xl border border-sky-800 bg-sky-950/40 p-4 text-sm text-sky-100"
    >
      <p role="status">
        {ready} of {batch.length} demo calls written.
        {now ? ` Claude is writing ${now} now.` : ' Starting…'} You can leave this page: they carry
        on in the background.
      </p>
      <div
        role="progressbar"
        aria-label="Demo calls ready"
        aria-valuemin={0}
        aria-valuemax={batch.length}
        aria-valuenow={ready}
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-[width]"
          style={{ width: `${batch.length ? (ready / batch.length) * 100 : 0}%` }}
        />
      </div>
    </section>
  );
}

export function DemosPage() {
  const { state, reload } = useDemos();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const demos = state.status === 'ready' ? state.demos : [];
  const inProgress = writing(demos);
  const failed = demos.filter((d) => d.status === 'failed').length;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await run();
      reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold">Demo calls</h2>
            <p className="mt-1 text-sm text-slate-300">
              Model cold calls to read: an expert rep calls your prospects, taking a different
              approach each time. Open one to read the whole call, with the technique behind every
              line the rep says and why it works at that point.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {failed > 0 && !inProgress && (
              <button
                type="button"
                onClick={() => void act(retryDemos)}
                disabled={busy}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
              >
                Retry {failed} failed
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (window.confirm(GENERATE_CONFIRM)) void act(() => generateDemos(MAX_DEMO_BATCH));
              }}
              disabled={busy || inProgress || state.status !== 'ready'}
              className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
            >
              Generate {MAX_DEMO_BATCH} demo calls
            </button>
          </div>
        </section>

        {notice && (
          <p role="alert" className="text-sm text-rose-300">
            {notice}
          </p>
        )}
        {state.status === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.status === 'error' && (
          <p role="alert" className="text-rose-300">
            {state.message}
          </p>
        )}
        {inProgress && <Progress demos={demos} />}
        {state.status === 'ready' && demos.length === 0 && (
          <p className="text-slate-400">
            No demo calls yet. Generate some, and Claude writes them in the background.
          </p>
        )}
        {demos.length > 0 && (
          <ul aria-label="Demo calls" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {demos.map((demo) => (
              <DemoCard key={demo.id} demo={demo} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
