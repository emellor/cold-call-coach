// Cheat-sheet fixtures: a written sheet, and a stub writer that records the
// profiles it was given and can fail on demand.
import type { CheatSheetDraft } from '@ccc/contracts';
import {
  type CheatSheetWriter,
  CheatSheetWriterError,
  type WrittenCheatSheet,
} from '../cheatSheets/writer.ts';

export const sheetDraft: CheatSheetDraft = {
  title: 'Sarah Patel, Carewell',
  goal: 'A 20-minute call on site-by-site monitoring',
  opener: ["Hi Sarah, it's Sam from WattGuard.", 'Can I have thirty seconds on why I rang?'],
  reason: 'Care groups tell me the gas bill doubled and nobody could say which home.',
  questions: [
    'How do you see energy home by home today?',
    'What does the board ask you about it?',
    'Where do you suspect waste?',
  ],
  theirQuestions: [
    { they: 'What is it exactly?', you: 'Half-hourly energy data for every site, on one screen.' },
  ],
  objections: [
    { they: 'Send me an email.', you: 'Happy to. What should it cover so it earns a read?' },
    { they: 'We have a broker.', you: 'Good: brokers do price. Who looks at how much you use?' },
  ],
  valueLines: [
    {
      they: 'Bills up, no idea why',
      you: 'WattGuard shows which home is using what, every half hour.',
    },
  ],
  close: ['Would Thursday at ten work for twenty minutes on Teams?'],
  voicemail: "Sarah, it's Sam from WattGuard about last winter's gas bills. I'll try you Thursday.",
};

export const writtenSheet: WrittenCheatSheet = {
  sheet: sheetDraft,
  model: 'claude-opus-5-5',
  costUsd: 0.05,
};

export function stubCheatSheetWriter() {
  const briefs: string[] = [];
  let failure: string | null = null;
  const writer: CheatSheetWriter = (brief) => {
    briefs.push(brief);
    if (failure) return Promise.reject(new CheatSheetWriterError(failure));
    return Promise.resolve(writtenSheet);
  };
  return {
    writer,
    briefs,
    /** Every call from now on fails with this, as Claude's refusal or error would. */
    failWith(message: string | null) {
      failure = message;
    },
  };
}
