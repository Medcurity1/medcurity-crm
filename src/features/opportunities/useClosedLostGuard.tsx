import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Summer's request (2026-06-29): when a deal is marked Closed Lost for a
 * CURRENT CLIENT, pop a prompt asking whether the client is still contracted
 * with Medcurity, so the active → former transition isn't missed (it
 * "frequently was in Salesforce").
 *
 * Design notes:
 *  - NON-BLOCKING. The stage change to closed_lost proceeds exactly as before;
 *    this prompt fires AFTER a successful move, so it never stacks on or blocks
 *    the existing loss-reason / confirm dialogs.
 *  - It only appears when the account is CURRENTLY a Client (customer_status =
 *    'client'). Prospects / former clients are never asked.
 *  - "Still a client" does nothing: the automatic Customer Status already keeps
 *    them a Client (a closed-LOST deal isn't a closed-won, so it doesn't change
 *    the derivation — they still hold a live contract elsewhere, e.g. renewed
 *    the SRA but declined Training).
 *  - "Mark Former Client" records a rep-confirmed override via
 *    set_account_customer_status_override, flipping them to Former Client now
 *    even if a stale contract end date still reads as live.
 *
 * Usage: call `promptIfClient(accountId)` right after a successful transition
 * INTO closed_lost, and render `{dialog}` somewhere in the component.
 */
export function useClosedLostGuard() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ accountId: string; accountName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const promptIfClient = useCallback(async (accountId: string | null | undefined) => {
    if (!accountId) return;
    const { data, error } = await supabase
      .from("accounts")
      .select("name, customer_status")
      .eq("id", accountId)
      .maybeSingle();
    if (error || !data) return;
    if (data.customer_status === "client") {
      setPending({ accountId, accountName: (data.name as string) ?? "This account" });
    }
  }, []);

  const markFormer = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("set_account_customer_status_override", {
        p_account_id: pending.accountId,
        p_override: "former_client",
        p_reason: "Rep confirmed not contracted when closing a deal Lost",
      });
      if (error) throw error;
      toast.success(`${pending.accountName} marked Former Client.`);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts", pending.accountId] });
    } catch (e) {
      toast.error("Couldn't update customer status: " + (e as Error).message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [pending, qc]);

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Is {pending?.accountName ?? "this account"} still a client?</DialogTitle>
          <DialogDescription>
            {pending?.accountName ?? "This account"} is currently a Client and you just marked a
            deal Closed Lost. If they still have any active contract with Medcurity (for example,
            they declined this but kept another product), leave them as a Client. If they've fully
            ended their contract, mark them a Former Client.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
            Still a client
          </Button>
          <Button variant="destructive" onClick={markFormer} disabled={busy}>
            {busy ? "Saving…" : "Mark Former Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { promptIfClient, dialog };
}
