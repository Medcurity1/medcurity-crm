export type SmartleadRefreshResult = {
  created?: number;
  updated?: number;
  synced?: number;
  capped?: number;
  enrollments_updated?: number;
  enrollments_deferred?: number;
  tasks_cancelled?: number;
};

export function formatSmartleadRefreshToast(r: SmartleadRefreshResult): {
  message: string;
  warning: boolean;
} {
  const created = r.created ?? 0;
  const updated = r.updated ?? 0;
  const synced = r.synced ?? 0;
  const capped = r.capped ?? 0;
  const flipped = r.enrollments_updated ?? 0;
  const deferred = r.enrollments_deferred ?? 0;
  const parts: string[] = [];

  if (created || updated) {
    parts.push(`Imported ${created} new, refreshed ${updated}.`);
  } else if (synced) {
    parts.push(`Synced ${synced} campaign${synced === 1 ? "" : "s"}.`);
  } else {
    parts.push("Smartlead is up to date.");
  }

  if (flipped) {
    parts.push(
      `${flipped} ${flipped === 1 ? "person is" : "people are"} no longer blocked by a stopped or finished campaign.`,
    );
  }
  if (deferred) {
    parts.push(
      `${deferred} ${deferred === 1 ? "person still has" : "people still have"} a call or LinkedIn task, so they stay enrolled until that work is done.`,
    );
  }
  if (capped) {
    parts.push(`${capped} campaign${capped === 1 ? "" : "s"} will finish on the next sync.`);
  }

  return {
    message: parts.join(" "),
    warning: capped > 0 || deferred > 0,
  };
}
