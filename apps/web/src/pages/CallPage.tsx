import { RoomContext, StartAudio, useVoiceAssistant } from '@livekit/components-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AgentAudio } from '../avatar/AgentAudio.tsx';
import { AvatarStage } from '../avatar/AvatarStage.tsx';
import { AvatarStore } from '../avatar/avatarStore.ts';
import { DEV_MOODS, type Mood } from '../avatar/config.ts';
import { type CallView, useCall } from '../call/useCall.ts';
import { PhoneIcon, PhoneOffIcon } from '../components/icons.tsx';
import { LatencyPanel } from '../components/LatencyPanel.tsx';
import { SystemStatus } from '../components/SystemStatus.tsx';
import { Transcript } from '../components/Transcript.tsx';
import { formatClock } from '../lib/stats.ts';
import { usePersistentFlag } from '../lib/usePersistentFlag.ts';

/** M1/M2 have one scenario; M3 adds the picker. */
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
  const [avatarStore] = useState(() => new AvatarStore());
  const { controller } = useSyncExternalStore(avatarStore.subscribe, avatarStore.getSnapshot);
  const [phoneMode, setPhoneMode] = usePersistentFlag('ccc.phoneMode', false);
  const [lipSyncDelay, setLipSyncDelay] = usePersistentFlag('ccc.lipSyncDelay', false);
  const [devMood, setDevMood] = useState<Mood>('neutral');
  const { view, dial, hangUp } = useCall();
  const live = isLive(view.phase);

  useEffect(() => controller?.setLipSyncDelay(lipSyncDelay), [controller, lipSyncDelay]);
  useEffect(() => controller?.setMood(devMood), [controller, devMood]);

  const onDial = () => {
    // Inside the click: the avatar's audio context may only start from a user gesture.
    controller?.resumeAudio();
    void dial({ scenarioId: SCENARIO.id, mode: 'coached' });
  };

  return (
    <RoomContext.Provider value={view.room}>
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Cold Call Coach</h1>
          <SystemStatus />
        </header>

        <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Call" className="flex min-w-0 flex-col gap-3">
            <AvatarStage
              store={avatarStore}
              phoneMode={phoneMode}
              name={SCENARIO.prospect}
              role={SCENARIO.role}
            >
              <div className="absolute top-3 left-3">
                <StatusChip view={view} prospect={SCENARIO.firstName} />
              </div>
              {view.phase === 'ended' && (
                <div
                  role="alert"
                  className="absolute inset-x-0 top-1/2 mx-auto w-fit max-w-md -translate-y-1/2 rounded-lg bg-slate-950/85 px-5 py-3 text-center"
                >
                  <p className="font-medium">Call ended</p>
                  {view.message && <p className="mt-1 text-sm text-slate-300">{view.message}</p>}
                </div>
              )}
            </AvatarStage>
            <p className="text-sm text-slate-400">
              {SCENARIO.title}. Put your headset on, press Dial, and get a meeting.
            </p>
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

        <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-slate-800 px-6 py-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <Toggle label="Phone mode" checked={phoneMode} onChange={setPhoneMode} />
            <Toggle
              label="Delay voice 0.1 s (lip sync)"
              checked={lipSyncDelay}
              onChange={setLipSyncDelay}
            />
          </div>

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
              onClick={onDial}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            >
              <PhoneIcon /> {view.phase === 'ended' ? 'Dial again' : 'Dial'}
            </button>
          )}

          <div className="flex justify-end">
            {import.meta.env.DEV && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Mood (dev)
                <select
                  value={devMood}
                  onChange={(e) => setDevMood(e.target.value as Mood)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                >
                  {DEV_MOODS.map((mood) => (
                    <option key={mood}>{mood}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </footer>

        {live && view.room && <AgentAudio controller={controller} />}
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

function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="size-4 accent-sky-500"
      />
      {props.label}
    </label>
  );
}

function StatusChip({ view, prospect }: { view: CallView; prospect: string }) {
  const chip = 'rounded-full bg-slate-950/70 px-3 py-1 text-sm backdrop-blur-sm';
  switch (view.phase) {
    case 'idle':
    case 'ended':
      return null;
    case 'dialling':
      return <p className={chip}>Dialling…</p>;
    case 'ringing':
      return <p className={`${chip} animate-pulse motion-reduce:animate-none`}>Ringing…</p>;
    case 'connected':
      return <Connected className={chip} since={view.connectedAt} prospect={prospect} />;
  }
}

function Connected(props: { className: string; since: number | undefined; prospect: string }) {
  const { since, prospect } = props;
  const { state } = useVoiceAssistant();
  const [elapsedS, setElapsedS] = useState(0);
  useEffect(() => {
    if (since === undefined) return;
    const id = window.setInterval(() => setElapsedS((Date.now() - since) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [since]);

  const activity =
    state === 'speaking'
      ? `${prospect} speaking`
      : state === 'thinking'
        ? `${prospect} thinking`
        : 'listening';

  return (
    <p className={props.className} aria-live="polite">
      <span className="font-medium text-emerald-400">● {formatClock(elapsedS)}</span>
      <span className="ml-2 text-slate-300">{activity}</span>
    </p>
  );
}
