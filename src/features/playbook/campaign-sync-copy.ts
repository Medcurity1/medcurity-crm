export type SmartleadRefreshResult = {
  created?: number;
  updated?: number;
  synced?: number;
  attempted?: number;
  failed?: number;
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
  const attempted = r.attempted ?? synced;
  const failed = r.failed ?? 0;
  const flipped = r.enrollments_updated ?? 0;
  const deferred = r.enrollments_deferred ?? 0;
  const parts: string[] = [];

  if (created || updated) {
    parts.push(`Imported ${created} new, refreshed ${updated}.`);
  } else if (synced) {
    parts.push(`Synced ${synced} campaign${synced === 1 ? "" : "s"}.`);
  } else if (failed || capped) {
    parts.push("Smartlead sync finished partially.");
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
  if (failed) {
    parts.push(`${failed} of ${attempted} attempted campaign${attempted === 1 ? "" : "s"} could not be refreshed; retry to finish them.`);
  }

  return {
    message: parts.join(" "),
    warning: capped > 0 || deferred > 0 || failed > 0,
  };
}
