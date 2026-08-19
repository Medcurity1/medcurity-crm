// Pure planner for closing stale active enrollments when the parent
// campaign is already stopped or completed. Used by interactive Smartlead
// sync and the daily sweep so both paths make the same decision.
//
// Stopped: a human (or Smartlead) killed the campaign — flip remaining
// active enrollments and archive pending call/LinkedIn tasks.
// Completed: sending finished, but later manual touches may still be due —
// only flip enrollments whose pending campaign tasks are done; defer the
// rest so a later reply/unsubscribe can still land.

export type TerminalEnrollmentPlan = {
  flipIds: string[];
  archiveTaskIds: string[];
  deferredIds: string[];
};

export function planTerminalEnrollmentReconcile(input: {
  parentStatus: string;
  activeEnrollmentIds: string[];
  pendingTaskEnrollmentIds?: Iterable<string>;
}): TerminalEnrollmentPlan {
  const active = input.activeEnrollmentIds;
  if (input.parentStatus === "stopped") {
    return {
      flipIds: [...active],
      archiveTaskIds: [...active],
      deferredIds: [],
    };
  }
  if (input.parentStatus !== "completed") {
    return { flipIds: [], archiveTaskIds: [], deferredIds: [] };
  }
  const pending = new Set(input.pendingTaskEnrollmentIds ?? []);
  const flipIds = active.filter((id) => !pending.has(id));
  const deferredIds = active.filter((id) => pending.has(id));
  return { flipIds, archiveTaskIds: [], deferredIds };
}
