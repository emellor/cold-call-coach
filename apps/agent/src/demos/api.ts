// The agent's side of the demo queue: claim the next demo, post it back
// written, or say why it couldn't be (the API retries it, up to a point).
import {
  DemoClaimResponse,
  type DemoJob,
  type DemoResultRequest,
  INTERNAL_SECRET_HEADER,
} from '@ccc/contracts';

const TIMEOUT_MS = 30_000;
/** A written demo is a few megabytes of audio; give its upload longer. */
const UPLOAD_TIMEOUT_MS = 120_000;

export interface DemoQueue {
  claim(): Promise<DemoJob | null>;
  post(id: string, result: DemoResultRequest): Promise<void>;
  fail(id: string, error: string): Promise<void>;
}

export function demoQueue(options: {
  apiBaseUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}): DemoQueue {
  const { apiBaseUrl, secret, fetchImpl = fetch } = options;
  const send = async (path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<Response> => {
    const res = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        [INTERNAL_SECRET_HEADER]: secret,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `POST ${path} answered ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }
    return res;
  };
  return {
    async claim() {
      const res = await send('/internal/demos/claim', undefined);
      return DemoClaimResponse.parse(await res.json()).job;
    },
    async post(id, result) {
      await send(`/internal/demos/${id}/result`, result, UPLOAD_TIMEOUT_MS);
    },
    async fail(id, error) {
      await send(`/internal/demos/${id}/failed`, { error: error.slice(0, 2000) });
    },
  };
}
