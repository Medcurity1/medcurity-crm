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
import { buildPersonSearchClause } from "@/lib/search-clause";

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface ContactSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account_id: string | null;
  account: { id: string; name: string } | null;
}

/**
 * Records this dialog can attach a contact to. Adding a new mode here
 * means adding a new link table + the read-side logic in the relevant
 * tab component (see AccountContacts / OpportunityContacts).
 */
type RecordKind = "account" | "opportunity";

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record (account or opportunity) we're attaching the contact to. */
  recordKind: RecordKind;
  recordId: string;
  /** Optional: when adding from an Opportunity, we know the opp's
   *  account_id so the "Create new" fallback can default the contact's
   *  home account to that. From an Account page this is just the
   *  recordId. */
  defaultAccountIdForNewContact?: string;
}

/**
 * Dialog opened by the "Add Contact" affordance on an Account or
 * Opportunity detail page. Two paths:
 *
 *   - Find existing → insert a row in `contact_account_links` (account
 *     mode) or `contact_opportunity_links` (opportunity mode). The
 *     contact itself is NOT duplicated and their home account is NOT
 *     changed. Mirrors SF's "Add Relationship" / "Add Contact Roles".
 *
 *   - Create new → navigate to /contacts/new?account_id=X for the
 *     existing form flow. In account mode the new contact lands with
 *     this account as their home (no link row needed). In opp mode the
 *     contact lands at the opp's home account AND we'll need a link
 *     row — but creating the contact happens on the next page, so this
 *     dialog just routes; OpportunityContacts handles the post-create
 *     wiring when it re-mounts.
 */
export function AddContactDialog({
  open,
  onOpenChange,
  recordKind,
  recordId,
  defaultAccountIdForNewContact,
}: AddContactDialogProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [selected, setSelected] = useState<ContactSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setResults([]);
    }
  }, [open]);

  // Pull the existing links on this record so we can disable the
  // "Add" button for contacts that are already attached (UI affordance
  // — the DB PK would reject the insert anyway, but showing the user
  // upfront is friendlier).
  const { data: existingLinks } = useQuery({
    queryKey: ["contact-record-links", recordKind, recordId],
    queryFn: async () => {
      if (recordKind === "account") {
        const { data, error } = await supabase
          .from("contact_account_links")
          .select("contact_id")
          .eq("account_id", recordId);
        if (error) throw error;
        return new Set<string>((data ?? []).map((r) => r.contact_id as string));
      } else {
        const { data, error } = await supabase
          .from("contact_opportunity_links")
          .select("contact_id")
          .eq("opportunity_id", recordId);
        if (error) throw error;
        return new Set<string>((data ?? []).map((r) => r.contact_id as string));
      }
    },
    enabled: open,
  });

  // Also fetch the home-account contact IDs when in account mode so we
  // can flag them too — a contact homed at this account is already
  // visible on the Contacts tab; a second link row would be redundant.
  const { data: homeContactIds } = useQuery({
    queryKey: ["home-contacts-on-account", recordId],
    queryFn: async () => {
      if (recordKind !== "account") return new Set<string>();
      const { data, error } = await supabase
        .from("contacts")
        .select("id")
        .eq("account_id", recordId)
        .is("archived_at", null);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r) => r.id as string));
    },
    enabled: open && recordKind === "account",
  });

  useEffect(() => {
    if (!open) return;
    if (!debouncedSearch || debouncedSearch.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const clause = buildPersonSearchClause(debouncedSearch, [
        "first_name",
        "last_name",
        "email",
        "title",
      ]);
      let query = supabase
        .from("contacts")
        .select(
          "id, first_name, last_name, email, title, account_id, account:accounts!account_id(id, name)",
        )
        .is("archived_at", null)
        .order("last_name")
        .limit(20);
      if (clause) query = query.or(clause);
      const { data, error } = await query;
      if (cancelled) return;
      setSearching(false);
      if (error) {
        toast.error("Contact search failed: " + error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as unknown as ContactSearchResult[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, open]);

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No contact selected");
      const { data: userRes } = await supabase.auth.getUser();
      if (recordKind === "account") {
        const { error } = await supabase
          .from("contact_account_links")
          .insert({
            contact_id: selected.id,
            account_id: recordId,
            added_by: userRes.user?.id ?? null,
          });
        if (error) {
          if (error.code === "23505") {
            throw new Error("This contact is already linked to this account.");
          }
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("contact_opportunity_links")
          .insert({
            contact_id: selected.id,
            opportunity_id: recordId,
            added_by: userRes.user?.id ?? null,
          });
        if (error) {
          if (error.code === "23505") {
            throw new Error("This contact is already on this opportunity.");
          }
          throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("Contact added");
      // Invalidate everything that might surface this association.
      qc.invalidateQueries({ queryKey: ["contact-record-links"] });
      qc.invalidateQueries({ queryKey: ["account-contacts"] });
      qc.invalidateQueries({ queryKey: ["opportunity-contacts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const selectedIsAlreadyLinked = useMemo(() => {
    if (!selected) return false;
    if (existingLinks?.has(selected.id)) return true;
    if (recordKind === "account" && homeContactIds?.has(selected.id))
      return true;
    return false;
  }, [selected, existingLinks, homeContactIds, recordKind]);

  const recordWord = recordKind === "account" ? "account" : "opportunity";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>
            Search for an existing contact, or create a new one. Existing
            contacts will be linked to this {recordWord} — their original
            account is not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-search">Find existing contact</Label>
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

            {!selected && results.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                {results.map((r) => {
                  const name =
                    formatName(r.first_name ?? "", r.last_name ?? "").trim() ||
                    r.email ||
                    "(no name)";
                  const alreadyHere =
                    existingLinks?.has(r.id) ||
                    (recordKind === "account" && homeContactIds?.has(r.id));
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
                            already here
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex justify-between gap-2">
                        <span className="truncate">
                          {r.title ? r.title : (r.email ?? "—")}
                        </span>
                        <span className="shrink-0">
                          {r.account?.name ?? "No account"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {!selected &&
              search.length >= 2 &&
              !searching &&
              results.length === 0 && (
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
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Home account:{" "}
                      <span className="font-medium">
                        {selected.account?.name ?? "(none)"}
                      </span>
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
                {selectedIsAlreadyLinked && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    This contact is already on this {recordWord}.
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
              const homeId =
                defaultAccountIdForNewContact ??
                (recordKind === "account" ? recordId : undefined);
              const qs = homeId ? `?account_id=${homeId}` : "";
              navigate(`/contacts/new${qs}`);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Create new contact
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !selected || selectedIsAlreadyLinked || linkMutation.isPending
            }
            onClick={() => linkMutation.mutate()}
          >
            {linkMutation.isPending
              ? "Adding…"
              : `Add to this ${recordWord}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
