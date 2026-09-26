// TalkingHead's CC0 sample avatar (see CREDITS.md). Fetched by `pnpm avatar:fetch`.

export const AVATAR_URL = '/avatars/mpfb.glb';

export type Mood = 'neutral' | 'happy' | 'angry' | 'sad';
export const DEV_MOODS: Mood[] = ['neutral', 'happy', 'angry', 'sad'];

/**
 * Secondary motion for the ponytail, from the MPFB entry in TalkingHead's
 * siteconfig.js. The breast bones in that entry are left out: invisible in the
 * upper-body framing, and every simulated bone costs CPU.
 */
export const MPFB_DYNAMIC_BONES = [
  {
    bone: 'Ponytail1',
    type: 'mix2',
    stiffness: 100,
    damping: 4,
    limits: [null, null, [null, 0.02], null],
    pivot: true,
  },
  {
    bone: 'Ponytail2',
    type: 'mix2',
    stiffness: 150,
    damping: 4,
    limits: [null, null, [null, 0.01], null],
  },
  {
    bone: 'Ponytail3',
    type: 'mix2',
    stiffness: 200,
    damping: 4,
    limits: [null, null, [null, 0.01], null],
  },
];

/** siteconfig.js's MPFB baseline: head a touch down, eyelids slightly lowered. */
export const MPFB_BASELINE = { headRotateX: -0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 };

/**
 * HeadAudio's mel spacing hint; adult female voices sit around 200–250 Hz.
 * Every v1 prospect is a woman (PLAN.md §6.1).
 */
export const SPEAKER_MEAN_HZ = 220;

/**
 * Framing for a video call: TalkingHead's upper-body view, moved in so head and
 * shoulders fill the frame. Negative distance is closer.
 */
export const CAMERA = { view: 'upper', distance: -0.5, x: -0.18, y: 0 } as const;

/** Lines the voice up with the lips, which trail the audio by 50–100 ms. */
export const LIP_SYNC_DELAY_S = 0.1;
