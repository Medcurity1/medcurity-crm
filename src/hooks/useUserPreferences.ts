import { useSyncExternalStore } from "react";
import {
  DEFAULT_QUICK_TASK_SHORTCUT,
  type QuickTaskShortcut,
} from "@/lib/quick-task-shortcut";

/**
 * Client-side user preferences, persisted to localStorage.
 *
 * Add new keys here as we need them. The value is always read synchronously
 * from localStorage so the UI can render the right layout on first paint.
 */

const STORAGE_KEY = "medcurity_user_prefs";

export interface UserPreferences {
  /**
   * Layout for detail pages (Account, Opportunity, etc.).
   *   "stacked"    — classic layout: header, info cards, collapsible sections,
   *                  related tabs at the bottom. This is the default.
   *   "side_panel" — two-column: main record fields on the left, an activity
   *                  panel pinned to the right (Salesforce-style).
   */
  detailLayout: "stacked" | "side_panel";
  /** Global keyboard shortcut that opens the Quick Task dialog. */
  quickTaskShortcut: QuickTaskShortcut;
}

const DEFAULTS: UserPreferences = {
  // Default to the Salesforce-style side-panel layout. Users who prefer the
  // original stacked layout can flip this in My Settings > Preferences.
  detailLayout: "side_panel",
  quickTaskShortcut: DEFAULT_QUICK_TASK_SHORTCUT,
};

function readPrefs(): UserPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage disabled; skip
  }
}

/**
 * Module-level store shared by every useUserPreferences() consumer.
 *
 * Previously each call had its own useState, so changing a preference in
 * Settings updated only that component's copy — the global keyboard-shortcut
 * handler (mounted way up in AppLayout) kept the stale value until a full page
 * refresh. With a single store + useSyncExternalStore, a setPref anywhere
 * re-renders ALL consumers immediately, so e.g. switching the Quick Task
 * shortcut takes effect on the next keypress.
 */
let currentPrefs: UserPreferences = readPrefs();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Cross-tab sync: localStorage "storage" events fire in OTHER tabs only, so
// changing a pref in one tab keeps the rest in step.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      currentPrefs = readPrefs();
      emit();
    }
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): UserPreferences {
  return currentPrefs;
}

export function setPref<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K]
) {
  if (currentPrefs[key] === value) return;
  currentPrefs = { ...currentPrefs, [key]: value };
  writePrefs(currentPrefs);
  emit();
}

export function useUserPreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
  return { prefs, setPref };
}
