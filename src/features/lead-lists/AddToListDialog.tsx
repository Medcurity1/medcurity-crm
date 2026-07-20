import { useEffect, useState } from "react";
import { ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useLeadLists,
  useCreateLeadList,
  useBulkAddContactsToList,
} from "./lead-lists-api";

/**
 * Add one or more CONTACTS to a static lead list — pick an existing list
 * or create a new one inline. Shared by the Contacts list bulk action and
 * the Contact detail header. Duplicate memberships no-op; the toast
 * reports how many were actually added vs already on the list.
 */
export function AddToListDialog({
  open,
  onOpenChange,
  contactIds,
  onAdded,
  defaultWorking = false,
  filterWorking = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactIds: string[];
  /** Called after a successful add (e.g. to clear a bulk selection). */
  onAdded?: () => void;
  /** Inline-created lists get is_working_list = this. The Sales Status
   * work-it-through-a-call-list flow passes true. */
  defaultWorking?: boolean;
  /** Show only working call lists (that flow promises activation, and a
   * neutral list would not deliver it). */
  filterWorking?: boolean;
}) {
  const { profile } = useAuth();
  const { data: lists } = useLeadLists();
  const createMutation = useCreateLeadList();
  const bulkAdd = useBulkAddContactsToList();
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (open) setNewName("");
  }, [open]);

  const staticLists = (lists ?? [])
    .filter((l) => !l.is_dynamic && (!filterWorking || l.is_working_list))
    .sort((a, b) => a.name.localeCompare(b.name));

  const isPending = bulkAdd.isPending || createMutation.isPending;

  async function addTo(listId: string) {
    if (!contactIds.length) return;
    try {
      const res = await bulkAdd.mutateAsync({
        list_id: listId,
        contact_ids: contactIds,
      });
      const skipped = res.requested - res.added;
      toast.success(
        res.added > 0
          ? `Added ${res.added} contact${res.added === 1 ? "" : "s"}${
              skipped > 0 ? ` (${skipped} already on list)` : ""
            }`
          : "All selected contacts are already on that list",
      );
      onAdded?.();
      onOpenChange(false);
    } catch {
      toast.error("Failed to add to list");
    }
  }

  async function handleCreateAndAdd() {
    if (!newName.trim()) {
      toast.error("List name is required");
      return;
    }
    let listId: string;
    try {
      const list = await createMutation.mutateAsync({
        name: newName.trim(),
        owner_user_id: profile!.id,
        is_dynamic: false,
        is_working_list: defaultWorking,
      });
      listId = list.id;
    } catch {
      toast.error("Failed to create list");
      return;
    }
    await addTo(listId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add {contactIds.length} contact{contactIds.length === 1 ? "" : "s"} to a list
          </DialogTitle>
          <DialogDescription>
            {filterWorking
              ? "Pick a working call list (or create one) - adding contacts marks their accounts as actively worked."
              : "Pick a list, or create a new one. Regular lists never change anyone's status; smart lists update themselves and can't be added to by hand."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {!staticLists.length ? (
            <p className="text-sm text-muted-foreground">
              No static lists yet — create one below.
            </p>
          ) : (
            staticLists.map((l) => (
              <Button
                key={l.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => addTo(l.id)}
                disabled={isPending}
              >
                <ListChecks className="h-4 w-4 mr-2" />
                {l.name}
              </Button>
            ))
          )}
        </div>
        <div className="border-t pt-3">
          <Label htmlFor="new-list-name" className="text-xs">
            Or create a new list
          </Label>
          <div className="flex gap-2 mt-1">
            <Input
              id="new-list-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., October cold call list"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateAndAdd();
                }
              }}
            />
            <Button
              onClick={handleCreateAndAdd}
              disabled={!newName.trim() || isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
