import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Shared discard-confirmation guard for form Dialogs.
 *
 * Radix Dialogs close on outside-click and Escape by default, which
 * silently wipes half-typed work — Nathan, 2026-08-17: "are you sure you
 * want to leave, this erases anything you've written." This hook is the
 * one shared fix, meant to be dropped into any Dialog that holds real
 * typed/selected content.
 *
 * Why wrapping onOpenChange is enough (no onInteractOutside/onEscapeKeyDown
 * needed): per @radix-ui/react-dialog's source, the X close button
 * (DialogClose's onClick) AND the DismissableLayer's onDismiss (Escape,
 * outside click) all funnel through the SAME `context.onOpenChange(false)`
 * call, which is exactly the `onOpenChange` prop passed to `<Dialog>`.
 * Guarding that one seam covers every dismissal path at once — including
 * the X button, which the older onInteractOutside/onEscapeKeyDown pattern
 * used by a handful of activity dialogs does NOT cover (Radix's built-in
 * X is a separate code path from those two handlers).
 *
 * Pattern lifted from RequestDialog.tsx's attemptClose/pending mechanism
 * (already shipped, 2026-08-04), generalized here for reuse.
 *
 * Usage:
 *   const discard = useDialogDiscardGuard(isDirty, () => onOpenChange(false));
 *   <Dialog open={open} onOpenChange={discard.guardedOnOpenChange}>
 *     <DialogContent>
 *       ...
 *       <Button onClick={discard.requestClose}>Cancel</Button>
 *     </DialogContent>
 *   </Dialog>
 *   {discard.dialog}
 *
 * `guardedOnOpenChange` is a drop-in replacement for the Dialog's own
 * `onOpenChange` prop — it transparently covers X/Escape/outside-click.
 * `requestClose` is what an explicit Cancel/X button (or any other
 * "close this dialog" affordance, e.g. a custom header X) should call so
 * it goes through the same gate. When `dirty` is false the close/cancel
 * happens immediately, exactly like before this hook existed — only a
 * true in-progress edit trips the confirm.
 *
 * `onClose` is whatever "actually close now" means for that dialog —
 * usually `() => onOpenChange(false)`, but if the dialog resets its own
 * form state on close (e.g. `handleClose(false)`), pass that instead so
 * the reset still happens once discard is confirmed.
 */
export function useDialogDiscardGuard(dirty: boolean, onClose: () => void) {
  // Refs so requestClose/guardedOnOpenChange can stay referentially stable
  // across renders while always reading the latest dirty/onClose — same
  // pattern as useUnsavedChanges.tsx's dirtyRef.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Ask to close: closes immediately when clean, confirms first when dirty. */
  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmOpen(true);
    } else {
      onCloseRef.current();
    }
  }, []);

  /** Drop-in replacement for a Dialog's `onOpenChange` prop. */
  const guardedOnOpenChange = useCallback(
    (next: boolean) => {
      // Opening is never guarded — only close attempts (next === false) are.
      // (These dialogs are all externally controlled/no DialogTrigger inside,
      // so Radix only ever calls this with false, but stay defensive.)
      if (!next) requestClose();
    },
    [requestClose],
  );

  const dialog = (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(o) => {
        // Escape/outside-click on the CONFIRM itself is the safe "keep
        // writing" outcome, not a second discard — it just closes the
        // confirm and leaves the original dialog open.
        if (!o) setConfirmOpen(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard what you&apos;ve written?</AlertDialogTitle>
          <AlertDialogDescription>
            Closing this will erase everything you&apos;ve typed so far.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Radix auto-focuses AlertDialogCancel on open, so "Keep writing"
              is the keyboard/Enter default — matches the spec. */}
          <AlertDialogCancel>Keep writing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirmOpen(false);
              onCloseRef.current();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestClose, guardedOnOpenChange, dialog };
}
