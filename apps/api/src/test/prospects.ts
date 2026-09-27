// A prospect as Claude might write her for "Add new", and a stub writer.
import type { ProspectDraft } from '@ccc/contracts';
import { scenarioFromDraft } from '@ccc/core';
import type { ProspectWriter } from '../prospects/writer.ts';
import { testCatalog } from './catalog.ts';

export const brokerDraft: ProspectDraft = {
  title: 'Energy broker with an in-house dev team',
  difficulty: 'hard',
  locale: 'en-GB',
  prospect: {
    name: 'Rachel Byrne',
    role: 'Operations Director',
    company: 'Voltline Energy Partners',
    companyFacts: 'A mid-sized energy broker in Leeds: 60 staff, 900 business clients',
    personality: 'blunt and hard to impress; proud of what her developers have built',
    speakingStyle: "fast and flat; says 'we've got that covered' and 'what's the catch?'",
    openingLine: 'Voltline, Rachel speaking.',
    hidden: {
      pains: ['clients keep asking for site-level reporting her team never finishes'],
      currentSolution: 'a home-grown portal her developers maintain',
      decisionProcess: 'she and the MD decide together',
      timing: 'the portal rebuild is scoped for next quarter',
    },
    objections: ['Our developers could build that in a month', 'Send me something'],
  },
  voice: { hint: 'Northern English woman in her forties, brisk', speed: 'fast' },
};

/** Writes `brokerDraft` under the given id, recording each description it was given. */
export function stubWriter(id: string) {
  const descriptions: string[] = [];
  const writer: ProspectWriter = (description) => {
    descriptions.push(description);
    return Promise.resolve({
      scenario: scenarioFromDraft(brokerDraft, { id, templates: testCatalog.scenarios }),
      voice: 'default',
    });
  };
  return { writer, descriptions };
}
