import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
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
  /** Called after the partnership row is successfully created. */
  onAdded: () => void;
}

interface AccountSearchResult {
  id: string;
  name: string;
  account_type: string | null;
  lifecycle_status: string | null;
}

/**
 * Dialog for creating a new account_partners row from an account
 * detail page. Asks the user which direction the relationship goes:
 *   - "this account is the PARTNER" → other account is member
 *   - "this account is the MEMBER"  → other account is partner
 *
 * The direction toggle removes ambiguity vs. just picking an
 * account (which could be either side). Defaults to "this is the
 * partner" since that's the more common case for the Partner tab
 * being on a partner-flagged account.
 */
export function AddPartnerDialog({
  open,
  onOpenChange,
  accountId,
  onAdded,
}: AddPartnerDialogProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [selected, setSelected] = useState<AccountSearchResult | null>(null);
  const [direction, setDirection] = useState<"this_is_partner" | "this_is_member">(
    "this_is_partner"
  );
  const [role, setRole] = useState("");
  const [searching, setSearching] = useState(false);

  // Reset everything when the dialog closes — otherwise state leaks
  // across openings (saw selected=stale in QA).
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      setRole("");
      setDirection("this_is_partner");
      setResults([]);
    }
  }, [open]);

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
        .select("id, name, account_type, lifecycle_status")
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
      const partner_account_id =
        direction === "this_is_partner" ? accountId : selected.id;
      const member_account_id =
        direction === "this_is_partner" ? selected.id : accountId;
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase.from("account_partners").insert({
        partner_account_id,
        member_account_id,
        role: role.trim() || null,
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
    return direction === "this_is_partner"
      ? `${selected.name} comes in through this account.`
      : `This account comes in through ${selected.name}.`;
  }, [selected, direction]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Partnership</DialogTitle>
          <DialogDescription>
            Link this account to another account as a partner or member.
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
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelected(r)}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between items-center"
                  >
                    <span className="font-medium">{r.name}</span>
                    {r.account_type && (
                      <span className="text-xs text-muted-foreground">
                        {r.account_type}
                      </span>
                    )}
                  </button>
                ))}
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

          {/* Direction toggle */}
          {selected && (
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection("this_is_partner")}
                  className={`rounded-md border p-3 text-left text-sm transition-colors ${
                    direction === "this_is_partner"
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <ArrowDown className="h-3.5 w-3.5" />
                    This is the Partner
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Other account is a member underneath us
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("this_is_member")}
                  className={`rounded-md border p-3 text-left text-sm transition-colors ${
                    direction === "this_is_member"
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <ArrowUp className="h-3.5 w-3.5" />
                    This is a Member
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Other account is the partner above us
                  </div>
                </button>
              </div>
              {directionDescription && (
                <p className="text-xs text-muted-foreground italic">
                  {directionDescription}
                </p>
              )}
            </div>
          )}

          {/* Optional role */}
          {selected && (
            <div className="space-y-1.5">
              <Label htmlFor="partner-role">Role (optional)</Label>
              <Input
                id="partner-role"
                placeholder="e.g. Reseller, Co-marketing partner"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
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
