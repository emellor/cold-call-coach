import {
  ApiError,
  CallDetail,
  CallListResponse,
  type CreateCallRequest,
  CreateCallResponse,
  HealthResponse,
  ReviewRerunResponse,
  ScenarioListResponse,
} from '@ccc/contracts';
import type { z } from 'zod';

/** A non-2xx response, carrying the API's own error message. */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<S extends z.ZodType>(
  schema: S,
  url: string,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = ApiError.safeParse(body);
    throw new ApiRequestError(
      res.status,
      error.success ? error.data.error : `Request failed (${res.status})`,
    );
  }
  return schema.parse(body);
}

/** `GET /api/health`. A 503 still carries a valid body describing what failed. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', { signal, headers: { accept: 'application/json' } });
  return HealthResponse.parse(await res.json());
}

export function createCall(body: CreateCallRequest): Promise<CreateCallResponse> {
  return request(CreateCallResponse, '/api/calls', { method: 'POST', body: JSON.stringify(body) });
}

/** `GET /api/scenarios`: what the picker offers, easiest first. */
export function fetchScenarios(signal?: AbortSignal): Promise<ScenarioListResponse> {
  return request(ScenarioListResponse, '/api/scenarios', { signal });
}

/** `GET /api/calls`: the call history, newest first. */
export function fetchCalls(signal?: AbortSignal): Promise<CallListResponse> {
  return request(CallListResponse, '/api/calls', { signal });
}

/** `GET /api/calls/:id`: transcript, metrics and review. */
export function fetchCall(id: string, signal?: AbortSignal): Promise<CallDetail> {
  return request(CallDetail, `/api/calls/${encodeURIComponent(id)}`, { signal });
}

/** `POST /api/calls/:id/review/rerun` */
export function rerunReview(id: string): Promise<ReviewRerunResponse> {
  return request(ReviewRerunResponse, `/api/calls/${encodeURIComponent(id)}/review/rerun`, {
    method: 'POST',
  });
}
