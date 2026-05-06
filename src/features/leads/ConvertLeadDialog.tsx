import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvertLead } from "./api";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";

interface ConvertLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
}

interface AccountSuggestion {
  id: string;
  name: string;
  lifecycle_status: string | null;
}

type AccountMode = "existing" | "new";

/**
 * Convert lead → account + contact + (optional) opportunity.
 *
 * Account picker has two modes:
 *   - "existing" — searchable list. Type-to-filter against the accounts
 *     table so the rep can find the right one without scrolling 5k+
 *     accounts. On dialog open, we auto-search by `lead.company` and
 *     pre-select an exact case-insensitive name match if one exists.
 *     This was the bug the previous version had: it free-typed an
 *     account name and ALWAYS created a new account, producing
 *     duplicates whenever the same company already existed.
 *   - "new" — type a name and a fresh account is created on convert.
 *
 * If we find a name match on open, we default to "existing" with that
 * account selected; otherwise we default to "new" with the lead's
 * company as the suggested name. Either way the rep is asked to
 * confirm before we mutate anything.
 */
export function ConvertLeadDialog({ open, onOpenChange, lead }: ConvertLeadDialogProps) {
  const navigate = useNavigate();
  const convertMutation = useConvertLead();

  const seedName = lead.company ?? `${lead.first_name} ${lead.last_name}`;

  // Account-picker state
  const [mode, setMode] = useState<AccountMode>("new");
  const [selectedAccount, setSelectedAccount] = useState<AccountSuggestion | null>(null);
  const [accountQuery, setAccountQuery] = useState(lead.company ?? "");
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<AccountSuggestion[]>([]);
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);

  // New-account name (only used when mode === "new")
  const [accountName, setAccountName] = useState(seedName);

  // Contact + opp state
  const [firstName, setFirstName] = useState(lead.first_name);
  const [lastName, setLastName] = useState(lead.last_name);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityName, setOpportunityName] = useState(
    `${lead.company ?? lead.last_name} - New Business`
  );
  const [opportunityAmount, setOpportunityAmount] = useState<string>("");
  const [opportunityStage, setOpportunityStage] = useState("details_analysis");

  // Reset state when the dialog reopens for a different lead
  useEffect(() => {
    if (!open) return;
    setMode("new");
    setSelectedAccount(null);
    setAccountQuery(lead.company ?? "");
    setAccountName(seedName);
    setFirstName(lead.first_name);
    setLastName(lead.last_name);
    setOpportunityName(`${lead.company ?? lead.last_name} - New Business`);
    setHasOpenedOnce(false);
    // seedName depends on lead.* — listing it would loop the effect
    // since seedName is computed each render. Just key off `open` and
    // `lead.id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  // Debounced account search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    const q = accountQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, lifecycle_status")
        .ilike("name", `%${q}%`)
        .is("archived_at", null)
        .order("name", { ascending: true })
        .limit(15);
      setSearching(false);
      if (error) {
        setSuggestions([]);
        return;
      }
      const rows = (data ?? []) as AccountSuggestion[];
      setSuggestions(rows);

      // First-open behavior: if we haven't auto-suggested yet AND we
      // find an exact (case-insensitive) name match for the lead's
      // company, default to "existing" mode with that account picked.
      // This is the main duplicate-prevention guardrail — reps can
      // still flip back to "new" if the match is wrong.
      if (!hasOpenedOnce && lead.company) {
        const exact = rows.find(
          (r) => r.name.toLowerCase().trim() === lead.company!.toLowerCase().trim()
        );
        if (exact) {
          setMode("existing");
          setSelectedAccount(exact);
        }
        setHasOpenedOnce(true);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // hasOpenedOnce intentionally omitted — we set it inside the effect
    // and don't want to re-run on that flip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountQuery, open, lead.company]);

  const accountReady = useMemo(() => {
    if (mode === "existing") return !!selectedAccount;
    return accountName.trim().length > 0;
  }, [mode, selectedAccount, accountName]);

  async function handleConvert() {
    try {
      const result = await convertMutation.mutateAsync({
        leadId: lead.id,
        existingAccountId: mode === "existing" ? selectedAccount!.id : undefined,
        accountName: mode === "new" ? accountName : undefined,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        title: lead.title,
        industry: lead.industry,
        website: lead.website,
        street: lead.street,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        country: lead.country,
        leadSource: lead.source,
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName : undefined,
        opportunityAmount: createOpportunity && opportunityAmount
          ? Number(opportunityAmount)
          : undefined,
        opportunityStage: createOpportunity ? opportunityStage : undefined,
      });
      toast.success(
        mode === "existing"
          ? `Lead converted into existing account "${result.account.name}"`
          : `Lead converted — new account "${result.account.name}" created`
      );
      onOpenChange(false);
      navigate(`/accounts/${result.account.id}`);
    } catch (err) {
      toast.error("Failed to convert lead: " + (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert Lead</DialogTitle>
          <DialogDescription>
            Convert this lead into an Account, Contact, and optionally an Opportunity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Account */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Account
            </h4>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "existing" ? "default" : "outline"}
                onClick={() => setMode("existing")}
                className="flex-1"
              >
                Existing account
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "new" ? "default" : "outline"}
                onClick={() => setMode("new")}
                className="flex-1"
              >
                Create new account
              </Button>
            </div>

            {mode === "existing" ? (
              <div className="space-y-2">
                <Label htmlFor="convert_account_search">
                  Find account
                  {lead.company && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      — searching for "{lead.company}"
                    </span>
                  )}
                </Label>
                {selectedAccount ? (
                  <div className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{selectedAccount.name}</span>
                      {selectedAccount.lifecycle_status && (
                        <Badge variant="outline" className="text-xs capitalize shrink-0">
                          {selectedAccount.lifecycle_status}
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAccount(null)}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="convert_account_search"
                        autoFocus
                        value={accountQuery}
                        onChange={(e) => setAccountQuery(e.target.value)}
                        placeholder="Type to search accounts…"
                        className="pl-8"
                      />
                      {searching && (
                        <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {accountQuery.trim().length > 0 && (
                      <div className="border rounded-md max-h-56 overflow-y-auto">
                        {suggestions.length === 0 && !searching ? (
                          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            No accounts match "{accountQuery}". Switch to "Create new account" or
                            try a shorter search.
                          </div>
                        ) : (
                          suggestions.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setSelectedAccount(a)}
                              className={cn(
                                "w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between gap-2 border-b last:border-b-0"
                              )}
                            >
                              <span className="truncate">{a.name}</span>
                              {a.lifecycle_status && (
                                <Badge variant="outline" className="text-xs capitalize shrink-0">
                                  {a.lifecycle_status}
                                </Badge>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>New Account Name</Label>
                {/* Read-only on purpose. We pull the name straight from
                    `lead.company` (or the contact name as a last resort)
                    so reps can't free-type a new account name here and
                    accidentally introduce a typo'd duplicate. If the
                    lead's company is wrong, fix the lead first, then
                    convert. */}
                <div className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 bg-muted/30">
                  <span className="font-medium truncate">{accountName}</span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    From lead
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  A new account will be created with this name. To change it,
                  cancel, edit the lead's Company, then re-open Convert. Or
                  switch to "Existing account" to attach this lead to an
                  account that's already in the CRM.
                </p>
              </div>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Contact
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="convert_first_name">First Name *</Label>
                <Input
                  id="convert_first_name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="convert_last_name">Last Name *</Label>
                <Input
                  id="convert_last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Opportunity */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="create_opportunity"
                checked={createOpportunity}
                onCheckedChange={(v) => setCreateOpportunity(v === true)}
              />
              <Label htmlFor="create_opportunity" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer">
                Create Opportunity
              </Label>
            </div>

            {createOpportunity && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label htmlFor="convert_opp_name">Opportunity Name</Label>
                  <Input
                    id="convert_opp_name"
                    value={opportunityName}
                    onChange={(e) => setOpportunityName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="convert_opp_amount">Amount</Label>
                    <Input
                      id="convert_opp_amount"
                      type="number"
                      step="0.01"
                      value={opportunityAmount}
                      onChange={(e) => setOpportunityAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stage</Label>
                    <Select value={opportunityStage} onValueChange={setOpportunityStage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="details_analysis">Details Analysis</SelectItem>
                        <SelectItem value="demo">Demo</SelectItem>
                        <SelectItem value="proposal_and_price_quote">Proposal and Price Quote</SelectItem>
                        <SelectItem value="proposal_conversation">Proposal Conversation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConvert}
            disabled={
              !accountReady ||
              !firstName ||
              !lastName ||
              convertMutation.isPending
            }
          >
            {convertMutation.isPending
              ? "Converting..."
              : mode === "existing"
                ? "Convert into existing account"
                : "Convert + create new account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
