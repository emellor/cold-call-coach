/** A "turn N" button that scrolls the transcript to that turn. */
export function TurnLink({ turn, onTurn }: { turn: number; onTurn: (turn: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTurn(turn)}
      className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-sky-300 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-sky-400"
    >
      turn {turn}
    </button>
  );
}
