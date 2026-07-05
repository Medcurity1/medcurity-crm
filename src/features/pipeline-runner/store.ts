import { useSyncExternalStore } from "react";

// Tiny module-level pub/sub so the sidebar's secret trigger can launch the
// game regardless of which component is mounted. The game component is only
// rendered while `open` is true, so it costs nothing when idle.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const pipelineRunner = {
  launch() {
    if (!open) {
      open = true;
      emit();
    }
  },
  close() {
    if (open) {
      open = false;
      emit();
    }
  },
  isOpen: () => open,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function usePipelineRunnerOpen(): boolean {
  return useSyncExternalStore(pipelineRunner.subscribe, pipelineRunner.isOpen, () => false);
}
