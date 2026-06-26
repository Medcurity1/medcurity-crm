import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface KeyboardShortcutsOptions {
  onQuickCreate: () => void;
  onShowHelp: () => void;
  onQuickTask: () => void;
}

/**
 * Registers global keyboard shortcuts:
 * - Cmd+N / Ctrl+N  -- Quick Create dialog
 * - Ctrl+Space      -- Quick Task capture (works even while typing; Summer's
 *                      Todoist-style "jot a task without leaving the screen")
 * - Cmd+/ / Ctrl+/  -- Keyboard shortcuts help
 * - G then H/A/L/O/P/R -- Navigation chords
 */
export function useKeyboardShortcuts({
  onQuickCreate,
  onShowHelp,
  onQuickTask,
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

      // Ctrl+Space -- Quick Task capture. Bound to Ctrl (not Cmd, which is
      // Spotlight on macOS) per Summer's Todoist muscle memory. Handled BEFORE
      // the input-focus check so she can jot a task without leaving the field
      // she's in. Uses e.code so it fires regardless of keyboard layout.
      if (e.ctrlKey && !e.metaKey && e.code === "Space") {
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
          const routes: Record<string, string> = {
            h: "/",
            a: "/accounts",
            l: "/leads",
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
  }, [navigate, onQuickCreate, onShowHelp, clearGChord]);
}
