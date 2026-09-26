import { HealthResponse } from '@ccc/contracts';

/** `GET /api/health`. A 503 still carries a valid body describing what failed. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', { signal, headers: { accept: 'application/json' } });
  return HealthResponse.parse(await res.json());
}
