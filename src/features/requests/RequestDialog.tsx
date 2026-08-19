import { useCallback, useRef, useState } from "react";
import { ArrowLeft, MessageSquarePlus, Palette, Package, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import { CollateralForm, ProductForm, CrmForm, type RequestTab } from "./RequestForms";

const TABS: Array<{ value: RequestTab; label: string; icon: typeof Palette }> = [
  { value: "product", label: "Product", icon: Package },
  { value: "crm", label: "CRM", icon: Wrench },
  { value: "collateral", label: "Collateral", icon: Palette },
];

/**
 * The Submit Request popup (replaces the /requests tab — Nathan, 2026-08-04).
 * Openable from anywhere via useRequestDialog(); mounted only while open, so
 * every open starts with a fresh form and this chunk stays lazy.
 *
 * Look: the "aurora" header band is this dialog's own personality (Nathan
 * explicitly OK'd tabs/dialogs having their own look). Body + forms stay on
 * the app's standard tokens so both themes work untouched.
 */
export function RequestDialog({
  initialTab,
  onClose,
}: {
  initialTab: RequestTab | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RequestTab | null>(initialTab);
  // Ref, not state: dirtiness changes on every keystroke and nothing needs to
  // re-render for it — it's only read at close/switch time.
  const dirtyRef = useRef(false);
  const handleDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  // A close or tab-switch attempted while the form holds unsubmitted input
  // parks here until the discard confirmation resolves it.
  const [pending, setPending] = useState<
    null | { kind: "close" } | { kind: "switch"; tab: RequestTab | null }
  >(null);

  function attemptClose() {
    if (dirtyRef.current) setPending({ kind: "close" });
    else onClose();
  }

  function attemptSwitch(next: RequestTab | null) {
    if (next === tab) return;
    if (dirtyRef.current) setPending({ kind: "switch", tab: next });
    else setTab(next);
  }

  function discardAndProceed() {
    if (!pending) return;
    if (pending.kind === "close") {
      setPending(null);
      onClose();
    } else {
      // The old form unmounts and reports dirty=false itself, but clear the
      // ref now so a fast follow-up close can't see a stale verdict.
      dirtyRef.current = false;
      setTab(pending.tab);
      setPending(null);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) attemptClose(); }}>
        <DialogContent
          showCloseButton={false}
          // No description on purpose (Nathan 8/4: redundant, and dropping it
          // slims the header); the explicit undefined opts out of Radix's
          // missing-Description warning.
          aria-describedby={undefined}
          className="gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        >
          {/* Ember header band — deliberately warm so Requests reads as its
              own thing, distinct from the violet/blue reserved for AI
              features (Nathan, 8/4). */}
          <div className="relative overflow-hidden px-6 pb-3.5 pt-4 text-white">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-red-500 to-rose-600" />
            <div className="absolute -right-8 -top-12 h-40 w-40 rounded-full bg-amber-300/40 blur-3xl" />
            <div className="absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-rose-300/40 blur-3xl" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  {tab ? (
                    <button
                      type="button"
                      aria-label="Back to request types"
                      onClick={() => attemptSwitch(null)}
                      className="rounded-full p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  ) : (
                    <MessageSquarePlus className="h-5 w-5 shrink-0" />
                  )}
                  <DialogTitle className="truncate text-lg font-semibold text-white">
                    {tab ? TABS.find((item) => item.value === tab)?.label : "Submit a request"}
                  </DialogTitle>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={attemptClose}
                  className="rounded-full p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          {/* Scrolling form body. Padding is load-bearing: FormFooter's -mx-6
              assumes px-6 here, and the missing bottom padding is deliberate —
              it lets the sticky footer sit flush with the scrollport bottom so
              no strip of content can peek out beneath it (Nathan, 8/4). */}
          <div className="max-h-[min(72vh,680px)] overflow-y-auto px-4 pt-5 sm:px-6">
            {tab === null && (
              <div className="grid gap-3 pb-6 sm:grid-cols-3" aria-label="Request type">
                {TABS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => attemptSwitch(item.value)}
                    className="flex min-h-24 items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-orange-500/60 hover:bg-orange-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:justify-center sm:text-center"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400">
                      <item.icon className="h-5 w-5" />
                    </span>
                    <span className="font-semibold">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "collateral" && (
              <CollateralForm onDirtyChange={handleDirty} onDone={onClose} />
            )}
            {tab === "product" && (
              <ProductForm onDirtyChange={handleDirty} onDone={onClose} />
            )}
            {tab === "crm" && <CrmForm onDirtyChange={handleDirty} onDone={onClose} />}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this request?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "switch"
                ? "You've started filling this out. Going back will clear what you've typed."
                : "You've started filling this out. Closing will discard what you've typed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndProceed}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
