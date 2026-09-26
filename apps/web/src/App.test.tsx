import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('App', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens on the call screen, ready to dial', async () => {
    mockFetch(200, { ok: true, db: { ok: true, latencyMs: 3 } });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Cold Call Coach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dial' })).toBeInTheDocument();
    expect(screen.getByText('Claire Hughes')).toBeInTheDocument();
    expect(await screen.findByText('API ok · Database ok (3 ms)')).toBeInTheDocument();
  });

  it('falls back to a voice-only call when the 3D avatar cannot run', async () => {
    // jsdom has no Web Audio worklets or WebGL, like a browser that can't run the avatar.
    mockFetch(200, { ok: true, db: { ok: true, latencyMs: 3 } });
    render(<App />);
    expect(await screen.findByText(/calls are voice only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dial' })).toBeEnabled();
  });

  it('reports a database failure from a 503 health body', async () => {
    mockFetch(503, { ok: false, db: { ok: false, error: 'connection refused' } });
    render(<App />);
    expect(
      await screen.findByText('API ok · Database unavailable: connection refused'),
    ).toBeInTheDocument();
  });
});
