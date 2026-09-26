import type { CallOutcome, RubricCriterionKey } from '@ccc/contracts';

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
