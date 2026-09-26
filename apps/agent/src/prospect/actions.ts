import type { CallOutcome } from '@ccc/contracts';
import type { MeetingDecision } from './brain.ts';
import type { Reply } from './replies.ts';

export interface ActionDeps {
  brain: { agreeToMeeting(when: string, turn: number): Promise<MeetingDecision> };
  controller: {
    recordMeeting(when: string): Promise<void>;
    end(outcome: CallOutcome, reason?: string): Promise<void>;
  };
  logger: { info(obj: object, msg: string): void };
}

/** The reason shown to the rep when she hangs up because her patience ran out. */
export const OUT_OF_PATIENCE = 'Out of patience';

/**
 * Acts on a reply the rep heard in full (PLAN.md §6.4): the meeting first, so
 * a "Tuesday at ten, bye" call ends as booked; then the hang-up, whether she
 * asked for it or her note had already told her to go.
 */
export async function actOnReply(reply: Reply, turn: number, deps: ActionDeps): Promise<void> {
  const { brain, controller, logger } = deps;
  for (const action of reply.actions) {
    if (action.type !== 'agree_to_meeting') continue;
    const decision = await brain.agreeToMeeting(action.when, turn);
    logger.info({ turn, when: action.when, ...decision }, 'agree_to_meeting');
    if (decision.booked) await controller.recordMeeting(decision.when);
  }

  const endCall = reply.actions.find((a) => a.type === 'end_call');
  if (endCall) {
    logger.info({ turn, reason: endCall.reason }, 'end_call');
    await controller.end('hung_up_by_prospect', endCall.reason);
  } else if (reply.forcedGoodbye) {
    logger.info({ turn }, 'out of patience; ending the call after her goodbye');
    await controller.end('hung_up_by_prospect', OUT_OF_PATIENCE);
  }
}
