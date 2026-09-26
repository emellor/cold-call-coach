import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LatencyPanel } from './LatencyPanel.tsx';

describe('LatencyPanel', () => {
  it('shows the last turn and the running p50 per stage', () => {
    render(
      <LatencyPanel
        entries={[
          { turn: 0, endOfTurnMs: null, llmTtftMs: null, ttsTtfbMs: 200, e2eMs: null },
          { turn: 1, endOfTurnMs: 400, llmTtftMs: 700, ttsTtfbMs: 180, e2eMs: 1300 },
          { turn: 2, endOfTurnMs: 600, llmTtftMs: 900, ttsTtfbMs: 220, e2eMs: 1900 },
        ]}
      />,
    );
    const e2e = screen.getByRole('row', { name: /End to end/ });
    const cells = within(e2e).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['1900 ms', '1600 ms']);
    expect(screen.getByText(/turn 2 · 3 replies/)).toBeInTheDocument();
  });

  it('shows dashes before any reply', () => {
    render(<LatencyPanel entries={[]} />);
    expect(screen.getByText('no replies yet')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /End to end/ })).getAllByText('–')).toHaveLength(
      2,
    );
  });
});
