import { describe, expect, it } from 'vitest';
import { type LibraryVoice, cartesiaVoiceLibrary, voiceChoices } from './voices.ts';

const voice = (id: string, locale: string, patch: Partial<LibraryVoice> = {}): LibraryVoice => ({
  id,
  name: id.toUpperCase(),
  description: `${id} description`,
  tagline: `${id} tagline`,
  language: locale.slice(0, 2),
  locales: [{ locale, is_native: true }],
  ...patch,
});

describe('voiceChoices', () => {
  it('offers English voices only, British first, each labelled with its locale', () => {
    const choices = voiceChoices([
      voice('us-1', 'en-US'),
      voice('fr-1', 'fr-FR'),
      voice('gb-1', 'en-GB'),
      voice('ie-1', 'en-IE', { tagline: '' }),
      voice('xx-1', 'en-IN'),
      voice('gb-2', 'es-ES', {
        locales: [
          { locale: 'es-ES', is_native: false },
          { locale: 'en-GB', is_native: true },
        ],
        language: 'en',
      }),
    ]);
    expect(choices.map((c) => c.id)).toEqual(['gb-1', 'gb-2', 'us-1', 'ie-1']);
    expect(choices[0]).toEqual({
      id: 'gb-1',
      name: 'GB-1',
      description: 'en-GB. gb-1 tagline: gb-1 description',
    });
    expect(choices[3]?.description).toBe('en-IE. ie-1 description');
  });

  it('keeps a few of each locale, and shortens long descriptions', () => {
    const many = Array.from({ length: 30 }, (_, i) => voice(`us-${i}`, 'en-US'));
    expect(voiceChoices(many)).toHaveLength(8);
    const [long] = voiceChoices([voice('gb-1', 'en-GB', { description: 'x'.repeat(400) })]);
    expect(long?.description.length).toBeLessThanOrEqual('en-GB. '.length + 160);
    expect(long?.description.endsWith('…')).toBe(true);
  });
});

describe('cartesiaVoiceLibrary', () => {
  it('reads the library once an hour', async () => {
    let now = 0;
    let reads = 0;
    const library = cartesiaVoiceLibrary({
      apiKey: 'test',
      now: () => now,
      list: async function* () {
        reads += 1;
        yield await Promise.resolve(voice('gb-1', 'en-GB'));
      },
    });
    expect(await library.voices()).toHaveLength(1);
    now = 30 * 60_000;
    await library.voices();
    expect(reads).toBe(1);
    now = 61 * 60_000;
    await library.voices();
    expect(reads).toBe(2);
  });
});
