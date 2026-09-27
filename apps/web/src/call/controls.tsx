// The call page's buttons: the mode choice before dialling, and during a
// call Pause/Resume (Space), Get help (H), Rewind (R) and Hang up (Esc).
import type { CallMode } from '@ccc/contracts';
import type { ReactNode } from 'react';
import {
  LightbulbIcon,
  PauseIcon,
  PhoneIcon,
  PhoneOffIcon,
  PlayIcon,
  RewindIcon,
} from '../components/icons.tsx';

const MODES: Array<{ mode: CallMode; label: string; detail: string }> = [
  { mode: 'coached', label: 'Coached', detail: 'Live panel, tips, pause, Get help and rewind' },
  { mode: 'exam', label: 'Exam', detail: 'No live help: the review only' },
];

export function ModeChoice(props: {
  mode: CallMode;
  onChange: (mode: CallMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={props.disabled}
      className="flex items-center gap-1 rounded-full bg-slate-900 p-1"
    >
      <legend className="sr-only">Mode</legend>
      {MODES.map(({ mode, label, detail }) => (
        <label
          key={mode}
          title={detail}
          className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky-400 ${
            props.mode === mode ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <input
            type="radio"
            name="call-mode"
            value={mode}
            checked={props.mode === mode}
            onChange={() => props.onChange(mode)}
            className="sr-only"
          />
          {label}
          <span className="sr-only">: {detail}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Kbd({
  children,
  className = 'border-slate-600 text-slate-400',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd className={`ml-1 rounded border px-1 font-sans text-[0.65rem] ${className}`}>
      {children}
    </kbd>
  );
}

function ControlButton(props: {
  label: string;
  shortcut: string;
  keys: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      aria-keyshortcuts={props.keys}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-50 ${
        props.pressed
          ? 'border-amber-400 bg-amber-500/20 text-amber-100'
          : 'border-slate-700 text-slate-200 hover:border-slate-500'
      }`}
    >
      {props.icon}
      {props.label}
      <Kbd>{props.shortcut}</Kbd>
    </button>
  );
}

export function DialButton(props: { onClick: () => void; disabled: boolean; again: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <PhoneIcon /> {props.again ? 'Dial again' : 'Dial'}
    </button>
  );
}

export function LiveControls(props: {
  /** Pause, Get help and rewind: coached calls, once she has answered. */
  coaching: boolean;
  paused: boolean;
  busy: boolean;
  hinting: boolean;
  onTogglePause: () => void;
  onHint: () => void;
  onRewind: () => void;
  onHangUp: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Call controls"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {props.coaching && (
        <>
          <ControlButton
            label={props.paused ? 'Resume' : 'Pause'}
            shortcut="Space"
            keys="Space"
            icon={props.paused ? <PlayIcon /> : <PauseIcon />}
            onClick={props.onTogglePause}
            disabled={props.busy}
            pressed={props.paused}
          />
          <ControlButton
            label="Get help"
            shortcut="H"
            keys="H"
            icon={<LightbulbIcon />}
            onClick={props.onHint}
            disabled={props.hinting}
          />
          <ControlButton
            label="Rewind"
            shortcut="R"
            keys="R"
            icon={<RewindIcon />}
            onClick={props.onRewind}
            disabled={props.busy}
          />
        </>
      )}
      <button
        type="button"
        onClick={props.onHangUp}
        aria-keyshortcuts="Escape"
        className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-6 py-3 font-medium text-white hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
      >
        <PhoneOffIcon /> Hang up
        <Kbd className="border-rose-300/70 text-rose-100">Esc</Kbd>
      </button>
    </div>
  );
}
