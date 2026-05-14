import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, AlertTriangle } from "lucide-react";
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

// Tiny debounce hook — duplicated from AddPartnerDialog. If a third
// consumer shows up, promote to src/hooks/.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account whose Contacts tab opened this dialog — any selected
   *  existing contact will be reassigned to this account_id. */
  accountId: string;
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
 * Dialog opened from an Account's (or Opportunity's) Contacts tab.
 * Lets a rep EITHER pick an existing contact (reassigning that
 * contact's account_id to the current account — reps were creating
 * duplicate contact rows because the only option was "create new")
 * OR fall through to the existing create-new flow.
 *
 * Schema note: `contacts.account_id` is a singular FK. There is no
 * many-to-many contact_accounts table, so "add existing" is really
 * "move existing to this account". The confirmation step makes the
 * move explicit when the contact already belongs to a different
 * account, so reps don't surprise themselves by silently orphaning
 * a contact from their prior account.
 */
export function AddContactDialog({
  open,
  onOpenChange,
  accountId,
}: AddContactDialogProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [selected, setSelected] = useState<ContactSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Reset on close — same pattern as AddPartnerDialog (selected was
  // leaking across openings during QA).
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setResults([]);
    }
  }, [open]);

  // Live search the contacts table. Includes the parent account name
  // so the rep can see "Kristal Walters — currently at Acme" before
  // moving her, instead of being surprised by the prior linkage
  // disappearing.
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

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No contact selected");
      const { error } = await supabase
        .from("contacts")
        .update({ account_id: accountId })
        .eq("id", selected.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        selected?.account_id && selected.account_id !== accountId
          ? "Contact moved to this account"
          : "Contact added to this account",
      );
      // Invalidate any contact list (the account's contacts query
      // uses queryKey ["contacts", {account_id: ...}]) AND the
      // moved-from account's list so it disappears there too.
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const isMove =
    !!selected?.account_id && selected.account_id !== accountId;
  const isAlreadyHere = selected?.account_id === accountId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>
            Search for an existing contact, or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
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
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelected(r)}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                    >
                      <div className="font-medium">{name}</div>
                      <div className="text-xs text-muted-foreground flex justify-between gap-2">
                        <span className="truncate">
                          {r.title ? r.title : r.email ?? "—"}
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
                      Currently at:{" "}
                      <span className="font-medium">
                        {selected.account?.name ?? "No account"}
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
                {isMove && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      This contact will be MOVED from{" "}
                      <span className="font-medium">
                        {selected.account?.name}
                      </span>{" "}
                      to this account. They won't appear under{" "}
                      {selected.account?.name} anymore.
                    </span>
                  </div>
                )}
                {isAlreadyHere && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    This contact already belongs to this account.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Divider + create-new fallback */}
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
            Create new contact
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !selected || isAlreadyHere || moveMutation.isPending
            }
            onClick={() => moveMutation.mutate()}
          >
            {moveMutation.isPending
              ? "Adding…"
              : isMove
                ? "Move to this account"
                : "Add to this account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
