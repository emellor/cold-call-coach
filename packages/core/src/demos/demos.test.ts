import { type DemoBriefDraft, type DemoScriptDraft, RubricSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { product, scenario } from '../test/fixtures.ts';
import { DEMO_ANGLES, demoPlan } from './plan.ts';
import {
  BRIEF_OPENING_LINE,
  DemoScriptError,
  briefScriptFrom,
  buildDemoBriefUserPrompt,
  buildDemoScriptSystemPrompt,
  buildDemoScriptUserPrompt,
  scriptFrom,
} from './script.ts';

const criterion = (key: string, name: string) => ({
  key,
  name,
  goodLooksLike: `${name} done well`,
  anchors: { '1': `${name}: poor`, '3': `${name}: fair`, '5': `${name}: 10/10` },
});

const rubric = RubricSpec.parse({
  id: 'cold-call-v1',
  version: 1,
  title: 'Cold call',
  criteria: [
    criterion('opener', 'Opener'),
    criterion('reason', 'Reason for call'),
    criterion('discovery', 'Discovery'),
    criterion('objections', 'Objections'),
    criterion('next_step', 'Next step'),
    criterion('delivery', 'Delivery'),
  ],
});

describe('demoPlan', () => {
  it('takes the prospects in turn, each demo with the next approach', () => {
    const plan = demoPlan(20, ['easy', 'medium', 'hard']);
    expect(plan).toHaveLength(20);
    expect(plan.slice(0, 4).map((p) => p.scenarioId)).toEqual(['easy', 'medium', 'hard', 'easy']);
    expect(plan[0]?.angle).toBe(DEMO_ANGLES[0]);
    expect(plan[11]?.angle).toBe(DEMO_ANGLES[1]);
    // Every prospect hears a different approach each time.
    for (const id of ['easy', 'medium', 'hard']) {
      const angles = plan.filter((p) => p.scenarioId === id).map((p) => p.angle);
      expect(new Set(angles).size).toBe(angles.length);
    }
  });

  it('plans nothing without a prospect', () => {
    expect(demoPlan(20, [])).toEqual([]);
  });
});

describe('the demo script prompt', () => {
  it('sets the product, the 10/10 scorecard and the shape of the answer, the same for every demo', () => {
    const system = buildDemoScriptSystemPrompt({ product, rubric });
    expect(system).toContain(
      `The caller is Sam, an expert B2B rep selling WattGuard: ${product.oneLiner}`,
    );
    expect(system).toContain(`The goal of the call: ${product.callGoal}.`);
    expect(system).toContain('- Discovery: Discovery: 10/10');
    expect(system).toContain('The call ends with the meeting booked');
    expect(system).toContain('For every rep line, name the technique');
    // Nothing about any one prospect, so the prompt caches across a batch.
    expect(system).not.toContain(scenario.prospect.name);
  });

  it('gives the prospect, what she hides and the approach, in her language', () => {
    const user = buildDemoScriptUserPrompt({ scenario, angle: DEMO_ANGLES[3]! });
    expect(user).toContain('The prospect: Claire Hughes, Finance Director at Harrow & Finch');
    expect(user).toContain('How hard she is to win: medium.');
    expect(user).toContain('She answers the phone with: "Claire Hughes."');
    expect(user).toContain('Just send me an email; We already get reports from our supplier');
    expect(user).toContain('- Pain: energy bills up about 40% in two years');
    expect(user).toContain('- Decision process: signs off anything under £20k');
    expect(user).toContain(`The rep's approach for this call: ${DEMO_ANGLES[3]}`);
    expect(user).toContain('Write the call in British English.');
  });

  it('gives a brief as the rep wrote it, and asks for whatever it leaves out', () => {
    const brief =
      '  Tom Reid, head of estates at Carewell, 14 care homes in Yorkshire. Gas bills doubled. Objective: a site visit.  ';
    const user = buildDemoBriefUserPrompt({ brief });
    expect(user).toContain(`<brief>\n${brief.trim()}\n</brief>`);
    expect(user).toContain('fill in whatever it leaves out');
    expect(user).toContain('where these instructions say "she", read "he" for a man');
    expect(user).toContain('If the brief sets the call an objective, that is the goal of the call');
    expect(user).toContain('Write the call in British English');
    // No stored prospect's details: the brief is all there is.
    expect(user).not.toContain(scenario.prospect.name);
  });
});

describe('scriptFrom', () => {
  const line = (
    speaker: 'rep' | 'prospect',
    text: string,
    technique: string | null = null,
    note: string | null = null,
  ) => ({ speaker, text, technique, note });

  const call = [
    line('prospect', 'Claire Hughes.', 'stray', 'stray'),
    line('rep', 'Hi Claire, Sam at WattGuard.', ' Permission opener ', ' Lowers her guard. '),
    line('rep', 'Have you got thirty seconds?'),
    line('prospect', 'Thirty. Go.'),
    line('rep', 'How do you see energy site by site today?', 'Open question', 'Gets her talking.'),
    line('prospect', '  '),
    line('prospect', "We don't. One bill."),
    line('rep', 'What does that cost you at board time?', 'Cost question', 'Makes it hers.'),
    line('prospect', 'Hours.'),
    line('rep', 'Thursday at ten for twenty minutes?', 'Specific close', 'Easy to say yes to.'),
    line('prospect', 'Thursday at ten.'),
  ];

  const draft = (lines = call): DemoScriptDraft => ({
    lines,
    meeting: ' Thursday 10:00, 20-minute video call ',
    title: ' The thirty-second opener ',
    summary: ' Earns time, then asks. ',
    lessons: [' Ask first. ', '', 'Follow up.', 'Quantify.', 'Close.', 'Confirm.', 'Sixth'],
  });

  it('joins lines in a row from one side, and keeps notes on the rep’s lines only', () => {
    const script = scriptFrom(draft(), scenario.prospect.openingLine);
    expect(script.lines).toHaveLength(9);
    expect(script.lines[0]).toEqual(line('prospect', 'Claire Hughes.'));
    expect(script.lines[1]).toEqual(
      line(
        'rep',
        'Hi Claire, Sam at WattGuard. Have you got thirty seconds?',
        'Permission opener',
        'Lowers her guard.',
      ),
    );
    expect(script.lines[4]).toEqual(line('prospect', "We don't. One bill."));
    expect(script).toMatchObject({
      meeting: 'Thursday 10:00, 20-minute video call',
      title: 'The thirty-second opener',
      summary: 'Earns time, then asks.',
      lessons: ['Ask first.', 'Follow up.', 'Quantify.', 'Close.', 'Confirm.'],
    });
  });

  it('puts her opening line first when Claude starts with the rep', () => {
    const script = scriptFrom(draft(call.slice(1)), scenario.prospect.openingLine);
    expect(script.lines[0]).toEqual(line('prospect', 'Claire Hughes.'));
    expect(script.lines[1]?.speaker).toBe('rep');
  });

  it('refuses a call too short to study', () => {
    expect(() => scriptFrom(draft(call.slice(0, 5)), scenario.prospect.openingLine)).toThrow(
      DemoScriptError,
    );
    expect(() => scriptFrom(draft(call.slice(0, 5)), scenario.prospect.openingLine)).toThrow(
      /too short to study/,
    );
  });

  it('keeps who a brief call was to, filling a blank name rather than refusing a paid call', () => {
    const brief = (name: string): DemoBriefDraft => ({
      ...draft(call.slice(1)),
      prospect: {
        name,
        role: ' Head of Estates ',
        company: 'Carewell',
        difficulty: 'hard',
        gender: 'male',
        locale: 'en-GB',
      },
    });
    const script = briefScriptFrom(brief(' Tom Reid '));
    expect(script.prospect).toEqual({
      name: 'Tom Reid',
      role: 'Head of Estates',
      company: 'Carewell',
      difficulty: 'hard',
      gender: 'male',
      locale: 'en-GB',
    });
    // The call started with the rep, so his first line is a plain answer.
    expect(script.lines[0]).toEqual(line('prospect', BRIEF_OPENING_LINE));
    expect(script.meeting).toBe('Thursday 10:00, 20-minute video call');
    expect(briefScriptFrom(brief('  ')).prospect.name).toBe('The prospect');
  });
});
