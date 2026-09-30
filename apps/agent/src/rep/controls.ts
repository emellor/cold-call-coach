// A reverse call's controls. The rep plays her, so there is nothing to pause,
// no help to get and no turn to take back: Sam is the one selling. Hanging up
// is her ending the call.
import type { CallOutcome, CallPhase } from '@ccc/contracts';
import { ControlError, type Controls } from '../controls/controls.ts';

const off = (what: string) => `${what} is off in a reverse call: Sam is the one selling.`;

export function reverseControls(controller: {
  readonly phase: CallPhase;
  end(outcome: CallOutcome, reason?: string): Promise<void>;
}): Controls {
  return {
    pause: () => ({ ok: false, reason: off('Pause') }),
    resume: () => ({ ok: true }),
    hint: () => Promise.reject(new ControlError(off('Help'))),
    rewind: () => Promise.resolve({ ok: false, reason: off('Rewind') }),
    hangup: () => {
      if (controller.phase !== 'ended') void controller.end('hung_up_by_prospect');
      return { ok: true };
    },
  };
}
