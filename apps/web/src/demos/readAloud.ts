// Reading a demo call aloud with the browser's own voices (the Web Speech API):
// it costs nothing, needs no download, and nothing leaves the browser. Each
// line is spoken a sentence at a time, so a pause or a jump lands on a line and
// no browser's limit on one long utterance cuts the call short. The rep and the
// prospect get different voices where the browser has them, or one voice at two
// pitches where it doesn't.
import type { DemoGender, Speaker } from '@ccc/contracts';

/** The parts of a SpeechSynthesisVoice this needs. */
export interface Voice {
  name: string;
  lang: string;
}

/** The parts of a SpeechSynthesisUtterance this sets and listens to. */
export interface Utterance {
  voice: Voice | null;
  lang: string;
  rate: number;
  pitch: number;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

/** The browser's speech synthesis, or a fake in tests. */
export interface Speech {
  voices(): Voice[];
  utterance(text: string): Utterance;
  speak(utterance: Utterance): void;
  cancel(): void;
}

/** The browser's speech synthesis, or null in a browser without it. */
export function browserSpeech(): Speech | null {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return null;
  const synth = window.speechSynthesis;
  return {
    voices: () => synth.getVoices(),
    // The DOM's event handlers take an event these never read.
    utterance: (text) => new window.SpeechSynthesisUtterance(text) as unknown as Utterance,
    speak: (utterance) => synth.speak(utterance as unknown as SpeechSynthesisUtterance),
    cancel: () => synth.cancel(),
  };
}

const FEMALE =
  /\b(female|samantha|serena|kate|stephanie|martha|fiona|moira|tessa|karen|victoria|susan|allison|ava|zoe|nicky|zira|hazel|libby|sonia|maisie|mia|emma|amy|olivia|jenny|aria|natasha|clara)\b/i;
const MALE =
  /\b(male|daniel|arthur|oliver|george|ryan|alex|tom|aaron|thomas|james|david|mark|guy|brian|rishi|william|liam|christopher|eric|ethan|jamie)\b/i;
/** Better-sounding voices: macOS's downloaded ones, Edge's neural ones, Chrome's Google ones. */
const GOOD = /premium|enhanced|natural|neural/i;
const DECENT = /google|online/i;
/** macOS's novelty and old robotic voices, which read a sales call as a joke. */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|kathy|fred|grandma|grandpa|rocko|eddy|flo|reed|sandy|shelley)\b/i;

const genderOf = (voice: Voice): DemoGender | null =>
  FEMALE.test(voice.name) ? 'female' : MALE.test(voice.name) ? 'male' : null;

const langOf = (voice: Voice) => voice.lang.replace('_', '-').toLowerCase();

/**
 * The voices for the rep and the prospect: the best-sounding ones in the call's
 * language, the prospect's matching their gender and the rep's (Sam, who could
 * be either) the other, so the two are easy to tell apart. Either may be null
 * when the browser lists no voice for the language yet.
 */
export function pickVoices(
  voices: readonly Voice[],
  locale: string,
  prospect: DemoGender,
): { rep: Voice | null; prospect: Voice | null } {
  const wanted = locale.toLowerCase();
  const language = wanted.slice(0, 2);
  const score = (voice: Voice) =>
    (langOf(voice) === wanted ? 4 : 0) +
    (GOOD.test(voice.name) ? 3 : DECENT.test(voice.name) ? 2 : 0) -
    (NOVELTY.test(voice.name) ? 10 : 0);
  const ranked = voices
    .filter((v) => langOf(v).startsWith(language))
    .sort((a, b) => score(b) - score(a));
  const theirs = ranked.find((v) => genderOf(v) === prospect) ?? ranked[0] ?? null;
  const other: DemoGender = prospect === 'female' ? 'male' : 'female';
  const reps =
    ranked.find((v) => v !== theirs && genderOf(v) === other) ??
    ranked.find((v) => v !== theirs) ??
    theirs;
  return { rep: reps, prospect: theirs };
}

/** A line split into sentences, each spoken as its own utterance. */
export const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export type ReaderState =
  | { status: 'idle' }
  | { status: 'playing'; line: number }
  | { status: 'paused'; line: number }
  | { status: 'failed'; message: string };

/** The pause between one speaker and the next, as on a phone line. */
export const TURN_GAP_MS = 350;
/** Chrome can drop an utterance spoken in the same tick as a cancel. */
const RESTART_DELAY_MS = 60;

interface Chunk {
  line: number;
  speaker: Speaker;
  text: string;
}

/**
 * Plays a demo call through the browser's speech synthesis, a line at a time,
 * and reports which line is being read. One per page; `dispose` stops it.
 */
export class CallReader {
  readonly #speech: Speech;
  readonly #chunks: Chunk[];
  readonly #locale: string;
  readonly #gender: DemoGender;
  readonly #onChange: (state: ReaderState) => void;
  #state: ReaderState = { status: 'idle' };
  #rate = 1;
  /** Bumped on every start and stop, so a cancelled utterance's events are ignored. */
  #run = 0;
  /** The chunk being read, where a pause resumes. */
  #at = 0;
  /** Held while it plays: Chrome drops `onend` for an utterance it has collected. */
  #current: Utterance | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #voices: { rep: Voice | null; prospect: Voice | null } = { rep: null, prospect: null };

  constructor(options: {
    speech: Speech;
    lines: readonly { speaker: Speaker; text: string }[];
    locale: string;
    prospectGender: DemoGender;
    onChange: (state: ReaderState) => void;
  }) {
    this.#speech = options.speech;
    this.#chunks = options.lines.flatMap((line, i) =>
      sentences(line.text).map((text) => ({ line: i, speaker: line.speaker, text })),
    );
    this.#locale = options.locale;
    this.#gender = options.prospectGender;
    this.#onChange = options.onChange;
  }

  get state(): ReaderState {
    return this.#state;
  }

  /** Reads from the start of `line` (the first by default) to the end of the call. */
  play(line = 0): void {
    const at = this.#chunks.findIndex((c) => c.line >= line);
    if (at < 0) return;
    this.#start(at);
  }

  pause(): void {
    if (this.#state.status !== 'playing') return;
    const { line } = this.#state;
    this.#halt();
    this.#set({ status: 'paused', line });
  }

  resume(): void {
    if (this.#state.status === 'paused') this.#start(this.#at);
  }

  stop(): void {
    this.#halt();
    this.#set({ status: 'idle' });
  }

  /** The reading speed; a line being read starts again at the new one. */
  setRate(rate: number): void {
    this.#rate = rate;
    if (this.#state.status === 'playing') this.#start(this.#at);
  }

  dispose(): void {
    this.#halt();
  }

  #start(at: number): void {
    const wasSpeaking = this.#state.status === 'playing';
    this.#halt();
    const run = this.#run;
    this.#voices = pickVoices(this.#speech.voices(), this.#locale, this.#gender);
    if (!wasSpeaking) {
      // Straight away: the browser only lets speech start from the rep's click.
      this.#say(at, run);
      return;
    }
    this.#set({ status: 'playing', line: this.#chunks[at]!.line });
    this.#timer = setTimeout(() => {
      if (run === this.#run) this.#say(at, run);
    }, RESTART_DELAY_MS);
  }

  #say(at: number, run: number): void {
    const chunk = this.#chunks[at]!;
    const { rep, prospect } = this.#voices;
    const voice = chunk.speaker === 'rep' ? rep : prospect;
    const utterance = this.#speech.utterance(chunk.text);
    utterance.voice = voice;
    utterance.lang = voice?.lang ?? this.#locale;
    utterance.rate = this.#rate;
    // One voice for both of them: pitch tells them apart.
    utterance.pitch = rep === prospect ? (chunk.speaker === 'rep' ? 0.9 : 1.15) : 1;
    utterance.onend = () => {
      if (run === this.#run) this.#next(at, run);
    };
    utterance.onerror = (event) => {
      if (run !== this.#run) return;
      // Cancelling reports one of these; the reader cancels only through #halt.
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      this.#halt();
      this.#set({
        status: 'failed',
        message:
          event.error === 'not-allowed'
            ? 'Your browser blocked the reading. Press Listen again.'
            : `Your browser couldn't read the call aloud${event.error ? ` (${event.error})` : ''}.`,
      });
    };
    this.#at = at;
    this.#current = utterance;
    this.#set({ status: 'playing', line: chunk.line });
    this.#speech.speak(utterance);
  }

  #next(at: number, run: number): void {
    const next = at + 1;
    const chunk = this.#chunks[next];
    if (!chunk) {
      this.#current = null;
      this.#at = 0;
      this.#set({ status: 'idle' });
      return;
    }
    const gap = chunk.speaker === this.#chunks[at]!.speaker ? 0 : TURN_GAP_MS;
    this.#timer = setTimeout(() => {
      if (run === this.#run) this.#say(next, run);
    }, gap / this.#rate);
  }

  #halt(): void {
    this.#run += 1;
    clearTimeout(this.#timer);
    if (this.#current) {
      // The cancel below ends it with an event nobody needs.
      this.#current.onend = null;
      this.#current.onerror = null;
      this.#current = null;
    }
    this.#speech.cancel();
  }

  #set(state: ReaderState): void {
    this.#state = state;
    this.#onChange(state);
  }
}
