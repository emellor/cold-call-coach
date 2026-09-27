import type { DemoDetail, DemoSummary } from '@ccc/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  durationMs: 94_000,
  error: null,
  createdAt: '2026-09-27T14:00:00.000Z',
  ...patch,
});

const DETAIL: DemoDetail = {
  ...summary({}),
  summary: 'The rep earns thirty seconds, finds the board pressure and books the meeting.',
  lessons: ['Ask for thirty seconds first.', 'Follow up on her exact words.'],
  outcomeDetail: 'Tuesday at 10am',
  costUsd: 0.64,
  turns: [
    {
      idx: 0,
      speaker: 'prospect',
      text: 'Claire Hughes.',
      technique: null,
      note: null,
      interest: null,
      patience: null,
      audioMs: 800,
    },
    {
      idx: 1,
      speaker: 'rep',
      text: 'Hi Claire, it’s Sam from WattGuard. Have I caught you at a bad time?',
      technique: 'Permission opener',
      note: 'She hears who is calling and gets to say yes before any pitch.',
      interest: 24,
      patience: 53,
      audioMs: 3_100,
    },
    {
      idx: 2,
      speaker: 'prospect',
      text: 'Go on, quickly.',
      technique: null,
      note: null,
      interest: null,
      patience: null,
      audioMs: null,
    },
    {
      idx: 3,
      speaker: 'rep',
      text: 'How are you tracking energy across your three warehouses today?',
      technique: 'Open discovery question',
      note: 'Gets her talking about her world, not your product.',
      interest: 31,
      patience: 51,
      audioMs: 2_600,
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

  it('lists the demo calls, ready ones linking to their player', async () => {
    answerAll(200, {
      demos: [
        summary({}),
        summary({
          id: '8b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
          position: 2,
          status: 'failed',
          title: null,
          outcome: null,
          durationMs: null,
          error: 'Cartesia answered 402',
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
    expect(ready).toHaveTextContent('1:34');
    expect(failed).toHaveTextContent('Failed');
    expect(failed).toHaveTextContent('Cartesia answered 402');
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
          summary({ status: 'generating', title: null, outcome: null, durationMs: null }),
          summary({
            id: '9b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
            position: 2,
            status: 'queued',
            title: null,
            outcome: null,
            durationMs: null,
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
      await screen.findByText(/0 of 2 demo calls ready\. Writing #1 now\./),
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
              error: 'The voice agent writes the demos and collects them with INTERNAL_API_SECRET.',
            })
          : json(200, { demos: [] }),
      ),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Generate 20 demo calls' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_API_SECRET');
  });
});

describe('DemoPage', () => {
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pause,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const renderDemo = () =>
    render(
      <Router hook={memoryLocation({ path: `/demos/${ID}` }).hook}>
        <DemoPage id={ID} />
      </Router>,
    );

  it('shows what the call teaches, and every rep line with its technique', async () => {
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
    expect(lines[1]).toHaveTextContent('Permission opener');
    expect(lines[1]).toHaveTextContent('She hears who is calling');
    expect(lines[1]).toHaveTextContent('interest 24 · patience 53');
    expect(lines[0]).toHaveTextContent('Claire');
    // A line with no audio can't be played from.
    expect(within(lines[2]!).queryByRole('button')).toBeNull();
  });

  it('plays the lines in order with a gap between them, highlighting the one playing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerAll(200, DETAIL);
    const { container } = renderDemo();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const audio = container.querySelector('audio')!;
    const lines = within(screen.getByRole('list', { name: 'The call' })).getAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'Play the call' }));
    expect(audio.getAttribute('src')).toBe(`/api/demos/${ID}/turns/0/audio`);
    expect(play).toHaveBeenCalledTimes(1);
    expect(lines[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Line 1 of 3')).toBeInTheDocument();

    fireEvent(audio, new Event('ended'));
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(audio.getAttribute('src')).toBe(`/api/demos/${ID}/turns/1/audio`);
    expect(lines[1]).toHaveAttribute('aria-current', 'true');

    // Line 2 has no audio, so the next one after line 1 is line 3.
    fireEvent(audio, new Event('ended'));
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(audio.getAttribute('src')).toBe(`/api/demos/${ID}/turns/3/audio`);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    fireEvent(audio, new Event('ended'));
    expect(screen.getByRole('button', { name: 'Play the call' })).toBeInTheDocument();
  });

  it('plays from any line you pick', async () => {
    answerAll(200, DETAIL);
    const { container } = renderDemo();
    const call = await screen.findByRole('list', { name: 'The call' });
    const lines = within(call).getAllByRole('listitem');
    fireEvent.click(within(lines[3]!).getByRole('button', { name: 'Play from here' }));
    expect(container.querySelector('audio')!.getAttribute('src')).toBe(
      `/api/demos/${ID}/turns/3/audio`,
    );
    expect(screen.getByText('Line 3 of 3')).toBeInTheDocument();
  });

  it('says so when the demo does not exist', async () => {
    answerAll(404, { error: 'No such demo call.' });
    renderDemo();
    expect(await screen.findByText('No such demo call.')).toBeInTheDocument();
  });
});
