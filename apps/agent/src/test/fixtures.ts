// A scenario and product for the agent's tests, shaped like scenarios/*.json.
import { type JudgeResult, type JudgeSignals, ProductSpec, ScenarioSpec } from '@ccc/contracts';

export const scenario: ScenarioSpec = ScenarioSpec.parse({
  id: 'medium-finance-director',
  version: 1,
  title: 'Busy finance director',
  difficulty: 'medium',
  locale: 'en-GB',
  prospect: {
    name: 'Claire Hughes',
    role: 'Finance Director',
    company: 'Harrow & Finch Logistics',
    companyFacts: '3 warehouses in the Midlands, 240 staff',
    personality: 'direct, numbers-first, sceptical of vendors, hates wasted time',
    speakingStyle: "clipped, dry humour, says 'right' and 'look'",
    openingLine: 'Claire Hughes.',
    hidden: {
      pains: [
        'energy bills up about 40% in two years and the board wants answers',
        "no per-site breakdown, only the supplier's monthly bill",
      ],
      currentSolution: "the supplier's portal plus a spreadsheet",
      decisionProcess: 'signs off anything under £20k; above that goes to the MD',
      timing: 'budget planning starts in January',
    },
    objections: ["I'm about to go into a meeting", 'Just send me an email'],
  },
  voice: { provider: 'cartesia', voiceId: 'voice-123', speed: 'normal' },
  avatar: { url: '/avatars/mpfb.glb', body: 'F' },
  state: { interest: 20, patience: 55, patienceDecayPerTurn: 3, hangUpAt: 0, meetingAt: 65 },
  winCondition: 'Agrees to a 20-minute call at a specific day and time',
  rubricId: 'cold-call-v1',
});

export const product: ProductSpec = ProductSpec.parse({
  name: 'WattGuard',
  oneLiner: 'Shows multi-site UK businesses where they waste energy, site by site',
  valuePoints: ['per-site energy visibility', 'anomaly alerts'],
  idealCustomer: 'UK businesses with 3+ sites',
  callGoal: 'Book a 20-minute discovery call',
  keyterms: ['WattGuard', 'ESOS', 'SECR', 'ISO 50001', 'half-hourly data'],
});

/** A judgement with only the given signals set. */
export function judged(
  signals: Partial<JudgeSignals> = {},
  extra: Partial<Omit<JudgeResult, 'signals'>> = {},
): JudgeResult {
  return {
    stage: 'other',
    revealEarned: null,
    tip: null,
    ...extra,
    signals: {
      askedPermission: false,
      gaveRelevantReason: false,
      askedOpenQuestion: false,
      followedUp: false,
      acknowledgedObjection: false,
      pitchedFeatures: false,
      ignoredHerPoint: false,
      pushy: false,
      rude: false,
      askedForMeeting: false,
      proposedSpecificTime: false,
      ...signals,
    },
  };
}

/** A logger that records nothing and satisfies every narrow logger interface here. */
export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
