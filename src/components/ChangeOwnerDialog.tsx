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
  onConfirm: (newOwnerId: string) => void;
  title?: string;
}

export function ChangeOwnerDialog({
  open,
  onOpenChange,
  currentOwnerId,
  onConfirm,
  title = "Change Owner",
}: ChangeOwnerDialogProps) {
  const { data: users } = useUsers();
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  useEffect(() => {
    if (open && currentOwnerId) {
      setSelectedUserId(currentOwnerId);
    }
  }, [open, currentOwnerId]);

  function handleConfirm() {
    if (!selectedUserId) return;
    onConfirm(selectedUserId);
    onOpenChange(false);
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
                  {user.full_name ?? user.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedUserId}>
            Change Owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
