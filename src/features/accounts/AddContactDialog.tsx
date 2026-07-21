import { useState, useEffect } from "react";
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

interface ContactSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account_id: string | null;
  account_name: string | null;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The opportunity we're attaching a contact to. */
  opportunityId: string;
  /** The opp's home account_id — used as the default list (the client's
   *  contacts) and to default "Create new contact". Searching reaches any
   *  account, so partner contacts can be attached too. */
  accountId: string;
}

// Shape the embedded account name into a flat field. PostgREST may type a
// to-one embed as an array, so normalize either shape.
type RawContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account_id: string | null;
  account?: { name: string | null } | { name: string | null }[] | null;
};

function mapRow(r: RawContactRow): ContactSearchResult {
  const acct = Array.isArray(r.account) ? r.account[0] : r.account;
  return {
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    title: r.title,
    account_id: r.account_id,
    account_name: acct?.name ?? null,
  };
}

const CONTACT_SELECT =
  "id, first_name, last_name, email, title, account_id, account:accounts!account_id(name)";

/**
 * "Add Contact" dialog for an Opportunity's Contacts tab.
 *
 * Default view lists the opp's own account contacts (the common case — the
 * client's people). Typing a search reaches ACROSS accounts so a partner's
 * contact (whoever you're running the deal through) can be attached too. Each
 * result shows its company so it's clear which side the person is on. Adding a
 * contact inserts a `contact_opportunity_links` row; it never moves the
 * contact's home account.
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

  const searchActive = search.trim().length >= 2;

  // Default list: the opp account's own (client) contacts.
  const { data: accountContacts } = useQuery({
    queryKey: ["account-home-contacts", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("last_name");
      if (error) throw error;
      return (data ?? []).map((r) => mapRow(r as unknown as RawContactRow));
    },
    enabled: open && !!accountId,
  });

  // Cross-account search (kicks in at 2+ chars) so partner contacts surface.
  const { data: searchResults, isFetching: searchFetching, isError: searchError } = useQuery({
    queryKey: ["contact-search-any", search.trim()],
    queryFn: async () => {
      const q = search.trim();
      let query = supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .is("archived_at", null)
        // Pending imports stay in the pen until promoted.
        .is("import_status", null)
        .order("last_name")
        .limit(25);
      const orClause = buildPersonSearchClause(q, [
        "first_name",
        "last_name",
        "email",
        "title",
      ]);
      if (orClause) query = query.or(orClause);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => mapRow(r as unknown as RawContactRow));
    },
    enabled: open && searchActive,
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

  const displayed = searchActive ? searchResults ?? [] : accountContacts ?? [];

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
            Add a stakeholder on this deal. Search reaches any account, so you
            can add a partner's contact too — their company is shown next to
            each result.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-search">Find a contact</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="contact-search"
                placeholder="Search any contact by name, email, or title…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                className="pl-9"
                autoFocus
              />
            </div>
            {!searchActive && (
              <p className="text-xs text-muted-foreground">
                Showing this account's contacts. Type to search across all
                accounts (including partners).
              </p>
            )}

            {!selected && displayed.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                {displayed.map((r) => {
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
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                            already on opp
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[r.title || r.email, r.account_name]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {!selected && searchActive && displayed.length === 0 && searchFetching && (
              <p className="text-xs text-muted-foreground">Searching…</p>
            )}
            {!selected && searchActive && displayed.length === 0 && !searchFetching && searchError && (
              <p className="text-xs text-destructive">Search failed — try again.</p>
            )}
            {!selected && searchActive && displayed.length === 0 && !searchFetching && !searchError && (
              <p className="text-xs text-muted-foreground">
                No contacts match. Add them to their account first, or create a
                new one below.
              </p>
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
                      {[selected.title || selected.email, selected.account_name]
                        .filter(Boolean)
                        .join(" · ") || "—"}
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
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              // Defer one frame so Radix restores body pointer-events before
              // this navigate unmounts the dialog portal (avoids a stranded
              // pointer-events:none lock that makes the page unclickable).
              requestAnimationFrame(() =>
                navigate(`/contacts/new?account_id=${accountId}`)
              );
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
