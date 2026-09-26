// The call's scenario, loaded from the API (GET /internal/scenarios/:id), and
// what the voice pipeline takes from it: voice, STT language and keyterms.
import {
  INTERNAL_SECRET_HEADER,
  InternalScenarioResponse,
  type ProductSpec,
  type ScenarioSpec,
  VOICE_ID_PLACEHOLDER,
} from '@ccc/contracts';

const FETCH_TIMEOUT_MS = 5_000;

export class ScenarioLoadError extends Error {
  override name = 'ScenarioLoadError';
}

export async function fetchScenario(options: {
  apiBaseUrl: string;
  secret: string;
  scenarioId: string;
  fetchImpl?: typeof fetch;
}): Promise<InternalScenarioResponse> {
  const { apiBaseUrl, secret, scenarioId, fetchImpl = fetch } = options;
  const url = `${apiBaseUrl}/internal/scenarios/${encodeURIComponent(scenarioId)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { [INTERNAL_SECRET_HEADER]: secret },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ScenarioLoadError(
      `could not reach the API at ${apiBaseUrl} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body ? String(body.error) : res.statusText;
    throw new ScenarioLoadError(`the API answered ${res.status} for ${scenarioId}: ${detail}`);
  }
  const parsed = InternalScenarioResponse.safeParse(body);
  if (!parsed.success) {
    throw new ScenarioLoadError(`the API sent an invalid scenario for ${scenarioId}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export type VoiceChoice = { ok: true; voiceId: string } | { ok: false; problem: string };

/** The scenario's own voice, or CARTESIA_VOICE_ID while its file still has the placeholder. */
export function chooseVoice(scenario: ScenarioSpec, fallback: string | undefined): VoiceChoice {
  if (scenario.voice.voiceId !== VOICE_ID_PLACEHOLDER) {
    return { ok: true, voiceId: scenario.voice.voiceId };
  }
  if (fallback) return { ok: true, voiceId: fallback };
  return {
    ok: false,
    problem: `${scenario.prospect.name} has no voice yet: set voice.voiceId in scenarios/${scenario.id}.json, or CARTESIA_VOICE_ID in .env`,
  };
}

/** Deepgram's bias list: the product's vocabulary plus the names it would otherwise mishear. */
export function keytermsFor(scenario: ScenarioSpec, product: ProductSpec): string[] {
  const terms = [
    ...product.keyterms,
    product.name,
    scenario.prospect.name,
    ...scenario.prospect.name.split(' '),
    scenario.prospect.company,
  ];
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
}

/** Cartesia takes the language alone ("en"); Deepgram the full locale ("en-GB"). */
export const ttsLanguage = (locale: string): string => locale.split('-')[0] ?? locale;

const SPEED_PRESETS = { slow: 0.85, normal: undefined, fast: 1.15 } as const;

/** Sonic-3 takes speed as a multiplier; presets map onto it and "normal" sends none. */
export const cartesiaSpeed = (speed: ScenarioSpec['voice']['speed']): number | undefined =>
  typeof speed === 'number' ? speed : SPEED_PRESETS[speed];
