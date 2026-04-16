import { useEffect, useState } from "react";

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
}

const DEFAULTS: UserPreferences = {
  // Default to the Salesforce-style side-panel layout. Users who prefer the
  // original stacked layout can flip this in My Settings > Preferences.
  detailLayout: "side_panel",
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

export function useUserPreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readPrefs());

  useEffect(() => {
    writePrefs(prefs);
  }, [prefs]);

  function setPref<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  return { prefs, setPref };
}
