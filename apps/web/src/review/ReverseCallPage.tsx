// A reverse call's page: the rep played her and Sam, Claude as the expert rep,
// made the call. In place of a scorecard, Claude's notes on Sam's side: the
// technique behind each of his lines and why it worked there, then a summary
// and the patterns to copy.
import type { CallDetail, CallTurn, RepNotes } from '@ccc/contracts';
import { CostSection } from './CostSection.tsx';
import { OUTCOME_TONE, REVERSE_OUTCOME_LABELS, dateTime, duration } from './format.ts';

const box = 'rounded-xl border border-slate-800 bg-slate-900/60 p-4';

function NotesStatus(props: {
  detail: CallDetail;
  gaveUp: boolean;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const { detail, gaveUp } = props;
  const panel = `${box} p-6 text-center`;
  if (detail.call.status !== 'ended' || !detail.review) {
    return (
      <div className={panel} role="status">
        <p className="font-medium">{gaveUp ? 'The call log never arrived.' : 'Saving the call…'}</p>
        <p className="mt-1 text-sm text-slate-400">
          {gaveUp
            ? 'The voice agent may have stopped mid-call; check its log.'
            : 'The voice agent sends it as soon as the call ends.'}
        </p>
      </div>
    );
  }
  const { review } = detail;
  if (review.status === 'pending' || review.status === 'running') {
    return (
      <div className={panel} role="status">
        <p className="animate-pulse font-medium motion-reduce:animate-none">
          Writing notes on Sam's lines…
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Claude is going through what Sam said, and why. This usually takes under a minute.
        </p>
      </div>
    );
  }
  if (review.status === 'skipped') {
    return (
      <div className={panel}>
        <p className="font-medium">No notes for this call</p>
        <p className="mt-1 text-sm text-slate-400">{review.error}</p>
      </div>
    );
  }
  return (
    <div className={panel} role="alert">
      <p className="font-medium text-rose-300">The notes failed</p>
      <p className="mt-1 text-sm text-slate-400">{review.error ?? 'Unknown error.'}</p>
      <button
        type="button"
        onClick={props.onRerun}
        disabled={props.rerunning}
        className="mt-3 rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        Try again
      </button>
    </div>
  );
}

/** The call, turn by turn, with the note on each of Sam's lines beneath it. */
function Transcript(props: { turns: CallTurn[]; herName: string; notes: RepNotes | null }) {
  const byTurn = new Map((props.notes?.notes ?? []).map((n) => [n.turn, n]));
  return (
    <ol aria-label="The call" className="space-y-2">
      {props.turns.map((turn) => {
        const n = turn.idx + 1;
        const sam = turn.speaker === 'rep';
        const note = sam ? byTurn.get(n) : undefined;
        return (
          <li key={turn.idx} id={`turn-${n}`} className="rounded-lg p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{n}</span>
              <span className={sam ? 'text-sky-300' : 'text-fuchsia-300'}>
                {sam ? 'Sam' : `You, as ${props.herName}`}
              </span>
              <span>{duration(turn.startMs)}</span>
            </div>
            <p className="mt-0.5 text-slate-200">
              {turn.text}
              {turn.interrupted && <span className="text-slate-500"> — (you cut in)</span>}
            </p>
            {note && (
              <div className="mt-1.5 border-l-2 border-sky-700 pl-3">
                <p className="text-xs font-medium tracking-wide text-sky-300 uppercase">
                  {note.technique}
                </p>
                <p className="mt-0.5 text-slate-400">{note.note}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ReverseCallPage(props: {
  detail: CallDetail;
  gaveUp: boolean;
  onRerun: () => void;
  rerunning: boolean;
  rerunError: string | null;
}) {
  const { detail } = props;
  const { call, review } = detail;
  const notes = review?.status === 'ready' ? review.notes : null;
  const herName = call.scenario.prospectName.split(' ')[0] ?? call.scenario.prospectName;

  return (
    <div className="flex flex-col gap-4">
      <section className={box}>
        <p className="text-xs font-semibold tracking-widest text-fuchsia-300 uppercase">
          Reverse call
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          Sam called you as {call.scenario.prospectName}
          <span className="ml-2 text-sm font-normal text-slate-400">{call.scenario.title}</span>
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {dateTime(call.startedAt)} · {duration(call.durationMs)}
        </p>
        {call.outcome && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2.5 py-0.5 font-medium ${OUTCOME_TONE[call.outcome]}`}
            >
              {REVERSE_OUTCOME_LABELS[call.outcome]}
            </span>
            {detail.outcomeReason && <span className="text-slate-400">{detail.outcomeReason}</span>}
          </p>
        )}
        {notes && <p className="mt-3 max-w-3xl text-slate-200">{notes.summary}</p>}
        {notes && notes.lessons.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium tracking-wide text-slate-300 uppercase">
              What to copy
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-200 marker:text-sky-400">
              {notes.lessons.map((lesson) => (
                <li key={lesson}>{lesson}</li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {!notes && (
        <NotesStatus
          detail={detail}
          gaveUp={props.gaveUp}
          onRerun={props.onRerun}
          rerunning={props.rerunning}
        />
      )}
      {props.rerunError && (
        <p role="alert" className="text-sm text-rose-300">
          Couldn't restart the notes: {props.rerunError}
        </p>
      )}

      {detail.turns.length > 0 && (
        <section className={box}>
          <h3 className="mb-3 text-sm font-medium tracking-wide text-slate-300 uppercase">
            The call, with what Sam did and why
          </h3>
          <Transcript turns={detail.turns} herName={herName} notes={notes} />
        </section>
      )}

      {detail.cost && detail.cost.lines.length > 0 && (
        <CostSection
          cost={detail.cost}
          labels={{ review: 'These notes', stt: 'Hearing you', tts: "Sam's voice" }}
        />
      )}

      {review?.status === 'ready' && (
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Notes by {review.model}
            {review.costUsd !== null && ` for $${review.costUsd.toFixed(3)}`}
          </span>
          <button
            type="button"
            onClick={props.onRerun}
            disabled={props.rerunning}
            className="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Write the notes again
          </button>
        </footer>
      )}
    </div>
  );
}
