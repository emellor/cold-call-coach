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
    expect(screen.getByText('Put your headset on and press Dial.')).toBeInTheDocument();
    expect(await screen.findByText('API ok · Database ok (3 ms)')).toBeInTheDocument();
  });

  it('reports a database failure from a 503 health body', async () => {
    mockFetch(503, { ok: false, db: { ok: false, error: 'connection refused' } });
    render(<App />);
    expect(
      await screen.findByText('API ok · Database unavailable: connection refused'),
    ).toBeInTheDocument();
  });
});
