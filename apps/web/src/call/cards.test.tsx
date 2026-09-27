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

describe('HintCard (Get help)', () => {
  const help = {
    say: 'What does month end look like for you?',
    why: 'Discovery: an open question about her process.',
    ifPushback: 'Fair enough. What would make ten minutes worth it?',
  };

  it('shows what to say, why, and what to say if she pushes back; and closes', () => {
    const onClose = vi.fn();
    render(<HintCard hint={{ status: 'ready', help }} onClose={onClose} />);
    const card = screen.getByRole('region', { name: 'Help' });
    expect(card).toHaveAttribute('aria-busy', 'false');
    expect(card).toHaveTextContent('What to say now');
    expect(card.querySelector('blockquote')).toHaveTextContent(help.say);
    expect(card).toHaveTextContent(`Why: ${help.why}`);
    expect(card).toHaveTextContent(`If she pushes back:${help.ifPushback}`);
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves out the comeback when there is none', () => {
    const { say, why } = help;
    render(<HintCard hint={{ status: 'ready', help: { say, why } }} onClose={() => {}} />);
    expect(screen.queryByText('If she pushes back:')).toBeNull();
  });

  it('says it is working, or why it failed', () => {
    const { rerender } = render(<HintCard hint={{ status: 'loading' }} onClose={() => {}} />);
    expect(screen.getByRole('region', { name: 'Help' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Working out what to say…')).toBeInTheDocument();
    rerender(
      <HintCard hint={{ status: 'error', message: 'Help took too long.' }} onClose={() => {}} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Help took too long.');
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
