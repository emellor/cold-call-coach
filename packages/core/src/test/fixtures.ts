// Test fixtures: a scenario and product shaped like the files in scenarios/
// (core cannot read files, even in tests).
import {
  type JudgeResult,
  type JudgeSignals,
  PriceTable,
  ProductSpec,
  ScenarioSpec,
} from '@ccc/contracts';

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
    objections: [
      "I'm about to go into a meeting",
      'Just send me an email',
      'We already get reports from our supplier',
      "What's this going to cost?",
    ],
  },
  voice: { provider: 'cartesia', voiceId: 'voice-123', speed: 'normal' },
  state: { interest: 20, patience: 55, patienceDecayPerTurn: 3, hangUpAt: 0, meetingAt: 65 },
  winCondition: 'Agrees to a 20-minute call at a specific day and time',
  rubricId: 'cold-call-v1',
});

export const hardScenario: ScenarioSpec = {
  ...scenario,
  id: 'hard-facilities-manager',
  difficulty: 'hard',
  state: { interest: 10, patience: 35, patienceDecayPerTurn: 5, hangUpAt: 0, meetingAt: 70 },
};

export const product: ProductSpec = ProductSpec.parse({
  name: 'WattGuard',
  oneLiner:
    'Shows multi-site UK businesses where they waste energy, site by site, and keeps them compliant',
  valuePoints: [
    'per-site energy visibility',
    'anomaly alerts',
    'ESOS / SECR / ISO 50001 reporting',
  ],
  idealCustomer: 'UK businesses with 3+ sites',
  callGoal: 'Book a 20-minute discovery call',
  keyterms: ['WattGuard', 'ESOS', 'SECR', 'ISO 50001', 'half-hourly data'],
});

const NO_SIGNALS: JudgeSignals = {
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
};

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
    signals: { ...NO_SIGNALS, ...signals },
  };
}

/** A deep copy (core has no Node or DOM globals, so no structuredClone). */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A price table shaped like config/prices.json, with its figures for the models used here. */
export const prices: PriceTable = PriceTable.parse({
  asOf: '2026-09-26',
  warnAboveUsd: 2,
  anthropic: {
    source: 'test',
    perMillionTokens: {
      'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
      'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
    },
  },
  deepgram: { source: 'test', perMinute: { 'nova-3': 0.0077 } },
  cartesia: { source: 'test', per1kCharacters: { 'sonic-3': 0.05 } },
});
