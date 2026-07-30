// The one flip point for the Home -> Nexus swap.
//
// Everything that only makes sense once Nexus IS the landing page hangs
// off this file and nothing else. Today that is two things: the
// first-visit tour (NexusTour.tsx) and the temporary "Something missing?"
// feedback link in the briefing's divider row.
//
// Nothing else in the app may gate those two features on any other flag,
// route check, env var, or date. One file, one edit, on swap day.

/**
 * Swap day. Flipping this to `true` is the moment Nexus replaces Home as
 * the landing page, and it arms both the first-visit tour and the
 * transition feedback link. While it is `false` both features render
 * nothing at all and cost nothing.
 */
export const NEXUS_IS_LANDING: boolean = false;

/**
 * True while we are still inside the transition window (Home just went
 * away, people are still finding their footing). Set this to `false` when
 * Home is removed for good and the feedback link should retire.
 *
 * This ARMED EARLY per Nathan 2026-07-29 (feedback wanted before the swap); no longer waits on the landing flip. Set false when Home retires. Previously: only mattered while NEXUS_IS_LANDING is true. On its own it does
 * nothing.
 */
export const NEXUS_FEEDBACK_LINK: boolean = true;
