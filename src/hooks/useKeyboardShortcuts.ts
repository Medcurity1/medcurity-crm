import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  matchesQuickTaskShortcut,
  DEFAULT_QUICK_TASK_SHORTCUT,
  type QuickTaskShortcut,
} from "@/lib/quick-task-shortcut";

interface KeyboardShortcutsOptions {
  onQuickCreate: () => void;
  onShowHelp: () => void;
  onQuickTask: () => void;
  onAskAi: () => void;
  /** User-chosen Quick Task shortcut (My Settings → Preferences). */
  quickTaskShortcut?: QuickTaskShortcut;
}

/**
 * Registers global keyboard shortcuts:
 * - Cmd+N / Ctrl+N  -- Quick Create dialog
 * - <configurable>  -- Quick Task capture (default Ctrl+Space; works even while
 *                      typing). User-configurable because Ctrl+Space collides
 *                      with the macOS input-source switcher for some.
 * - Cmd+/ / Ctrl+/  -- Keyboard shortcuts help
 * - G then H/A/L/O/P/R -- Navigation chords
 */
export function useKeyboardShortcuts({
  onQuickCreate,
  onShowHelp,
  onQuickTask,
  onAskAi,
  quickTaskShortcut = DEFAULT_QUICK_TASK_SHORTCUT,
}: KeyboardShortcutsOptions) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearGChord = useCallback(() => {
    pendingG.current = false;
    if (gTimer.current) {
      clearTimeout(gTimer.current);
      gTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function isInputFocused(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+N / Ctrl+N -- Quick Create
      if (mod && e.key === "n") {
        e.preventDefault();
        onQuickCreate();
        clearGChord();
        return;
      }

      // Quick Task capture (user-configurable shortcut). Handled BEFORE the
      // input-focus check so a task can be jotted without leaving the current
      // field.
      if (matchesQuickTaskShortcut(e, quickTaskShortcut)) {
        e.preventDefault();
        onQuickTask();
        clearGChord();
        return;
      }

      // Cmd+/ / Ctrl+/ -- Shortcuts help
      if (mod && e.key === "/") {
        e.preventDefault();
        onShowHelp();
        clearGChord();
        return;
      }

      // Skip chord navigation if user is typing in an input
      if (isInputFocused()) return;

      // G-chord navigation (two-key: press G, then second key within 1s)
      if (!mod && !e.altKey && !e.shiftKey) {
        if (e.key === "g" || e.key === "G") {
          if (!pendingG.current) {
            pendingG.current = true;
            gTimer.current = setTimeout(clearGChord, 1000);
            return;
          }
        }

        if (pendingG.current) {
          clearGChord();
          // "G then I" opens Ask AI (an action, not a route).
          if (e.key.toLowerCase() === "i") {
            e.preventDefault();
            onAskAi();
            return;
          }
          const routes: Record<string, string> = {
            h: "/",
            a: "/accounts",
            l: "/imports",
            o: "/opportunities",
            p: "/pipeline",
            r: "/reports",
          };
          const route = routes[e.key.toLowerCase()];
          if (route) {
            e.preventDefault();
            navigate(route);
          }
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearGChord();
    };
  }, [navigate, onQuickCreate, onShowHelp, onQuickTask, onAskAi, quickTaskShortcut, clearGChord]);
}
