import { useSyncExternalStore } from "react";

// Tiny module-level pub/sub so the sidebar's secret trigger (triple-click the
// Opportunities nav label) can launch Deal Merger regardless of what's
// mounted. The game component only renders while `open` is true, so it costs
// nothing when idle. Same pattern as pipeline-runner and meddy-sweeper.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const dealMerger = {
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

export function useDealMergerOpen(): boolean {
  return useSyncExternalStore(dealMerger.subscribe, dealMerger.isOpen, () => false);
}
