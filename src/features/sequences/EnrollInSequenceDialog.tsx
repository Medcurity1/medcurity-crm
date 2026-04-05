import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSequences, useEnrollInSequence } from "./sequences-api";
import { useAuth } from "@/features/auth/AuthProvider";

interface EnrollInSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string | null;
  contactId?: string | null;
  accountId?: string | null;
}

export function EnrollInSequenceDialog({
  open,
  onOpenChange,
  leadId,
  contactId,
  accountId,
}: EnrollInSequenceDialogProps) {
  const { profile } = useAuth();
  const { data: sequences } = useSequences();
  const enrollMutation = useEnrollInSequence();
  const [selectedId, setSelectedId] = useState<string>("");

  const activeSequences = (sequences ?? []).filter((s) => s.is_active);
  const selected = activeSequences.find((s) => s.id === selectedId);

  async function handleEnroll() {
    if (!selectedId) {
      toast.error("Select a sequence first");
      return;
    }
    try {
      await enrollMutation.mutateAsync({
        sequence_id: selectedId,
        lead_id: leadId ?? null,
        contact_id: contactId ?? null,
        account_id: accountId ?? null,
        owner_user_id: profile?.id ?? null,
      });
      toast.success("Enrolled in sequence");
      setSelectedId("");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to enroll: " + (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            Enroll in Sequence
          </DialogTitle>
          <DialogDescription>
            Add this record to an automated outreach cadence.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sequence-select">Sequence</Label>
            {!activeSequences.length ? (
              <p className="text-sm text-muted-foreground">
                No active sequences. Create one first.
              </p>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger id="sequence-select">
                  <SelectValue placeholder="Select a sequence" />
                </SelectTrigger>
                <SelectContent>
                  {activeSequences.map((seq) => (
                    <SelectItem key={seq.id} value={seq.id}>
                      {seq.name} ({seq.steps.length} steps)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selected && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {selected.description && (
                <p className="text-muted-foreground mb-2">
                  {selected.description}
                </p>
              )}
              <p className="font-medium">
                {selected.steps.length} step
                {selected.steps.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleEnroll}
            disabled={!selectedId || enrollMutation.isPending}
          >
            {enrollMutation.isPending ? "Enrolling..." : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
