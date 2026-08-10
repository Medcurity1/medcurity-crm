import type { BugClassification } from "./api";

/**
 * MSD-999 (Rachel + Makena, 2026-08-10): client-facing BUGS keep the fast
 * path straight to the dev team — but only actual, time-sensitive bugs.
 * When the classifier read the report as a request/enhancement instead of a
 * defect and the submitter still picks "Yes — a client is affected", the form
 * shows an are-you-sure warning steering it to review. The submitter can
 * bypass it (they may know better), and the bypass is stamped on the ticket.
 *
 * Pure predicate, split out of RequestsPage so it can be tested. Rules:
 *  - no verdict, or a timed-out/degraded one → never warn (there is no read
 *    to warn from; nagging on a model hiccup would train people to ignore it)
 *  - warn only when the submitter is choosing the straight-to-dev path
 *    (clientFacing true) AND the classifier explicitly said not-a-bug
 *  - once bypassed for this verdict, stay quiet (editing the report
 *    invalidates the verdict, which also resets the bypass)
 */
export function shouldWarnNotABug(
  verdict: BugClassification | null | undefined,
  choosingClientFacing: boolean,
  alreadyBypassed: boolean,
): boolean {
  if (!verdict || verdict.timedOut || verdict.degraded) return false;
  if (!choosingClientFacing || alreadyBypassed) return false;
  // Missing field (older Helm build) coerces to true = looks like a bug.
  return verdict.looksLikeBug === false;
}
