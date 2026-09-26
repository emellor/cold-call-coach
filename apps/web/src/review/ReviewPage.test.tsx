import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CALL_ID, callDetail } from '../test/callDetail.ts';
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

  it('shows the outcome, the moments, every stage, delivery against targets, objections and the drill', async () => {
    mockApi([callDetail()]);
    renderPage();
    expect(await screen.findByText('She hung up')).toBeInTheDocument();
    expect(screen.getByText('Out of patience')).toBeInTheDocument();
    expect(
      screen.getByText('You opened well but pitched features before finding a problem.'),
    ).toBeInTheDocument();

    // The first "Moment 1" is the scorecard's; the transcript's annotation comes later.
    const moment = screen.getAllByText('Moment 1')[0]!.closest('li')!;
    expect(within(moment).getByText('We do per-site dashboards')).toBeInTheDocument();
    expect(within(moment).getByText(/Finance directors tell me/)).toBeInTheDocument();

    expect(screen.getByRole('img', { name: 'Opener: 4 out of 5' })).toBeInTheDocument();
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
    expect(within(turn4).getByText('Moment 1')).toBeInTheDocument();
    expect(within(turn4).getByText('Reason for call')).toBeInTheDocument();
    expect(within(turn4).getByText(/interest 20 · patience 43/)).toBeInTheDocument();

    const moment = screen.getAllByText('Moment 1')[0]!.closest('li')!;
    fireEvent.click(within(moment).getByRole('button', { name: 'turn 4' }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(turn4.className).toContain('ring-1');
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

  it('says so when the call does not exist', async () => {
    mockApi([json(404, { error: 'Unknown call' })]);
    renderPage();
    expect(await screen.findByText(/No such call/)).toBeInTheDocument();
  });
});
