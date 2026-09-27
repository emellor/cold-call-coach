import { type DemoOutcome, type DemoStatus, type Difficulty, MAX_DEMO_BATCH } from '@ccc/contracts';

export const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  hard: 'bg-rose-500/15 text-rose-300',
};

export const OUTCOME_CHIP: Record<DemoOutcome, { label: string; style: string }> = {
  meeting_booked: { label: 'Meeting booked', style: 'bg-emerald-500/15 text-emerald-300' },
  hung_up_by_prospect: { label: 'She hung up', style: 'bg-rose-500/15 text-rose-300' },
  no_decision: { label: 'No decision', style: 'bg-slate-500/20 text-slate-300' },
};

export const STATUS_CHIP: Record<DemoStatus, { label: string; style: string }> = {
  queued: { label: 'Queued', style: 'bg-slate-500/20 text-slate-300' },
  generating: { label: 'Writing…', style: 'bg-sky-500/15 text-sky-300' },
  ready: { label: 'Ready', style: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Failed', style: 'bg-rose-500/15 text-rose-300' },
};

/** What "Generate" asks before it spends money. */
export const GENERATE_CONFIRM = `Write ${MAX_DEMO_BATCH} demo calls? Claude writes each one in a single request, three at a time in the background: about ten minutes for all ${MAX_DEMO_BATCH}. Each costs about 10 cents, roughly $2 in all.`;
