import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RequestTab } from "./RequestForms";

// The dialog (and with it the three forms + requests api) stays a lazy chunk,
// exactly as it was when it lived behind the lazy /requests route.
const RequestDialog = lazy(() =>
  import("./RequestDialog").then((m) => ({ default: m.RequestDialog })),
);

interface RequestDialogCtx {
  /** Open the Submit Request popup, optionally on a specific form. */
  openRequestDialog: (tab?: RequestTab) => void;
}

const RequestDialogContext = createContext<RequestDialogCtx | null>(null);

export function useRequestDialog(): RequestDialogCtx {
  const ctx = useContext(RequestDialogContext);
  if (!ctx) throw new Error("useRequestDialog must be used within RequestDialogProvider");
  return ctx;
}

/**
 * App-shell provider for the Submit Request popup (replaces the /requests
 * tab — Nathan, 2026-08-04). Mounted once in AppLayout so the popup opens
 * over ANY page: the header button, Nexus's "Something missing?", the legacy
 * /requests redirect, and the future Collateral page all call
 * useRequestDialog().openRequestDialog(tab).
 *
 * The dialog mounts only while open — fresh form state every open, and the
 * heavy chunk loads on first use.
 */
export function RequestDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tab: RequestTab }>({
    open: false,
    tab: "collateral",
  });
  const openRequestDialog = useCallback(
    (tab: RequestTab = "collateral") => setState({ open: true, tab }),
    [],
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ openRequestDialog }), [openRequestDialog]);

  return (
    <RequestDialogContext.Provider value={value}>
      {children}
      {state.open && (
        <Suspense fallback={null}>
          <RequestDialog initialTab={state.tab} onClose={close} />
        </Suspense>
      )}
    </RequestDialogContext.Provider>
  );
}

/** The top-bar "Submit Request" button — a gradient pill that stands out a
 * notch above its ghost-button neighbors (it's an invitation, not a utility). */
export function SubmitRequestButton() {
  const { openRequestDialog } = useRequestDialog();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => openRequestDialog()}
      title="Submit a request"
      className="gap-1.5 rounded-full border-violet-500/40 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 hover:border-violet-500/70 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-cyan-500/20 dark:border-violet-400/40"
    >
      <MessageSquarePlus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
      <span className="hidden sm:inline">Submit Request</span>
    </Button>
  );
}
