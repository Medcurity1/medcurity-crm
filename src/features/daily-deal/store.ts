import { useSyncExternalStore } from "react";

// Tiny module-level pub/sub so the sidebar's secret trigger (triple-click the
// Nexus nav label) can launch The Daily Deal regardless of what's mounted.
// Same pattern as pipeline-runner / meddy-sweeper / deal-merger.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const dailyDeal = {
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

export function useDailyDealOpen(): boolean {
  return useSyncExternalStore(dailyDeal.subscribe, dailyDeal.isOpen, () => false);
}
