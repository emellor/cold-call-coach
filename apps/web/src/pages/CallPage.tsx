import {
  RoomAudioRenderer,
  RoomContext,
  StartAudio,
  useVoiceAssistant,
} from '@livekit/components-react';
import { useEffect, useState } from 'react';
import { type CallView, useCall } from '../call/useCall.ts';
import { PhoneIcon, PhoneOffIcon } from '../components/icons.tsx';
import { LatencyPanel } from '../components/LatencyPanel.tsx';
import { SystemStatus } from '../components/SystemStatus.tsx';
import { Transcript } from '../components/Transcript.tsx';
import { formatClock } from '../lib/stats.ts';

/** M1 has one scenario; M3 adds the picker. */
const SCENARIO = {
  id: 'medium-finance-director',
  title: 'Busy finance director',
  prospect: 'Claire Hughes',
  firstName: 'Claire',
  role: 'Finance Director, Harrow & Finch Logistics',
};

const isLive = (phase: CallView['phase']) =>
  phase === 'dialling' || phase === 'ringing' || phase === 'connected';

export function CallPage() {
  const { view, dial, hangUp } = useCall();
  const live = isLive(view.phase);

  return (
    <RoomContext.Provider value={view.room}>
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Cold Call Coach</h1>
          <SystemStatus />
        </header>

        <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section
            aria-label="Call"
            className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center"
          >
            <p className="text-sm text-slate-400">{SCENARIO.title}</p>
            <h2 className="text-2xl font-semibold">{SCENARIO.prospect}</h2>
            <p className="text-sm text-slate-400">{SCENARIO.role}</p>
            <CallStatus view={view} prospect={SCENARIO.firstName} />
          </section>

          <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60">
            <h2 className="px-4 pt-4 text-sm font-medium text-slate-300">Transcript</h2>
            <div className="min-h-48 flex-1 overflow-y-auto">
              {view.room ? (
                <Transcript prospectName={SCENARIO.firstName} />
              ) : (
                <p className="p-4 text-sm text-slate-500">Press Dial to start a call.</p>
              )}
            </div>
            <div className="border-t border-slate-800">
              <LatencyPanel entries={view.latency} />
            </div>
          </aside>
        </main>

        <footer className="flex justify-center border-t border-slate-800 p-4">
          {live ? (
            <button
              type="button"
              onClick={hangUp}
              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-6 py-3 font-medium text-white hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
            >
              <PhoneOffIcon /> Hang up
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void dial({ scenarioId: SCENARIO.id, mode: 'coached' })}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            >
              <PhoneIcon /> {view.phase === 'ended' ? 'Dial again' : 'Dial'}
            </button>
          )}
        </footer>

        {/* M1 plays the agent's audio directly; M2 routes it through the avatar instead. */}
        {live && view.room && <RoomAudioRenderer room={view.room} />}
        {live && view.room && (
          <StartAudio
            label="Click to allow audio"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950"
          />
        )}
      </div>
    </RoomContext.Provider>
  );
}

function CallStatus({ view, prospect }: { view: CallView; prospect: string }) {
  switch (view.phase) {
    case 'idle':
      return <p className="mt-4 text-slate-300">Put your headset on and press Dial.</p>;
    case 'dialling':
      return <p className="mt-4 text-slate-300">Dialling…</p>;
    case 'ringing':
      return (
        <p className="mt-4 animate-pulse text-slate-200 motion-reduce:animate-none">Ringing…</p>
      );
    case 'connected':
      return <Connected since={view.connectedAt} prospect={prospect} />;
    case 'ended':
      return (
        <p role="alert" className="mt-4 max-w-md text-slate-200">
          Call ended. {view.message}
        </p>
      );
  }
}

function Connected({ since, prospect }: { since: number | undefined; prospect: string }) {
  const { state } = useVoiceAssistant();
  const [elapsedS, setElapsedS] = useState(0);
  useEffect(() => {
    if (since === undefined) return;
    const id = window.setInterval(() => setElapsedS((Date.now() - since) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [since]);

  const activity =
    state === 'speaking'
      ? `${prospect} is speaking`
      : state === 'thinking'
        ? `${prospect} is thinking`
        : 'Listening';

  return (
    <div className="mt-4 flex flex-col items-center gap-1">
      <p className="font-medium text-emerald-400">Connected · {formatClock(elapsedS)}</p>
      <p className="text-sm text-slate-400" aria-live="polite">
        {activity}
      </p>
    </div>
  );
}
