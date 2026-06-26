// The Quick Task global shortcut is user-configurable (My Settings → Preferences)
// because Ctrl+Space collides with the macOS "switch input source" shortcut for
// some users. Stored per-device in localStorage via useUserPreferences.

export type QuickTaskShortcut = "ctrl_space" | "mod_j" | "mod_shift_space";

export const QUICK_TASK_SHORTCUTS: {
  value: QuickTaskShortcut;
  label: string;
  /** Key chips for the help dialog / settings preview. */
  keys: string[];
}[] = [
  { value: "ctrl_space", label: "Ctrl + Space", keys: ["Ctrl", "Space"] },
  { value: "mod_j", label: "⌘ J  (Mac)  /  Ctrl + J", keys: ["⌘ / Ctrl", "J"] },
  { value: "mod_shift_space", label: "⌘ ⇧ Space  /  Ctrl + Shift + Space", keys: ["⌘ / Ctrl", "⇧", "Space"] },
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
