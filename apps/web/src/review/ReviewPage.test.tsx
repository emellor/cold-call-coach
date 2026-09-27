import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CALL_ID, callDetail, olderReviewResult } from '../test/callDetail.ts';
import { ReviewPage } from './ReviewPage.tsx';
import { POLL_MS } from './useCallDetail.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch input as the URL string the page asked for. */
const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** Answers GET /api/calls/:id from `details` in turn (the last one repeats), and records posts. */
function mockApi(details: unknown[], rerunStatus = 202) {
  const queue = [...details];
  const posts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOf(input);
    if (url === '/api/health')
      return Promise.resolve(json(200, { ok: true, db: { ok: true, latencyMs: 1 } }));
    if (init?.method === 'POST') {
      posts.push(url);
      return Promise.resolve(json(rerunStatus, { status: 'pending' }));
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(next instanceof Response ? next : json(200, next));
  });
  return { posts };
}

const renderPage = () =>
  render(
    <Router hook={memoryLocation({ path: `/calls/${CALL_ID}` }).hook}>
      <ReviewPage id={CALL_ID} />
    </Router>,
  );

describe('ReviewPage', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows "Reviewing…" until the review is ready, then the scorecard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockApi([callDetail({ status: 'running', result: null }), callDetail()]);
    renderPage();
    // Fake timers would stall findBy*'s own polling, so let the fetch settle and assert directly.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Reviewing…')).toBeInTheDocument();
    // The transcript is already there while the coach reads it.
    expect(screen.getByText('Claire Hughes.')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByLabelText('Score 38 out of 100')).toBeInTheDocument();
    expect(screen.queryByText('Reviewing…')).not.toBeInTheDocument();
  });

  it('shows the outcome, the walkthrough, every stage, delivery against targets, objections and the drill', async () => {
    mockApi([callDetail()]);
    renderPage();
    expect(await screen.findByText('She hung up')).toBeInTheDocument();
    expect(screen.getByText('Out of patience')).toBeInTheDocument();
    expect(screen.getByText('She hung up after a feature pitch.')).toBeInTheDocument();
    expect(
      screen.getByText('You opened well but pitched features before finding a problem.'),
    ).toBeInTheDocument();

    const next = within(
      screen.getByRole('heading', { name: 'Your next call' }).closest('section')!,
    );
    expect(next.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Lead with her problem, not your features.',
      'When she is busy, offer a callback at a specific time.',
      'Ask one open question before you pitch anything.',
    ]);

    // Turn by turn: each moment at its time, what happened, what to say instead and why.
    const walk = screen.getByRole('list', { name: 'Moments, in the order they happened' });
    expect(walk.closest('section')).toHaveTextContent(
      '1 mistake · 1 missed chance · 1 strong moment',
    );
    const [strong, missed, mistake] = within(walk).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(strong).toHaveTextContent('0:01✓ WorkedOpener');
    expect(strong).toHaveTextContent('You said: Have you got thirty seconds?');
    expect(strong).toHaveTextContent('Why it worked: Asking permission lowers her guard.');
    expect(within(strong).queryByText('Say instead')).toBeNull();
    expect(missed).toHaveTextContent('0:06◌ Missed chanceObjections');
    expect(missed).toHaveTextContent("She said: I'm about to go into a meeting");
    expect(missed).toHaveTextContent('Say insteadOf course. Could I call you back at three?');
    expect(mistake).toHaveTextContent('0:07✗ Went wrongReason for call');
    expect(mistake).toHaveTextContent('her patience fell from 62 to 43');
    expect(mistake).toHaveTextContent('Why it works: Lead with a problem she recognises.');

    expect(screen.getByRole('img', { name: 'Opener: 4 out of 5' })).toBeInTheDocument();
    expect(
      screen.getByText('Keep the permission ask, and give your reason straight after it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Discovery: 1 out of 5' })).toBeInTheDocument();

    const pace = screen.getByRole('rowheader', { name: 'Pace' }).closest('tr')!;
    expect(within(pace).getByText('159 wpm')).toBeInTheDocument();
    expect(within(pace).getByText('130–170 wpm')).toBeInTheDocument();
    const talk = screen.getByRole('rowheader', { name: 'Talk ratio (you)' }).closest('tr')!;
    expect(within(talk).getByText('(off target)')).toBeInTheDocument();

    expect(screen.getByText('Then I will be quick: is 3pm better?')).toBeInTheDocument();
    expect(screen.getByText('Drill: Problem-first reasons', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/1 quote left out/)).toBeInTheDocument();
  });

  it('annotates the transcript and scrolls to a moment’s turn when asked', async () => {
    mockApi([callDetail()]);
    renderPage();
    const turn4 = (await screen.findByText(/We do per-site dashboards, anomaly alerts/)).closest(
      'li',
    )!;
    expect(turn4.id).toBe('turn-4');
    expect(within(turn4).getByText('Went wrong')).toBeInTheDocument();
    expect(within(turn4).getByText('Objection answered')).toBeInTheDocument();
    expect(within(turn4).getByText('Reason for call')).toBeInTheDocument();
    expect(within(turn4).getByText(/interest 20 · patience 43/)).toBeInTheDocument();
    const turn3 = document.getElementById('turn-3')!;
    expect(within(turn3).getByText('Missed chance')).toBeInTheDocument();

    const walk = screen.getByRole('list', { name: 'Moments, in the order they happened' });
    fireEvent.click(within(walk).getByRole('button', { name: 'turn 4' }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(turn4.className).toContain('ring-1');
  });

  it('still shows a review stored before the walkthrough, and says how to get the full one', async () => {
    mockApi([callDetail({ result: olderReviewResult })]);
    renderPage();
    const walk = await screen.findByRole('list', { name: 'Moments, in the order they happened' });
    const [moment] = within(walk).getAllByRole('listitem');
    expect(moment).toHaveTextContent('0:07✗ Went wrong');
    expect(moment).toHaveTextContent('You said: We do per-site dashboards');
    expect(moment).toHaveTextContent('Say insteadFinance directors tell me');
    expect(screen.getByText(/review it again for the full version/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your next call' })).toBeNull();
    expect(screen.queryByText(/Next time:/)).toBeNull();
  });

  it('offers to rerun a failed review, and starts polling again', async () => {
    const { posts } = mockApi([
      callDetail({ status: 'failed', result: null, error: 'overloaded' }),
      callDetail({ status: 'pending', result: null }),
    ]);
    renderPage();
    expect(await screen.findByText('The review failed')).toBeInTheDocument();
    expect(screen.getByText('overloaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Reviewing…')).toBeInTheDocument();
    expect(posts).toEqual([`/api/calls/${CALL_ID}/review/rerun`]);
  });

  it('explains a call that was not reviewed', async () => {
    mockApi([
      callDetail({
        status: 'skipped',
        result: null,
        error: 'Nothing to review: you did not say anything on this call.',
      }),
    ]);
    renderPage();
    expect(await screen.findByText('No review for this call')).toBeInTheDocument();
    expect(screen.getByText(/you did not say anything/)).toBeInTheDocument();
  });

  it('waits for the call log before there is anything to review', async () => {
    const detail = callDetail(null);
    mockApi([
      { ...detail, call: { ...detail.call, status: 'connected' }, metrics: null, turns: [] },
    ]);
    renderPage();
    expect(await screen.findByText('Saving the call…')).toBeInTheDocument();
  });

  it('shows what the call cost, line by line', async () => {
    mockApi([callDetail()]);
    renderPage();
    const cost = within(await screen.findByRole('region', { name: /Cost/ }));
    expect(cost.getByRole('heading')).toHaveTextContent('Cost$0.29');
    const rows = cost.getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual([
      'Her repliesclaude-opus-5 · 25,900 tokens (20,000 from cache)$0.09',
      'The coach judging your turnsclaude-opus-5 · 18,200 tokens$0.04',
      'This reviewclaude-opus-5$0.06',
      'Hearing younova-3 · 1.38 min$0.01',
      'Her voicesonic-3 · 1,802 characters$0.09',
    ]);
    expect(cost.queryByRole('alert')).toBeNull();
  });

  it('warns when a call cost more than the warning line, and says what it could not price', async () => {
    const detail = callDetail();
    mockApi([
      {
        ...detail,
        cost: {
          ...detail.cost!,
          totalUsd: 2.4,
          overBudget: true,
          incomplete: true,
          lines: [
            ...detail.cost!.lines,
            { key: 'hint', model: 'claude-x', quantity: 900, unit: 'tokens', usd: null },
          ],
        },
      },
    ]);
    renderPage();
    const cost = within(await screen.findByRole('region', { name: /Cost/ }));
    expect(cost.getByRole('alert')).toHaveTextContent(
      'This call cost $2.40+, over the $2.00 warning line.',
    );
    expect(cost.getByText('not priced')).toBeInTheDocument();
    expect(cost.getByText(/add their model to config\/prices.json/)).toBeInTheDocument();
  });

  it('says so when the call does not exist', async () => {
    mockApi([json(404, { error: 'Unknown call' })]);
    renderPage();
    expect(await screen.findByText(/No such call/)).toBeInTheDocument();
  });
});
