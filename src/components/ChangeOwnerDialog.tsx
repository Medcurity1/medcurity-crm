import { useState, useEffect } from "react";
import { useUsers } from "@/features/accounts/api";
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
import { Button } from "@/components/ui/button";

interface ChangeOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOwnerId: string | null;
  /** May return a promise. When it does, the dialog stays open (button
   *  disabled) until it settles and closes only on success — on failure it
   *  stays open with the error visible. Callers should pass `mutateAsync`
   *  (which rejects on error) rather than fire-and-forget `mutate` so a
   *  failed write doesn't close the dialog as if it succeeded. */
  onConfirm: (newOwnerId: string) => void | Promise<unknown>;
  title?: string;
}

export function ChangeOwnerDialog({
  open,
  onOpenChange,
  currentOwnerId,
  onConfirm,
  title = "Change Owner",
}: ChangeOwnerDialogProps) {
  const { data: users } = useUsers(true);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && currentOwnerId) {
      setSelectedUserId(currentOwnerId);
    }
    if (open) setError(null);
  }, [open, currentOwnerId]);

  async function handleConfirm() {
    if (!selectedUserId || saving) return;
    setError(null);
    try {
      setSaving(true);
      // Await the write so we only dismiss on success. If onConfirm is
      // fire-and-forget (returns void) this resolves immediately as before.
      await onConfirm(selectedUserId);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the owner. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Select a new owner for this record.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an owner" />
            </SelectTrigger>
            <SelectContent>
              {users?.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.full_name ?? user.id}{!user.is_active ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedUserId || saving}>
            {saving ? "Changing…" : "Change Owner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
