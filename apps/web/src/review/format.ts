import type { CallOutcome, CostKey, CostLine, RubricCriterionKey } from '@ccc/contracts';

export const STAGE_LABELS: Record<RubricCriterionKey, string> = {
  opener: 'Opener',
  reason: 'Reason for call',
  discovery: 'Discovery',
  objections: 'Objections',
  next_step: 'Next step',
  delivery: 'Delivery',
};

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  meeting_booked: 'Meeting booked',
  hung_up_by_prospect: 'She hung up',
  ended_by_rep: 'You hung up',
  timeout: 'Time limit reached',
  error: 'Call failed',
};

/** A reverse call's outcomes: the rep played her, and Sam made the call. */
export const REVERSE_OUTCOME_LABELS: Record<CallOutcome, string> = {
  meeting_booked: 'Sam booked the meeting',
  hung_up_by_prospect: 'You hung up',
  ended_by_rep: 'Sam ended the call',
  timeout: 'Time limit reached',
  error: 'Call failed',
};

export const OUTCOME_TONE: Record<CallOutcome, string> = {
  meeting_booked: 'bg-emerald-500/15 text-emerald-300',
  hung_up_by_prospect: 'bg-rose-500/15 text-rose-300',
  ended_by_rep: 'bg-slate-500/20 text-slate-300',
  timeout: 'bg-amber-500/15 text-amber-300',
  error: 'bg-rose-500/15 text-rose-300',
};

/** 83_000 → "1:23". */
export function duration(ms: number | null): string {
  if (ms === null) return '–';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** 0.2918 → "$0.29"; anything under a cent shows as "<$0.01". */
export function money(usd: number | null): string {
  if (usd === null) return '–';
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export const COST_LABELS: Record<CostKey, string> = {
  prospect: 'Her replies',
  rep: "Sam's replies",
  judge: 'The coach judging your turns',
  hint: 'Get help',
  review: 'This review',
  stt: 'Hearing you',
  tts: 'Her voice',
};

const count = (n: number) => n.toLocaleString('en-GB');

/** "claude-opus-5 · 25,900 tokens (20,000 from cache)", "nova-3 · 1.38 min". */
export function costDetail(line: CostLine): string {
  if (line.quantity === null) return line.model;
  if (line.unit === 'minutes') return `${line.model} · ${line.quantity} min`;
  if (line.unit === 'characters') return `${line.model} · ${count(line.quantity)} characters`;
  const cached = line.cachedTokens ? ` (${count(line.cachedTokens)} from cache)` : '';
  return `${line.model} · ${count(line.quantity)} tokens${cached}`;
}
