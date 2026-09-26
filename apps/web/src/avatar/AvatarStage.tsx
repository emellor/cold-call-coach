import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import type { AvatarStore } from './avatarStore.ts';

interface AvatarStageProps {
  store: AvatarStore;
  /** Phone mode hides the avatar and pauses rendering; the audio path is the same. */
  phoneMode: boolean;
  name: string;
  role: string;
  /** Overlays: call status, "Call ended". */
  children?: ReactNode;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2);

/** The video-call frame the prospect appears in. */
export function AvatarStage({ store, phoneMode, name, role, children }: AvatarStageProps) {
  const { status, controller } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    return element ? store.mount(element) : undefined;
  }, [store]);

  useEffect(() => {
    controller?.setRendering(!phoneMode);
  }, [controller, phoneMode]);

  const showAvatar = !phoneMode && status.kind === 'ready';

  return (
    <div
      role="region"
      aria-label="Prospect video"
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950"
    >
      {/* Kept in layout (visibility, not display) so TalkingHead always has a size. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className={`absolute inset-0 ${showAvatar ? 'visible' : 'invisible'}`}
      />

      {!showAvatar && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-24 items-center justify-center rounded-full bg-slate-700 text-3xl font-semibold text-slate-200">
            {initials(name)}
          </div>
          {!phoneMode && status.kind === 'loading' && <LoadingBar progress={status.progress} />}
          {!phoneMode && (status.kind === 'failed' || status.kind === 'unavailable') && (
            <p className="max-w-sm px-4 text-sm text-amber-300">{status.message}</p>
          )}
        </div>
      )}

      <div className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-3 py-1.5 backdrop-blur-sm">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-slate-400">{role}</p>
      </div>
      {children}
    </div>
  );
}

function LoadingBar({ progress }: { progress: number | null }) {
  const percent = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="w-48">
      <div
        role="progressbar"
        aria-label="Loading the avatar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-slate-700"
      >
        <div
          className={`h-full rounded-full bg-sky-400 transition-[width] ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Loading avatar{percent === null ? '…' : ` ${percent}%`}
      </p>
    </div>
  );
}
