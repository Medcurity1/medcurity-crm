import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
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

// Tiny debounce hook used only here; if a second consumer shows up
// promote to src/hooks/. Keeps account search from hammering
// PostgREST on every keystroke.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface AddPartnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account whose Partner tab opened this dialog. */
  accountId: string;
  /** Whether that account is partner-typed — decides the direction. */
  accountIsPartner: boolean;
  /** Called after the partnership row is successfully created. */
  onAdded: () => void;
}

interface AccountSearchResult {
  id: string;
  name: string;
  account_type: string | null;
  customer_status: string | null;
}

/**
 * Dialog for creating a new account_partners row from an account
 * detail page. The direction is INFERRED, not asked (Summer 7/27):
 * if THIS account is partner-typed, the picked account joins as a
 * member underneath it; otherwise the picked account is the partner
 * this account came in through. The old member/partner chooser
 * defaulted to "this is the partner", which kept recording
 * resellers backwards as members of their own clients. The
 * partner/member columns (512 live rows) are unchanged — only the
 * question is gone, replaced by a plain-English sentence stating
 * what will be recorded.
 */
export function AddPartnerDialog({
  open,
  onOpenChange,
  accountId,
  accountIsPartner,
  onAdded,
}: AddPartnerDialogProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [selected, setSelected] = useState<AccountSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  // Accounts already linked to this one (either direction) so the search
  // results can mark them instead of dead-ending in an "already exists"
  // toast after the user picks one.
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());

  // Reset everything when the dialog closes — otherwise state leaks
  // across openings (saw selected=stale in QA).
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setResults([]);
    }
  }, [open]);

  // Load the set of accounts already partnered with this one (either
  // direction) whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("account_partners")
        .select("partner_account_id, member_account_id")
        .or(`partner_account_id.eq.${accountId},member_account_id.eq.${accountId}`)
        .range(0, 4999);
      if (cancelled) return;
      const ids = new Set<string>();
      for (const r of data ?? []) {
        const other =
          r.partner_account_id === accountId
            ? r.member_account_id
            : r.partner_account_id;
        if (other) ids.add(other as string);
      }
      setLinkedIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  // Live search the accounts table. Keep results small so the
  // dropdown stays usable on touch screens; users can refine.
  useEffect(() => {
    if (!open) return;
    if (!debouncedSearch || debouncedSearch.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, account_type, customer_status")
        .ilike("name", `%${debouncedSearch.trim()}%`)
        .neq("id", accountId)  // can't partner with yourself
        .is("archived_at", null)
        .order("name")
        .limit(20);
      if (cancelled) return;
      setSearching(false);
      if (error) {
        toast.error("Account search failed: " + error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as AccountSearchResult[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, accountId, open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No account selected");
      const partner_account_id = accountIsPartner ? accountId : selected.id;
      const member_account_id = accountIsPartner ? selected.id : accountId;
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase.from("account_partners").insert({
        partner_account_id,
        member_account_id,
        created_by: userRes.user?.id ?? null,
      });
      if (error) {
        // Friendly message on duplicate
        if (error.code === "23505") {
          throw new Error("That partnership already exists.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Partnership added");
      onAdded();
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const directionDescription = useMemo(() => {
    if (!selected) return null;
    return accountIsPartner
      ? `${selected.name} will be listed as a member — an account that came in through this partner.`
      : `${selected.name} will be listed as the partner this account came in through.`;
  }, [selected, accountIsPartner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Partnership</DialogTitle>
          <DialogDescription>
            {accountIsPartner
              ? "Pick an account that came in through this partner."
              : "Pick the partner this account came in through."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Account search */}
          <div className="space-y-1.5">
            <Label htmlFor="partner-search">Account</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="partner-search"
                placeholder="Type at least 2 characters…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                className="pl-9"
                autoFocus
              />
            </div>
            {/* Results dropdown */}
            {!selected && results.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                {results.map((r) => {
                  const alreadyLinked = linkedIds.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={alreadyLinked}
                      onClick={() => !alreadyLinked && setSelected(r)}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between items-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <span className="font-medium">{r.name}</span>
                      {alreadyLinked ? (
                        <span className="text-xs text-muted-foreground">
                          Already linked
                        </span>
                      ) : (
                        r.account_type && (
                          <span className="text-xs text-muted-foreground">
                            {r.account_type}
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {!selected && search.length >= 2 && !searching && results.length === 0 && (
              <p className="text-xs text-muted-foreground">No matches.</p>
            )}
            {selected && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex justify-between items-center">
                <div>
                  <div className="font-medium">{selected.name}</div>
                  {selected.account_type && (
                    <div className="text-xs text-muted-foreground">
                      {selected.account_type}
                    </div>
                  )}
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
            )}
          </div>

          {/* What will be recorded — direction is inferred, stated plainly */}
          {selected && directionDescription && (
            <p className="text-sm text-muted-foreground">{directionDescription}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Adding…" : "Add Partnership"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
