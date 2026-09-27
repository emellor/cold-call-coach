import { CallMode } from '@ccc/contracts';
import { usePersistentString } from '../lib/usePersistentString.ts';

/** The mode for the next call, remembered between visits. Coached unless chosen. */
export function useCallMode(): [CallMode, (mode: CallMode) => void] {
  const [stored, setStored] = usePersistentString('ccc.mode');
  return [CallMode.safeParse(stored).data ?? 'coached', setStored];
}
