import { REP_IDENTITY } from '@ccc/contracts';
import { useTranscriptions } from '@livekit/components-react';
import { useEffect, useMemo, useRef } from 'react';

/** The live transcript, both sides, from LiveKit's `lk.transcription` topic. */
export function Transcript({ prospectName }: { prospectName: string }) {
  const transcriptions = useTranscriptions();
  const lines = useMemo(
    () =>
      transcriptions
        .filter((t) => t.text.trim())
        .sort((a, b) => a.streamInfo.timestamp - b.streamInfo.timestamp),
    [transcriptions],
  );

  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lines]);

  if (lines.length === 0) {
    return (
      <p className="p-4 text-sm text-slate-500">The transcript appears here once she answers.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 p-4" aria-live="polite">
      {lines.map((line) => {
        const isRep = line.participantInfo.identity === REP_IDENTITY;
        return (
          <li key={line.streamInfo.id} className={isRep ? 'self-end text-right' : 'self-start'}>
            <span className="block text-xs text-slate-500">{isRep ? 'You' : prospectName}</span>
            <span
              className={`inline-block max-w-[34ch] rounded-2xl px-3 py-2 text-sm leading-snug ${
                isRep ? 'bg-sky-700/60 text-sky-50' : 'bg-slate-800 text-slate-100'
              }`}
            >
              {line.text}
            </span>
          </li>
        );
      })}
      <li ref={endRef} aria-hidden="true" />
    </ol>
  );
}
