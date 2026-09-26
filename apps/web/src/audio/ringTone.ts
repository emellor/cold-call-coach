// A UK ring tone, synthesised: 400 Hz + 450 Hz together, cadence 0.4 s on,
// 0.2 s off, 0.4 s on, 2.0 s off (PLAN.md §5, step 2).

export const RING_FREQUENCIES_HZ = [400, 450] as const;
export const RING_PERIOD_S = 3.0;

export interface Burst {
  /** Seconds from the start of ringing. */
  on: number;
  off: number;
}

/** The on/off times of `cycles` ring cycles. Pure, so the cadence is testable. */
export function ringBursts(cycles: number): Burst[] {
  const bursts: Burst[] = [];
  for (let c = 0; c < cycles; c++) {
    const t = c * RING_PERIOD_S;
    bursts.push({ on: t, off: t + 0.4 }, { on: t + 0.6, off: t + 1.0 });
  }
  return bursts;
}

/** Per oscillator; the two sum to a comfortable earpiece level. */
const LEVEL = 0.08;
/** Softens each edge so bursts don't click (setTargetAtTime time constant, s). */
const EDGE_S = 0.004;
/** Two minutes of ringing is scheduled up front; the no-answer timeout is far shorter. */
const SCHEDULED_CYCLES = 40;

export class RingTone {
  readonly #ctx: AudioContext;
  readonly #gain: GainNode;
  readonly #oscillators: OscillatorNode[];
  #stopped = false;

  /**
   * Starts ringing immediately. Call it inside the Dial click handler: browsers
   * only let audio start from a user gesture.
   */
  static start(): RingTone {
    return new RingTone(new AudioContext());
  }

  private constructor(ctx: AudioContext) {
    this.#ctx = ctx;
    void ctx.resume();
    this.#gain = ctx.createGain();
    this.#gain.gain.value = 0;
    this.#gain.connect(ctx.destination);
    this.#oscillators = RING_FREQUENCIES_HZ.map((frequency) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(this.#gain);
      osc.start();
      return osc;
    });

    const t0 = ctx.currentTime + 0.05;
    for (const burst of ringBursts(SCHEDULED_CYCLES)) {
      this.#gain.gain.setTargetAtTime(LEVEL, t0 + burst.on, EDGE_S);
      this.#gain.gain.setTargetAtTime(0, t0 + burst.off, EDGE_S);
    }
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    const now = this.#ctx.currentTime;
    this.#gain.gain.cancelScheduledValues(now);
    this.#gain.gain.setTargetAtTime(0, now, EDGE_S);
    for (const osc of this.#oscillators) osc.stop(now + 0.05);
    setTimeout(() => void this.#ctx.close(), 200);
  }
}
