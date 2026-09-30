import type { ReactNode } from 'react';

interface ProspectStageProps {
  name: string;
  role: string;
  /** The region's name: who is on the other end. Sam is the caller in a reverse call. */
  label?: string;
  /** Overlays: call status, tips, help, "Call ended". */
  children?: ReactNode;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2);

/** The frame the call happens in: who is on the line, with the call's overlays on top. */
export function ProspectStage({ name, role, label = 'Prospect', children }: ProspectStageProps) {
  return (
    <div
      role="region"
      aria-label={label}
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-slate-700 text-3xl font-semibold text-slate-200">
          {initials(name)}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-3 py-1.5 backdrop-blur-sm">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-slate-400">{role}</p>
      </div>
      {children}
    </div>
  );
}
