import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Account, Contact } from "@/types/crm";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUpdateAccount } from "./api";
import { StatusBadge } from "@/components/StatusBadge";
import { salesStatusLabel, formatName } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PicklistSelect } from "@/features/picklists/PicklistSelect";
import { AddToListDialog } from "@/features/lead-lists/AddToListDialog";

/** Read-only sales-status chip (kept for non-write roles + other callers). */
export function SalesStatusChip({
  salesActive,
  salesStatus,
}: {
  salesActive: boolean;
  salesStatus: string | null;
}) {
  return (
    <StatusBadge
      value={salesActive ? salesStatus ?? "" : "inactive"}
      variant="salesStatus"
      label={salesActive ? (salesStatus ? salesStatusLabel(salesStatus) : "Active") : "Inactive"}
    />
  );
}

/**
 * Clickable sales-status control (Summer 7/16: "the active toggle at the
 * top of the screen... I see it listed, but it is not clickable").
 *
 * Click the chip → popover with the Active toggle, sub-status, and
 * follow-up date (required when flipping to Active, mirroring the edit
 * form's rule). Also offers "Add contacts to a list" — the native way
 * accounts activate (list membership auto-activates via
 * trg_list_member_sales_active), including creating a NEW list, which
 * any user may do (lists are per-owner).
 */
export function SalesStatusControl({ account }: { account: Account }) {
  const { profile } = useAuth();
  const canWrite = !!profile?.role && profile.role !== "read_only";
  const updateMutation = useUpdateAccount();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(account.sales_active ?? false);
  const [subStatus, setSubStatus] = useState(account.sales_status ?? "");
  const [followUp, setFollowUp] = useState(account.next_follow_up_date ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [listDialogOpen, setListDialogOpen] = useState(false);

  // Same key as the AccountContacts panel — shares its cache.
  const { data: contacts } = useQuery({
    queryKey: ["account-contacts", account.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("account_id", account.id)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
    enabled: pickerOpen,
  });

  if (!canWrite) {
    return (
      <SalesStatusChip
        salesActive={account.sales_active ?? false}
        salesStatus={account.sales_status ?? null}
      />
    );
  }

  function resetDraft() {
    setActive(account.sales_active ?? false);
    setSubStatus(account.sales_status ?? "");
    setFollowUp(account.next_follow_up_date ?? "");
  }

  const activating = active && !(account.sales_active ?? false);

  async function save() {
    // Mirror the edit form's rule: the save that PUTS an account into the
    // actively-worked state must set a follow-up date (already-active
    // accounts without one are grandfathered).
    if (activating && !followUp) {
      toast.error("Set a Next Follow Up Date — active accounts need one.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: account.id,
        sales_active: active,
        sales_status: subStatus === "" ? null : subStatus,
        // Going inactive clears the date (the DB trigger does too).
        next_follow_up_date: active ? (followUp === "" ? null : followUp) : null,
      } as Parameters<typeof updateMutation.mutateAsync>[0]);
      toast.success(active ? "Account marked Active" : "Account marked Inactive");
      setOpen(false);
    } catch (err) {
      toast.error("Failed to update: " + (err as Error).message);
    }
  }

  function togglePicked(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) resetDraft();
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded-md hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-ring"
            title="Change sales status"
          >
            <SalesStatusChip
              salesActive={account.sales_active ?? false}
              salesStatus={account.sales_status ?? null}
            />
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              id="quick-sales-active"
              checked={active}
              onCheckedChange={(v) => setActive(v === true)}
            />
            <Label htmlFor="quick-sales-active" className="cursor-pointer text-sm">
              {active ? "Active — being worked" : "Inactive"}
            </Label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sub-Status</Label>
            <PicklistSelect
              fieldKey="accounts.sales_status"
              value={subStatus || null}
              onChange={(v) => setSubStatus(v ?? "")}
              allowClear
              placeholder="Select…"
              disabled={!active}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Next Follow Up Date
              {activating && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            <Input
              type="date"
              value={followUp ?? ""}
              onChange={(e) => setFollowUp(e.target.value)}
              disabled={!active}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
          <div className="border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Or work it through a call list — adding a contact to a working
              call list marks the account Active automatically.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setPickedIds(new Set());
                setOpen(false);
                setPickerOpen(true);
              }}
            >
              <ListPlus className="h-4 w-4 mr-1" />
              Add contacts to a list…
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Step 1: pick which of the account's contacts go on the list. */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add contacts to a list</DialogTitle>
            <DialogDescription>
              Pick who to work from {account.name}. You'll choose (or create)
              the list next — adding them marks this account Active.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[40vh] space-y-1 overflow-y-auto">
            {contacts === undefined ? (
              <p className="text-sm text-muted-foreground">Loading contacts…</p>
            ) : contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No contacts on this account yet — add a contact first.
              </p>
            ) : (
              contacts.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={pickedIds.has(c.id)}
                    onCheckedChange={() => togglePicked(c.id)}
                  />
                  <span className="text-sm">
                    {formatName(c.first_name, c.last_name)}
                    {c.is_primary && (
                      <span className="ml-1 text-xs text-muted-foreground">(primary)</span>
                    )}
                    {c.title && (
                      <span className="ml-1 text-xs text-muted-foreground">— {c.title}</span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pickedIds.size === 0}
              onClick={() => {
                setPickerOpen(false);
                setListDialogOpen(true);
              }}
            >
              Next: choose list ({pickedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: the existing list picker (create-new included). */}
      <AddToListDialog
        open={listDialogOpen}
        onOpenChange={setListDialogOpen}
        contactIds={Array.from(pickedIds)}
        defaultWorking
        filterWorking
      />
    </>
  );
}
