// What the rep did with the practice controls (PLAN.md §8.3), read back from
// the call's events so the review can mention it.
import { type EventKind, ResumeEventPayload, RewindEventPayload } from '@ccc/contracts';

export interface ControlEvent {
  kind: EventKind;
  payload: Record<string, unknown>;
}

export interface ControlsUsed {
  pauses: number;
  pausedMs: number;
  hints: number;
  rewinds: Array<{ beforeTurn: number; tookBack: string }>;
}

export const NO_CONTROLS: ControlsUsed = { pauses: 0, pausedMs: 0, hints: 0, rewinds: [] };

/** Tallies the control events; a payload that doesn't parse still counts where it can. */
export function controlsUsed(events: readonly ControlEvent[]): ControlsUsed {
  const used: ControlsUsed = { pauses: 0, pausedMs: 0, hints: 0, rewinds: [] };
  for (const event of events) {
    switch (event.kind) {
      case 'pause':
        used.pauses += 1;
        break;
      case 'resume': {
        const parsed = ResumeEventPayload.safeParse(event.payload);
        if (parsed.success) used.pausedMs += parsed.data.pausedMs;
        break;
      }
      case 'hint':
        used.hints += 1;
        break;
      case 'rewind': {
        const parsed = RewindEventPayload.safeParse(event.payload);
        if (parsed.success) {
          used.rewinds.push({ beforeTurn: parsed.data.beforeTurn, tookBack: parsed.data.tookBack });
        }
        break;
      }
      default:
        break;
    }
  }
  return used;
}

export const anyControlsUsed = (used: ControlsUsed): boolean =>
  used.pauses > 0 || used.hints > 0 || used.rewinds.length > 0;
