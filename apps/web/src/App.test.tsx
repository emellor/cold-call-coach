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
      custom: false,
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
      custom: false,
    },
  ],
};

const RACHEL = {
  id: 'rachel-byrne-4f2a9c',
  version: 1,
  title: 'Energy broker with an in-house dev team',
  difficulty: 'hard',
  winCondition: 'Agrees to a 20-minute call at a specific day and time',
  prospect: { name: 'Rachel Byrne', role: 'Operations Director', company: 'Voltline Energy' },
  custom: true,
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
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
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

  it('picks the prospect a demo sent the rep to practise on, then tidies the address', async () => {
    mockApi({
      '/api/health': healthy,
      '/api/scenarios': () => json(200, { scenarios: [...SCENARIOS.scenarios, RACHEL] }),
    });
    window.history.replaceState(null, '', `/?prospect=${RACHEL.id}`);
    render(<App />);
    expect(await screen.findByRole('radio', { name: /Rachel Byrne/ })).toBeChecked();
    expect(stage().getByText('Rachel Byrne')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/');
  });

  it('sets up a reverse call: the rep plays her, with all of her in view, and Sam is the caller', async () => {
    const character = {
      prospect: {
        name: 'Claire Hughes',
        role: 'Finance Director',
        company: 'Harrow & Finch Logistics',
        companyFacts: '3 warehouses in the Midlands',
        personality: 'direct, numbers-first, sceptical of vendors',
        speakingStyle: "clipped, says 'right' and 'look'",
        openingLine: 'Claire Hughes.',
        hidden: {
          pains: ['energy bills up about 40% in two years'],
          currentSolution: "the supplier's portal plus a spreadsheet",
          decisionProcess: 'signs off anything under £20k',
          timing: 'budget planning starts in January',
        },
        objections: ['Just send me an email'],
      },
    };
    mockApi({
      '/api/health': healthy,
      '/api/scenarios': () => json(200, SCENARIOS),
      '/api/scenarios/medium-finance-director/character': () => json(200, character),
    });
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('radio', { name: /Claire Hughes/ }));
    // Coached and exam calls never show what she hides.
    expect(screen.queryByRole('region', { name: "You're playing" })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Reverse/ }));

    expect(screen.getByRole('group', { name: 'Who are you playing?' })).toBeInTheDocument();
    const card = await screen.findByRole('region', { name: "You're playing" });
    expect(await within(card).findByText(/energy bills up about 40%/)).toBeInTheDocument();
    expect(card).toHaveTextContent('Answer the phone with “Claire Hughes.”');
    expect(card).toHaveTextContent('Who decides: signs off anything under £20k');
    expect(card).toHaveTextContent('“Just send me an email”');
    expect(card).toHaveTextContent('Sam knows only her name, role and company.');
    const caller = within(screen.getByRole('region', { name: 'Caller' }));
    expect(caller.getByText('Sam')).toBeInTheDocument();
    expect(caller.getByText('The expert rep, calling you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Take Sam's call" })).toBeEnabled();
    expect(
      screen.getByText(/^Sam's goal: Agrees to a 20-minute call at a specific day and time\./),
    ).toHaveTextContent('answer as Claire.');
    unmount();

    // The choice is remembered, like the others.
    render(<App />);
    expect(await screen.findByRole('radio', { name: /^Reverse/ })).toBeChecked();
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

  it('adds a prospect from a description, picks her, and can remove her again', async () => {
    let listed = SCENARIOS.scenarios;
    const sent: Array<[string, string]> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') sent.push([method, url]);
      if (url === '/api/health') return Promise.resolve(healthy());
      if (url === '/api/scenarios' && method === 'POST') {
        listed = [...SCENARIOS.scenarios, RACHEL];
        return Promise.resolve(json(201, { scenario: RACHEL, voice: 'default' }));
      }
      if (url === '/api/scenarios') return Promise.resolve(json(200, { scenarios: listed }));
      if (url === `/api/scenarios/${RACHEL.id}` && method === 'DELETE') {
        listed = SCENARIOS.scenarios;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json(404, { error: 'not found' }));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Add new/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Who are you calling?' }), {
      target: { value: 'A mid-sized energy broker, very tough to sell to.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add her' }));

    expect(await screen.findByRole('radio', { name: /Rachel Byrne/ })).toBeChecked();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByText(/^Added Rachel Byrne \(hard\)\. She speaks in the default voice/),
    ).toHaveAttribute('role', 'status');
    expect(stage().getByText('Rachel Byrne')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Rachel Byrne' }));
    expect(confirm).toHaveBeenCalledWith(
      'Remove Rachel Byrne? Your calls with her stay in History.',
    );
    expect(await screen.findByText('Removed Rachel Byrne.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Rachel Byrne/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Priya Shah/ })).toBeChecked();
    expect(sent).toEqual([
      ['POST', '/api/scenarios'],
      ['DELETE', `/api/scenarios/${RACHEL.id}`],
    ]);
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
