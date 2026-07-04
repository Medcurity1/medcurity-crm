import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Light unsaved-changes guard for the big edit forms.
 *
 * The app runs on a plain <BrowserRouter> (not a data router), so
 * react-router's useBlocker/usePrompt are unavailable — we can't
 * intercept in-app navigation generally. What this DOES cover:
 *   - hard exits (tab close, refresh, external nav) via `beforeunload`
 *     (that one is necessarily the browser's own prompt)
 *   - the forms' explicit Cancel buttons via `confirmIfDirty(fn)`, which
 *     now opens a styled Pulse ConfirmDialog (render the returned
 *     `dialog` node in the form)
 *
 * Call `disarm()` right before an intentional post-save navigate() so a
 * successful save never trips the guard.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const disarmedRef = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

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

  /** Run `fn` immediately when clean; ask first (styled dialog) when dirty. */
  const confirmIfDirty = useCallback((fn: () => void) => {
    if (dirtyRef.current && !disarmedRef.current) {
      setPending(() => fn);
    } else {
      fn();
    }
  }, []);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Discard unsaved changes?"
      description="You have unsaved edits on this form. If you leave now, they'll be lost."
      confirmLabel="Discard changes"
      destructive
      onConfirm={() => {
        const fn = pending;
        setPending(null);
        fn?.();
      }}
    />
  );

  return { confirmIfDirty, disarm, dialog };
}
