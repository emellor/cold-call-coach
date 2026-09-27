// Cartesia's voice library, so "Add new" can give each prospect a voice that
// fits her. Read with the API's own CARTESIA_API_KEY; without one, or if the
// library can't be read, she speaks in the agent's CARTESIA_VOICE_ID.
import Cartesia from '@cartesia/cartesia-js';
import { ProspectLocale, type VoiceChoice } from '@ccc/contracts';

/** The fields of a Cartesia voice this reads. */
export interface LibraryVoice {
  id: string;
  name: string;
  description: string;
  tagline?: string;
  language: string;
  locales: ReadonlyArray<{ locale: string; is_native: boolean }>;
}

export interface VoiceLibrary {
  /** Feminine English voices, British first, each described with its accent. */
  voices(): Promise<VoiceChoice[]>;
}

/** How many of each locale Claude chooses from: most of them British, like most prospects. */
const PER_LOCALE: Record<ProspectLocale, number> = {
  'en-GB': 24,
  'en-US': 8,
  'en-AU': 4,
  'en-IE': 4,
  'en-NZ': 3,
  'en-CA': 3,
};
/** Stop paging through the library after this many voices. */
const SCAN_LIMIT = 600;
const CACHE_MS = 60 * 60_000;
const DESCRIPTION_CHARS = 160;

const nativeLocale = (voice: LibraryVoice) =>
  voice.locales.find((l) => l.is_native)?.locale ?? voice.locales[0]?.locale;

/** The voices to offer, in PER_LOCALE's order, each labelled with its locale. */
export function voiceChoices(library: readonly LibraryVoice[]): VoiceChoice[] {
  const byLocale = new Map<string, VoiceChoice[]>();
  for (const voice of library) {
    const locale = nativeLocale(voice);
    const parsed = ProspectLocale.safeParse(locale);
    if (voice.language !== 'en' || !parsed.success) continue;
    const chosen = byLocale.get(parsed.data) ?? [];
    if (chosen.length >= PER_LOCALE[parsed.data]) continue;
    const about = [voice.tagline, voice.description].filter(Boolean).join(': ');
    chosen.push({
      id: voice.id,
      name: voice.name,
      description: `${parsed.data}. ${about.length > DESCRIPTION_CHARS ? `${about.slice(0, DESCRIPTION_CHARS - 1)}…` : about}`,
    });
    byLocale.set(parsed.data, chosen);
  }
  return ProspectLocale.options.flatMap((locale) => byLocale.get(locale) ?? []);
}

export function cartesiaVoiceLibrary(options: {
  apiKey: string;
  /** The library's feminine voices; Cartesia's own list unless a test passes one. */
  list?: () => AsyncIterable<LibraryVoice>;
  now?: () => number;
}): VoiceLibrary {
  const { now = Date.now } = options;
  const list =
    options.list ??
    (() =>
      new Cartesia({ apiKey: options.apiKey }).voices.list({ gender: 'feminine', limit: 100 }));
  let cached: { at: number; voices: VoiceChoice[] } | null = null;
  return {
    async voices() {
      if (cached && now() - cached.at < CACHE_MS) return cached.voices;
      const library: LibraryVoice[] = [];
      for await (const voice of list()) {
        library.push(voice);
        if (library.length >= SCAN_LIMIT) break;
      }
      cached = { at: now(), voices: voiceChoices(library) };
      return cached.voices;
    },
  };
}
