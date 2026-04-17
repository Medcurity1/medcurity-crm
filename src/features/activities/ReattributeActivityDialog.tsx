import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useReattributeActivity } from "./api";
import { errorMessage } from "@/lib/errors";
import type { Activity } from "@/types/crm";

interface ReattributeActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
}

interface OppOption {
  id: string;
  name: string;
  stage: string;
  kind: string;
}

/**
 * Lets a user move an activity (usually email) to a different opportunity
 * on the same account, or unlink it from an opp entirely. Solves Brayden's
 * SRA/NVA case: automation picks the wrong opp based on recency, user
 * fixes it in one click without leaving the activity row.
 *
 * Shows ALL opps on the account (open + closed) because reps sometimes
 * want to back-attribute to a closed_won opp when the customer emails
 * about a past purchase. We order open first, then closed.
 */
export function ReattributeActivityDialog({
  open,
  onOpenChange,
  activity,
}: ReattributeActivityDialogProps) {
  const [selectedOppId, setSelectedOppId] = useState<string>(
    activity.opportunity_id ?? "__none__"
  );
  const reattribute = useReattributeActivity();

  // Reset state whenever the dialog opens for a different activity.
  useEffect(() => {
    if (open) {
      setSelectedOppId(activity.opportunity_id ?? "__none__");
    }
  }, [open, activity.opportunity_id]);

  const { data: opps, isLoading } = useQuery({
    queryKey: ["account_opps_for_reattribute", activity.account_id],
    queryFn: async () => {
      if (!activity.account_id) return [];
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, kind")
        .eq("account_id", activity.account_id)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OppOption[];
    },
    enabled: open && !!activity.account_id,
  });

  async function handleSave() {
    const target = selectedOppId === "__none__" ? null : selectedOppId;
    try {
      await reattribute.mutateAsync({ id: activity.id, opportunityId: target });
      toast.success(
        target ? "Activity re-attributed" : "Activity unlinked from opportunity"
      );
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to re-attribute: " + errorMessage(err));
    }
  }

  const openOpps = (opps ?? []).filter(
    (o) => o.stage !== "closed_won" && o.stage !== "closed_lost"
  );
  const closedOpps = (opps ?? []).filter(
    (o) => o.stage === "closed_won" || o.stage === "closed_lost"
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-attribute Activity</DialogTitle>
          <DialogDescription>
            Move this activity to a different opportunity on the account, or
            unlink it so it lives at the account level only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="reattr-opp-select">Opportunity</Label>
          <Select value={selectedOppId} onValueChange={setSelectedOppId}>
            <SelectTrigger id="reattr-opp-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No opportunity (account-level only)</SelectItem>
              {openOpps.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                    Open
                  </div>
                  {openOpps.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </>
              )}
              {closedOpps.length > 0 && (
                <>
                  <div className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                    Closed
                  </div>
                  {closedOpps.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          {isLoading && (
            <p className="text-xs text-muted-foreground">Loading opportunities...</p>
          )}
          {!isLoading && !activity.account_id && (
            <p className="text-xs text-destructive">
              This activity isn't linked to any account, so there's no opp list
              to pick from.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={reattribute.isPending || !activity.account_id}
          >
            {reattribute.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
