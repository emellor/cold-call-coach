import { useCallback, useState } from 'react';

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

/** A boolean preference remembered in localStorage (when it is available). */
export function usePersistentFlag(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Private mode or blocked storage: the setting lasts for this visit only.
      }
    },
    [key],
  );
  return [value, update];
}
