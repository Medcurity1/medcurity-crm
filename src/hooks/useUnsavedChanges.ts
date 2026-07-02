import { useCallback, useEffect, useRef } from "react";

/**
 * Light unsaved-changes guard for the big edit forms.
 *
 * The app runs on a plain <BrowserRouter> (not a data router), so
 * react-router's useBlocker/usePrompt are unavailable — we can't
 * intercept in-app navigation generally. What this DOES cover:
 *   - hard exits (tab close, refresh, external nav) via `beforeunload`
 *   - the forms' explicit Cancel buttons via `confirmIfDirty(fn)`
 *
 * Call `disarm()` right before an intentional post-save navigate() so a
 * successful save never trips the browser's leave-page prompt.
 */
export function useUnsavedChanges(isDirty: boolean) {
  // Refs so the beforeunload listener (bound once) and confirmIfDirty
  // always see the latest state without re-binding on every keystroke.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const disarmedRef = useRef(false);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || disarmedRef.current) return;
      e.preventDefault();
      // Chrome still requires returnValue to be set for the prompt to show.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /** Disable the guard — call right before a deliberate post-save navigation. */
  const disarm = useCallback(() => {
    disarmedRef.current = true;
  }, []);

  /** Run `fn` immediately when clean; ask first when there are unsaved edits. */
  const confirmIfDirty = useCallback((fn: () => void) => {
    if (dirtyRef.current && !disarmedRef.current) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    fn();
  }, []);

  return { confirmIfDirty, disarm };
}
