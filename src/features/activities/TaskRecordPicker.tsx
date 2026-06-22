// Optional "attach this task to a record" control for standalone task
// creation (V2-A2). A task created from the Activities tab has no record
// context, so this lets the rep optionally anchor it to an Account and,
// once chosen, optionally narrow to a Contact or Opportunity under that
// account. Account-anchored mirrors the rest of the app (contacts/opps are
// scoped to an account); leaving it empty creates a pure personal task.
//
// Search pattern (debounced ilike + results dropdown + selected chip) is
// lifted from AddPartnerDialog so it behaves identically.

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface TaskRecordSelection {
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

export const EMPTY_TASK_RECORD: TaskRecordSelection = {
  accountId: null,
  contactId: null,
  opportunityId: null,
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface AccountResult {
  id: string;
  name: string;
  account_type: string | null;
}
interface NamedRow {
  id: string;
  label: string;
}

export function TaskRecordPicker({
  value,
  onChange,
}: {
  value: TaskRecordSelection;
  onChange: (next: TaskRecordSelection) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [account, setAccount] = useState<AccountResult | null>(null);
  const [contacts, setContacts] = useState<NamedRow[]>([]);
  const [opps, setOpps] = useState<NamedRow[]>([]);

  // Live account search (≥2 chars), same shape as AddPartnerDialog.
  useEffect(() => {
    if (account) return; // already chosen — don't keep searching
    if (!debounced || debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, account_type")
        .ilike("name", `%${debounced.trim()}%`)
        .is("archived_at", null)
        .order("name")
        .limit(20);
      if (cancelled) return;
      setSearching(false);
      setResults(error ? [] : ((data ?? []) as AccountResult[]));
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, account]);

  // When an account is picked, load its contacts + open-ish opps so the
  // rep can narrow the attachment without leaving the dialog.
  useEffect(() => {
    if (!account) {
      setContacts([]);
      setOpps([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: cData }, { data: oData }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, first_name, last_name")
          .eq("account_id", account.id)
          .is("archived_at", null)
          .order("last_name")
          .limit(100),
        supabase
          .from("opportunities")
          .select("id, name")
          .eq("account_id", account.id)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (cancelled) return;
      setContacts(
        (cData ?? []).map((c: { id: string; first_name: string | null; last_name: string | null }) => ({
          id: c.id,
          label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed",
        })),
      );
      setOpps(
        (oData ?? []).map((o: { id: string; name: string }) => ({
          id: o.id,
          label: o.name,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  function selectAccount(a: AccountResult) {
    setAccount(a);
    setSearch(a.name);
    setResults([]);
    onChange({ accountId: a.id, contactId: null, opportunityId: null });
  }

  function clearAccount() {
    setAccount(null);
    setSearch("");
    setResults([]);
    onChange(EMPTY_TASK_RECORD);
  }

  return (
    <div className="space-y-2 border rounded-md p-3">
      <Label className="text-sm font-semibold">Attach to a record (optional)</Label>

      {!account ? (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search accounts… (type 2+ characters)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {results.length > 0 && (
            <div className="rounded-md border max-h-48 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectAccount(r)}
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
          {search.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground">No matching accounts.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex justify-between items-center">
            <span className="font-medium truncate">{account.name}</span>
            <Button variant="ghost" size="sm" onClick={clearAccount}>
              Change
            </Button>
          </div>

          {contacts.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Contact (optional)</Label>
              <select
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={value.contactId ?? ""}
                onChange={(e) =>
                  onChange({ ...value, contactId: e.target.value || null })
                }
              >
                <option value="">— None —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {opps.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Opportunity (optional)</Label>
              <select
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={value.opportunityId ?? ""}
                onChange={(e) =>
                  onChange({ ...value, opportunityId: e.target.value || null })
                }
              >
                <option value="">— None —</option>
                {opps.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
