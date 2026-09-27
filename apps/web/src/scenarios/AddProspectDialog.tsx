// "Add new": the rep describes the person they want to practise on, and Claude
// writes her. Her private facts stay on the server, like everyone else's: the
// rep learns them the same way, on the call.
import type { CreateScenarioResponse } from '@ccc/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { createScenario } from '../lib/api.ts';
import { EXAMPLES } from './examples.ts';

export function AddProspectDialog(props: {
  onClose: () => void;
  onAdded: (added: CreateScenarioResponse) => void;
}) {
  const { onClose, onAdded } = props;
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  // Escape closes it, unless she is being written: she'd be added all the same.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await createScenario({ description }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        onSubmit={(event) => void submit(event)}
        className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Add someone to call
        </h2>
        <p className="text-sm text-slate-300">
          Describe the person: their job, their company, how they'll take a cold call. Claude writes
          her background, what she's struggling with and how she'll push back, and adds her to the
          list. You find those out on the call, as with everyone else.
        </p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
          Who are you calling?
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={2000}
            required
            disabled={busy}
            // Opened on purpose, so typing is the next thing to do.
            autoFocus
            placeholder={EXAMPLES[0]}
            className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-normal text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-60"
          />
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Or start from one of these:</span>
          <ul className="flex flex-col gap-1.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDescription(example)}
                  className="w-full rounded-md border border-slate-800 px-3 py-1.5 text-left text-slate-300 hover:border-slate-600 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-60"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          Every prospect is a woman for now: the coaching is written that way.
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {busy && (
            <p
              role="status"
              className="mr-auto animate-pulse text-sm text-slate-300 motion-reduce:animate-none"
            >
              Writing her… about half a minute.
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm text-slate-300 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || description.trim().length < 10}
            className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
          >
            Add her
          </button>
        </div>
      </form>
    </div>
  );
}
