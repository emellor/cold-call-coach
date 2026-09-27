// Every file in scenarios/ validates against its contracts schema (PLAN.md §12).
// The API validates them again at boot; this catches a bad edit before then.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type JudgeResult,
  type JudgeSignals,
  ProductSpec,
  RubricSpec,
  ScenarioCatalog,
  ScenarioSpec,
  VOICE_ID_PLACEHOLDER,
} from '@ccc/contracts';
import { applyJudgement, initialState, meetingAllowed, shouldHangUp, wouldMeet } from '@ccc/core';

const scenariosDir = fileURLToPath(new URL('./', import.meta.url));
const rubricsDir = join(scenariosDir, 'rubrics');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const jsonFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

const scenarioFiles = jsonFiles(scenariosDir).filter((f) => f !== 'product.json');
const rubricFiles = jsonFiles(rubricsDir);

describe('scenarios/', () => {
  it('has the three v1 scenarios and a rubric', () => {
    expect(scenarioFiles).toEqual([
      'easy-ops-manager.json',
      'hard-facilities-manager.json',
      'medium-finance-director.json',
    ]);
    expect(rubricFiles).toEqual(['cold-call-v1.json']);
  });

  it('product.json is a valid ProductSpec', () => {
    const result = ProductSpec.safeParse(readJson(join(scenariosDir, 'product.json')));
    expect(result.error?.issues).toBeUndefined();
  });

  it.each(scenarioFiles)('%s is a valid ScenarioSpec named after its id', (file) => {
    const result = ScenarioSpec.safeParse(readJson(join(scenariosDir, file)));
    expect(result.error?.issues).toBeUndefined();
    expect(`${result.data?.id}.json`).toBe(file);
  });

  it.each(rubricFiles)('rubrics/%s is a valid RubricSpec named after its id', (file) => {
    const result = RubricSpec.safeParse(readJson(join(rubricsDir, file)));
    expect(result.error?.issues).toBeUndefined();
    expect(`${result.data?.id}.json`).toBe(file);
  });

  it('the files form a consistent catalog', () => {
    const result = ScenarioCatalog.safeParse({
      product: readJson(join(scenariosDir, 'product.json')),
      rubrics: rubricFiles.map((f) => readJson(join(rubricsDir, f))),
      scenarios: scenarioFiles.map((f) => readJson(join(scenariosDir, f))),
    });
    expect(result.error?.issues).toBeUndefined();
  });

  it('keeps the v1 casting: one per difficulty, hard the least patient', () => {
    const scenarios = scenarioFiles.map((f) => ScenarioSpec.parse(readJson(join(scenariosDir, f))));
    const by = Object.fromEntries(scenarios.map((s) => [s.difficulty, s]));
    expect(Object.keys(by).sort()).toEqual(['easy', 'hard', 'medium']);
    expect(by.hard!.state.patience).toBeLessThan(by.medium!.state.patience);
    expect(by.medium!.state.patience).toBeLessThan(by.easy!.state.patience);
    expect(by.hard!.state.patienceDecayPerTurn).toBeGreaterThan(
      by.easy!.state.patienceDecayPerTurn,
    );
  });

  it('marks every unfilled voice id with the placeholder and a hint for choosing one', () => {
    for (const file of scenarioFiles) {
      const { voice } = ScenarioSpec.parse(readJson(join(scenariosDir, file)));
      if (voice.voiceId === VOICE_ID_PLACEHOLDER) expect(voice.hint, file).toBeTruthy();
    }
  });
});

describe('ScenarioCatalog', () => {
  const product = readJson(join(scenariosDir, 'product.json'));
  const rubric = readJson(join(rubricsDir, 'cold-call-v1.json'));
  const scenario = readJson(join(scenariosDir, 'medium-finance-director.json')) as Record<
    string,
    unknown
  >;

  it('rejects a scenario whose rubric does not exist', () => {
    const result = ScenarioCatalog.safeParse({
      product,
      rubrics: [rubric],
      scenarios: [{ ...scenario, rubricId: 'missing' }],
    });
    expect(result.error?.issues[0]?.message).toBe('no rubric with id "missing"');
  });

  it('rejects the same id and version twice', () => {
    const result = ScenarioCatalog.safeParse({
      product,
      rubrics: [rubric],
      scenarios: [scenario, scenario],
    });
    expect(result.error?.issues[0]?.message).toBe('duplicate scenario medium-finance-director@1');
  });

  it('rejects state thresholds that make the scenario unwinnable or instantly over', () => {
    const state = scenario.state as Record<string, number>;
    expect(
      ScenarioSpec.safeParse({ ...scenario, state: { ...state, meetingAt: state.interest } })
        .success,
    ).toBe(false);
    expect(
      ScenarioSpec.safeParse({ ...scenario, state: { ...state, hangUpAt: state.patience } })
        .success,
    ).toBe(false);
  });
});

// A deterministic stand-in for scripts/simulate-call.ts: scripted judgements
// (no Claude) run through the real state engine against each real scenario.
describe('the scenario thresholds under the state engine', () => {
  const scenarios = scenarioFiles.map((f) => ScenarioSpec.parse(readJson(join(scenariosDir, f))));
  const signals = (on: Partial<JudgeSignals>): JudgeResult => ({
    stage: 'other',
    revealEarned: null,
    tip: null,
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
      ...on,
    },
  });
  const calm = { longestMonologueSec: 20 };
  const ask = { askedForMeeting: true, proposedSpecificTime: true };

  it.each(scenarios.map((s) => [s.id, s] as const))(
    '%s: a well-run call earns the meeting before she runs out of patience',
    (_id, scenario) => {
      const script = [
        signals({ askedPermission: true, gaveRelevantReason: true }),
        signals({ askedOpenQuestion: true }),
        signals({ askedOpenQuestion: true, followedUp: true, acknowledgedObjection: true }),
      ];
      let state = initialState(scenario);
      for (let turn = 0; turn < 10 && !wouldMeet(state, scenario); turn++) {
        state = applyJudgement(
          state,
          script[turn] ?? signals({ askedOpenQuestion: true, followedUp: true }),
          calm,
          scenario,
        );
        expect(shouldHangUp(state, scenario)).toBe(false);
      }
      const asked = applyJudgement(state, signals(ask), calm, scenario);
      expect(meetingAllowed(state, ask, scenario)).toBe(true);
      expect(shouldHangUp(asked, scenario)).toBe(false);
      expect(state.turn).toBeLessThanOrEqual(scenario.difficulty === 'hard' ? 8 : 6);
    },
  );

  it.each(scenarios.map((s) => [s.id, s] as const))(
    '%s: a rambling, pushy feature pitch never books and gets hung up on',
    (_id, scenario) => {
      let state = initialState(scenario);
      while (!shouldHangUp(state, scenario)) {
        expect(meetingAllowed(state, ask, scenario)).toBe(false);
        state = applyJudgement(
          state,
          signals({ pitchedFeatures: true, ignoredHerPoint: true, ...ask }),
          { longestMonologueSec: 50 },
          scenario,
        );
      }
      expect(state.turn).toBeLessThanOrEqual(scenario.difficulty === 'easy' ? 4 : 2);
    },
  );
});
