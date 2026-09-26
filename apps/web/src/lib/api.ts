import {
  ApiError,
  CallDetail,
  CallListResponse,
  type CreateCallRequest,
  CreateCallResponse,
  HealthResponse,
  type LoginRequest,
  ReviewRerunResponse,
  ScenarioListResponse,
  SessionResponse,
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

/** Fired when the API answers 401: the session is gone, so the sign-in screen shows. */
export const SIGNED_OUT_EVENT = 'ccc:signed-out';

async function send(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...init.headers },
  });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  return res;
}

async function request<S extends z.ZodType>(
  schema: S,
  url: string,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  const res = await send(url, init);
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

/** `GET /api/auth/session`: whether this deploy has a password, and whether we're signed in. */
export function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  return request(SessionResponse, '/api/auth/session', { signal });
}

/** `POST /api/auth/login`: throws with the API's message (wrong password, too many tries). */
export async function signIn(password: string): Promise<void> {
  const body: LoginRequest = { password };
  const res = await send('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) return;
  const error = ApiError.safeParse(await res.json().catch(() => null));
  throw new ApiRequestError(res.status, error.success ? error.data.error : "Couldn't sign in.");
}

/** `POST /api/auth/logout` */
export async function signOut(): Promise<void> {
  await send('/api/auth/logout', { method: 'POST' });
}
