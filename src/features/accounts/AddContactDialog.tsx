import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatName } from "@/lib/formatters";

interface ContactSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account_id: string | null;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The opportunity we're attaching a contact to. */
  opportunityId: string;
  /** The opp's home account_id — search results are restricted to
   *  contacts homed at this account, and "Create new" defaults the new
   *  contact's home account here. */
  accountId: string;
}

/**
 * "Add Contact" dialog for an Opportunity's Contacts tab.
 *
 * Behavior (decided 2026-05-14): contacts are 1:1 with accounts, so
 * the only contacts that can be added to an opp are ones already homed
 * at the opp's account. The picker filters to those — no cross-account
 * search, no multi-account linkage. If the person doesn't exist at
 * this account yet, "Create new contact" routes to the contact form
 * with account_id pre-filled.
 *
 * Account-level Contacts tabs no longer use this dialog at all; they
 * just send the user to /contacts/new?account_id=X to create.
 */
export function AddContactDialog({
  open,
  onOpenChange,
  opportunityId,
  accountId,
}: AddContactDialogProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ContactSearchResult | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
    }
  }, [open]);

  // Every contact homed at this account — used as the picker source and
  // to detect "already on this opp" by intersecting with existing links.
  const { data: accountContacts } = useQuery({
    queryKey: ["account-home-contacts", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, title, account_id")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as ContactSearchResult[];
    },
    enabled: open && !!accountId,
  });

  const { data: existingLinkIds } = useQuery({
    queryKey: ["contact-opportunity-links", opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_opportunity_links")
        .select("contact_id")
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r) => r.contact_id as string));
    },
    enabled: open,
  });

  // Local filter — accountContacts is bounded (one account's worth) so
  // we don't need server-side search; this is faster and avoids hitting
  // the DB on every keystroke.
  const filtered = useMemo(() => {
    const all = accountContacts ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      const haystack = [
        c.first_name ?? "",
        c.last_name ?? "",
        c.email ?? "",
        c.title ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accountContacts, search]);

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No contact selected");
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("contact_opportunity_links")
        .insert({
          contact_id: selected.id,
          opportunity_id: opportunityId,
          added_by: userRes.user?.id ?? null,
        });
      if (error) {
        if (error.code === "23505") {
          throw new Error("This contact is already on this opportunity.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Contact added");
      qc.invalidateQueries({ queryKey: ["opportunity-contacts", opportunityId] });
      qc.invalidateQueries({ queryKey: ["contact-opportunity-links", opportunityId] });
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const selectedAlreadyLinked =
    !!selected && !!existingLinkIds?.has(selected.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact to Opportunity</DialogTitle>
          <DialogDescription>
            Pick a contact already at this account, or create a new one.
            Only contacts homed at this account can be added.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-search">Find contact at this account</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="contact-search"
                placeholder="Search by name, email, or title…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                className="pl-9"
                autoFocus
              />
            </div>

            {!selected && filtered.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                {filtered.map((r) => {
                  const name =
                    formatName(r.first_name ?? "", r.last_name ?? "").trim() ||
                    r.email ||
                    "(no name)";
                  const alreadyHere = existingLinkIds?.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelected(r)}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-medium">{name}</span>
                        {alreadyHere && (
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            already on opp
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.title ? r.title : (r.email ?? "—")}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {!selected && (accountContacts?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">
                No contacts at this account yet. Use "Create new contact" below.
              </p>
            )}
            {!selected &&
              (accountContacts?.length ?? 0) > 0 &&
              filtered.length === 0 && (
                <p className="text-xs text-muted-foreground">No matches.</p>
              )}

            {selected && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-medium">
                      {formatName(
                        selected.first_name ?? "",
                        selected.last_name ?? "",
                      ).trim() ||
                        selected.email ||
                        "(no name)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selected.title ?? selected.email ?? "—"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelected(null);
                      setSearch("");
                    }}
                  >
                    Change
                  </Button>
                </div>
                {selectedAlreadyLinked && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    This contact is already on this opportunity.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate(`/contacts/new?account_id=${accountId}`);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Create new contact at this account
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !selected || selectedAlreadyLinked || linkMutation.isPending
            }
            onClick={() => linkMutation.mutate()}
          >
            {linkMutation.isPending ? "Adding…" : "Add to this opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
