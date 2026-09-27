// The review's walkthrough: the call in turn order, each moment at its time,
// with what happened, the words to say instead and why they work.
import type { CallTurn, MomentKind } from '@ccc/contracts';
import { STAGE_LABELS, duration } from './format.ts';
import { MOMENT_LABELS, type ShownMoment, tally } from './moments.ts';
import { TurnLink } from './TurnLink.tsx';

const KIND_STYLE: Record<MomentKind, { icon: string; badge: string; rail: string }> = {
  strong: {
    icon: '✓',
    badge: 'bg-emerald-500/15 text-emerald-300',
    rail: 'border-l-emerald-500/70',
  },
  mistake: { icon: '✗', badge: 'bg-rose-500/15 text-rose-300', rail: 'border-l-rose-500/70' },
  missed: { icon: '◌', badge: 'bg-amber-500/15 text-amber-300', rail: 'border-l-amber-500/70' },
};

export function Walkthrough(props: {
  moments: readonly ShownMoment[];
  /** The transcript, for each moment's time. */
  turns: readonly CallTurn[];
  onTurn: (turn: number) => void;
}) {
  if (!props.moments.length) {
    return <p className="text-sm text-slate-400">No moments to call out.</p>;
  }
  return (
    <>
      <p className="mb-3 text-sm text-slate-400">{tally(props.moments)}</p>
      <ol aria-label="Moments, in the order they happened" className="space-y-3">
        {props.moments.map((m, i) => {
          const style = KIND_STYLE[m.kind];
          const at = props.turns[m.turn - 1];
          return (
            <li
              key={`${m.turn}:${i}`}
              className={`rounded-lg border border-l-4 border-slate-800 p-3 ${style.rail}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {at && (
                  <span className="font-mono text-slate-400 tabular-nums">
                    {duration(at.startMs)}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 font-medium ${style.badge}`}>
                  <span aria-hidden="true">{style.icon} </span>
                  {MOMENT_LABELS[m.kind]}
                </span>
                {m.stage && <span className="text-slate-500">{STAGE_LABELS[m.stage]}</span>}
                <span className="ml-auto">
                  <TurnLink turn={m.turn} onTurn={props.onTurn} />
                </span>
              </div>
              <p className="mt-2 text-sm">
                <span className="text-slate-500">
                  {m.kind === 'missed' ? 'She said' : 'You said'}:{' '}
                </span>
                <q className="text-slate-200">{m.quote}</q>
              </p>
              {m.whatHappened && <p className="mt-1 text-sm text-slate-300">{m.whatHappened}</p>}
              {m.sayInstead && (
                <div className="mt-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
                  <p className="text-xs font-medium tracking-wide text-emerald-300 uppercase">
                    Say instead
                  </p>
                  <q className="mt-0.5 block text-emerald-100">{m.sayInstead}</q>
                </div>
              )}
              {m.why && (
                <p className="mt-2 text-sm text-slate-400">
                  <span className="font-medium text-slate-300">
                    {m.kind === 'strong' ? 'Why it worked' : 'Why it works'}:{' '}
                  </span>
                  {m.why}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
