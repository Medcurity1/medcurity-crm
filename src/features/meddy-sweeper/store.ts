import { useSyncExternalStore } from "react";

// Module-level pub/sub so the sidebar's secret trigger (triple-click the
// Meddy nav label) can launch MeddySweeper regardless of what's mounted.
// The game component only renders while `open` is true, so it's free when idle.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const meddySweeper = {
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

export function useMeddySweeperOpen(): boolean {
  return useSyncExternalStore(meddySweeper.subscribe, meddySweeper.isOpen, () => false);
}
