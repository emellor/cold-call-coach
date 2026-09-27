import type { DemoDetail, DemoSummary } from '@ccc/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { DemoPage } from './DemoPage.tsx';
import { DemosPage } from './DemosPage.tsx';
import { GENERATE_CONFIRM } from './labels.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** Answers every request with a fresh copy of `status` and `body` (the header checks health too). */
const answerAll = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === '/api/health'
          ? json(200, { ok: true, db: { ok: true, latencyMs: 1 } })
          : json(status, body),
      ),
    );

const ID = '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10';
const PROSPECT = {
  name: 'Claire Hughes',
  role: 'Finance Director',
  company: 'Harrow & Finch Logistics',
  difficulty: 'medium' as const,
};

const summary = (patch: Partial<DemoSummary>): DemoSummary => ({
  id: ID,
  position: 1,
  status: 'ready',
  angle: 'Lead with cost visibility: bills that keep rising with no site-by-site view of why.',
  title: 'Permission, then discovery',
  prospect: PROSPECT,
  outcome: 'meeting_booked',
  error: null,
  createdAt: '2026-09-27T14:00:00.000Z',
  ...patch,
});

const DETAIL: DemoDetail = {
  ...summary({}),
  summary: 'The rep earns thirty seconds, finds the board pressure and books the meeting.',
  lessons: ['Ask for thirty seconds first.', 'Follow up on her exact words.'],
  outcomeDetail: 'Tuesday at 10am',
  costUsd: 0.08,
  turns: [
    {
      idx: 0,
      speaker: 'prospect',
      text: 'Claire Hughes.',
      technique: null,
      note: null,
    },
    {
      idx: 1,
      speaker: 'rep',
      text: 'Hi Claire, it’s Sam from WattGuard. Have I caught you at a bad time?',
      technique: 'Permission opener',
      note: 'She hears who is calling and gets to say yes before any pitch.',
    },
    {
      idx: 2,
      speaker: 'prospect',
      text: 'Go on, quickly.',
      technique: null,
      note: null,
    },
    {
      idx: 3,
      speaker: 'rep',
      text: 'How are you tracking energy across your three warehouses today?',
      technique: 'Open discovery question',
      note: 'Gets her talking about her world, not your product.',
    },
  ],
};

describe('DemosPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const renderPage = () =>
    render(
      <Router hook={memoryLocation({ path: '/demos' }).hook}>
        <DemosPage />
      </Router>,
    );

  it('lists the demo calls, ready ones linking to their transcript', async () => {
    answerAll(200, {
      demos: [
        summary({}),
        summary({
          id: '8b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
          position: 2,
          status: 'failed',
          title: null,
          outcome: null,
          error: 'Claude answered 400: Your credit balance is too low',
        }),
      ],
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Demo calls' });
    const [ready, failed] = within(list).getAllByRole('listitem');
    expect(within(ready!).getByRole('link')).toHaveAttribute('href', `/demos/${ID}`);
    expect(ready).toHaveTextContent('Permission, then discovery');
    expect(ready).toHaveTextContent('Meeting booked');
    expect(ready).toHaveTextContent('Claire Hughes, Finance Director');
    expect(ready).toHaveTextContent('Read the call');
    expect(failed).toHaveTextContent('Failed');
    expect(failed).toHaveTextContent('credit balance is too low');
    expect(within(failed!).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry 1 failed' })).toBeEnabled();
  });

  it('asks before generating, then shows the batch being written', async () => {
    let listed: DemoSummary[] = [];
    const posts: Array<[string, string | undefined]> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (init?.method === 'POST') {
        posts.push([urlOf(input), init.body as string | undefined]);
        listed = [
          summary({ status: 'generating', title: null, outcome: null }),
          summary({
            id: '9b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
            position: 2,
            status: 'queued',
            title: null,
            outcome: null,
          }),
        ];
        return Promise.resolve(json(202, { queued: 2 }));
      }
      return Promise.resolve(json(200, { demos: listed }));
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPage();
    const generate = await screen.findByRole('button', { name: 'Generate 20 demo calls' });
    expect(screen.getByText(/No demo calls yet/)).toBeInTheDocument();

    fireEvent.click(generate);
    expect(confirm).toHaveBeenCalledWith(GENERATE_CONFIRM);
    expect(posts).toEqual([]);

    fireEvent.click(generate);
    expect(
      await screen.findByText(/0 of 2 demo calls written\. Claude is writing 1 now\./),
    ).toBeInTheDocument();
    expect(posts).toEqual([['/api/demos/generate', JSON.stringify({ count: 20 })]]);
    expect(screen.getByRole('progressbar', { name: 'Demo calls ready' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(screen.getByRole('button', { name: 'Generate 20 demo calls' })).toBeDisabled();
  });

  it('says why generating was refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? json(503, {
              error:
                'Demo calls need ANTHROPIC_API_KEY on the API: set it, restart, and try again.',
            })
          : json(200, { demos: [] }),
      ),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Generate 20 demo calls' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY');
  });
});

describe('DemoPage', () => {
  afterEach(() => vi.restoreAllMocks());

  const renderDemo = () =>
    render(
      <Router hook={memoryLocation({ path: `/demos/${ID}` }).hook}>
        <DemoPage id={ID} />
      </Router>,
    );

  it('shows the whole call to read, with the technique under every rep line', async () => {
    answerAll(200, DETAIL);
    renderDemo();
    expect(
      await screen.findByRole('heading', { name: 'Permission, then discovery' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tuesday at 10am')).toBeInTheDocument();
    expect(screen.getByText('Ask for thirty seconds first.')).toBeInTheDocument();
    const call = screen.getByRole('list', { name: 'The call' });
    const lines = within(call).getAllByRole('listitem');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toHaveTextContent('Claire');
    expect(lines[0]).toHaveTextContent('Claire Hughes.');
    expect(lines[1]).toHaveTextContent('Rep');
    expect(lines[1]).toHaveTextContent('Permission opener');
    expect(lines[1]).toHaveTextContent('She hears who is calling');
    // Her lines carry no notes, and nothing plays.
    expect(lines[2]).toHaveTextContent('Go on, quickly.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Written by Claude for $0.08.')).toBeInTheDocument();
  });

  it('says why a failed demo has no call to read', async () => {
    answerAll(200, {
      ...DETAIL,
      status: 'failed',
      error: 'Claude answered 400: Your credit balance is too low',
      turns: [],
    });
    renderDemo();
    expect(
      await screen.findByText(/This demo call wasn't written: Claude answered 400/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'The call' })).toBeNull();
  });

  it('says so when the demo does not exist', async () => {
    answerAll(404, { error: 'No such demo call.' });
    renderDemo();
    expect(await screen.findByText('No such demo call.')).toBeInTheDocument();
  });
});
