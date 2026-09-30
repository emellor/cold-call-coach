// A reverse call's character card: in a reverse call the rep plays her and
// Sam makes the call, so the rep needs the whole of her, including what she
// keeps to herself. Sam knows only her name, role and company, so everything
// else here is his to find out.
import type { ProspectSpec } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { fetchCharacter } from '../lib/api.ts';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; prospect: ProspectSpec };

/** Her details; the card is keyed by her id, so another prospect starts it afresh. */
function useCharacter(scenarioId: string): State {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    fetchCharacter(scenarioId, abort.signal).then(
      ({ prospect }) => setState({ status: 'ready', prospect }),
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const detail = error instanceof Error ? error.message : String(error);
        setState({ status: 'error', message: `Couldn't load her details: ${detail}` });
      },
    );
    return () => abort.abort();
  }, [scenarioId]);
  return state;
}

const heading = 'text-xs font-semibold tracking-widest text-slate-400 uppercase';

export function CharacterCard({ scenarioId }: { scenarioId: string }) {
  const state = useCharacter(scenarioId);
  return (
    <section
      aria-labelledby="character"
      className="rounded-xl border border-fuchsia-900/60 bg-fuchsia-950/20 p-4"
    >
      <h2 id="character" className={heading}>
        You're playing
      </h2>
      {state.status === 'loading' && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
      {state.status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && <Character prospect={state.prospect} />}
    </section>
  );
}

function Character({ prospect }: { prospect: ProspectSpec }) {
  const { hidden } = prospect;
  const secrets = [
    ...hidden.pains.map((pain) => ({ label: 'Pain', text: pain })),
    { label: 'Today', text: hidden.currentSolution },
    { label: 'Who decides', text: hidden.decisionProcess },
    { label: 'Timing', text: hidden.timing },
  ];
  return (
    <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
      <div className="space-y-2">
        <p className="text-base">
          <span className="font-medium text-slate-100">{prospect.name}</span>
          <span className="text-slate-400">
            , {prospect.role} at {prospect.company}
          </span>
        </p>
        <p className="text-slate-300">
          <span className="text-slate-500">Answer the phone with </span>“{prospect.openingLine}”
        </p>
        <p className="text-slate-300">
          <span className="text-slate-500">Who she is: </span>
          {prospect.personality}
        </p>
        <p className="text-slate-300">
          <span className="text-slate-500">How she talks: </span>
          {prospect.speakingStyle}
        </p>
        <p className="text-xs text-slate-500">
          Sam knows only her name, role and company. Make him earn the rest.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <h3 className={heading}>What she keeps to herself</h3>
          <ul className="mt-1 space-y-1 text-slate-300">
            {secrets.map((s) => (
              <li key={`${s.label}:${s.text}`}>
                <span className="text-slate-500">{s.label}: </span>
                {s.text}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={heading}>Push back with</h3>
          <ul className="mt-1 space-y-1 text-slate-300">
            {prospect.objections.map((objection) => (
              <li key={objection}>“{objection}”</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
