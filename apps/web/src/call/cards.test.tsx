import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentNotices,
  HintCard,
  NOTICE_VISIBLE_MS,
  NoticeLine,
  TIP_VISIBLE_MS,
  TipCard,
} from './cards.tsx';

const tip = (id: string, text: string) => ({ id, turn: 2, severity: 'warn' as const, text });

describe('TipCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the tip, fades it in its last second, and is gone after 8 s', () => {
    render(<TipCard tip={tip('tip-1', 'Ask an open question.')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ask an open question.');
    expect(screen.getByRole('status')).toHaveClass('opacity-100');
    act(() => {
      vi.advanceTimersByTime(TIP_VISIBLE_MS - 1_000);
    });
    expect(screen.getByRole('status')).toHaveClass('opacity-0');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('starts over for a new tip', () => {
    const { rerender } = render(<TipCard key="tip-1" tip={tip('tip-1', 'First.')} />);
    act(() => {
      vi.advanceTimersByTime(TIP_VISIBLE_MS - 500);
    });
    rerender(<TipCard key="tip-2" tip={tip('tip-2', 'Second.')} />);
    act(() => {
      vi.advanceTimersByTime(TIP_VISIBLE_MS - 1_500);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Second.');
    expect(screen.getByRole('status')).toHaveClass('opacity-100');
  });
});

describe('NoticeLine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces errors as alerts and clears itself', () => {
    render(<NoticeLine notice={{ id: 1, text: "Couldn't pause.", tone: 'error' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't pause.");
    act(() => {
      vi.advanceTimersByTime(NOTICE_VISIBLE_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('HintCard', () => {
  it('shows the lines in order, and closes', () => {
    const onClose = vi.fn();
    render(
      <HintCard
        hint={{ status: 'ready', suggestions: ['One?', 'Two?', 'Three?'] }}
        onClose={onClose}
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'One?',
      'Two?',
      'Three?',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Close the hint' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says it is thinking, or why it failed', () => {
    const { rerender } = render(<HintCard hint={{ status: 'loading' }} onClose={() => {}} />);
    expect(screen.getByRole('region', { name: 'Hint' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Thinking of lines…')).toBeInTheDocument();
    rerender(
      <HintCard
        hint={{ status: 'error', message: 'The hint took too long.' }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The hint took too long.');
  });
});

describe('AgentNotices', () => {
  it('shows each notice with its level, and dismisses by kind', () => {
    const onDismiss = vi.fn();
    render(
      <AgentNotices
        notices={[
          { level: 'error', code: 'stt', message: 'Hearing you (Deepgram) failed.' },
          { level: 'warn', code: 'cost', message: 'This call has cost $2.10 so far.' },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const list = screen.getByRole('list', { name: 'Call notices' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('alert').map((n) => n.textContent)).toEqual([
      'Hearing you (Deepgram) failed.',
      'This call has cost $2.10 so far.',
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]!);
    expect(onDismiss).toHaveBeenCalledWith('cost');
  });

  it('renders nothing without notices', () => {
    const { container } = render(<AgentNotices notices={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
