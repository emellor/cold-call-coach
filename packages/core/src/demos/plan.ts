// What a batch of demo calls covers: each demo pairs a prospect with an
// approach the expert rep takes, so twenty demos show twenty ways into a call
// rather than one call twenty times.

/** The approaches, one per demo, in the order a batch hands them out. */
export const DEMO_ANGLES: readonly string[] = [
  'Lead with the compliance deadline she is likely facing (ESOS or SECR reporting), and find out how ready she is.',
  'Lead with cost visibility: bills that keep rising with no site-by-site view of why.',
  'Open with a short peer story: what a similar multi-site firm found when it looked at its energy site by site.',
  'Use an upfront agreement: thirty seconds on why you called, then she decides whether it is worth a conversation.',
  'Lead with one sharp open question about how she tracks energy today, instead of a statement.',
  'Go hunting for waste: out-of-hours consumption and unexplained spikes she can’t see in a monthly bill.',
  'Assume she already has a broker, supplier portal or consultant, and position alongside it rather than against it.',
  'Board pressure: energy is a line the board keeps asking about, and she needs answers she can defend.',
  'Timing: find out when her budget or contract renewal comes round, and make the meeting about getting ahead of it.',
  'Straight talk: admit it is a cold call, be brief and honest about why her, and earn the next thirty seconds.',
];

export interface DemoPlanItem {
  scenarioId: string;
  angle: string;
}

/**
 * `count` demos: the prospects in turn, each demo with the next approach. With
 * the three shipped prospects, each hears six or seven different approaches.
 */
export function demoPlan(count: number, scenarioIds: readonly string[]): DemoPlanItem[] {
  if (!scenarioIds.length) return [];
  return Array.from({ length: count }, (_, i) => ({
    scenarioId: scenarioIds[i % scenarioIds.length]!,
    angle: DEMO_ANGLES[i % DEMO_ANGLES.length]!,
  }));
}
