// Delivery metrics (PLAN.md §8.1), computed in code from the logged turns.
// The review is told these as facts; the live coach (M5) reuses them.
import type { CallMetrics, Speaker, TimedWord } from '@ccc/contracts';

export interface MetricTurn {
  speaker: Speaker;
  text: string;
  /** Milliseconds from pick-up. */
  startMs: number;
  endMs: number;
  words?: readonly TimedWord[] | null;
  /** A prospect turn the rep talked over. */
  interrupted?: boolean;
}

/** Rep speech separated by less than this, with no prospect speech between, is one monologue. */
export const MONOLOGUE_GAP_MS = 1_500;

/** §8.1's core fillers (Deepgram's spellings included); `fillerWords: true` keeps them. */
export const CORE_FILLERS: ReadonlySet<string> = new Set([
  'um',
  'umm',
  'uh',
  'uhh',
  'erm',
  'er',
  'ah',
]);
export const SOFT_FILLERS = [
  'you know',
  'sort of',
  'kind of',
  'i mean',
  'basically',
  'literally',
  'like',
] as const;

/** Spoken before a question without changing its kind: "So, what…" is still open. */
const LEADING_MARKERS =
  /^(?:so|and|but|okay|ok|right|well|now|oh|look|um|umm|uh|uhh|er|erm|ah)\b[\s,]*/i;
const OPEN_START = /^(?:what|how|why|tell me|walk me through)\b/i;

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Lower-case word tokens, apostrophes removed ("don't" → "dont"). */
export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .match(/[a-z0-9]+/g) ?? [];

export const countCoreFillers = (text: string): number =>
  wordsOf(text).filter((w) => CORE_FILLERS.has(w)).length;

export function countSoftFillers(text: string): number {
  const normal = ` ${wordsOf(text).join(' ')} `;
  return SOFT_FILLERS.reduce((sum, phrase) => sum + normal.split(` ${phrase} `).length - 1, 0);
}

/** Sentences as punctuated by the STT. */
export const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function isOpenQuestion(sentence: string): boolean {
  let s = sentence.trim();
  for (let previous = ''; previous !== s;) {
    previous = s;
    s = s.replace(LEADING_MARKERS, '');
  }
  return OPEN_START.test(s);
}

const speechMs = (t: MetricTurn) => Math.max(0, t.endMs - t.startMs);

interface Span {
  start: number;
  end: number;
}

/** A rep turn's stretches of speech: split at word gaps of 1.5 s or more, when words exist. */
function repSpans(turn: MetricTurn): Span[] {
  const words = turn.words ?? [];
  if (!words.length) return [{ start: turn.startMs, end: turn.endMs }];
  const spans: Span[] = [];
  for (const word of words) {
    const last = spans.at(-1);
    if (last && word.startMs - last.end < MONOLOGUE_GAP_MS)
      last.end = Math.max(last.end, word.endMs);
    else spans.push({ start: word.startMs, end: word.endMs });
  }
  return spans;
}

function longestMonologueMs(turns: readonly MetricTurn[]): number {
  const prospect = turns.filter((t) => t.speaker === 'prospect');
  const spans = turns
    .filter((t) => t.speaker === 'rep')
    .flatMap(repSpans)
    .sort((a, b) => a.start - b.start);
  const herVoiceBetween = (from: number, to: number) =>
    prospect.some((p) => p.startMs < to && p.endMs > from);

  let longest = 0;
  let current: Span | undefined;
  for (const span of spans) {
    if (
      current &&
      span.start - current.end < MONOLOGUE_GAP_MS &&
      !herVoiceBetween(current.end, span.start)
    ) {
      current.end = Math.max(current.end, span.end);
    } else {
      current = { ...span };
    }
    longest = Math.max(longest, current.end - current.start);
  }
  return longest;
}

/** When the rep's first question was asked: its last word, or its share of the turn's time. */
function firstQuestionMs(turns: readonly MetricTurn[]): number | null {
  for (const turn of [...turns].sort((a, b) => a.startMs - b.startMs)) {
    if (turn.speaker !== 'rep') continue;
    const question = sentencesOf(turn.text).find((s) => s.endsWith('?'));
    if (!question) continue;
    const word = turn.words?.find((w) => w.text.trim().endsWith('?'));
    if (word) return word.endMs;
    const at = turn.text.indexOf('?');
    const share = turn.text.length ? (at + 1) / turn.text.length : 1;
    return turn.startMs + speechMs(turn) * share;
  }
  return null;
}

export function computeMetrics(turns: readonly MetricTurn[], durationMs: number): CallMetrics {
  const rep = turns.filter((t) => t.speaker === 'rep');
  const repSpeech = rep.reduce((sum, t) => sum + speechMs(t), 0);
  const prospectSpeech = turns
    .filter((t) => t.speaker === 'prospect')
    .reduce((sum, t) => sum + speechMs(t), 0);
  const repText = rep.map((t) => t.text).join(' ');
  const repWords = wordsOf(repText).length;
  const repMinutes = repSpeech / 60_000;
  const coreFillers = countCoreFillers(repText);
  const questions = rep.flatMap((t) => sentencesOf(t.text)).filter((s) => s.endsWith('?'));
  const questionsOpen = questions.filter(isOpenQuestion).length;
  const firstQuestion = firstQuestionMs(turns);

  return {
    durationSec: round(durationMs / 1000, 1),
    repSpeechSec: round(repSpeech / 1000, 1),
    prospectSpeechSec: round(prospectSpeech / 1000, 1),
    talkRatio:
      repSpeech + prospectSpeech > 0 ? round(repSpeech / (repSpeech + prospectSpeech), 2) : null,
    repWords,
    repWpm: repMinutes > 0 ? Math.round(repWords / repMinutes) : null,
    coreFillers,
    softFillers: countSoftFillers(repText),
    fillersPerMin: repMinutes > 0 ? round(coreFillers / repMinutes, 1) : null,
    questionsOpen,
    questionsClosed: questions.length - questionsOpen,
    longestMonologueSec: round(longestMonologueMs(turns) / 1000, 1),
    interruptions: turns.filter((t) => t.speaker === 'prospect' && t.interrupted).length,
    timeToFirstQuestionSec: firstQuestion === null ? null : round(firstQuestion / 1000, 1),
  };
}
