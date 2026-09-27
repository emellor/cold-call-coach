import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

const SCENARIOS = {
  scenarios: [
    {
      id: 'easy-ops-manager',
      version: 1,
      title: 'Curious operations manager',
      difficulty: 'easy',
      winCondition: 'Agrees to a 20-minute call at a specific day and time',
      prospect: { name: 'Priya Shah', role: 'Operations Manager', company: 'Northgate Bakeries' },
    },
    {
      id: 'medium-finance-director',
      version: 1,
      title: 'Busy finance director',
      difficulty: 'medium',
      winCondition: 'Agrees to a 20-minute call at a specific day and time',
      prospect: {
        name: 'Claire Hughes',
        role: 'Finance Director',
        company: 'Harrow & Finch Logistics',
      },
    },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each API route the page calls on load. */
function mockApi(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const answer = routes[url];
    return Promise.resolve(answer ? answer() : json(404, { error: 'not found' }));
  });
}

const healthy = () => json(200, { ok: true, db: { ok: true, latencyMs: 3 } });
const stage = () => within(screen.getByRole('region', { name: 'Prospect' }));

describe('App', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('opens on the call screen with the first scenario picked, ready to dial', async () => {
    mockApi({ '/api/health': healthy, '/api/scenarios': () => json(200, SCENARIOS) });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Cold Call Coach' })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /Priya Shah/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Dial' })).toBeEnabled();
    expect(stage().getByText('Priya Shah')).toBeInTheDocument();
    expect(stage().getByText('Operations Manager, Northgate Bakeries')).toBeInTheDocument();
    expect(await screen.findByText('API ok · Database ok (3 ms)')).toBeInTheDocument();
  });

  it('shows whoever is picked, and remembers the choice', async () => {
    mockApi({ '/api/health': healthy, '/api/scenarios': () => json(200, SCENARIOS) });
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: /Claire Hughes/ }));
    expect(stage().getByText('Finance Director, Harrow & Finch Logistics')).toBeInTheDocument();
    unmount();

    render(<App />);
    expect(await screen.findByRole('radio', { name: /Claire Hughes/ })).toBeChecked();
  });

  it('dials coached calls unless the rep picks exam, and remembers the choice', async () => {
    mockApi({ '/api/health': healthy, '/api/scenarios': () => json(200, SCENARIOS) });
    const { unmount } = render(<App />);
    expect(await screen.findByRole('radio', { name: /Coached/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Exam/ }));
    expect(screen.getByRole('radio', { name: /Exam/ })).toBeChecked();
    unmount();

    render(<App />);
    expect(await screen.findByRole('radio', { name: /Exam/ })).toBeChecked();
  });

  it('cannot dial when the scenarios fail to load, and says why', async () => {
    mockApi({
      '/api/health': healthy,
      '/api/scenarios': () => json(500, { error: 'Internal server error' }),
    });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the scenarios: Internal server error",
    );
    expect(screen.getByRole('button', { name: 'Dial' })).toBeDisabled();
  });

  it('shows who you are calling, by initials and name, with no avatar settings', async () => {
    mockApi({ '/api/health': healthy, '/api/scenarios': () => json(200, SCENARIOS) });
    render(<App />);
    expect(await stage().findByText('Priya Shah')).toBeInTheDocument();
    expect(stage().getByText('PS')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Phone mode|lip sync/ })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Dial' })).toBeEnabled();
  });

  it('says which of calls and reviews the API has switched off, and why', async () => {
    mockApi({
      '/api/health': () =>
        json(200, {
          ok: true,
          db: { ok: true, latencyMs: 2 },
          features: {
            calls: { ok: true },
            reviews: { ok: false, reason: 'Reviews are off: set ANTHROPIC_API_KEY on the API.' },
          },
        }),
      '/api/scenarios': () => json(200, SCENARIOS),
    });
    render(<App />);
    expect(
      await screen.findByText('Reviews are off: set ANTHROPIC_API_KEY on the API.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Calls are off/)).toBeNull();
  });

  it('reports a database failure from a 503 health body', async () => {
    mockApi({
      '/api/health': () => json(503, { ok: false, db: { ok: false, error: 'connection refused' } }),
      '/api/scenarios': () => json(200, SCENARIOS),
    });
    render(<App />);
    expect(
      await screen.findByText('API ok · Database unavailable: connection refused'),
    ).toBeInTheDocument();
  });
});
