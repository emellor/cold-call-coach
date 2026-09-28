import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CallReader,
  type ReaderState,
  type Speech,
  TURN_GAP_MS,
  type Utterance,
  type Voice,
  pickVoices,
  sentences,
} from './readAloud.ts';

const voice = (name: string, lang = 'en-GB'): Voice => ({ name, lang });

describe('pickVoices', () => {
  const mac = [
    voice('Albert', 'en-US'),
    voice('Bad News', 'en-US'),
    voice('Samantha', 'en-US'),
    voice('Daniel'),
    voice('Kate'),
    voice('Serena (Premium)'),
    voice('Thomas', 'fr-FR'),
  ];

  it('gives the prospect a voice of their gender and the rep the other, in the call’s accent', () => {
    expect(pickVoices(mac, 'en-GB', 'female')).toEqual({
      prospect: voice('Serena (Premium)'),
      rep: voice('Daniel'),
    });
    expect(pickVoices(mac, 'en-GB', 'male')).toEqual({
      prospect: voice('Daniel'),
      rep: voice('Serena (Premium)'),
    });
  });

  it('takes the same language from elsewhere before nothing, and never a novelty voice', () => {
    const us = [voice('Bad News', 'en-US'), voice('Albert', 'en-US'), voice('Samantha', 'en-US')];
    expect(pickVoices(us, 'en-GB', 'female').prospect).toEqual(voice('Samantha', 'en-US'));
    // Only one real voice: both use it, and the reader tells them apart by pitch.
    expect(pickVoices([voice('Samantha', 'en_US')], 'en-GB', 'female')).toEqual({
      prospect: voice('Samantha', 'en_US'),
      rep: voice('Samantha', 'en_US'),
    });
    expect(pickVoices([voice('Thomas', 'fr-FR')], 'en-GB', 'female')).toEqual({
      prospect: null,
      rep: null,
    });
  });

  it('prefers Chrome’s and Edge’s better voices', () => {
    const chrome = [
      voice('Google UK English Male'),
      voice('Google UK English Female'),
      voice('Microsoft Hazel - English (United Kingdom)'),
    ];
    expect(pickVoices(chrome, 'en-GB', 'female')).toEqual({
      prospect: voice('Google UK English Female'),
      rep: voice('Google UK English Male'),
    });
  });
});

describe('sentences', () => {
  it('splits a line where one sentence ends and the next begins', () => {
    expect(sentences('Fair. How are you placed for it? Go on…  tell me.')).toEqual([
      'Fair.',
      'How are you placed for it?',
      'Go on…',
      'tell me.',
    ]);
    expect(sentences('  ')).toEqual([]);
  });
});

/** A speech engine that speaks nothing: the test ends each utterance itself. */
function fakeSpeech(voices: Voice[] = [voice('Daniel'), voice('Kate')]) {
  const spoken: Array<Utterance & { text: string }> = [];
  let cancels = 0;
  const speech: Speech = {
    voices: () => voices,
    utterance: (text) => ({
      text,
      voice: null,
      lang: '',
      rate: 1,
      pitch: 1,
      onend: null,
      onerror: null,
    }),
    speak: (u) => spoken.push(u as Utterance & { text: string }),
    cancel: () => {
      cancels += 1;
    },
  };
  return {
    speech,
    spoken,
    cancels: () => cancels,
    /** Ends the utterance being read, as the browser does when it finishes. */
    finish: () => spoken.at(-1)?.onend?.(),
  };
}

const call = [
  { speaker: 'prospect' as const, text: 'Denise Walsh.' },
  { speaker: 'rep' as const, text: "Hi Denise, it's Sam from WattGuard. Thirty seconds?" },
  { speaker: 'prospect' as const, text: 'Go on.' },
];

describe('CallReader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const reader = (fake = fakeSpeech()) => {
    const states: ReaderState[] = [];
    const r = new CallReader({
      speech: fake.speech,
      lines: call,
      locale: 'en-GB',
      prospectGender: 'female',
      onChange: (s) => states.push(s),
    });
    return { r, states, fake };
  };

  it('reads the call a sentence at a time, in two voices, with a pause between speakers', () => {
    const { r, fake } = reader();
    r.play();
    expect(fake.spoken.map((u) => u.text)).toEqual(['Denise Walsh.']);
    expect(fake.spoken[0]).toMatchObject({ voice: voice('Kate'), lang: 'en-GB', pitch: 1 });
    expect(r.state).toEqual({ status: 'playing', line: 0 });

    fake.finish();
    // The other speaker waits a beat, as on a phone line.
    expect(fake.spoken).toHaveLength(1);
    vi.advanceTimersByTime(TURN_GAP_MS);
    expect(fake.spoken.at(-1)).toMatchObject({
      text: "Hi Denise, it's Sam from WattGuard.",
      voice: voice('Daniel'),
    });
    expect(r.state).toEqual({ status: 'playing', line: 1 });

    fake.finish();
    // The rep's next sentence follows straight on.
    vi.advanceTimersByTime(0);
    expect(fake.spoken.at(-1)?.text).toBe('Thirty seconds?');
    fake.finish();
    vi.advanceTimersByTime(TURN_GAP_MS);
    fake.finish();
    expect(r.state).toEqual({ status: 'idle' });
    expect(fake.spoken.map((u) => u.text)).toEqual([
      'Denise Walsh.',
      "Hi Denise, it's Sam from WattGuard.",
      'Thirty seconds?',
      'Go on.',
    ]);
  });

  it('pauses on the line it is reading and resumes there', () => {
    const { r, fake } = reader();
    r.play(1);
    expect(fake.spoken.at(-1)?.text).toBe("Hi Denise, it's Sam from WattGuard.");
    fake.finish();
    vi.advanceTimersByTime(0);
    r.pause();
    expect(r.state).toEqual({ status: 'paused', line: 1 });
    expect(fake.cancels()).toBeGreaterThan(0);
    // A cancelled utterance's end is ignored.
    fake.finish();
    vi.advanceTimersByTime(TURN_GAP_MS);
    expect(r.state).toEqual({ status: 'paused', line: 1 });

    r.resume();
    expect(fake.spoken.at(-1)?.text).toBe('Thirty seconds?');
    expect(r.state).toEqual({ status: 'playing', line: 1 });
    r.stop();
    expect(r.state).toEqual({ status: 'idle' });
  });

  it('restarts the line at a new speed, and tells the two apart by pitch with one voice', () => {
    const { r, fake } = reader(fakeSpeech([voice('Samantha')]));
    r.play();
    expect(fake.spoken[0]).toMatchObject({ voice: voice('Samantha'), pitch: 1.15 });
    r.setRate(1.5);
    vi.advanceTimersByTime(100);
    expect(fake.spoken.at(-1)).toMatchObject({ text: 'Denise Walsh.', rate: 1.5 });
    fake.finish();
    vi.advanceTimersByTime(TURN_GAP_MS);
    expect(fake.spoken.at(-1)).toMatchObject({ voice: voice('Samantha'), pitch: 0.9, rate: 1.5 });
  });

  it('says so when the browser will not speak', () => {
    const { r, fake } = reader();
    r.play();
    fake.spoken[0]?.onerror?.({ error: 'not-allowed' });
    expect(r.state).toEqual({
      status: 'failed',
      message: 'Your browser blocked the reading. Press Listen again.',
    });
  });
});
