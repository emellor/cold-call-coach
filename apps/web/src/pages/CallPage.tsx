import type { ScenarioSummary } from '@ccc/contracts';
import { RoomContext, StartAudio, useVoiceAssistant } from '@livekit/components-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { AgentAudio } from '../avatar/AgentAudio.tsx';
import { AppHeader } from '../components/AppHeader.tsx';
import { AvatarStage } from '../avatar/AvatarStage.tsx';
import { AvatarStore } from '../avatar/avatarStore.ts';
import { DEV_MOODS, type Mood } from '../avatar/config.ts';
import { CoachPanel } from '../call/CoachPanel.tsx';
import { HintCard, NoticeLine, TipCard } from '../call/cards.tsx';
import { DialButton, LiveControls, ModeChoice } from '../call/controls.tsx';
import { type CallView, REVIEW_REDIRECT_MS, reviewPathAfter, useCall } from '../call/useCall.ts';
import { useCallMode } from '../call/useCallMode.ts';
import { useShortcuts } from '../call/useShortcuts.ts';
import { LatencyPanel } from '../components/LatencyPanel.tsx';
import { Transcript } from '../components/Transcript.tsx';
import { formatClock } from '../lib/stats.ts';
import { usePersistentFlag, usePersistentString } from '../lib/usePersistentFlag.ts';
import { ScenarioPicker } from '../scenarios/ScenarioPicker.tsx';
import { useScenarios } from '../scenarios/useScenarios.ts';

const firstName = (s: ScenarioSummary | undefined) => s?.prospect.name.split(' ')[0] ?? 'She';

const isLive = (phase: CallView['phase']) =>
  phase === 'dialling' || phase === 'ringing' || phase === 'connected';

export function CallPage() {
  const [avatarStore] = useState(() => new AvatarStore());
  const { controller } = useSyncExternalStore(avatarStore.subscribe, avatarStore.getSnapshot);
  const [phoneMode, setPhoneMode] = usePersistentFlag('ccc.phoneMode', false);
  const [lipSyncDelay, setLipSyncDelay] = usePersistentFlag('ccc.lipSyncDelay', false);
  const [devMood, setDevMood] = useState<Mood>('neutral');
  const { view, dial, hangUp, togglePause, hint, dismissHint, rewind } = useCall();
  const [mode, setMode] = useCallMode();
  const live = isLive(view.phase);
  const coached = live && view.mode === 'coached';
  // Pause, hint and rewind need her on the line; hanging up works from the first ring.
  const coaching = coached && view.phase === 'connected';

  useShortcuts({
    togglePause: coaching ? () => void togglePause() : undefined,
    hint: coaching ? () => void hint() : undefined,
    rewind: coaching ? () => void rewind() : undefined,
    hangUp: live ? hangUp : undefined,
  });

  // Once a call she answered is over, its review is the next thing to see.
  const [, navigate] = useLocation();
  const reviewPath = reviewPathAfter(view);
  useEffect(() => {
    if (!reviewPath) return;
    const timer = window.setTimeout(() => navigate(reviewPath), REVIEW_REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [reviewPath, navigate]);

  const scenarios = useScenarios();
  const [chosenId, setChosenId] = usePersistentString('ccc.scenario');
  const available = scenarios.status === 'ready' ? scenarios.scenarios : [];
  const selected = available.find((s) => s.id === chosenId) ?? available[0];
  // The call in progress (or just ended) keeps its prospect while the picker moves on.
  const [dialled, setDialled] = useState<ScenarioSummary>();
  const shown = live ? dialled : selected;

  useEffect(() => controller?.setLipSyncDelay(lipSyncDelay), [controller, lipSyncDelay]);
  useEffect(() => controller?.setMood(devMood), [controller, devMood]);
  // Her face follows her mood; each call starts neutral.
  const mood = view.prospect?.mood ?? 'neutral';
  useEffect(() => controller?.setMood(mood), [controller, mood]);

  const onDial = () => {
    if (!selected) return;
    // Inside the click: the avatar's audio context may only start from a user gesture.
    controller?.resumeAudio();
    setDialled(selected);
    void dial({ scenarioId: selected.id, mode });
  };

  return (
    <RoomContext.Provider value={view.room}>
      <div className="flex min-h-dvh flex-col">
        <AppHeader />

        <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Call" className="flex min-w-0 flex-col gap-3">
            <AvatarStage
              store={avatarStore}
              phoneMode={phoneMode}
              name={shown?.prospect.name ?? 'Prospect'}
              role={shown ? `${shown.prospect.role}, ${shown.prospect.company}` : ''}
            >
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <StatusChip view={view} prospect={firstName(shown)} />
                {live && view.mode === 'exam' && (
                  <p className="rounded-full bg-slate-950/70 px-3 py-1 text-sm text-slate-300 backdrop-blur-sm">
                    Exam: no live help
                  </p>
                )}
              </div>
              {live && view.paused && (
                <div
                  role="status"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/90 text-center"
                >
                  <p className="text-lg font-medium">Paused</p>
                  <p className="text-sm text-slate-300">
                    Your mic is off and {firstName(shown)} is waiting. Press Space to resume.
                  </p>
                </div>
              )}
              {coached && view.coach.tip && (
                <div className="absolute right-3 bottom-3">
                  <TipCard key={view.coach.tip.id} tip={view.coach.tip} />
                </div>
              )}
              {/* Over the stage, so the controls never move: the rep may pause, then ask. */}
              {coached && view.hint && (
                <div className="absolute top-14 right-3 w-[min(28rem,calc(100%-1.5rem))]">
                  <HintCard hint={view.hint} onClose={dismissHint} />
                </div>
              )}
              {live && view.meeting !== undefined && (
                <p
                  role="status"
                  className="absolute top-3 right-3 rounded-full bg-emerald-600/90 px-3 py-1 text-sm font-medium text-white"
                >
                  ✓ Meeting booked{view.meeting && ` · ${view.meeting}`}
                </p>
              )}
              {view.phase === 'ended' && (
                <div
                  role="alert"
                  className="absolute inset-x-0 top-1/2 mx-auto w-fit max-w-md -translate-y-1/2 rounded-lg bg-slate-950/85 px-5 py-3 text-center"
                >
                  <p className="font-medium">Call ended</p>
                  {view.message && <p className="mt-1 text-sm text-slate-300">{view.message}</p>}
                  {reviewPath && (
                    <Link
                      href={reviewPath}
                      className="mt-2 inline-block text-sm text-sky-300 underline"
                    >
                      See your review
                    </Link>
                  )}
                </div>
              )}
            </AvatarStage>
            {coached ? (
              <CoachPanel coach={view.coach} />
            ) : (
              <>
                {scenarios.status === 'ready' && available.length > 0 && (
                  <ScenarioPicker
                    scenarios={available}
                    selectedId={(live ? dialled : selected)?.id}
                    onSelect={setChosenId}
                    disabled={live}
                  />
                )}
                <p
                  className="text-sm text-slate-400"
                  role={scenarios.status === 'error' ? 'alert' : undefined}
                >
                  {scenarios.status === 'loading' && 'Loading scenarios…'}
                  {scenarios.status === 'error' && scenarios.message}
                  {scenarios.status === 'ready' &&
                    (shown
                      ? `Goal: ${shown.winCondition}.${live ? '' : ' Put your headset on and press Dial.'}`
                      : 'No scenarios found: check the API log.')}
                </p>
              </>
            )}
          </section>

          <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60">
            <h2 className="px-4 pt-4 text-sm font-medium text-slate-300">Transcript</h2>
            <div className="min-h-48 flex-1 overflow-y-auto">
              {view.room ? (
                <Transcript prospectName={firstName(dialled)} />
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

          <div className="flex flex-col items-center gap-2">
            {live ? (
              <LiveControls
                coaching={coaching}
                paused={view.paused}
                busy={view.busy !== undefined}
                hinting={view.hint?.status === 'loading'}
                onTogglePause={() => void togglePause()}
                onHint={() => void hint()}
                onRewind={() => void rewind()}
                onHangUp={hangUp}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <ModeChoice mode={mode} onChange={setMode} />
                <DialButton onClick={onDial} disabled={!selected} again={view.phase === 'ended'} />
              </div>
            )}
            {view.notice && <NoticeLine key={view.notice.id} notice={view.notice} />}
          </div>

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
