import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Warning modal shown by useIdleLogout when the session is about to end.
 * User clicks "Stay signed in" to reset the idle timer; otherwise they
 * get signed out when secondsRemaining reaches 0.
 */
export function IdleWarningDialog({
  open,
  secondsRemaining,
  onStay,
}: {
  open: boolean;
  secondsRemaining: number;
  onStay: () => void;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You're about to be signed out</AlertDialogTitle>
          <AlertDialogDescription>
            For your security, you'll be signed out after {secondsRemaining}{" "}
            second{secondsRemaining === 1 ? "" : "s"} of inactivity. Click
            below to stay signed in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onStay}>
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
