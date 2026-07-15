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
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Lead, CustomerStatus } from "@/types/crm";
import {
  MultiProductPicker,
  type StagedOpportunityProduct,
} from "@/features/opportunities/MultiProductPicker";
import { useAddOpportunityProductsBulk } from "@/features/opportunities/api";
import { employeesToFteRange, formatCurrency, customerStatusLabel } from "@/lib/formatters";
import { DuplicateWarning } from "@/components/DuplicateWarning";

interface ConvertLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
}

interface AccountSuggestion {
  id: string;
  name: string;
  customer_status: string | null;
}

type AccountMode = "existing" | "new" | "none";

// Normalize a company name for the dialog's account auto-match. This MUST
// mirror the DB norm_company() (20260616000001) exactly, or the dialog will
// pre-select an "existing" account the server wouldn't actually match (false
// merges). The DB rule: fold "&"->" and ", strip punctuation to spaces,
// collapse whitespace, then strip ONLY a trailing legal suffix. It keeps
// inner spaces and does NOT drop "co"/"company"/"group" — those genuinely
// distinguish separate healthcare billing entities.
function normCompany(s: string): string {
  const collapsed = (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed
    .replace(/ (inc|llc|llp|ltd|corp|corporation|pllc|incorporated)$/, "")
    .trim();
}

// The most distinctive word in a company name (longest, ignoring filler),
// used to broaden the dup search so "&"/"and"/suffix variants surface.
function distinctiveToken(s: string): string | null {
  const stop = new Set([
    "and", "the", "inc", "llc", "llp", "ltd", "co", "corp",
    "corporation", "company", "of", "for",
  ]);
  const words = s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
  if (words.length === 0) return null;
  return words.sort((a, b) => b.length - a.length)[0];
}

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
  const addProductsBulkMutation = useAddOpportunityProductsBulk();

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
  const [opportunityStage, setOpportunityStage] = useState("details_analysis");

  // Opportunity products: same product-picker pattern as OpportunityForm.
  // We force the rep to add at least one product before they can convert
  // (when createOpportunity is on) so the opp gets a real product-derived
  // name + amount instead of free-typed placeholder text. Removed the
  // free-text Opportunity Name + Amount inputs entirely — both are
  // derived from staged products via the same logic OpportunityForm uses.
  const [stagedProducts, setStagedProducts] = useState<StagedOpportunityProduct[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);

  // Reset state when the dialog reopens for a different lead
  useEffect(() => {
    if (!open) return;
    setMode("new");
    setSelectedAccount(null);
    setAccountQuery(lead.company ?? "");
    setAccountName(seedName);
    setFirstName(lead.first_name);
    setLastName(lead.last_name);
    setStagedProducts([]);
    setShowAddProduct(false);
    setHasOpenedOnce(false);
    // seedName depends on lead.* — listing it would loop the effect
    // since seedName is computed each render. Just key off `open` and
    // `lead.id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  // Auto-derived opportunity name from staged products. Mirrors the
  // SF-style "SHORT1 | SHORT2 | SHORT3" pattern used by OpportunityForm —
  // falls back through short_name → code → name per product. The DB
  // trigger + bulk hook resync this server-side too once products
  // attach, but we compute a placeholder for the initial insert so the
  // opp never carries a blank name.
  const derivedOpportunityName = useMemo(() => {
    const labels = stagedProducts
      .map((p) => {
        const sn = p.product_short_name?.trim();
        if (sn) return sn;
        const code = p.product_code?.trim();
        if (code) return code;
        const nm = p.product_name?.trim();
        return nm || null;
      })
      .filter((c): c is string => !!c);
    return labels.length ? labels.join(" | ") : "";
  }, [stagedProducts]);

  // FTE range for price-book lookup. We can't pass an account_id when
  // creating a new account, so we derive the FTE bucket from the lead's
  // employee count. For existing-account mode the picker also accepts
  // accountId and will look up the account's FTE directly.
  const fteRangeFromLead = useMemo(
    () => employeesToFteRange(lead.employees ?? null) || null,
    [lead.employees],
  );

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
        .select("id, name, customer_status")
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
        const target = normCompany(lead.company);
        // Normalized match within the already-fetched suggestions...
        let match = rows.find((r) => normCompany(r.name) === target);
        // ...else broaden by the most distinctive token so "&"/"and"/suffix
        // variants (e.g. "Smith & Sons" vs "Smith and Sons") surface, then
        // normalized-match. Normalized equality is safe — it only collapses
        // punctuation/suffix/and variants, never distinct companies.
        if (!match) {
          const token = distinctiveToken(lead.company);
          if (token) {
            const { data: extra } = await supabase
              .from("accounts")
              .select("id, name, customer_status")
              .ilike("name", `%${token}%`)
              .is("archived_at", null)
              .limit(25);
            match = ((extra ?? []) as AccountSuggestion[]).find(
              (r) => normCompany(r.name) === target,
            );
          }
        }
        if (match) {
          setMode("existing");
          setSelectedAccount(match);
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
    if (mode === "none") return true;
    if (mode === "existing") return !!selectedAccount;
    return accountName.trim().length > 0;
  }, [mode, selectedAccount, accountName]);

  async function handleConvert() {
    try {
      // Pre-flight: require at least one product when creating an opp.
      // The opp's name + amount come from products, not free-text inputs.
      if (createOpportunity && stagedProducts.length === 0) {
        toast.error(
          "Add at least one product to the opportunity before converting (name + amount come from products).",
        );
        return;
      }

      // Seed the opp with the staged products' total so it never lands at
      // $0 if the post-convert product attach fails. On success the bulk
      // attach recomputes the amount server-side, overwriting this.
      const stagedTotal = stagedProducts.reduce(
        (sum, sp) => sum + (Number(sp.arr_amount) || 0),
        0,
      );

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
        // Pass the derived name so the row never lands in the DB blank.
        // The bulk-products step right after this resyncs it server-side
        // anyway, but a derived placeholder is safer in case the bulk
        // call fails midway.
        opportunityName: createOpportunity
          ? (derivedOpportunityName || "New Opportunity")
          : undefined,
        opportunityStage: createOpportunity ? opportunityStage : undefined,
        opportunityAmount: createOpportunity ? stagedTotal : undefined,
      });

      // Attach staged products. useAddOpportunityProductsBulk also
      // recomputes totals + resyncs the auto-name on the server, so the
      // opp lands with the right name and amount even if the rep didn't
      // type anything.
      if (createOpportunity && result.opportunity && stagedProducts.length > 0) {
        try {
          await addProductsBulkMutation.mutateAsync({
            opportunity_id: result.opportunity.id,
            rows: stagedProducts.map((sp) => ({
              product_id: sp.product_id,
              quantity: sp.quantity,
              unit_price: sp.unit_price,
              arr_amount: sp.arr_amount,
              discount_percent: sp.discount_percent,
              discount_type: sp.discount_type,
            })),
          });
        } catch (err) {
          console.error("Failed to attach products to converted opp:", err);
          toast.error(
            "Lead converted, but products failed to attach. Open the opportunity and add them from the products section.",
          );
        }
      }

      toast.success(
        mode === "none"
          ? "Lead promoted to a contact (no account)"
          : mode === "existing"
            ? `Lead converted into existing account "${result.account.name}"`
            : `Lead converted — new account "${result.account.name}" created`
      );
      // Close dialog first, then navigate. Target is the new CONTACT —
      // this is the "newly created record" the rep cares about, and it
      // matches LeadDetail's converted-lead useEffect redirect target so
      // both paths agree (otherwise the lead-query refetch triggered by
      // useConvertLead.onSuccess could race this navigate and silently
      // send the user to /contacts/X first, leaving the dialog in a
      // half-unmounted state — observed 2026-05-26).
      onOpenChange(false);
      navigate(`/contacts/${result.contact.id}`, { replace: true });
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
              <Button
                type="button"
                size="sm"
                variant={mode === "none" ? "default" : "outline"}
                onClick={() => {
                  setMode("none");
                  setCreateOpportunity(false); // an opp needs an account
                }}
                className="flex-1"
              >
                No account
              </Button>
            </div>

            {mode === "none" ? (
              <p className="text-sm text-muted-foreground rounded-md border border-border p-3">
                This person will become a contact with <strong>no account</strong> — use this
                for an individual whose company you don't know yet. You can attach an account
                later, and an opportunity can only be added once they have one.
              </p>
            ) : mode === "existing" ? (
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
                      {selectedAccount.customer_status && (
                        <Badge variant="outline" className="text-xs capitalize shrink-0">
                          {customerStatusLabel(selectedAccount.customer_status as CustomerStatus)}
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
                              {a.customer_status && (
                                <Badge variant="outline" className="text-xs capitalize shrink-0">
                                  {customerStatusLabel(a.customer_status as CustomerStatus)}
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
                {/* Non-blocking nudge: if a similarly-named account already
                    exists, surface it so the rep can switch to "Existing
                    account" instead of minting a duplicate. Never blocks —
                    two real companies can share a name. */}
                <DuplicateWarning entity="accounts" name={accountName} />
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
                disabled={mode === "none"}
                onCheckedChange={(v) => setCreateOpportunity(v === true)}
              />
              <Label htmlFor="create_opportunity" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer">
                Create Opportunity
                {mode === "none" && (
                  <span className="ml-2 font-normal normal-case tracking-normal lowercase text-xs">
                    (needs an account)
                  </span>
                )}
              </Label>
            </div>

            {createOpportunity && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                {/* Read-only auto-derived name. Mirrors OpportunityForm's
                    create flow — name comes from product short codes
                    joined "SHORT1 | SHORT2 | SHORT3", never free-typed.
                    Avoids the same SF anti-pattern that lets reps
                    invent inconsistent opp titles. */}
                <div className="space-y-2">
                  <Label>Opportunity Name</Label>
                  <div className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 bg-muted/30 min-h-9">
                    <span className="font-medium truncate">
                      {derivedOpportunityName || (
                        <span className="text-muted-foreground italic font-normal">
                          Add a product to generate the name
                        </span>
                      )}
                    </span>
                    {derivedOpportunityName && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        From products
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Built automatically from the products you add — same
                    behavior as creating an opportunity from scratch. To
                    rename later, edit the opportunity directly.
                  </p>
                </div>

                {/* Stage picker only — Amount is derived from the
                    products you attach (price book × quantity − discount). */}
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

                {/* Staged products list + add button. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Products *</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAddProduct(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Products
                    </Button>
                  </div>
                  {stagedProducts.length === 0 ? (
                    <div className="border border-dashed rounded-md p-3 text-xs text-muted-foreground text-center">
                      No products yet. The opportunity name and amount
                      come from the products you add here.
                    </div>
                  ) : (
                    <div className="border rounded-md divide-y">
                      {stagedProducts.map((p, idx) => (
                        <div
                          key={`${p.product_id}-${idx}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{p.product_name}</div>
                            <div className="text-xs text-muted-foreground">
                              Qty {p.quantity} · {formatCurrency(p.arr_amount)}
                              {p.discount_percent
                                ? ` · ${p.discount_percent}% off`
                                : ""}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setStagedProducts((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            aria-label={`Remove ${p.product_name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
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
              (createOpportunity && stagedProducts.length === 0) ||
              convertMutation.isPending ||
              addProductsBulkMutation.isPending
            }
          >
            {convertMutation.isPending || addProductsBulkMutation.isPending
              ? "Converting..."
              : mode === "none"
                ? "Promote to contact (no account)"
                : mode === "existing"
                  ? "Convert into existing account"
                  : "Convert + create new account"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Product picker dialog. Same component used by OpportunityForm
          create flow — staged mode means it returns rows the caller
          owns until insert time. accountId is best-effort: only
          available when converting into an existing account; for the
          new-account path we fall back to an FTE range derived from
          the lead's employee count so price-book selection still
          works. */}
      <MultiProductPicker
        mode="staged"
        open={showAddProduct}
        onOpenChange={setShowAddProduct}
        accountId={mode === "existing" ? selectedAccount?.id ?? null : null}
        fteRange={fteRangeFromLead}
        onStage={(rows) => setStagedProducts((prev) => [...prev, ...rows])}
      />
    </Dialog>
  );
}
