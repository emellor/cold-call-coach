// The rep describes a call they're about to make: who they're calling, the
// business and what they want from it. A demo call and a cheat sheet are both
// written from one of these; each page says what it writes and what it costs.
import { MIN_BRIEF_LENGTH } from '@ccc/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';

/** Briefs to start from, as a rep might write them. */
const BRIEF_EXAMPLES = [
  "Sarah Patel, Head of Estates at Carewell, 14 care homes across Yorkshire. Their gas bills doubled last winter and the board wants answers. She's busy and wary of salespeople. I want a 20-minute call to show her site-by-site monitoring.",
  'Mark Jones, operations director at a food manufacturer with three factories in the Midlands. Energy is his second-biggest cost after staff, and ESOS Phase 4 is coming. Objective: a site visit to their biggest plant.',
  'The finance director of a regional chain of 30 gyms. They fixed their energy contract last year and think they are sorted. Objective: agree to a 15-minute call with our energy analyst.',
] as const;

export function BriefDialog(props: {
  title: string;
  /** What Claude writes from the brief. */
  intro: string;
  submitLabel: string;
  /** What it costs and how long it takes, above the buttons. */
  note: string;
  /** Shown while it's being written, when that takes the rep's time. */
  busyText?: string;
  /** Writes it; a rejection is shown in the dialog, and the rep can try again. */
  onSubmit: (brief: string) => Promise<void>;
  onClose: () => void;
}) {
  const { title, intro, submitLabel, note, busyText, onSubmit, onClose } = props;
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const hintId = useId();

  // Escape closes it, unless it's being written: it would be kept all the same.
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
      await onSubmit(brief);
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
          {title}
        </h2>
        <p className="text-sm text-slate-300">{intro}</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
          Who are you calling, and what do you want from the call?
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={6}
            maxLength={2000}
            required
            disabled={busy}
            // Opened on purpose, so typing is the next thing to do.
            autoFocus
            aria-describedby={hintId}
            placeholder={BRIEF_EXAMPLES[0]}
            className="rounded-lg border border-slate-700 bg-slate-950 p-3 font-normal text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-60"
          />
        </label>
        <p id={hintId} className="-mt-1 text-xs text-slate-400">
          Their name and job, the business and what's going on there, how they'll take a cold call,
          and your objective. Claude fills in anything you leave out.
        </p>
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Or start from one of these:</span>
          <ul className="flex flex-col gap-1.5">
            {BRIEF_EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setBrief(example)}
                  className="w-full rounded-md border border-slate-800 px-3 py-1.5 text-left text-slate-300 hover:border-slate-600 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-60"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        {busy && busyText ? (
          <p
            role="status"
            className="animate-pulse text-sm text-slate-300 motion-reduce:animate-none"
          >
            {busyText}
          </p>
        ) : (
          <p className="text-xs text-slate-500">{note}</p>
        )}
        <div className="flex items-center justify-end gap-3">
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
            disabled={busy || brief.trim().length < MIN_BRIEF_LENGTH}
            className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
