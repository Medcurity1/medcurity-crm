import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetCustomerStatusOverride } from "./api";
import { toast } from "sonner";

export function CustomerStatusOverrideDialog({
  accountId,
  accountName,
  open,
  onOpenChange,
}: {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useSetCustomerStatusOverride();

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  async function save() {
    try {
      await mutation.mutateAsync({ accountId, override: "client", reason });
      toast.success(`${accountName} marked Customer.`);
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || "Could not update Account Status.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Customer?</DialogTitle>
          <DialogDescription>
            This overrides the automatic status until it is returned to automatic.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="customer-status-reason">Reason</Label>
          <Textarea
            id="customer-status-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: Active contract is not in Pulse yet"
            maxLength={300}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!reason.trim() || mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Mark Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
