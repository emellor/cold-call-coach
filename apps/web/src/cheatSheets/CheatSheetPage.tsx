// A cheat sheet: the page of notes to keep in front of you on a real call,
// laid out to be read at a glance mid-conversation. The call in order runs
// down the left (open, why you're calling, ask, close), and what to say back
// runs down the right. It prints on one page, black on white.
import type { CheatSheetDetail, CheatSheetReply } from '@ccc/contracts';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { ApiRequestError, deleteCheatSheet, fetchCheatSheet } from '../lib/api.ts';

type SheetState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; sheet: CheatSheetDetail };

function useCheatSheet(id: string): SheetState {
  const [state, setState] = useState<SheetState>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    fetchCheatSheet(id, abort.signal).then(
      (sheet) => setState({ kind: 'ready', sheet }),
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
    return () => abort.abort();
  }, [id]);
  return state;
}

export function CheatSheetPage({ id }: { id: string }) {
  const state = useCheatSheet(id);
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 print:max-w-none print:gap-2 print:p-0">
        {state.kind === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.kind === 'missing' && (
          <>
            <BackLink />
            <p>No such cheat sheet.</p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <BackLink />
            <p role="alert" className="text-rose-300">
              Couldn't load this cheat sheet: {state.message}
            </p>
          </>
        )}
        {state.kind === 'ready' && <Sheet sheet={state.sheet} />}
      </main>
    </div>
  );
}

const BackLink = () => (
  <Link href="/cheat-sheets" className="text-sm text-sky-300 hover:underline print:hidden">
    ← All cheat sheets
  </Link>
);

const TONES = {
  step: 'text-sky-300 print:text-black',
  reply: 'text-amber-300 print:text-black',
  close: 'text-emerald-300 print:text-black',
} as const;

function Section(props: {
  title: string;
  tone: keyof typeof TONES;
  /** Its place in the call, for the sections on the left. */
  step?: number;
  children: ReactNode;
}) {
  const { title, tone, step, children } = props;
  return (
    <section className="break-inside-avoid rounded-xl border border-slate-800 bg-slate-900/60 p-4 print:rounded-none print:border-0 print:border-t print:border-slate-400 print:bg-white print:px-0 print:py-2">
      <h3
        className={`flex items-center gap-2 text-xs font-semibold tracking-widest uppercase ${TONES[tone]}`}
      >
        {step !== undefined && (
          <span
            aria-hidden="true"
            className="grid size-5 place-items-center rounded-full border border-current text-[0.65rem]"
          >
            {step}
          </span>
        )}
        {title}
      </h3>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

/** A line to say, as it is. */
const Say = ({ children }: { children: ReactNode }) => (
  <p className="text-lg leading-snug text-slate-50 print:text-[11pt] print:text-black">
    {children}
  </p>
);

function Replies({ items }: { items: readonly CheatSheetReply[] }) {
  return (
    <dl className="space-y-3 print:space-y-1.5">
      {items.map((r) => (
        <div key={r.they}>
          <dt className="text-sm text-slate-400 print:text-[9pt] print:text-slate-700">
            “{r.they}”
          </dt>
          {/* A hanging arrow, so a reply that wraps lines up with its first line. */}
          <dd className="flex gap-1.5 text-lg leading-snug text-slate-50 print:text-[11pt] print:text-black">
            <span aria-hidden="true" className="text-slate-500">
              →
            </span>
            <span>{r.you}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Sheet({ sheet }: { sheet: CheatSheetDetail }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sheet: s } = sheet;

  const remove = async () => {
    if (!window.confirm(`Delete the cheat sheet for ${sheet.title}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCheatSheet(sheet.id);
      navigate('/cheat-sheets');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full border border-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Print
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-full border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:border-rose-500 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}

      <header className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 print:rounded-none print:border-0 print:bg-white print:p-0">
        <h2 className="text-2xl font-semibold print:text-[16pt]">{s.title}</h2>
        <p className="mt-1 text-lg text-sky-200 print:text-[12pt] print:text-black">
          <span className="text-sm font-semibold tracking-widest text-slate-400 uppercase print:text-slate-700">
            Goal{' '}
          </span>
          {s.goal}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2 print:gap-x-6 print:gap-y-0">
        <div className="space-y-4 print:space-y-0">
          <Section title="Open" tone="step" step={1}>
            {s.opener.map((line) => (
              <Say key={line}>“{line}”</Say>
            ))}
          </Section>
          <Section title="Why I'm calling" tone="step" step={2}>
            <Say>{s.reason}</Say>
          </Section>
          <Section title="Ask" tone="step" step={3}>
            <ol className="list-decimal space-y-2 pl-6 marker:text-sky-400 print:space-y-1 print:marker:text-black">
              {s.questions.map((q) => (
                <li key={q}>
                  <Say>{q}</Say>
                </li>
              ))}
            </ol>
          </Section>
          <Section title="Close" tone="close" step={4}>
            {s.close.map((line) => (
              <Say key={line}>“{line}”</Say>
            ))}
          </Section>
        </div>
        <div className="space-y-4 print:space-y-0">
          <Section title="If they push back" tone="reply">
            <Replies items={s.objections} />
          </Section>
          <Section title="If they ask" tone="reply">
            <Replies items={s.theirQuestions} />
          </Section>
          {s.valueLines.length > 0 && (
            <Section title="When they name a problem" tone="reply">
              <Replies items={s.valueLines} />
            </Section>
          )}
          {s.voicemail && (
            <Section title="Voicemail" tone="step">
              <Say>{s.voicemail}</Say>
            </Section>
          )}
        </div>
      </div>

      <details className="text-sm text-slate-400 print:hidden">
        <summary className="cursor-pointer select-none">
          Written from your profile
          {sheet.costUsd !== null && ` by Claude for $${sheet.costUsd.toFixed(2)}`}
        </summary>
        <p className="mt-2 whitespace-pre-line text-slate-300">{sheet.brief}</p>
      </details>
    </>
  );
}
