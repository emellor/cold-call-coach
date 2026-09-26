// Short-lived cards on the call page: the coach's tip (fades after 8 s), the
// rep's hint, and a notice about the last control.
import type { CoachTipPayload } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import type { HintView, Notice } from './useCall.ts';

/** PLAN.md §8.2: tips fade after 8 s. */
export const TIP_VISIBLE_MS = 8_000;
export const NOTICE_VISIBLE_MS = 5_000;
const FADE_MS = 1_000;

/** Shows for `ms`, fading over its last second. Remount (a new key) to show again. */
function useFadeOut(ms: number): 'shown' | 'fading' | 'gone' {
  const [phase, setPhase] = useState<'shown' | 'fading' | 'gone'>('shown');
  useEffect(() => {
    const fade = window.setTimeout(() => setPhase('fading'), ms - FADE_MS);
    const gone = window.setTimeout(() => setPhase('gone'), ms);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [ms]);
  return phase;
}

/** Render with `key={tip.id}` so each new tip starts its own 8 s. */
export function TipCard({ tip }: { tip: CoachTipPayload }) {
  const phase = useFadeOut(TIP_VISIBLE_MS);
  if (phase === 'gone') return null;
  return (
    <div
      role="status"
      className={`max-w-sm rounded-lg border border-amber-400/60 bg-slate-950/90 px-4 py-2.5 shadow-lg backdrop-blur-sm transition-opacity duration-1000 motion-reduce:transition-none ${phase === 'fading' ? 'opacity-0' : 'opacity-100'}`}
    >
      <p className="text-xs font-medium tracking-wide text-amber-300 uppercase">Coach</p>
      <p className="mt-0.5 text-sm text-slate-100">{tip.text}</p>
    </div>
  );
}

/** Render with `key={notice.id}`. */
export function NoticeLine({ notice }: { notice: Notice }) {
  const phase = useFadeOut(NOTICE_VISIBLE_MS);
  if (phase === 'gone') return null;
  return (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`text-sm transition-opacity duration-1000 motion-reduce:transition-none ${phase === 'fading' ? 'opacity-0' : 'opacity-100'} ${notice.tone === 'error' ? 'text-rose-300' : 'text-sky-200'}`}
    >
      {notice.text}
    </p>
  );
}

export function HintCard({ hint, onClose }: { hint: HintView; onClose: () => void }) {
  return (
    <section
      aria-label="Hint"
      aria-busy={hint.status === 'loading'}
      className="rounded-xl border border-sky-700 bg-slate-950/90 p-4 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-sky-200">Lines you could say next</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the hint"
          className="rounded px-2 text-slate-400 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          ×
        </button>
      </div>
      {hint.status === 'loading' && (
        <p className="mt-2 animate-pulse text-sm text-slate-400 motion-reduce:animate-none">
          Thinking of lines…
        </p>
      )}
      {hint.status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {hint.message}
        </p>
      )}
      {hint.status === 'ready' && (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-100">
          {hint.suggestions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
