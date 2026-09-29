// Cheat sheets: the page of notes to keep in front of you on a real call.
// "Create cheat sheet" takes the rep's profile of the person they're about to
// call; Claude writes the sheet while they wait, and it is kept here.
import type { CheatSheetSummary } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { BriefDialog } from '../components/BriefDialog.tsx';
import { createCheatSheet, fetchCheatSheets } from '../lib/api.ts';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sheets: CheatSheetSummary[] };

const dated = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function CheatSheetsPage() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const abort = new AbortController();
    fetchCheatSheets(abort.signal).then(
      ({ sheets }) => setState({ status: 'ready', sheets }),
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const detail = error instanceof Error ? error.message : String(error);
        setState({ status: 'error', message: `Couldn't load the cheat sheets: ${detail}` });
      },
    );
    return () => abort.abort();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold">Cheat sheets</h2>
            <p className="mt-1 text-sm text-slate-300">
              The notes to have in front of you on a real call: how to open, why you're calling,
              what to ask, what to say when they ask or push back, and how to close. Short lines to
              read at a glance mid-call, or to print.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            Create cheat sheet
          </button>
        </section>

        {creating && (
          <BriefDialog
            title="Create a cheat sheet"
            intro="Describe the person you're about to call, and Claude writes your notes for the call: the opener, the questions to ask, what to say when they ask or push back, and the close."
            submitLabel="Create cheat sheet"
            note="One request to Claude: about 5 cents, and about half a minute to write."
            busyText="Writing your cheat sheet… about half a minute."
            onSubmit={async (brief) => {
              const { id } = await createCheatSheet({ brief });
              navigate(`/cheat-sheets/${id}`);
            }}
            onClose={() => setCreating(false)}
          />
        )}

        {state.status === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.status === 'error' && (
          <p role="alert" className="text-rose-300">
            {state.message}
          </p>
        )}
        {state.status === 'ready' && state.sheets.length === 0 && (
          <p className="text-slate-400">
            No cheat sheets yet. Create one for the next call you're making.
          </p>
        )}
        {state.status === 'ready' && state.sheets.length > 0 && (
          <ul aria-label="Cheat sheets" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state.sheets.map((sheet) => (
              <li key={sheet.id}>
                <Link
                  href={`/cheat-sheets/${sheet.id}`}
                  className="block h-full rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-sky-600 focus-visible:outline-2 focus-visible:outline-sky-400"
                >
                  <p className="text-xs text-slate-500">{dated(sheet.createdAt)}</p>
                  <p className="mt-1 font-medium text-slate-100">{sheet.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-400">
                    <span className="text-slate-500">Goal: </span>
                    {sheet.goal}
                  </p>
                  <p className="mt-2 text-xs text-sky-300">Open the sheet →</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
