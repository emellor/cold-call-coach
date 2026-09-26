import { useEffect, useRef } from 'react';

/** The call's keyboard shortcuts (PLAN.md §8.3); a missing handler means that key is off. */
export interface CallShortcuts {
  /** Space */
  togglePause?: () => void;
  /** H */
  hint?: () => void;
  /** R */
  rewind?: () => void;
  /** Esc */
  hangUp?: () => void;
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Space already activates these natively; taking it over would press them twice. */
const ACTIVATES_ON_SPACE = 'button, a[href], summary, [role="button"], [role="checkbox"]';

function targetMatches(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** Which handler a key press asks for, if any. */
export function shortcutFor(
  event: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
  shortcuts: CallShortcuts,
): (() => void) | undefined {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (targetMatches(event.target, EDITABLE)) return undefined;
  switch (event.key) {
    case ' ':
      return targetMatches(event.target, ACTIVATES_ON_SPACE) ? undefined : shortcuts.togglePause;
    case 'h':
    case 'H':
      return shortcuts.hint;
    case 'r':
    case 'R':
      return shortcuts.rewind;
    case 'Escape':
      return shortcuts.hangUp;
    default:
      return undefined;
  }
}

/** Listens on the window for the call's shortcuts while the page is mounted. */
export function useShortcuts(shortcuts: CallShortcuts): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const run = shortcutFor(event, latest.current);
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
