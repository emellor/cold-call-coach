// The live stage tracker (PLAN.md §8.2): Opener → Reason → Discovery →
// Objections → Next step, driven by the judge's stage for each rep turn. The
// tracker's state is a function of the judged stages so far, so a rewind
// recomputes it from the turns that remain and publishes the difference.
import {
  type CallStage,
  type CoachStagePayload,
  type StageStatus,
  TrackerStage,
} from '@ccc/contracts';

export type StageStatuses = Record<TrackerStage, StageStatus>;

export const TRACKER_STAGES: readonly TrackerStage[] = TrackerStage.options;

const position = (stage: TrackerStage) => TRACKER_STAGES.indexOf(stage);

/**
 * Where a judged stage puts the tracker, or null to leave it. A pitch before
 * discovery is the rep's (weak) reason for calling; a pitch after it has no
 * step of its own. "other" moves nothing.
 */
export function trackerStageFor(stage: CallStage, active: TrackerStage): TrackerStage | null {
  switch (stage) {
    case 'opener':
    case 'reason':
    case 'discovery':
      return stage;
    case 'pitch':
      return position(active) <= position('reason') ? 'reason' : null;
    case 'objection_handling':
      return 'objections';
    case 'close':
      return 'next_step';
    case 'other':
      return null;
  }
}

/**
 * The tracker after these judged stages, in order. The call opens on the
 * opener; each move marks the step it leaves done (a skipped step stays
 * pending, which shows the rep what they missed). A booked meeting completes
 * the next step.
 */
export function stageStatuses(stages: readonly CallStage[], meetingBooked = false): StageStatuses {
  const statuses: StageStatuses = {
    opener: 'active',
    reason: 'pending',
    discovery: 'pending',
    objections: 'pending',
    next_step: 'pending',
  };
  let active: TrackerStage = 'opener';
  for (const stage of stages) {
    const next = trackerStageFor(stage, active);
    if (next === null || next === active) continue;
    statuses[active] = 'done';
    statuses[next] = 'active';
    active = next;
  }
  if (meetingBooked) {
    statuses[active] = 'done';
    statuses.next_step = 'done';
  }
  return statuses;
}

/** Nothing published yet: every step pending. */
export const NO_STAGES: StageStatuses = {
  opener: 'pending',
  reason: 'pending',
  discovery: 'pending',
  objections: 'pending',
  next_step: 'pending',
};

/**
 * The `coach.stage` messages that turn `from` into `to`: the steps that stop
 * being active first, then the one that becomes active.
 */
export function stageChanges(from: StageStatuses, to: StageStatuses): CoachStagePayload[] {
  const changed = TRACKER_STAGES.filter((stage) => from[stage] !== to[stage]).map((stage) => ({
    stage,
    status: to[stage],
  }));
  return [
    ...changed.filter((c) => c.status !== 'active'),
    ...changed.filter((c) => c.status === 'active'),
  ];
}
