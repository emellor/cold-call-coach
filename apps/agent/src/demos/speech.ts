// Voicing a demo call: Cartesia's bytes endpoint, one MP3 per line. The rep
// gets DEMO_REP_VOICE_ID, or the first British man in Cartesia's library.
import Cartesia from '@cartesia/cartesia-js';

export const DEMO_TTS_MODEL = 'sonic-3';
/** 64 kbit/s constant bit rate: 8 bytes a millisecond, which gives each line's length. */
const BIT_RATE = 64_000;

export interface SpokenLine {
  audio: Buffer;
  ms: number;
}

export interface Speech {
  /** `speed` is Cartesia's multiplier, 0.6–1.5. */
  speak(text: string, voice: { id: string; speed?: number; language: string }): Promise<SpokenLine>;
  /** The rep's voice. */
  repVoice(): Promise<string>;
}

/** The fields of a Cartesia voice this reads. */
interface LibraryVoice {
  id: string;
  locales: ReadonlyArray<{ locale: string; is_native: boolean }>;
}

export const mp3Ms = (bytes: number): number => Math.round((bytes * 8) / (BIT_RATE / 1000));

export function cartesiaSpeech(options: {
  apiKey: string;
  /** DEMO_REP_VOICE_ID; otherwise the library's first British man. */
  repVoiceId?: string;
  /** Her fallback, CARTESIA_VOICE_ID, if the library has no British man. */
  fallbackVoiceId?: string;
}): Speech {
  const client = new Cartesia({ apiKey: options.apiKey });
  let rep: Promise<string> | null = null;

  const findRep = async (): Promise<string> => {
    if (options.repVoiceId) return options.repVoiceId;
    for await (const voice of client.voices.list({
      gender: 'masculine',
      limit: 100,
    }) as AsyncIterable<LibraryVoice>) {
      if (voice.locales.some((l) => l.is_native && l.locale === 'en-GB')) return voice.id;
    }
    if (options.fallbackVoiceId) return options.fallbackVoiceId;
    throw new Error('No voice for the rep: set DEMO_REP_VOICE_ID for the agent.');
  };

  return {
    async speak(text, voice) {
      const speed =
        voice.speed === undefined ? undefined : Math.min(1.5, Math.max(0.6, voice.speed));
      const res = await client.tts.generate({
        model_id: DEMO_TTS_MODEL,
        transcript: text,
        voice: voice.id,
        language: voice.language,
        output_format: { container: 'mp3', sample_rate: 24_000, bit_rate: BIT_RATE },
        ...(speed === undefined ? {} : { generation_config: { speed } }),
      });
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, ms: mp3Ms(audio.length) };
    },
    repVoice() {
      rep ??= findRep().catch((error: unknown) => {
        rep = null;
        throw error;
      });
      return rep;
    },
  };
}
