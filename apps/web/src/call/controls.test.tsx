import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveControls, ModeChoice } from './controls.tsx';
import { type CallShortcuts, shortcutFor, useShortcuts } from './useShortcuts.ts';

function controls(overrides: Partial<Parameters<typeof LiveControls>[0]> = {}) {
  const props = {
    coaching: true,
    paused: false,
    busy: false,
    hinting: false,
    onTogglePause: vi.fn(),
    onHint: vi.fn(),
    onRewind: vi.fn(),
    onHangUp: vi.fn(),
    ...overrides,
  };
  render(<LiveControls {...props} />);
  return props;
}

describe('ModeChoice', () => {
  it('offers coached and exam, and reports the choice', () => {
    const onChange = vi.fn();
    render(<ModeChoice mode="coached" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /Coached/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Exam: No live help/ }));
    expect(onChange).toHaveBeenCalledWith('exam');
  });
});

describe('LiveControls', () => {
  it('offers pause, hint, rewind and hang up in a coached call, with their shortcuts', () => {
    const props = controls();
    for (const [name, keys] of [
      [/Pause/, 'Space'],
      [/Hint/, 'H'],
      [/Rewind/, 'R'],
      [/Hang up/, 'Escape'],
    ] as const) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-keyshortcuts', keys);
    }
    fireEvent.click(screen.getByRole('button', { name: /Rewind/ }));
    expect(props.onRewind).toHaveBeenCalledOnce();
  });

  it('shows Resume, pressed, while paused', () => {
    controls({ paused: true });
    expect(screen.getByRole('button', { name: /Resume/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers only hang up in an exam call', () => {
    controls({ coaching: false });
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: /Hang up/ }),
    ]);
  });
});

describe('shortcutFor', () => {
  const shortcuts: Required<CallShortcuts> = {
    togglePause: vi.fn(),
    hint: vi.fn(),
    rewind: vi.fn(),
    hangUp: vi.fn(),
  };
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    shortcutFor(
      {
        key,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: document.body,
        ...extra,
      },
      shortcuts,
    );

  it('maps Space, H, R and Esc', () => {
    expect(press(' ')).toBe(shortcuts.togglePause);
    expect(press('h')).toBe(shortcuts.hint);
    expect(press('H')).toBe(shortcuts.hint);
    expect(press('r')).toBe(shortcuts.rewind);
    expect(press('Escape')).toBe(shortcuts.hangUp);
    expect(press('x')).toBeUndefined();
  });

  it('leaves typing, held keys and browser shortcuts alone', () => {
    const input = document.createElement('input');
    expect(press('h', { target: input })).toBeUndefined();
    expect(press('r', { ctrlKey: true })).toBeUndefined(); // reload
    expect(press('r', { metaKey: true })).toBeUndefined();
    expect(press(' ', { repeat: true })).toBeUndefined();
  });

  it('lets Space press a focused button instead of pausing', () => {
    const button = document.createElement('button');
    expect(press(' ', { target: button })).toBeUndefined();
    expect(press('h', { target: button })).toBe(shortcuts.hint);
  });

  it('does nothing for a key whose control is off', () => {
    expect(
      shortcutFor(
        { key: 'h', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null },
        {},
      ),
    ).toBeUndefined();
  });
});

describe('useShortcuts', () => {
  function Harness(props: CallShortcuts) {
    useShortcuts(props);
    return <input aria-label="notes" />;
  }

  it('runs the handler for a key pressed anywhere on the page, and keeps the page from scrolling', () => {
    const togglePause = vi.fn();
    const { rerender } = render(<Harness togglePause={togglePause} />);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(togglePause).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);

    // The latest handlers are used without re-subscribing.
    const next = vi.fn();
    rerender(<Harness togglePause={next} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(next).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'notes' }), { key: ' ' });
    expect(next).toHaveBeenCalledOnce();
  });
});
