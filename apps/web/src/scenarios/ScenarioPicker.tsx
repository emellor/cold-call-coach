import type { Difficulty, ScenarioSummary } from '@ccc/contracts';

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  hard: 'bg-rose-500/15 text-rose-300',
};

interface ScenarioPickerProps {
  scenarios: readonly ScenarioSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** Locked while a call is live. */
  disabled: boolean;
}

/** Who you're calling: one card per scenario, easiest first. */
export function ScenarioPicker({ scenarios, selectedId, onSelect, disabled }: ScenarioPickerProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-slate-300">Who are you calling?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {scenarios.map((s) => {
          const selected = s.id === selectedId;
          return (
            <label
              key={s.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky-400 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                selected
                  ? 'border-sky-500 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="scenario"
                value={s.id}
                checked={selected}
                onChange={() => onSelect(s.id)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-100">{s.prospect.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_STYLE[s.difficulty]}`}
                >
                  {s.difficulty}
                </span>
              </span>
              <span className="text-slate-400">
                {s.prospect.role}, {s.prospect.company}
              </span>
              <span className="text-slate-300">{s.title}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
