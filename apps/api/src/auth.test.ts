import { describe, expect, it } from 'vitest';
import {
  LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
  LoginLimiter,
  SESSION_SECONDS,
  Sessions,
  readCookie,
} from './auth.ts';

const NOW = Date.parse('2026-09-26T12:00:00Z');

describe('Sessions', () => {
  const sessions = new Sessions('correct horse battery', 'a'.repeat(32));

  it('checks the password', () => {
    expect(sessions.passwordMatches('correct horse battery')).toBe(true);
    expect(sessions.passwordMatches('correct horse')).toBe(false);
    expect(sessions.passwordMatches('')).toBe(false);
  });

  it('accepts a session it minted until it expires', () => {
    const value = sessions.mint(NOW);
    expect(sessions.verify(value, NOW + 1_000)).toBe(true);
    expect(sessions.verify(value, NOW + SESSION_SECONDS * 1000 + 1)).toBe(false);
  });

  it('refuses a forged, altered or foreign session', () => {
    const value = sessions.mint(NOW);
    const [expires, signature] = value.split('.');
    expect(sessions.verify(`${Number(expires) + 86_400}.${signature}`, NOW)).toBe(false);
    expect(sessions.verify(`${expires}.x${signature!.slice(1)}`, NOW)).toBe(false);
    expect(sessions.verify(undefined, NOW)).toBe(false);
    expect(sessions.verify('nonsense', NOW)).toBe(false);
    // A new password (or secret) signs everyone out.
    expect(new Sessions('a new password!', 'a'.repeat(32)).verify(value, NOW)).toBe(false);
  });
});

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('theme=dark; ccc_session=123.abc; x=1', 'ccc_session')).toBe('123.abc');
    expect(readCookie('theme=dark', 'ccc_session')).toBeUndefined();
    expect(readCookie(undefined, 'ccc_session')).toBeUndefined();
  });
});

describe('LoginLimiter', () => {
  it('locks an address out after too many wrong passwords, for the rest of the window', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < LOGIN_ATTEMPTS - 1; i++) limiter.failed('1.2.3.4', NOW);
    expect(limiter.retryAfterMs('1.2.3.4', NOW)).toBe(0);
    limiter.failed('1.2.3.4', NOW);
    expect(limiter.retryAfterMs('1.2.3.4', NOW + 60_000)).toBe(LOGIN_WINDOW_MS - 60_000);
    expect(limiter.retryAfterMs('5.6.7.8', NOW)).toBe(0);
    expect(limiter.retryAfterMs('1.2.3.4', NOW + LOGIN_WINDOW_MS)).toBe(0);
  });

  it('forgets the failures once the right password is given', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < LOGIN_ATTEMPTS; i++) limiter.failed('1.2.3.4', NOW);
    limiter.succeeded('1.2.3.4');
    expect(limiter.retryAfterMs('1.2.3.4', NOW)).toBe(0);
  });
});
