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

/** One-per-browser "the Requests tab moved up here" callout (Nathan, 8/4).
 * Shows until dismissed — one click on Got it, or just using the button,
 * silences it forever via localStorage. */
const CALLOUT_KEY = "requests_moved_callout_dismissed_v1";

function readCalloutDismissed(): boolean {
  try {
    return localStorage.getItem(CALLOUT_KEY) === "1";
  } catch {
    return true; // no storage → never nag repeatedly
  }
}

/** The top-bar "Submit Request" button — an ember-gradient pill. Warm on
 * purpose: purple/blue is the AI-features palette, so Requests gets its own
 * orangey-red identity (Nathan, 8/4). `data-tour` hook is for the future
 * Nexus walkthrough tile (docket D14). */
export function SubmitRequestButton() {
  const { openRequestDialog } = useRequestDialog();
  const [showCallout, setShowCallout] = useState(() => !readCalloutDismissed());
  const dismissCallout = useCallback(() => {
    setShowCallout(false);
    try {
      localStorage.setItem(CALLOUT_KEY, "1");
    } catch {
      /* fine — worst case it shows again next session */
    }
  }, []);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-tour="submit-request"
        onClick={() => {
          dismissCallout();
          openRequestDialog();
        }}
        title="Submit a request"
        className="gap-1.5 rounded-full border-orange-500/40 bg-gradient-to-r from-orange-500/10 via-red-500/10 to-rose-500/10 hover:border-orange-500/70 hover:from-orange-500/20 hover:via-red-500/20 hover:to-rose-500/20 dark:border-orange-400/40"
      >
        <MessageSquarePlus className="h-4 w-4 text-orange-600 dark:text-orange-400" />
        <span className="hidden sm:inline">Submit Request</span>
      </Button>
      {showCallout && (
        <div className="absolute right-0 top-full z-50 mt-3 w-72">
          {/* arrow */}
          <div className="absolute -top-1 right-8 h-2.5 w-2.5 rotate-45 bg-orange-500" />
          <div className="overflow-hidden rounded-xl bg-gradient-to-br from-orange-500 via-red-500 to-rose-600 p-4 text-white shadow-xl">
            <p className="text-sm font-semibold">Requests moved up here!</p>
            <p className="mt-1 text-xs text-white/90">
              The Requests tab is now this button. Same forms, same flow, but
              you can submit from any page.
            </p>
            <button
              type="button"
              onClick={dismissCallout}
              className="mt-3 rounded-full bg-white px-3 py-1 text-xs font-medium text-orange-700 shadow-sm transition-colors hover:bg-orange-50"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
