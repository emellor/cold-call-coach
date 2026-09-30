import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CALL_ID, callDetail, reverseCallDetail } from '../test/callDetail.ts';
import { CallsPage } from './CallsPage.tsx';

/** A fetch input as the URL string the page asked for. */
const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

function mockCalls(calls: unknown[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          urlOf(input) === '/api/health' ? { ok: true, db: { ok: true, latencyMs: 1 } } : { calls },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

const renderPage = () =>
  render(
    <Router hook={memoryLocation({ path: '/calls' }).hook}>
      <CallsPage />
    </Router>,
  );

describe('CallsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists each call with its prospect, outcome, score and duration, linked to its review', async () => {
    const reviewed = callDetail().call;
    const reviewing = {
      ...reviewed,
      id: '11111111-2222-4333-8444-555555555555',
      overallScore: null,
      reviewStatus: 'running' as const,
      outcome: 'meeting_booked' as const,
    };
    mockCalls([reviewing, reviewed]);
    renderPage();
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    const row = rows[2]!;
    expect(within(row).getByText('Claire Hughes')).toBeInTheDocument();
    expect(within(row).getByText('She hung up')).toBeInTheDocument();
    expect(within(row).getByText('38')).toBeInTheDocument();
    expect(within(row).getByText('1:23')).toBeInTheDocument();
    expect(within(row).getByText('$0.29')).toBeInTheDocument();
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/calls/${CALL_ID}`);
    expect(within(rows[1]!).getByText('reviewing…')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Meeting booked')).toBeInTheDocument();
  });

  it("marks a reverse call, says how it ended from Sam's side, and offers his notes for a score", async () => {
    mockCalls([reverseCallDetail().call]);
    renderPage();
    const [, row] = await screen.findAllByRole('row');
    expect(within(row!).getByText('Reverse')).toBeInTheDocument();
    expect(within(row!).getByText('Sam booked the meeting')).toBeInTheDocument();
    expect(within(row!).getByText('notes')).toBeInTheDocument();
  });

  it('flags a call that cost more than the warning line', async () => {
    mockCalls([{ ...callDetail().call, costUsd: 2.31, overBudget: true }]);
    renderPage();
    const [, row] = await screen.findAllByRole('row');
    expect(within(row!).getByText(/\$2\.31/)).toHaveTextContent('⚠ $2.31 (over the warning line)');
  });

  it('invites a first call when there are none', async () => {
    mockCalls([]);
    renderPage();
    expect(await screen.findByText(/No calls yet/)).toBeInTheDocument();
  });
});
