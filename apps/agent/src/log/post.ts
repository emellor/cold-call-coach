import { type CallLog, INTERNAL_SECRET_HEADER } from '@ccc/contracts';

export interface PostLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const ATTEMPTS = 4;
const TIMEOUT_MS = 10_000;

/** Posted; refused by the API (a retry won't help); or the API couldn't be reached. */
export type PostResult = 'posted' | 'rejected' | 'unreachable';

/**
 * POSTs the call log to the API, retrying network failures and 5xx answers
 * with backoff (1 s, 2 s, 4 s). The API's upsert is idempotent, so a retry
 * after an answer that got lost is harmless. Never throws.
 */
export async function postCallLog(options: {
  apiBaseUrl: string;
  secret: string;
  callId: string;
  log: CallLog;
  logger: PostLogger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PostResult> {
  const {
    apiBaseUrl,
    secret,
    callId,
    log,
    logger,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const url = `${apiBaseUrl}/internal/calls/${callId}/log`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INTERNAL_SECRET_HEADER]: secret },
        body: JSON.stringify(log),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        logger.info({ callId, turns: log.turns.length, attempt }, 'call log posted');
        return 'posted';
      }
      const detail = await res.text().catch(() => '');
      if (res.status < 500) {
        logger.error({ callId, status: res.status, detail }, 'the API rejected the call log');
        return 'rejected';
      }
      logger.warn({ callId, status: res.status, attempt }, 'posting the call log failed; retrying');
    } catch (error) {
      logger.warn({ callId, err: error, attempt }, 'posting the call log failed; retrying');
    }
    if (attempt < ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
  logger.error({ callId }, 'gave up posting the call log');
  return 'unreachable';
}
