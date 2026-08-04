import { useCallback, useRef, useState } from "react";
import { MessageSquarePlus, Palette, Package, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  { value: "collateral", label: "Collateral", icon: Palette },
  { value: "product", label: "Product", icon: Package },
  { value: "crm", label: "CRM", icon: Wrench },
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
  initialTab: RequestTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RequestTab>(initialTab);
  // Ref, not state: dirtiness changes on every keystroke and nothing needs to
  // re-render for it — it's only read at close/switch time.
  const dirtyRef = useRef(false);
  const handleDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  // A close or tab-switch attempted while the form holds unsubmitted input
  // parks here until the discard confirmation resolves it.
  const [pending, setPending] = useState<
    null | { kind: "close" } | { kind: "switch"; tab: RequestTab }
  >(null);

  function attemptClose() {
    if (dirtyRef.current) setPending({ kind: "close" });
    else onClose();
  }

  function attemptSwitch(next: RequestTab) {
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
          className="gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        >
          {/* Ember header band — deliberately warm so Requests reads as its
              own thing, distinct from the violet/blue reserved for AI
              features (Nathan, 8/4). */}
          <div className="relative overflow-hidden px-6 pb-4 pt-5 text-white">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-red-500 to-rose-600" />
            <div className="absolute -right-8 -top-12 h-40 w-40 rounded-full bg-amber-300/40 blur-3xl" />
            <div className="absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-rose-300/40 blur-3xl" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-white">
                    <MessageSquarePlus className="h-5 w-5" />
                    Submit a request
                  </DialogTitle>
                  <DialogDescription className="mt-0.5 text-sm text-white/85">
                    It goes straight to the right person — no hunting for who to ask.
                  </DialogDescription>
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
              <div className="mt-4 flex w-fit gap-1 rounded-full bg-white/15 p-1 backdrop-blur-sm">
                {TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => attemptSwitch(t.value)}
                    aria-pressed={tab === t.value}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                      tab === t.value
                        ? "bg-white text-orange-700 shadow-sm"
                        : "text-white/85 hover:bg-white/10",
                    )}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Scrolling form body. Padding is load-bearing: FormFooter's -mx-6
              assumes px-6 here, and the missing bottom padding is deliberate —
              it lets the sticky footer sit flush with the scrollport bottom so
              no strip of content can peek out beneath it (Nathan, 8/4). */}
          <div className="max-h-[min(62vh,560px)] overflow-y-auto px-6 pt-5">
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
                ? "You've started filling this out. Switching forms will clear what you've typed."
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
