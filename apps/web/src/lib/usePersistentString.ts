import { useCallback, useState } from 'react';

/** A string preference remembered in localStorage; null until one is chosen. */
export function usePersistentString(key: string): [string | null, (value: string) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Private mode or blocked storage: the setting lasts for this visit only.
      }
    },
    [key],
  );
  return [value, update];
}
