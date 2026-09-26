import type { CoachMetricsPayload } from '@ccc/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoachPanel, MonologueTimer } from './CoachPanel.tsx';
import { monologueTone } from './coachFormat.ts';
import { NO_STAGES } from './useCall.ts';

const metrics: CoachMetricsPayload = {
  elapsedSec: 95,
  talkRatio: 0.72,
  repWpm: 148,
  coreFillers: 3,
  softFillers: 2,
  fillersPerMin: 2.6,
  questionsOpen: 1,
  questionsClosed: 3,
  currentMonologueSec: 12.4,
  longestMonologueSec: 31,
};

describe('CoachPanel', () => {
  it('shows the stages in order, marking the one under way and the ones done', () => {
    render(
      <CoachPanel
        coach={{ stages: { ...NO_STAGES, opener: 'done', discovery: 'active' }, metrics }}
      />,
    );
    const steps = within(screen.getByRole('list', { name: 'Call stages' })).getAllByRole(
      'listitem',
    );
    expect(steps.map((s) => s.textContent)).toEqual([
      '✓ Opener (done)',
      '→Reason for call',
      '→Discovery',
      '→Objections',
      '→Next step',
    ]);
    expect(screen.getByText('Discovery')).toHaveAttribute('aria-current', 'step');
  });

  it('shows the live numbers against their targets', () => {
    render(<CoachPanel coach={{ stages: NO_STAGES, metrics }} />);
    expect(screen.getByRole('meter', { name: 'Your share of the talking' })).toHaveAttribute(
      'aria-valuenow',
      '72',
    );
    expect(screen.getByText('72%')).toHaveClass('text-amber-300'); // above 60%
    expect(screen.getByText('148 wpm')).toHaveClass('text-emerald-300');
    expect(screen.getByText('3 um/uh')).toHaveClass('text-amber-300');
    expect(screen.getByText('1 open · 3 closed')).toBeInTheDocument();
    expect(screen.getByText('12 s')).toBeInTheDocument();
    expect(screen.getByText(/longest 31 s/)).toBeInTheDocument();
  });

  it('waits quietly for the first numbers', () => {
    render(<CoachPanel coach={{ stages: NO_STAGES }} />);
    expect(screen.getAllByText('–')).toHaveLength(2); // talk ratio, pace
    expect(screen.getByText('0 open · 0 closed')).toBeInTheDocument();
  });
});

describe('the monologue timer', () => {
  it.each([
    [29.9, 'ok'],
    [30, 'warn'],
    [44.9, 'warn'],
    [45, 'over'],
  ] as const)('%s s is %s', (seconds, tone) => {
    expect(monologueTone(seconds)).toBe(tone);
  });

  it('turns amber at 30 s and red at 45 s, and says what to do', () => {
    const { rerender } = render(<MonologueTimer current={31} longest={31} />);
    expect(screen.getByText('31 s')).toHaveClass('text-amber-300');
    expect(screen.getByText('Wrap up soon')).toBeInTheDocument();
    rerender(<MonologueTimer current={46} longest={46} />);
    expect(screen.getByText('46 s')).toHaveClass('text-rose-400');
    expect(screen.getByText('Stop and ask a question')).toBeInTheDocument();
  });
});
