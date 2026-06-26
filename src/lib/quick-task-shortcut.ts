// The Quick Task global shortcut is user-configurable (My Settings → Preferences)
// because Ctrl+Space collides with the macOS "switch input source" shortcut for
// some users. Stored per-device in localStorage via useUserPreferences.

export type QuickTaskShortcut = "ctrl_space" | "mod_j" | "mod_shift_space";

/**
 * Is this a Mac? The "mod" shortcuts below fire on EITHER Command or Ctrl, but
 * the label should name the key the user actually presses — Command on a Mac,
 * Ctrl on Windows/Linux — so we don't tell a Mac user to press "Ctrl + J" when
 * they're really pressing ⌘ J. Evaluated once at module load (platform is fixed
 * for the session).
 */
export const IS_MAC: boolean = (() => {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const p = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
})();

// Word + chip symbol for the "mod" key, per platform.
const MOD_WORD = IS_MAC ? "Command" : "Ctrl";
const MOD_CHIP = IS_MAC ? "⌘" : "Ctrl";

export const QUICK_TASK_SHORTCUTS: {
  value: QuickTaskShortcut;
  label: string;
  /** Key chips for the help dialog / settings preview. */
  keys: string[];
}[] = [
  // ctrl_space is literally the Control key on every platform (the matcher
  // requires ctrlKey && !metaKey), so it stays "Ctrl" even on a Mac.
  { value: "ctrl_space", label: "Ctrl + Space", keys: ["Ctrl", "Space"] },
  { value: "mod_j", label: `${MOD_WORD} + J`, keys: [MOD_CHIP, "J"] },
  {
    value: "mod_shift_space",
    label: `${MOD_WORD} + Shift + Space`,
    keys: [MOD_CHIP, "Shift", "Space"],
  },
];

export const DEFAULT_QUICK_TASK_SHORTCUT: QuickTaskShortcut = "ctrl_space";

/** Does this keydown match the configured Quick Task shortcut? */
export function matchesQuickTaskShortcut(e: KeyboardEvent, sc: QuickTaskShortcut): boolean {
  const mod = e.metaKey || e.ctrlKey;
  switch (sc) {
    case "ctrl_space":
      return e.ctrlKey && !e.metaKey && e.code === "Space";
    case "mod_j":
      return mod && (e.key === "j" || e.key === "J");
    case "mod_shift_space":
      return mod && e.shiftKey && e.code === "Space";
    default:
      return false;
  }
}

export function quickTaskShortcutLabel(sc: QuickTaskShortcut): string {
  return QUICK_TASK_SHORTCUTS.find((s) => s.value === sc)?.label ?? "Ctrl + Space";
}

export function quickTaskShortcutKeys(sc: QuickTaskShortcut): string[] {
  return QUICK_TASK_SHORTCUTS.find((s) => s.value === sc)?.keys ?? ["Ctrl", "Space"];
}
