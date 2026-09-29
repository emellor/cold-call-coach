import type { DemoDetail, DemoSummary } from '@ccc/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { DEMO_POLL_MS, DemoPage } from './DemoPage.tsx';
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
  gender: 'female' as const,
  locale: 'en-GB',
};

const BRIEF =
  'Tom Reid, head of estates at Carewell, 14 care homes in Yorkshire. Gas bills doubled. Objective: a site visit.';

const summary = (patch: Partial<DemoSummary>): DemoSummary => ({
  id: ID,
  position: 1,
  status: 'ready',
  angle: 'Lead with cost visibility: bills that keep rising with no site-by-site view of why.',
  brief: null,
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
  practiceProspect: null,
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
    expect(ready).toHaveTextContent('Read or listen to the call');
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

  it("writes a demo from the rep's brief and opens it", async () => {
    const posts: Array<[string, unknown]> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (init?.method === 'POST') {
        posts.push([urlOf(input), JSON.parse(init.body as string)]);
        return Promise.resolve(json(202, { id: ID }));
      }
      return Promise.resolve(json(200, { demos: [] }));
    });
    const location = memoryLocation({ path: '/demos', record: true });
    render(
      <Router hook={location.hook}>
        <DemosPage />
      </Router>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Write one from your brief' }));
    const dialog = screen.getByRole('dialog', { name: 'Write a demo call from your brief' });
    const box = within(dialog).getByRole('textbox', { name: /Who are you calling/ });
    const write = within(dialog).getByRole('button', { name: 'Write the call' });
    fireEvent.change(box, { target: { value: 'Too short' } });
    expect(write).toBeDisabled();
    fireEvent.change(box, { target: { value: BRIEF } });
    fireEvent.click(write);
    await waitFor(() => expect(location.history).toContain(`/demos/${ID}`));
    expect(posts).toEqual([['/api/demos', { brief: BRIEF }]]);
  });

  it('shows a demo from a brief on its own card, apart from the batch progress', async () => {
    answerAll(200, {
      demos: [
        summary({
          id: '9b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
          status: 'generating',
          angle: null,
          brief: BRIEF,
          prospect: null,
          title: null,
          outcome: null,
        }),
        summary({}),
      ],
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Demo calls' });
    const [inProgress, ready] = within(list).getAllByRole('listitem');
    expect(inProgress).toHaveTextContent('From your brief');
    expect(inProgress).toHaveTextContent('Writing…');
    expect(inProgress).toHaveTextContent(`Your brief: ${BRIEF}`);
    expect(inProgress).not.toHaveTextContent('Approach');
    expect(ready).toHaveTextContent('Read or listen to the call');
    expect(screen.queryByRole('progressbar')).toBeNull();
    // The API takes no new batch until it's written.
    expect(screen.getByRole('button', { name: 'Generate 20 demo calls' })).toBeDisabled();
  });
});

describe('DemoPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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
    // Her lines carry no notes. This browser (jsdom) has no speech, so nothing plays.
    expect(lines[2]).toHaveTextContent('Go on, quickly.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText("This browser can't read the call aloud.")).toBeInTheDocument();
    expect(screen.getByText('Written by Claude for $0.08.')).toBeInTheDocument();
  });

  it('reads the call aloud in two voices, following along line by line', async () => {
    type Spoken = { text: string; voice: { name: string } | null; onend: (() => void) | null };
    const spoken: Spoken[] = [];
    const synth = {
      getVoices: () => [
        { name: 'Daniel', lang: 'en-GB' },
        { name: 'Kate', lang: 'en-GB' },
      ],
      speak: (utterance: Spoken) => spoken.push(utterance),
      cancel: vi.fn(),
    };
    class FakeUtterance {
      text: string;
      voice = null;
      lang = '';
      rate = 1;
      pitch = 1;
      onend = null;
      onerror = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    answerAll(200, DETAIL);
    renderDemo();

    fireEvent.click(await screen.findByRole('button', { name: 'Listen' }));
    const lines = within(screen.getByRole('list', { name: 'The call' })).getAllByRole('listitem');
    expect(spoken.map((u) => u.text)).toEqual(['Claire Hughes.']);
    expect(spoken[0]?.voice?.name).toBe('Kate');
    expect(lines[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Line 1 of 4')).toBeInTheDocument();

    // She finishes, and after a beat the rep answers in the other voice.
    act(() => spoken[0]?.onend?.());
    await waitFor(() => expect(spoken).toHaveLength(2));
    expect(spoken[1]?.text).toBe('Hi Claire, it’s Sam from WattGuard.');
    expect(spoken[1]?.voice?.name).toBe('Daniel');
    expect(lines[1]).toHaveAttribute('aria-current', 'true');
    expect(lines[0]).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Listen from line 3' }));
    expect(spoken.at(-1)?.text).toBe('Go on, quickly.');
    expect(lines[2]).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
    expect(lines[2]).not.toHaveAttribute('aria-current');
  });

  it('checks back while Claude writes a demo from a brief, then shows it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: DemoDetail = {
      ...DETAIL,
      status: 'generating',
      angle: null,
      brief: BRIEF,
      prospect: null,
      title: null,
      outcome: null,
      outcomeDetail: null,
      summary: null,
      lessons: [],
      turns: [],
      costUsd: null,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === '/api/health'
          ? json(200, { ok: true, db: { ok: true, latencyMs: 1 } })
          : json(200, answer),
      ),
    );
    renderDemo();
    expect(await screen.findByText(/Claude is writing this call/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Demo call from your brief' })).toBeInTheDocument();
    expect(screen.getByText(BRIEF)).toBeInTheDocument();

    answer = {
      ...DETAIL,
      angle: null,
      brief: BRIEF,
      outcome: 'objective_met',
      outcomeDetail: 'A site visit, Tuesday at 2pm',
      prospect: {
        name: 'Tom Reid',
        role: 'Head of Estates',
        company: 'Carewell',
        difficulty: 'hard',
        gender: 'male',
        locale: 'en-GB',
      },
    };
    await act(() => vi.advanceTimersByTimeAsync(DEMO_POLL_MS));
    expect(await screen.findByRole('list', { name: 'The call' })).toBeInTheDocument();
    expect(screen.getByText('Objective met')).toBeInTheDocument();
    expect(screen.getByText('Tom Reid, Head of Estates at Carewell')).toBeInTheDocument();
    expect(screen.queryByText(/The rep's approach/)).toBeNull();
  });

  describe('preparing for the call in a brief', () => {
    const FROM_BRIEF: DemoDetail = {
      ...DETAIL,
      angle: null,
      brief: BRIEF,
      outcome: 'objective_met',
      outcomeDetail: 'A site visit, Tuesday at 2pm',
    };
    const PRACTICE = {
      id: 'claire-hughes-a1b2c3',
      version: 1,
      title: 'Claire Hughes, Harrow & Finch Logistics',
      difficulty: 'medium',
      winCondition: 'A 20-minute call with her and the MD.',
      prospect: {
        name: 'Claire Hughes',
        role: 'Finance Director',
        company: 'Harrow & Finch Logistics',
      },
      custom: true,
    };

    /** Serves the demo, and holds each POST until the test answers it. */
    const serve = (demo: DemoDetail) => {
      const posts: Array<[string, unknown]> = [];
      const answers: Array<(value: Response) => void> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (urlOf(input) === '/api/health') {
          return Promise.resolve(json(200, { ok: true, db: { ok: true, latencyMs: 1 } }));
        }
        if (init?.method === 'POST') {
          posts.push([urlOf(input), init.body ? JSON.parse(init.body as string) : undefined]);
          return new Promise((resolve) => answers.push(resolve));
        }
        return Promise.resolve(json(200, demo));
      });
      const location = memoryLocation({ path: `/demos/${ID}`, record: true });
      render(
        <Router hook={location.hook}>
          <DemoPage id={ID} />
        </Router>,
      );
      return { posts, answer: (res: Response) => answers.shift()?.(res), location };
    };

    it('adds the person in the brief to the prospects, then links to her on the Call page', async () => {
      const { posts, answer } = serve(FROM_BRIEF);
      const prepare = await screen.findByRole('region', { name: 'Prepare for this call' });
      expect(within(prepare).queryByText(/Practice prospects are all women/)).toBeNull();

      fireEvent.click(within(prepare).getByRole('button', { name: 'Practise this call' }));
      expect(within(prepare).getByRole('status')).toHaveTextContent(
        'Adding Claire to your prospects… about half a minute.',
      );
      expect(
        within(prepare).getByRole('button', { name: 'Cheat sheet for this call' }),
      ).toBeDisabled();
      expect(posts).toEqual([[`/api/demos/${ID}/practice`, undefined]]);

      answer(json(201, { scenario: PRACTICE }));
      const practise = await within(prepare).findByRole('link', {
        name: 'Practise the call with Claire →',
      });
      expect(practise).toHaveAttribute('href', '/?prospect=claire-hughes-a1b2c3');
      expect(within(prepare).getByRole('status')).toHaveTextContent(
        'Claire Hughes is in your prospects on the Call page.',
      );
      expect(within(prepare).queryByRole('button', { name: 'Practise this call' })).toBeNull();
    });

    it('links straight to the practice prospect once there is one', async () => {
      serve({ ...FROM_BRIEF, practiceProspect: { id: PRACTICE.id, name: 'Claire Hughes' } });
      const prepare = await screen.findByRole('region', { name: 'Prepare for this call' });
      expect(
        within(prepare).getByRole('link', { name: 'Practise the call with Claire →' }),
      ).toHaveAttribute('href', '/?prospect=claire-hughes-a1b2c3');
      expect(within(prepare).queryByRole('button', { name: 'Practise this call' })).toBeNull();
    });

    it('says a man in the brief is practised as a woman in the same job', async () => {
      serve({
        ...FROM_BRIEF,
        prospect: {
          name: 'Tom Reid',
          role: 'Head of Estates',
          company: 'Carewell',
          difficulty: 'hard',
          gender: 'male',
          locale: 'en-GB',
        },
      });
      const prepare = await screen.findByRole('region', { name: 'Prepare for this call' });
      expect(prepare).toHaveTextContent(
        'Practice prospects are all women for now, as the coaching is written that way: Tom becomes a woman in the same job.',
      );
      // She comes back with another name, so the wait doesn't promise Tom.
      fireEvent.click(within(prepare).getByRole('button', { name: 'Practise this call' }));
      expect(within(prepare).getByRole('status')).toHaveTextContent(
        'Writing your practice prospect… about half a minute.',
      );
    });

    it('says why practising failed, and lets the rep try again', async () => {
      const { answer } = serve(FROM_BRIEF);
      const prepare = await screen.findByRole('region', { name: 'Prepare for this call' });
      const practise = within(prepare).getByRole('button', { name: 'Practise this call' });
      fireEvent.click(practise);
      answer(json(502, { error: 'Claude declined to write this prospect.' }));
      expect(await within(prepare).findByRole('alert')).toHaveTextContent(
        'Claude declined to write this prospect.',
      );
      expect(practise).toBeEnabled();
    });

    it('writes a cheat sheet from the brief and opens it', async () => {
      const { posts, answer, location } = serve(FROM_BRIEF);
      const prepare = await screen.findByRole('region', { name: 'Prepare for this call' });
      fireEvent.click(within(prepare).getByRole('button', { name: 'Cheat sheet for this call' }));
      expect(within(prepare).getByRole('status')).toHaveTextContent(
        'Writing your cheat sheet… about half a minute.',
      );
      expect(within(prepare).getByRole('button', { name: 'Practise this call' })).toBeDisabled();
      expect(posts).toEqual([['/api/cheat-sheets', { brief: BRIEF }]]);

      answer(json(201, { id: '5c1e0a4e-2b1f-4f55-9a0c-6d3f1c1e8a10' }));
      await waitFor(() =>
        expect(location.history).toContain('/cheat-sheets/5c1e0a4e-2b1f-4f55-9a0c-6d3f1c1e8a10'),
      );
    });
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
