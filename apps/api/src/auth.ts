// A single password for a deployed app (PROMPTS.md M6): APP_PASSWORD is traded
// for a signed, http-only session cookie, and every /api route but health and
// sign-in needs it. So LiveKit tokens (POST /api/calls) only go to whoever
// signed in. Locally, with no APP_PASSWORD, nothing changes.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LoginRequest, SessionResponse } from '@ccc/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';

export const SESSION_COOKIE = 'ccc_session';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

/** Routes that answer without a session: the health check and signing in and out. */
const OPEN_ROUTES = new Set([
  '/api/health',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
]);

const hmac = (key: Buffer | string, text: string) =>
  createHmac('sha256', key).update(text).digest();

/**
 * Signs sessions with a key derived from the password and INTERNAL_API_SECRET,
 * so changing the password signs everyone out.
 */
export class Sessions {
  readonly #key: Buffer;
  readonly #passwordDigest: Buffer;

  constructor(password: string, secret: string) {
    this.#key = hmac(secret, `cold-call-coach session v1:${password}`);
    this.#passwordDigest = hmac(this.#key, password);
  }

  /** Compares in constant time, whatever the lengths. */
  passwordMatches(given: string): boolean {
    return timingSafeEqual(hmac(this.#key, given), this.#passwordDigest);
  }

  /** A cookie value that expires SESSION_SECONDS from now. */
  mint(nowMs = Date.now()): string {
    const expires = Math.floor(nowMs / 1000) + SESSION_SECONDS;
    return `${expires}.${hmac(this.#key, `session:${expires}`).toString('base64url')}`;
  }

  verify(value: string | undefined, nowMs = Date.now()): boolean {
    const [expires, signature] = value?.split('.') ?? [];
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    if (Number(expires) * 1000 <= nowMs) return false;
    const expected = hmac(this.#key, `session:${expires}`);
    const given = Buffer.from(signature, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

/** The request's cookies (no dependency needed for one cookie). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** At most this many wrong passwords per address in LOGIN_WINDOW_MS. */
export const LOGIN_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;

export class LoginLimiter {
  readonly #failures = new Map<string, { count: number; since: number }>();

  /** Milliseconds to wait before trying again, or 0 if this address may try now. */
  retryAfterMs(address: string, now = Date.now()): number {
    const entry = this.#failures.get(address);
    if (!entry || now - entry.since >= LOGIN_WINDOW_MS) return 0;
    return entry.count >= LOGIN_ATTEMPTS ? entry.since + LOGIN_WINDOW_MS - now : 0;
  }

  failed(address: string, now = Date.now()): void {
    const entry = this.#failures.get(address);
    if (!entry || now - entry.since >= LOGIN_WINDOW_MS) {
      this.#failures.set(address, { count: 1, since: now });
    } else {
      entry.count += 1;
    }
  }

  succeeded(address: string): void {
    this.#failures.delete(address);
  }
}

function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function registerAuth(app: FastifyInstance, config: Config): void {
  const password = config.APP_PASSWORD;
  if (!password) {
    app.get('/api/auth/session', () => SessionResponse.parse({ required: false, signedIn: true }));
    app.post('/api/auth/login', (_request, reply) =>
      reply.code(400).send({ error: 'This app has no password: APP_PASSWORD is not set.' }),
    );
    return;
  }

  // loadConfig insists on the secret alongside the password.
  const sessions = new Sessions(password, config.INTERNAL_API_SECRET ?? '');
  const limiter = new LoginLimiter();
  const secure = config.NODE_ENV === 'production';
  const signedIn = (request: FastifyRequest) =>
    sessions.verify(readCookie(request.headers.cookie, SESSION_COOKIE));

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || OPEN_ROUTES.has(path) || signedIn(request)) return;
    return reply.code(401).send({ error: 'Sign in first.' });
  });

  app.get('/api/auth/session', (request) =>
    SessionResponse.parse({ required: true, signedIn: signedIn(request) }),
  );

  app.post('/api/auth/login', async (request, reply) => {
    const wait = limiter.retryAfterMs(request.ip);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(wait / 1000)))
        .send({ error: 'Too many wrong passwords. Try again in a few minutes.' });
    }
    const { password: given } = LoginRequest.parse(request.body);
    if (!sessions.passwordMatches(given)) {
      limiter.failed(request.ip);
      return reply.code(401).send({ error: 'That password is wrong.' });
    }
    limiter.succeeded(request.ip);
    return reply
      .header('set-cookie', sessionCookie(sessions.mint(), SESSION_SECONDS, secure))
      .code(204)
      .send();
  });

  app.post('/api/auth/logout', (_request, reply) =>
    reply
      .header('set-cookie', sessionCookie('', 0, secure))
      .code(204)
      .send(),
  );
}
