import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useOpportunity,
  useCreateOpportunity,
  useUpdateOpportunity,
  useOpportunityProducts,
  useAddOpportunityProductsBulk,
  useRemoveOpportunityProduct,
  useUpdateOpportunityProduct,
} from "./api";
import { MultiProductPicker, type StagedOpportunityProduct } from "./MultiProductPicker";
import { PicklistSelect } from "@/features/picklists/PicklistSelect";
import { useFieldHelpMap } from "@/features/layouts/api";
import { HelpTooltip } from "@/components/ui/help-tooltip";

/**
 * Default win probability per stage. Mirrors the SF probability ladder
 * documented in docs/migration/salesforce-findings.md. Used to auto-fill
 * the Probability field when the rep changes stage on a brand-new opp
 * (or hasn't manually overridden it yet).
 */
const STAGE_PROBABILITY: Record<string, number> = {
  lead: 10,
  qualified: 25,
  details_analysis: 40,
  demo: 60,
  proposal_and_price_quote: 75,
  proposal: 75,
  proposal_conversation: 90,
  verbal_commit: 95,
  closed_won: 100,
  closed_lost: 0,
};
import { useAccount, useUsers } from "@/features/accounts/api";
import { AccountCombobox } from "@/components/AccountCombobox";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { getMissingRequiredFields, formatFieldLabel } from "@/lib/requiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { opportunitySchema, type OpportunityFormValues } from "./schema";
import { FTE_RANGES, employeesToFteRange } from "@/lib/formatters";
import { celebrateClosedWon } from "@/lib/confetti";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatCurrencyDetailed } from "@/lib/formatters";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";
import type { Contact, CustomFieldDefinition, Opportunity } from "@/types/crm";

/* ---------- Section wrapper ---------- */

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b pb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

/* ---------- Wrapper: handles loading, then mounts inner form ---------- */

export function OpportunityForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { data: opp, isLoading: loadingOpp } = useOpportunity(id);
  const { data: users } = useUsers(true);

  // Wait for data before mounting the form so defaultValues are correct
  if (isEditing && (loadingOpp || !opp || !users)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // key={id} forces React to remount a fresh form instance per opportunity
  return <OpportunityFormInner key={id ?? "new"} opp={opp} users={users ?? []} />;
}

/* ---------- Inner form (mounted fresh with correct defaults) ---------- */

interface UserProfile { id: string; full_name: string | null; is_active: boolean }

function OpportunityFormInner({ opp, users }: { opp: Opportunity | undefined; users: UserProfile[] }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const helpMap = useFieldHelpMap("opportunities");
  const { data: customFieldDefs } = useCustomFieldDefinitions("opportunities");
  const { data: requiredFieldsData } = useRequiredFields("opportunities");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateOpportunity();
  const updateMutation = useUpdateOpportunity();
  const { profile } = useAuth();
  const [newNote, setNewNote] = useState("");
  // Per-line inline edit state for the form's Notes log. Mirrors the
  // detail page so reps can fix a typo from either entry point. Edits
  // mutate the in-memory `notes` field via setValue and persist on form
  // save (we don't write to the DB directly here — the rest of the
  // form's edits would be lost otherwise).
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [pendingDeleteNoteIndex, setPendingDeleteNoteIndex] = useState<number | null>(null);

  // Products editor exposes a `flushDrafts()` imperative handle so the
  // form's onSubmit can persist any in-flight line-item edits as part of
  // the same Save Changes click. Previously the editor auto-saved per
  // input blur, which surprised reps: changes "stuck" even when they
  // hit Cancel, because the row was already in the DB. Now drafts live
  // only in the editor's local state until the form submits — Cancel
  // simply navigates away and the drafts vanish.
  const productsEditorRef = useRef<OpportunityProductsEditorHandle | null>(null);

  const preselectedAccountId = searchParams.get("account_id");

  // ----- Products state -----
  // Create mode: stage products locally and flush after the opp is created.
  // Edit mode: products come from the DB and are mutated directly.
  const [stagedProducts, setStagedProducts] = useState<StagedOpportunityProduct[]>([]);
  // Opportunity name is fully derived from attached products (decision
  // 2026-05-14). Users cannot type into the Name field. The override
  // state + edit-init flag that used to detect hand-typed names are
  // gone — auto-sync is always on.
  // Two-step wizard for CREATE mode:
  //   "products" — slim view with Account + Products picker only
  //   "details"  — full form with all fields, name pre-filled
  // Edit mode skips the wizard entirely.
  const [createStep, setCreateStep] = useState<"products" | "details">(
    isEditing ? "details" : "products"
  );
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const [pendingRemoveProductId, setPendingRemoveProductId] = useState<string | null>(null);

  const { data: existingProducts } = useOpportunityProducts(isEditing ? id : undefined);
  const addProductsBulkMutation = useAddOpportunityProductsBulk();
  const removeProductMutation = useRemoveOpportunityProduct();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OpportunityFormValues>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: isEditing && opp
      ? {
          account_id: opp.account_id,
          primary_contact_id: opp.primary_contact_id,
          owner_user_id: opp.owner_user_id,
          team: opp.team,
          kind: opp.kind,
          business_type: opp.business_type ?? "",
          name: opp.name,
          stage: opp.stage,
          amount: opp.amount,
          expected_close_date: opp.expected_close_date ?? "",
          close_date: opp.close_date ?? "",
          contract_start_date: opp.contract_start_date ?? "",
          contract_end_date: opp.contract_end_date ?? "",
          contract_length_months: opp.contract_length_months ?? undefined,
          contract_signed_date: opp.contract_signed_date ?? "",
          contract_year: opp.contract_year ?? undefined,
          loss_reason: opp.loss_reason ?? "",
          notes: opp.notes ?? "",
          probability: opp.probability ?? undefined,
          next_step: opp.next_step ?? "",
          lead_source: opp.lead_source ?? null,
          lead_source_detail: opp.lead_source_detail ?? "",
          payment_frequency: opp.payment_frequency ?? null,
          cycle_count: opp.cycle_count ?? undefined,
          auto_renewal: opp.auto_renewal ?? false,
          description: opp.description ?? "",
          promo_code: opp.promo_code ?? "",
          discount: opp.discount ?? undefined,
          discount_type:
            ((opp as { discount_type?: "percent" | "amount" }).discount_type) ?? "percent",
          subtotal: opp.subtotal ?? undefined,
          follow_up: opp.follow_up ?? false,
          service_amount: opp.service_amount ?? undefined,
          product_amount: opp.product_amount ?? undefined,
          services_included: opp.services_included ?? false,
          one_time_project: opp.one_time_project ?? false,
          fte_count: opp.fte_count ?? undefined,
          fte_range: (opp.fte_range ?? "") as OpportunityFormValues["fte_range"],
          created_by_automation: opp.created_by_automation ?? false,
          assigned_assessor_id: opp.assigned_assessor_id ?? null,
          original_sales_rep_id: opp.original_sales_rep_id ?? null,
          custom_fields: opp.custom_fields ?? {},
        }
      : {
          account_id: preselectedAccountId ?? "",
          primary_contact_id: null,
          // Default the owner to whoever's creating the opp (Summer's
          // request, 2026-07-07) — still changeable in the Owner select.
          owner_user_id: profile?.id ?? null,
          team: "sales",
          kind: "new_business",
          business_type: "",
          name: "",
          stage: "details_analysis",
          amount: 0,
          expected_close_date: "",
          close_date: "",
          contract_start_date: "",
          contract_end_date: "",
          contract_length_months: undefined,
          contract_signed_date: "",
          contract_year: undefined,
          loss_reason: "",
          notes: "",
          probability: undefined,
          next_step: "",
          lead_source: null,
          lead_source_detail: "",
          payment_frequency: null,
          cycle_count: undefined,
          auto_renewal: false,
          description: "",
          promo_code: "",
          discount: undefined,
          discount_type: "percent",
          subtotal: undefined,
          follow_up: false,
          service_amount: undefined,
          product_amount: undefined,
          services_included: false,
          one_time_project: false,
          fte_count: undefined,
          fte_range: "",
          created_by_automation: false,
          assigned_assessor_id: null,
          original_sales_rep_id: null,
          custom_fields: {},
        },
  });

  // The owner default above reads profile at first render; on a hard page
  // load the profile can arrive a beat later, leaving owner null. Backfill
  // it once — but only while the field is still empty, so a deliberate
  // "Unassigned" pick is never overwritten.
  useEffect(() => {
    if (!isEditing && profile?.id && !watch("owner_user_id")) {
      setValue("owner_user_id", profile.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Warn before losing edits: RHF dirty state, plus (create mode) any
  // staged products — those live outside the form but are just as easy
  // to lose. Cancel buttons route through confirmIfDirty; the post-save
  // navigates call disarm() first so saving never trips the prompt.
  const { confirmIfDirty, disarm, dialog: unsavedDialog } = useUnsavedChanges(
    isDirty || (!isEditing && stagedProducts.length > 0),
  );

  const watchedAccountId = watch("account_id");
  const watchedStage = watch("stage");
  const watchedBusinessType = watch("business_type");

  // Derive kind + team from business_type so reps only have to set
  // ONE field. Mapping (per Brayden 2026-04-28):
  //   new_business / opportunity / null  → kind=new_business, team=sales
  //   existing_business*                 → kind=renewal,      team=renewals
  // Driving from business_type means there's a single source of
  // truth for "is this a renewal or a new sale" — which the pipeline
  // and KPI views can rely on.
  // In EDIT mode, skip the initial mount run: imported renewals can have a
  // null business_type, and deriving on mount would silently flip them to
  // new_business/sales (knocking them out of the renewals queue) just by
  // opening + saving. Only respond to a genuine user change of Business Type.
  const businessTypeDerivationReady = useRef(!isEditing);
  useEffect(() => {
    if (!businessTypeDerivationReady.current) {
      businessTypeDerivationReady.current = true;
      return;
    }
    const bt = (watchedBusinessType ?? null) as string | null;
    const isExisting = !!bt && bt.startsWith("existing_business");
    const targetKind = isExisting ? "renewal" : "new_business";
    const targetTeam = isExisting ? "renewals" : "sales";
    if (watch("kind") !== targetKind) {
      setValue("kind", targetKind as "new_business" | "renewal", { shouldDirty: true });
    }
    if (watch("team") !== targetTeam) {
      setValue("team", targetTeam as "sales" | "renewals", { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedBusinessType]);

  const { data: contacts } = useQuery({
    queryKey: ["contacts", { account_id: watchedAccountId }],
    queryFn: async () => {
      if (!watchedAccountId) return [];
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("account_id", watchedAccountId)
        .order("last_name");
      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!watchedAccountId,
  });

  // Fetch full account data for the selected account (FTE, lead source, partner, etc.)
  const { data: selectedAccount } = useAccount(watchedAccountId || undefined);
  useEffect(() => {
    if (!watchedAccountId || isEditing) return;
    const acct = selectedAccount;
    if (!acct) return;
    if (acct.lead_source) {
      setValue("lead_source", acct.lead_source as OpportunityFormValues["lead_source"]);
    }
    // Snapshot FTE from account for new opportunities. Imported accounts
    // often have fte_count populated (from SF NumberOfEmployees) but
    // fte_range null — derive the range from the count so the price-book
    // auto-pick has something to match on.
    const fteCount = acct.fte_count ?? acct.employees ?? null;
    if (fteCount != null) {
      setValue("fte_count", fteCount);
    }
    const fteRange =
      acct.fte_range || (fteCount != null ? employeesToFteRange(fteCount) : null);
    if (fteRange) {
      setValue("fte_range", fteRange as OpportunityFormValues["fte_range"]);
    }
  }, [watchedAccountId, selectedAccount, isEditing, setValue]);

  // Keep Amount = Subtotal × (1 − Discount/100) so reps see the impact
  // of a discount on the deal total in real time. Discount is a PERCENT
  // (0–100), matching the DB trigger recalc_opportunity_amount.
  //
  // We track which field the user last edited to avoid a feedback loop
  // when they manually change Amount (which then back-solves Subtotal):
  //   - Edit Subtotal or Discount → Amount auto-updates
  //   - Edit Amount → Subtotal back-solves to amount / (1 − disc/100)
  const watchedSubtotal = watch("subtotal");
  const watchedDiscount = watch("discount");
  const watchedAmount = watch("amount");
  const watchedDiscountType = watch("discount_type");
  const lastEditedRef = useRef<"subtotal" | "discount" | "amount" | null>(null);

  // hasProducts is true in edit mode when the opp already has line items.
  // In that case, amount is auto-calculated by the DB trigger and should
  // NOT be recomputed from subtotal here — that would overwrite the real
  // post-discount value with gross-subtotal math.
  const hasProducts = isEditing && existingProducts != null && existingProducts.length > 0;
  // existingProducts is `undefined` while the line-items query is still
  // in flight. The auto-recalc effects below MUST wait for it; otherwise
  // an opp whose amount is line-item-driven gets clobbered on first
  // render (effect runs → hasProducts is still false → overwrites
  // amount with subtotal × (1−disc/100), losing per-line-item discount
  // math). User-reported as: "edit form 0's out the data and throws
  // errors."  See OpportunityProductsEditor — inline edit on detail
  // page already worked because that flow doesn't gate amount.
  const productsLoaded = !isEditing || existingProducts !== undefined;

  useEffect(() => {
    if (!productsLoaded) return; // wait until we know if opp has products
    if (hasProducts) return; // DB trigger owns amount when products exist
    // Only recompute when the USER edited subtotal or discount. On initial
    // mount, lastEditedRef.current is null because reset() populated the
    // form from DB values — we must NOT recompute then, or SF-imported
    // opps with subtotal=0, discount=0, amount=12000 get silently zeroed.
    // (Issue: discount on SF data was informational, not multiplicative.)
    if (
      lastEditedRef.current !== "subtotal" &&
      lastEditedRef.current !== "discount"
    ) {
      return;
    }
    // Base off subtotal, but fall back to the current amount when subtotal is
    // unset (amount-only / SF-imported opps) so editing the discount can't
    // divide into 0 and silently zero out the deal. No usable base -> bail.
    const base = Number(watchedSubtotal) || Number(watchedAmount) || 0;
    if (base <= 0) return;
    // Honor discount_type: a flat-$ ('amount') discount subtracts dollars; a
    // percent discount scales. Treating an amount-type discount as a percent
    // (the old behavior) corrupted the deal amount. Floor at 0.
    const dtype = watchedDiscountType === "amount" ? "amount" : "percent";
    let next: number;
    if (dtype === "amount") {
      const discAmt = Math.max(0, Number(watchedDiscount) || 0);
      next = Math.round(Math.max(0, base - discAmt) * 100) / 100;
    } else {
      const discPct = Math.max(0, Math.min(100, Number(watchedDiscount) || 0));
      next = Math.round(base * (1 - discPct / 100) * 100) / 100;
    }
    // Persist the gross base into subtotal when it wasn't set, so the displayed
    // subtotal is populated and a second discount edit re-derives from the
    // original value instead of compounding off the discounted amount.
    if (!(Number(watchedSubtotal) > 0)) {
      setValue("subtotal", Math.round(base * 100) / 100, { shouldDirty: true });
    }
    if (next !== Number(watchedAmount)) {
      setValue("amount", next, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedSubtotal, watchedDiscount, watchedDiscountType, hasProducts, productsLoaded]);

  useEffect(() => {
    if (!productsLoaded) return;
    if (hasProducts) return;
    if (lastEditedRef.current !== "amount") return;
    // User typed in Amount directly → back-solve Subtotal, honoring discount_type.
    const amt = Number(watchedAmount) || 0;
    let nextSub: number;
    if (watchedDiscountType === "amount") {
      // amount = subtotal - discAmt  =>  subtotal = amount + discAmt
      nextSub = Math.round((amt + Math.max(0, Number(watchedDiscount) || 0)) * 100) / 100;
    } else {
      const discPct = Math.max(0, Math.min(99.99, Number(watchedDiscount) || 0));
      const factor = 1 - discPct / 100;
      if (factor <= 0) return;
      nextSub = Math.round((amt / factor) * 100) / 100;
    }
    if (nextSub !== Number(watchedSubtotal)) {
      setValue("subtotal", nextSub, { shouldDirty: true });
    }
    // Reset the flag so the next subtotal/discount edit re-triggers.
    lastEditedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedAmount, hasProducts, productsLoaded]);

  // ----- Auto-set probability from stage -----
  // Whenever the stage changes, populate probability from the SF
  // ladder UNLESS the user has explicitly set a value (we detect that
  // by comparing — if the current probability matches the OLD stage's
  // default, treat it as auto-managed and overwrite).
  const watchedProbability = watch("probability");
  const [probabilityUserOverridden, setProbabilityUserOverridden] = useState(
    () => {
      if (!isEditing || !opp) return false;
      // If existing probability doesn't match the stage default, the user
      // explicitly set it. Don't auto-overwrite on edit.
      const stageDefault = STAGE_PROBABILITY[opp.stage as string];
      // Treat a null/blank probability as NOT user-overridden — many
      // imported opps have no probability and should still auto-manage.
      return (
        opp.probability != null &&
        stageDefault !== undefined &&
        opp.probability !== stageDefault
      );
    },
  );
  // Skip the mount run in edit mode so opening an opp never stamps/dirties
  // probability; only a real stage change auto-fills it.
  const probabilityAutoFillReady = useRef(!isEditing);
  useEffect(() => {
    if (!probabilityAutoFillReady.current) {
      probabilityAutoFillReady.current = true;
      return;
    }
    if (!watchedStage) return;
    if (probabilityUserOverridden) return;
    const next = STAGE_PROBABILITY[watchedStage as string];
    if (next === undefined) return;
    if (Number(watchedProbability) === next) return;
    setValue("probability", next, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedStage, probabilityUserOverridden]);

  // ----- Auto-derive opportunity name from attached product codes -----
  // Format: "Code1 | Code2 | Code3" — pipe-separated, matching the SF
  // naming convention (e.g. "SRA | Onsite Services | BNVA"). Always
  // applied (in both create + edit modes) — the name field is no
  // longer user-editable.
  /**
   * Compute the suggested opp name from currently-attached products.
   * Works in both CREATE (stagedProducts) and EDIT (existingProducts) mode.
   * Format: "SHORT1 | SHORT2 | SHORT3" — pipe-separated, consistent.
   * Falls back through short_name → code → name per product.
   */
  const suggestedName = (() => {
    const sources = isEditing
      ? (existingProducts ?? []).map((ep) => ({
          short: ep.product?.short_name ?? null,
          code: ep.product?.code ?? null,
          name: ep.product?.name ?? null,
        }))
      : stagedProducts.map((p) => ({
          short: p.product_short_name ?? null,
          code: p.product_code ?? null,
          name: p.product_name ?? null,
        }));
    const labels = sources
      .map((s) => {
        const sn = s.short?.trim();
        if (sn) return sn;
        const code = s.code?.trim();
        if (code) return code;
        const nm = s.name?.trim();
        return nm || null;
      })
      .filter((c): c is string => !!c);
    return labels.length ? labels.join(" | ") : "";
  })();

  // Auto-sync name from products whenever the product list changes. In
  // both create + edit modes — name is purely a function of attached
  // products, never a free-text field.
  useEffect(() => {
    if (!suggestedName) return;
    if (suggestedName !== watch("name")) {
      // shouldDirty=true in EDIT so the user sees the "save" prompt and
      // the change actually persists when they hit Save Opportunity.
      setValue("name", suggestedName, { shouldDirty: isEditing });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedName, isEditing]);

  function emptyToNull(v: unknown): unknown {
    if (v === "" || v === undefined) return null;
    return v;
  }

  async function onSubmit(values: OpportunityFormValues) {
    // Check dynamic required fields. In edit mode, a field that was
    // already empty on the original opportunity is grandfathered — it
    // only blocks the save if we're clearing a value that used to be
    // there. See src/lib/requiredFields.ts for the full rationale.
    const missingFields = getMissingRequiredFields(
      requiredKeys,
      values,
      opp as Record<string, unknown> | undefined
    );
    if (missingFields.length > 0) {
      toast.error(
        `Required fields missing: ${missingFields.map(formatFieldLabel).join(", ")}`
      );
      return;
    }

    // Force at least one product on new (manually-created) opps.
    // Automation-created opps (created_by_automation=true) are exempt
    // because the renewal automation attaches products after insert.
    // This matches Anna's feedback: "make it so you are forced to add
    // products when creating an opportunity."
    if (!isEditing && stagedProducts.length === 0) {
      toast.error(
        "Add at least one product before saving — an opportunity needs something to quote."
      );
      return;
    }

    const payload: Record<string, unknown> = {
      account_id: values.account_id,
      primary_contact_id: values.primary_contact_id || null,
      owner_user_id: values.owner_user_id ?? null,
      team: values.team,
      kind: values.kind,
      business_type: emptyToNull(values.business_type),
      name: values.name,
      stage: values.stage,
      amount: Number(values.amount),
      expected_close_date: emptyToNull(values.expected_close_date),
      close_date: emptyToNull(values.close_date),
      contract_start_date: emptyToNull(values.contract_start_date),
      contract_end_date: emptyToNull(values.contract_end_date),
      contract_length_months: emptyToNull(values.contract_length_months),
      contract_signed_date: emptyToNull(values.contract_signed_date),
      contract_year: emptyToNull(values.contract_year),
      loss_reason: emptyToNull(values.loss_reason),
      notes: emptyToNull(values.notes),
      probability: values.probability ?? null,
      next_step: emptyToNull(values.next_step),
      lead_source: values.lead_source ?? null,
      lead_source_detail: emptyToNull(values.lead_source_detail),
      payment_frequency: values.payment_frequency ?? null,
      // DB constraint: cycle_count must be NULL or > 0. Coerce 0/empty
      // to null so old opps with no cycle_count can still be edited
      // without tripping opportunities_cycle_count_check.
      cycle_count: Number(values.cycle_count) > 0 ? Number(values.cycle_count) : null,
      auto_renewal: values.auto_renewal ?? false,
      description: emptyToNull(values.description),
      promo_code: emptyToNull(values.promo_code),
      discount: values.discount ?? null,
      discount_type: emptyToNull(values.discount_type) ?? "percent",
      subtotal: values.subtotal ?? null,
      follow_up: values.follow_up ?? false,
      service_amount: values.service_amount ?? null,
      product_amount: values.product_amount ?? null,
      services_included: values.services_included ?? false,
      one_time_project: values.one_time_project ?? false,
      fte_count: values.fte_count ?? null,
      fte_range: emptyToNull(values.fte_range),
      created_by_automation: values.created_by_automation ?? false,
      assigned_assessor_id: values.assigned_assessor_id ?? null,
      original_sales_rep_id: values.original_sales_rep_id ?? null,
      custom_fields: values.custom_fields ?? {},
      // Name is always auto-synced from attached products now (decision
      // 2026-05-14). The server-side trigger and this client-side
      // useEffect both keep `name` in sync on every product change.
      name_auto_sync: true,
    };

    // When the opp has line items, amount/subtotal/service_amount/product_amount
    // are DERIVED — owned by the line-item recompute (DB trigger + recalc RPC),
    // which runs on every product add/remove/edit. The form loads these as
    // read-only snapshots and never recomputes them (hasProducts gates the
    // auto-recalc effects above). So sending them here would clobber a fresh
    // recompute: e.g. swap a product in the editor (amount recomputes to the
    // new price immediately), then this save writes back the STALE loaded
    // amount. That's exactly the "moved to small-practice SRA but Amount still
    // shows the old $1,350" bug. The flushDrafts() ordering below only covers
    // pending ROW edits, not immediate add/remove — so drop the derived
    // totals from the payload entirely and let the recompute own them.
    if (hasProducts) {
      delete payload.amount;
      delete payload.subtotal;
      delete payload.service_amount;
      delete payload.product_amount;
    }

    try {
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, ...payload } as Parameters<typeof updateMutation.mutateAsync>[0]);
        // Flush pending product line-item edits AFTER the opp-level
        // update so the per-line recompute (inside commitDraft) has the
        // final say on amount/subtotal. (Derived totals are already omitted
        // from the payload above when the opp has line items.)
        try {
          await productsEditorRef.current?.flushDrafts();
        } catch (err) {
          toast.error(
            "Opportunity saved, but one or more product edits failed: " +
              (err as Error).message,
          );
          // Stay on the page so the rep can retry the line edits.
          return;
        }
        // Belt-and-suspenders: recompute totals from the line items as the
        // very last step. recalc_opportunity_amount is idempotent and BAILS
        // when the opp has no line items, so this preserves a manually-entered
        // amount on amount-only opps while guaranteeing line-item opps reflect
        // their products — even in edge paths (e.g. adding the first product to
        // a previously product-less opp, where hasProducts was false at load
        // and the payload still carried a stale amount). Best-effort; the
        // triggers already ran on each line edit, so a failure here is benign.
        try {
          await supabase.rpc("recalc_opportunity_amount", { p_opp_id: id });
        } catch {
          /* triggers already handled it; ignore */
        }
        toast.success("Opportunity updated");
        // Celebrate only a genuine transition INTO Closed Won (not a
        // re-save of an already-won deal).
        if (values.stage === "closed_won" && opp?.stage !== "closed_won") {
          celebrateClosedWon();
        }
        // After a transition INTO Closed Lost, hand the "still a client?" prompt
        // (Summer's request) to the detail page via a query flag — it asks only
        // if the account is currently a Client.
        const lostTransition = values.stage === "closed_lost" && opp?.stage !== "closed_lost";
        disarm();
        navigate(`/opportunities/${id}${lostTransition ? "?ask_client_status=1" : ""}`);
      } else {
        const result = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);

        // Flush any products the user staged before the opp existed.
        // Use the BULK insert so the client-side recompute fires after
        // all rows land. The previous per-row loop only relied on the
        // DB trigger for amount/subtotal, which racy under invalidation
        // caused the detail page to flash the pre-trigger amount=0
        // before resettling. Bulk insert + client-side recompute keeps
        // the displayed total in sync immediately.
        if (stagedProducts.length > 0) {
          try {
            await addProductsBulkMutation.mutateAsync({
              opportunity_id: result.id,
              rows: stagedProducts.map((sp) => ({
                product_id: sp.product_id,
                quantity: sp.quantity,
                unit_price: sp.unit_price,
                arr_amount: sp.arr_amount,
                discount_percent: sp.discount_percent,
                discount_type: sp.discount_type,
              })),
            });
            toast.success(
              `Opportunity created with ${stagedProducts.length} product${stagedProducts.length !== 1 ? "s" : ""}`
            );
          } catch (err) {
            console.error("Failed to attach staged products:", err);
            toast.error(
              "Opportunity created, but products failed to attach. Open it and add them from the products section."
            );
          }
        } else {
          toast.success("Opportunity created");
        }

        disarm();
        navigate(`/opportunities/${result.id}`);
      }
    } catch (err) {
      console.error("Failed to save opportunity:", err);
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

  // When creating from an account page, lock the account selection
  const accountLocked = isEditing || !!preselectedAccountId;

  // ----- Step 1 of CREATE wizard: Account + Products only -----
  // Forces the user to make those two decisions first, which auto-fills
  // the opp name + amount + price book on Step 2. Edit mode skips this
  // entirely. Account-preselected create (from /accounts/<id>/opps/new)
  // also skips since the account is already locked.
  if (!isEditing && createStep === "products") {
    const watchedAccountId = watch("account_id");
    // Force at least one product before continuing. We removed the
    // "Skip — I'll add products later" escape hatch (Brayden 2026-04-28)
    // because too many opps were getting created empty.
    const canContinue = !!watchedAccountId && stagedProducts.length > 0;
    return (
      <div>
        <PageHeader
          title="New Opportunity"
          description="Step 1 of 2 — pick the account and the products you're selling. We'll auto-fill the rest on the next step."
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Account picker */}
            <div className="space-y-2">
              <Label>
                Account *
              </Label>
              <AccountCombobox
                value={watchedAccountId || null}
                onChange={(v) => setValue("account_id", v ?? "", { shouldDirty: true })}
                placeholder="Pick an account..."
                disabled={!!preselectedAccountId}
              />
            </div>

            {/* Products picker — same component as Step 2, just isolated here */}
            <div className="space-y-2">
              <Label>Products</Label>
              <p className="text-xs text-muted-foreground">
                Pick products. Their unit prices come from the account's FTE
                price book. The opp name will be auto-built from the product
                short names ("SRA | CO Training | Remote Services").
              </p>
              {watchedAccountId ? (
                <OpportunityProductsEditor
                  isEditing={false}
                  opportunityId={null}
                  stagedProducts={stagedProducts}
                  existingProducts={[]}
                  onOpenAdd={() => setShowAddProduct(true)}
                  onRemoveStaged={(idx) => setPendingRemoveIdx(idx)}
                  onRemoveExisting={() => {}}
                />
              ) : (
                <div className="border border-dashed rounded-md p-4 text-sm text-muted-foreground text-center">
                  Pick an account first, then add products.
                </div>
              )}
            </div>

            {/* Step navigation */}
            <div className="flex items-center justify-between pt-4 border-t">
              {unsavedDialog}
              <Button type="button" variant="ghost" onClick={() => confirmIfDirty(() => navigate(-1))}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setCreateStep("details")}
                disabled={!canContinue}
              >
                Continue →
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* The picker dialog is the same one used on Step 2; reuse it here */}
        <MultiProductPicker
          mode="staged"
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          accountId={watchedAccountId ?? null}
          fteRange={null}
          onStage={(rows) =>
            // Dedupe by product_id (last write wins) — the DB has a unique
            // (opportunity_id, product_id) and upserts on it, so staging the
            // same product twice would silently collapse on save and the
            // preview total would overstate what's persisted. Merge here so
            // the preview always matches the saved result.
            setStagedProducts((prev) => {
              const byId = new Map(prev.map((p) => [p.product_id, p]));
              for (const r of rows) byId.set(r.product_id, r);
              return [...byId.values()];
            })
          }
        />

        {/* Confirm-remove dialog (in case user picks then removes) */}
        <ConfirmDialog
          open={pendingRemoveIdx !== null}
          onOpenChange={(o) => !o && setPendingRemoveIdx(null)}
          title="Remove product?"
          description={
            pendingRemoveIdx !== null && stagedProducts[pendingRemoveIdx]
              ? `Remove ${stagedProducts[pendingRemoveIdx].product_name} from this opportunity?`
              : ""
          }
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            if (pendingRemoveIdx !== null) {
              setStagedProducts((prev) => prev.filter((_, i) => i !== pendingRemoveIdx));
              setPendingRemoveIdx(null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEditing ? "Edit Opportunity" : "New Opportunity — Details"}
        description={
          isEditing
            ? undefined
            : "Step 2 of 2 — review the auto-filled name + amount, fill in the rest."
        }
      />
      {!isEditing && (
        <div className="mb-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreateStep("products")}
          >
            ← Back to products
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit, (formErrors) => {
              // Without this, a validation failure (e.g. a >100% discount)
              // silently no-ops the Save button — onSubmit never runs and
              // nothing is shown. Surface the first error so the rep knows why.
              const firstMsg = Object.values(formErrors)
                .map((e) => (e as { message?: string } | undefined)?.message)
                .find(Boolean);
              toast.error(
                firstMsg ? String(firstMsg) : "Please fix the highlighted fields before saving.",
              );
            })}
            className="space-y-8"
          >
            {/* ---- Basic Info ---- */}
            <FormSection title="Basic Info">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="name">Opportunity Name *<RequiredIndicator fieldKey="name" requiredFields={requiredKeys} /></Label>
                  {/* Auto-generated from attached product short names — no
                      manual edit. Decision 2026-05-14: the name is a
                      function of products, not a free-text field. The
                      hidden input keeps RHF's value flow intact for the
                      submit payload. */}
                  <Input
                    id="name"
                    type="hidden"
                    {...register("name")}
                  />
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-mono min-h-[2.25rem] flex items-center">
                    {watch("name")?.trim() ||
                      (stagedProducts.length === 0
                        ? "(add products — name auto-builds from product short names)"
                        : "(generating…)")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Auto-built from attached product short names (e.g.{" "}
                    <span className="font-mono">SRA | CO Training | Remote Services</span>
                    ). Add or remove products to change the name.
                  </p>
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Account *<RequiredIndicator fieldKey="account_id" requiredFields={requiredKeys} /></Label>
                  {accountLocked ? (
                    <Input
                      value={selectedAccount?.name ?? opp?.account?.name ?? "Loading..."}
                      disabled
                      className="bg-muted"
                    />
                  ) : (
                    <AccountCombobox
                      value={watchedAccountId || null}
                      onChange={(v) => setValue("account_id", v ?? "")}
                      placeholder="Select account"
                    />
                  )}
                  {errors.account_id && <p className="text-sm text-destructive">{errors.account_id.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Primary Contact<RequiredIndicator fieldKey="primary_contact_id" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("primary_contact_id") ?? "none"}
                    onValueChange={(v) => setValue("primary_contact_id", v === "none" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select contact" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {contacts?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.first_name} {c.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Opportunity Owner<RequiredIndicator fieldKey="owner_user_id" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("owner_user_id") ?? "unassigned"}
                    onValueChange={(v) => setValue("owner_user_id", v === "unassigned" ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.id}{!u.is_active ? " (inactive)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Assigned Assessor</Label>
                  <Select
                    value={watch("assigned_assessor_id") ?? "unassigned"}
                    onValueChange={(v) => setValue("assigned_assessor_id", v === "unassigned" ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select assessor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.id}{!u.is_active ? " (inactive)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">For SRA/NVA service assessments</p>
                </div>

                <div className="space-y-2">
                  <Label>Original Sales Rep</Label>
                  <Select
                    value={watch("original_sales_rep_id") ?? "unassigned"}
                    onValueChange={(v) => setValue("original_sales_rep_id", v === "unassigned" ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select sales rep" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">None</SelectItem>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.id}{!u.is_active ? " (inactive)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Preserved when renewals takes ownership</p>
                </div>

                {/* Kind + Team are now derived from Business Type
                    (see effect below). Reps were confused by having
                    three overlapping fields. Single source of truth =
                    Business Type. */}

                <div className="space-y-2">
                  <Label>Business Type</Label>
                  <Select
                    value={(watch("business_type") as string) || "none"}
                    onValueChange={(v) =>
                      setValue("business_type", v === "none" ? "" : (v as never))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select business type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="new_business">New Business</SelectItem>
                      <SelectItem value="existing_business">Existing Business</SelectItem>
                      <SelectItem value="existing_business_new_product">Existing Business — New Product</SelectItem>
                      <SelectItem value="existing_business_new_service">Existing Business — New Service</SelectItem>
                      <SelectItem value="opportunity">Opportunity</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Revenue-reporting category. Use "Opportunity" for deals still being qualified or where a sales-team closed_lost shouldn't roll up as losing a customer.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Stage<RequiredIndicator fieldKey="stage" requiredFields={requiredKeys} /></Label>
                  <Select value={watchedStage} onValueChange={(v) => setValue("stage", v as OpportunityFormValues["stage"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="details_analysis">Details Analysis</SelectItem>
                      <SelectItem value="demo">Demo</SelectItem>
                      <SelectItem value="proposal_and_price_quote">Proposal and Price Quote</SelectItem>
                      <SelectItem value="proposal_conversation">Proposal Conversation</SelectItem>
                      <SelectItem value="closed_won">Closed Won</SelectItem>
                      <SelectItem value="closed_lost">Closed Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="probability">Probability (%)<RequiredIndicator fieldKey="probability" requiredFields={requiredKeys} /></Label>
                  <Input
                    id="probability"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    {...register("probability", {
                      onChange: () => {
                        if (!probabilityUserOverridden) setProbabilityUserOverridden(true);
                      },
                    })}
                  />
                  {errors.probability && <p className="text-sm text-destructive">{errors.probability.message}</p>}
                </div>
              </div>
            </FormSection>

            {/* ---- Products (CREATE mode only — sits high so picking
                 products is the second thing the user does after Basic
                 Info. EDIT mode keeps the original position lower in
                 the form.) ---- */}
            {!isEditing && (
              <FormSection title="Products">
                <p className="text-xs text-muted-foreground mb-3">
                  Pick products first — this auto-fills the opportunity
                  name, the Amount, and matches the right price book based
                  on the account's FTE range. You can edit the name and
                  amount manually below if needed.
                </p>
                <OpportunityProductsEditor
                  isEditing={isEditing}
                  opportunityId={id ?? null}
                  stagedProducts={stagedProducts}
                  existingProducts={existingProducts ?? []}
                  onOpenAdd={() => setShowAddProduct(true)}
                  onRemoveStaged={(idx) => setPendingRemoveIdx(idx)}
                  onRemoveExisting={(productRowId) => setPendingRemoveProductId(productRowId)}
                />
              </FormSection>
            )}

            {/* ---- Financial ---- */}
            <FormSection title="Financial">
              <p className="text-xs text-muted-foreground mb-3">
                <span className="font-medium text-foreground">Amount</span> and{" "}
                <span className="font-medium text-foreground">Subtotal</span> are
                auto-calculated from the products on the opportunity. To change the
                total, add or remove products or adjust their unit prices. Use{" "}
                <span className="font-medium text-foreground">Overall Adjustment Discount</span> for
                a deal-level reduction on top of any product-level discounts, and{" "}
                <span className="font-medium text-foreground">Promo Code</span> if
                the adjustment is tied to a marketing campaign.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="subtotal" className="inline-flex items-center gap-1">
                    Subtotal ($)
                    <HelpTooltip text={helpMap.get("subtotal")} />
                  </Label>
                  <Input
                    id="subtotal"
                    type="number"
                    step="0.01"
                    {...register("subtotal", {
                      onChange: () => { lastEditedRef.current = "subtotal"; },
                    })}
                  />
                  <p className="text-xs text-muted-foreground">{helpMap.get("subtotal") ?? "Sum of product line items BEFORE the overall adjustment discount. Editable for manual corrections."}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount" className="inline-flex items-center gap-1">
                    Overall Adjustment Discount (%)
                    <HelpTooltip text={helpMap.get("discount")} />
                  </Label>
                  <div className="relative">
                    <Input
                      id="discount"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      {...register("discount", {
                        onChange: () => { lastEditedRef.current = "discount"; },
                      })}
                      className="pr-8"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
                  </div>
                  {errors.discount && <p className="text-sm text-destructive">{errors.discount.message}</p>}
                  <p className="text-xs text-muted-foreground">{helpMap.get("discount") ?? "Deal-level percent reduction applied on top of any product-level discounts. 0–100. Updates the Amount automatically."}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount" className="inline-flex items-center gap-1">
                    Amount ($) *<RequiredIndicator fieldKey="amount" requiredFields={requiredKeys} />
                    <HelpTooltip text={helpMap.get("amount")} />
                  </Label>
                  {isEditing && existingProducts != null && existingProducts.length > 0 ? (
                    <>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        readOnly
                        className="bg-muted cursor-not-allowed"
                        {...register("amount")}
                      />
                      <p className="text-xs text-muted-foreground">{helpMap.get("amount") ?? "Auto-calculated from line items. Edit products to change this value."}</p>
                    </>
                  ) : (
                    <>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        {...register("amount", {
                          onChange: () => { lastEditedRef.current = "amount"; },
                        })}
                      />
                      <p className="text-xs text-muted-foreground">{helpMap.get("amount") ?? "Final deal value AFTER the overall adjustment discount. Auto-calculated as Subtotal × (1 − Discount/100). Editable for manual corrections (will back-solve Subtotal)."}</p>
                    </>
                  )}
                  {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="promo_code">Promo Code</Label>
                  <Input id="promo_code" {...register("promo_code")} />
                  <p className="text-xs text-muted-foreground">Optional — tag a discount with a campaign code.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="service_amount">Service Amount ($)</Label>
                  <Input id="service_amount" type="number" step="0.01" {...register("service_amount")} />
                  <p className="text-xs text-muted-foreground">Portion of the deal that's services (onboarding, SRA, etc.).</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="product_amount">Product Amount ($)</Label>
                  <Input id="product_amount" type="number" step="0.01" {...register("product_amount")} />
                  <p className="text-xs text-muted-foreground">Portion that's recurring product ARR (Platform, training, etc.).</p>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="services_included"
                    checked={watch("services_included") ?? false}
                    onCheckedChange={(v) => setValue("services_included", v === true)}
                  />
                  <Label htmlFor="services_included" className="text-sm font-normal cursor-pointer">
                    Services Included
                  </Label>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="one_time_project"
                    checked={watch("one_time_project") ?? false}
                    onCheckedChange={(v) => setValue("one_time_project", v === true)}
                  />
                  <Label htmlFor="one_time_project" className="text-sm font-normal cursor-pointer">
                    One Time Project
                  </Label>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="created_by_automation"
                    checked={watch("created_by_automation") ?? false}
                    onCheckedChange={(v) => setValue("created_by_automation", v === true)}
                  />
                  <Label htmlFor="created_by_automation" className="text-sm font-normal cursor-pointer">
                    Created by Automation
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label>Payment Frequency</Label>
                  <PicklistSelect
                    fieldKey="opportunities.payment_frequency"
                    value={watch("payment_frequency")}
                    onChange={(v) =>
                      setValue(
                        "payment_frequency",
                        (v ?? null) as OpportunityFormValues["payment_frequency"],
                      )
                    }
                    allowClear
                  />
                </div>
              </div>
            </FormSection>

            {/* ---- Dates & Contract ---- */}
            <FormSection title="Dates & Contract">
              <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-900 p-3 text-xs">
                <p className="font-semibold mb-1">When do these dates move?</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>
                    <strong>Expected Close</strong> — move this when a deal
                    slips. Used for forecasting.
                  </li>
                  <li>
                    <strong>Close Date</strong> — auto-fills on Closed Won /
                    Lost. Edit only to fix bad data.
                  </li>
                  <li>
                    <strong>Contract Start / End</strong> — only move on an
                    actual contract amendment. These drive renewal timing —
                    if a renewal deal slips in negotiation but the new term
                    still starts on the original anniversary, leave these
                    alone.
                  </li>
                </ul>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expected_close_date">Expected Close Date<RequiredIndicator fieldKey="expected_close_date" requiredFields={requiredKeys} /></Label>
                  <Input id="expected_close_date" type="date" {...register("expected_close_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close_date">Close Date</Label>
                  <Input id="close_date" type="date" {...register("close_date")} />
                  <p className="text-xs text-muted-foreground">
                    Auto-filled when stage changes to Closed Won or Closed
                    Lost. Editable for corrections / data cleanup — every
                    change is audit-logged.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_start_date">Contract Start<RequiredIndicator fieldKey="contract_start_date" requiredFields={requiredKeys} /></Label>
                  <Input id="contract_start_date" type="date" {...register("contract_start_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_end_date">Maturity Date<RequiredIndicator fieldKey="contract_end_date" requiredFields={requiredKeys} /></Label>
                  <Input id="contract_end_date" type="date" {...register("contract_end_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_signed_date">Contract Signed Date</Label>
                  <Input id="contract_signed_date" type="date" {...register("contract_signed_date")} />
                  <p className="text-xs text-muted-foreground">Auto-set on Closed Won if blank</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_length_months">Contract Length</Label>
                  <PicklistSelect
                    id="contract_length_months"
                    fieldKey="opportunities.contract_length_months"
                    value={watch("contract_length_months") as number | null | undefined}
                    onChange={(v) =>
                      setValue(
                        "contract_length_months",
                        v == null ? undefined : Number(v),
                        { shouldDirty: true },
                      )
                    }
                    allowClear
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_year">Contract Year</Label>
                  <PicklistSelect
                    id="contract_year"
                    fieldKey="opportunities.contract_year"
                    value={watch("contract_year") as number | null | undefined}
                    onChange={(v) =>
                      setValue(
                        "contract_year",
                        v == null ? undefined : Number(v),
                        { shouldDirty: true },
                      )
                    }
                    allowClear
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cycle_count">Cycle Count</Label>
                  <Input id="cycle_count" type="number" min={0} {...register("cycle_count")} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="auto_renewal"
                    checked={watch("auto_renewal") ?? false}
                    onCheckedChange={(v) => setValue("auto_renewal", v === true)}
                  />
                  <Label htmlFor="auto_renewal" className="text-sm font-normal cursor-pointer">
                    Auto Renewal
                  </Label>
                </div>
              </div>
            </FormSection>

            {/* ---- Source & Next Steps ---- */}
            <FormSection title="Source & Next Steps">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Lead Source<RequiredIndicator fieldKey="lead_source" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("lead_source") ?? "none"}
                    onValueChange={(v) => setValue("lead_source", v === "none" ? null : v as OpportunityFormValues["lead_source"])}
                  >
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="webinar">Webinar</SelectItem>
                      <SelectItem value="podcast">Podcast</SelectItem>
                      <SelectItem value="conference">Conference</SelectItem>
                      <SelectItem value="email_campaign">Email Campaign</SelectItem>
                      <SelectItem value="sql">SQL</SelectItem>
                      <SelectItem value="mql">MQL</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="cold_call">Cold Call</SelectItem>
                      <SelectItem value="trade_show">Trade Show</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lead_source_detail">Lead Source Detail</Label>
                  <Input id="lead_source_detail" placeholder="Additional info (discount type, event name, etc.)" {...register("lead_source_detail")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="next_step">Next Step<RequiredIndicator fieldKey="next_step" requiredFields={requiredKeys} /></Label>
                  <Input id="next_step" {...register("next_step")} />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    id="follow_up"
                    checked={watch("follow_up") ?? false}
                    onCheckedChange={(v) => setValue("follow_up", v === true)}
                  />
                  <Label htmlFor="follow_up" className="text-sm font-normal cursor-pointer">
                    Follow Up
                  </Label>
                </div>
              </div>

              {watchedStage === "closed_lost" && (
                <div className="space-y-2 mt-4">
                  <Label htmlFor="loss_reason">Loss Reason</Label>
                  <Textarea id="loss_reason" rows={3} {...register("loss_reason")} />
                </div>
              )}
            </FormSection>

            {/* ---- FTE Snapshot ---- */}
            <FormSection title="FTE Snapshot">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>FTE Count</Label>
                  <Input
                    type="number"
                    {...register("fte_count", {
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        const num = parseInt(e.target.value, 10);
                        if (!isNaN(num) && num > 0) {
                          setValue("fte_range", employeesToFteRange(num) as OpportunityFormValues["fte_range"]);
                        }
                      },
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>FTE Range</Label>
                  <Select
                    value={watch("fte_range") || "none"}
                    onValueChange={(v) => setValue("fte_range", v === "none" ? "" as OpportunityFormValues["fte_range"] : v as OpportunityFormValues["fte_range"])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- None --</SelectItem>
                      {FTE_RANGES.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedAccount && (
                  <div className="space-y-2 col-span-1 md:col-span-2">
                    <Label className="text-muted-foreground text-xs">Current Account FTE</Label>
                    <p className="text-sm text-muted-foreground pt-1">
                      {selectedAccount.fte_count != null ? `${selectedAccount.fte_count.toLocaleString()} employees` : "Not set"}
                      {selectedAccount.fte_range ? ` (${selectedAccount.fte_range})` : ""}
                    </p>
                  </div>
                )}
              </div>
            </FormSection>

            {/* ---- Account Reference (read-only) ---- */}
            {selectedAccount && (
              <FormSection title="Account Reference">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Lead Source (from Account)</Label>
                    <Input value={selectedAccount.lead_source ?? ""} disabled className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>Partner (from Account)</Label>
                    <Input value={selectedAccount.partner_account ?? ""} disabled className="bg-muted" />
                  </div>
                </div>
              </FormSection>
            )}

            {/* ---- Notes & Description ---- */}
            <FormSection title="Notes & Description">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={4} {...register("description")} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  {/* Scrollable log of existing notes with per-line
                      Edit + Delete affordance. Edits flow through
                      setValue("notes", ...) so they persist when the
                      user clicks Save Changes — same lifecycle as the
                      rest of the form's edits. */}
                  {watch("notes") && (() => {
                    const lines = watch("notes")!.split("\n").filter(Boolean);
                    const writeLines = (next: string[]) =>
                      setValue("notes", next.join("\n"), { shouldDirty: true });
                    const saveEdit = (i: number) => {
                      const trimmed = editNoteValue.trim();
                      if (!trimmed) {
                        toast.error("Note cannot be empty");
                        return;
                      }
                      const original = lines[i];
                      const parts = original.split(" | ");
                      const updatedLine =
                        parts.length >= 3
                          ? `${parts[0]} | ${parts[1]} | ${trimmed}`
                          : trimmed;
                      const next = [...lines];
                      next[i] = updatedLine;
                      writeLines(next);
                      setEditingNoteIndex(null);
                      setEditNoteValue("");
                    };
                    const deleteAt = (i: number) => {
                      const next = lines.filter((_, idx) => idx !== i);
                      writeLines(next);
                      setPendingDeleteNoteIndex(null);
                    };
                    return (
                      <div className="border rounded-md p-3 max-h-48 overflow-y-auto bg-muted/30 space-y-1 text-sm">
                        {lines.map((line, i) => {
                          const parts = line.split(" | ");
                          const hasMeta = parts.length >= 3;
                          const name = hasMeta ? parts[0] : "";
                          const date = hasMeta ? parts[1] : "";
                          const content = hasMeta ? parts.slice(2).join(" | ") : line;
                          const isEditing = editingNoteIndex === i;
                          const isPendingDelete = pendingDeleteNoteIndex === i;

                          if (isEditing) {
                            return (
                              <div key={i} className="py-2 border-b last:border-b-0 border-muted space-y-1">
                                {hasMeta && (
                                  <div className="text-xs text-muted-foreground">
                                    <span className="font-medium">{name}</span> - {date}
                                  </div>
                                )}
                                <Input
                                  autoFocus
                                  value={editNoteValue}
                                  onChange={(e) => setEditNoteValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveEdit(i);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      setEditingNoteIndex(null);
                                      setEditNoteValue("");
                                    }
                                  }}
                                />
                                <div className="flex gap-2">
                                  <Button type="button" size="sm" onClick={() => saveEdit(i)}>
                                    Save
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingNoteIndex(null);
                                      setEditNoteValue("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={i}
                              className="group py-1 border-b last:border-b-0 border-muted flex items-start gap-2"
                            >
                              <div className="flex-1 min-w-0">
                                {hasMeta ? (
                                  <>
                                    <span className="font-medium">{name}</span>
                                    <span className="text-muted-foreground"> - {date}: </span>
                                    <span>{content}</span>
                                  </>
                                ) : (
                                  <span>{line}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  title="Edit note"
                                  className="p-1 rounded hover:bg-muted"
                                  onClick={() => {
                                    setEditingNoteIndex(i);
                                    setEditNoteValue(content);
                                    setPendingDeleteNoteIndex(null);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                                {isPendingDelete ? (
                                  <>
                                    <button
                                      type="button"
                                      className="text-xs text-destructive font-medium px-1"
                                      onClick={() => deleteAt(i)}
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-muted-foreground px-1"
                                      onClick={() => setPendingDeleteNoteIndex(null)}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    title="Delete note"
                                    className="p-1 rounded hover:bg-muted"
                                    onClick={() => {
                                      setPendingDeleteNoteIndex(i);
                                      setEditingNoteIndex(null);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {/* Add new note input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a note..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (!newNote.trim()) return;
                          const userName = profile?.full_name ?? "Unknown";
                          const now = new Date().toLocaleString();
                          const entry = `${userName} | ${now} | ${newNote.trim()}`;
                          const current = watch("notes") ?? "";
                          setValue("notes", current ? `${entry}\n${current}` : entry);
                          setNewNote("");
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (!newNote.trim()) return;
                        const userName = profile?.full_name ?? "Unknown";
                        const now = new Date().toLocaleString();
                        const entry = `${userName} | ${now} | ${newNote.trim()}`;
                        const current = watch("notes") ?? "";
                        setValue("notes", current ? `${entry}\n${current}` : entry);
                        setNewNote("");
                      }}
                    >
                      Add Note
                    </Button>
                  </div>
                </div>
              </div>
            </FormSection>

            {/* ---- Products ----
                On EDIT, this stays at the bottom (under Notes) so reps
                can scroll through the deal-shape fields first. On
                CREATE, it's moved to the top right after Basic Info
                (rendered above) so picking products is the second
                thing the user does — which auto-fills the opp name,
                amount, subtotal, FTE pricing in one step.
            */}
            {isEditing && (
              <FormSection title="Products">
                <OpportunityProductsEditor
                  ref={productsEditorRef}
                  isEditing={isEditing}
                  opportunityId={id ?? null}
                  stagedProducts={stagedProducts}
                  existingProducts={existingProducts ?? []}
                  onOpenAdd={() => setShowAddProduct(true)}
                  onRemoveStaged={(idx) => setPendingRemoveIdx(idx)}
                  onRemoveExisting={(productRowId) => setPendingRemoveProductId(productRowId)}
                />
              </FormSection>
            )}

            {/* ---- Custom Fields ---- */}
            {customFieldDefs && customFieldDefs.length > 0 && (
              <FormSection title="Custom Fields">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {customFieldDefs.map((def) => (
                    <CustomFieldInput
                      key={def.id}
                      definition={def}
                      value={watch("custom_fields")?.[def.field_key]}
                      onChange={(v) => {
                        const current = watch("custom_fields") ?? {};
                        setValue("custom_fields", { ...current, [def.field_key]: v });
                      }}
                    />
                  ))}
                </div>
              </FormSection>
            )}

            {/* ---- Actions ---- */}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Opportunity"}
              </Button>
              {/* second render branch (edit footer) — dialog already mounted above in wizard branch, but branches are exclusive so mount here too */}
              <Button type="button" variant="outline" onClick={() => confirmIfDirty(() => navigate(-1))}>
                Cancel
              </Button>
            </div>
            {/* Mount the unsaved-changes confirm here too — this edit branch
                is exclusive with the one at the top that also mounts it, so
                without this Cancel silently no-ops while the form is dirty. */}
            {unsavedDialog}
          </form>
        </CardContent>
      </Card>

      {/* ---- Add Product dialog: immediate in edit mode, staged in create mode ---- */}
      {isEditing && id ? (
        <MultiProductPicker
          mode="immediate"
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          opportunityId={id}
        />
      ) : (
        <MultiProductPicker
          mode="staged"
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          fteRange={(watch("fte_range") as string | undefined) || null}
          accountId={watchedAccountId || null}
          onStage={(rows) =>
            // Dedupe by product_id (last write wins) — the DB has a unique
            // (opportunity_id, product_id) and upserts on it, so staging the
            // same product twice would silently collapse on save and the
            // preview total would overstate what's persisted. Merge here so
            // the preview always matches the saved result.
            setStagedProducts((prev) => {
              const byId = new Map(prev.map((p) => [p.product_id, p]));
              for (const r of rows) byId.set(r.product_id, r);
              return [...byId.values()];
            })
          }
        />
      )}

      <ConfirmDialog
        open={pendingRemoveIdx !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoveIdx(null); }}
        title="Remove Product"
        description={
          pendingRemoveIdx !== null && stagedProducts[pendingRemoveIdx]
            ? `Remove ${stagedProducts[pendingRemoveIdx].product_name} from this opportunity?`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingRemoveIdx === null) return;
          setStagedProducts((prev) => prev.filter((_, i) => i !== pendingRemoveIdx));
          setPendingRemoveIdx(null);
        }}
      />

      <ConfirmDialog
        open={!!pendingRemoveProductId}
        onOpenChange={(open) => { if (!open) setPendingRemoveProductId(null); }}
        title="Remove Product"
        description="Remove this product from the opportunity?"
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (!pendingRemoveProductId || !id) return;
          removeProductMutation.mutate(
            { id: pendingRemoveProductId, opportunityId: id },
            {
              onSuccess: () => {
                toast.success("Product removed");
                setPendingRemoveProductId(null);
              },
              onError: (err) => {
                toast.error("Failed to remove product: " + (err as Error).message);
                setPendingRemoveProductId(null);
              },
            }
          );
        }}
      />
    </div>
  );
}

/* ---------- Products editor (staged for create, deferred for edit) ---------- */

export interface OpportunityProductsEditorHandle {
  /**
   * Persist any pending row drafts to the DB. Called by the parent
   * form's onSubmit so line-item edits commit alongside the rest of
   * the form's Save Changes click — not on each input's blur. Awaits
   * every per-row mutation and surfaces the first error.
   */
  flushDrafts: () => Promise<void>;
}

type ExistingProductRow = {
  id: string;
  quantity: number;
  unit_price: number;
  arr_amount: number;
  discount_percent?: number | null;
  discount_type?: "percent" | "amount" | null;
  product?: { name?: string | null; code?: string | null } | null;
};

const OpportunityProductsEditor = forwardRef<
  OpportunityProductsEditorHandle,
  {
    isEditing: boolean;
    opportunityId: string | null;
    stagedProducts: StagedOpportunityProduct[];
    existingProducts: ExistingProductRow[];
    onOpenAdd: () => void;
    onRemoveStaged: (idx: number) => void;
    onRemoveExisting: (productRowId: string) => void;
  }
>(function OpportunityProductsEditor(
  {
    isEditing,
    opportunityId,
    stagedProducts,
    existingProducts,
    onOpenAdd,
    onRemoveStaged,
    onRemoveExisting,
  },
  ref,
) {
  const updateProductMutation = useUpdateOpportunityProduct();

  // Per-row draft buffer. Inputs write here on every keystroke. The
  // drafts are NOT auto-flushed to the DB — the parent form's onSubmit
  // calls `flushDrafts()` (via the ref above) so all line edits land in
  // the same Save Changes click. Cancel just unmounts the component
  // and the drafts evaporate.
  type RowDraft = {
    quantity: string;
    unit_price: string;
    discount_percent: string;
    discount_type: "percent" | "amount";
  };
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  function getDraft(p: {
    id: string;
    quantity: number;
    unit_price: number;
    discount_percent?: number | null;
    discount_type?: "percent" | "amount" | null;
  }): RowDraft {
    return (
      drafts[p.id] ?? {
        quantity: String(p.quantity ?? 1),
        unit_price: String(p.unit_price ?? 0),
        discount_percent: String(p.discount_percent ?? 0),
        discount_type: (p.discount_type ?? "percent") as "percent" | "amount",
      }
    );
  }

  function setDraft(
    p: {
      id: string;
      quantity: number;
      unit_price: number;
      discount_percent?: number | null;
      discount_type?: "percent" | "amount" | null;
    },
    patch: Partial<RowDraft>,
  ) {
    setDrafts((prev) => ({
      ...prev,
      // Seed the draft from the ACTUAL product values, not 0/0/0. The
      // old version seeded everything to "0" on first edit, so typing
      // into Disc% would commit qty=0 on blur and trip the
      // opportunity_products_quantity_check constraint. The product
      // object now flows through so a partial edit of one field doesn't
      // clobber the others.
      [p.id]: { ...getDraft(p), ...prev[p.id], ...patch },
    }));
  }

  async function commitDraft(p: ExistingProductRow): Promise<void> {
    if (!opportunityId) return;
    const draft = drafts[p.id];
    if (!draft) return; // never edited
    // qty must be >= 1 (DB constraint opportunity_products_quantity_check).
    // If the input was momentarily empty or 0, fall back to the prior
    // quantity so we don't trip the constraint.
    const rawQty = Number(draft.quantity);
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? rawQty : Number(p.quantity ?? 1);
    const price = Math.max(0, Number(draft.unit_price) || 0);
    // The DISCOUNT input is interpreted by `discount_type`: in "percent"
    // mode it's clamped to 0-100; in "amount" mode it's a flat dollar
    // value with no upper clamp (other than the line subtotal — handled
    // server-side in arr_amount calc).
    const rawDisc = Math.max(0, Number(draft.discount_percent) || 0);
    const dtype = draft.discount_type ?? "percent";
    const disc = dtype === "percent" ? Math.min(100, rawDisc) : rawDisc;
    const noChange =
      qty === Number(p.quantity ?? 0) &&
      price === Number(p.unit_price ?? 0) &&
      disc === Number(p.discount_percent ?? 0) &&
      dtype === ((p.discount_type ?? "percent") as "percent" | "amount");
    if (noChange) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      return;
    }
    await updateProductMutation.mutateAsync({
      id: p.id,
      opportunity_id: opportunityId,
      patch: {
        quantity: qty,
        unit_price: price,
        discount_percent: disc,
        discount_type: dtype,
      },
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
  }

  useImperativeHandle(
    ref,
    () => ({
      async flushDrafts() {
        // Walk the current drafts and commit each. Sequential (not
        // Promise.all) so recompute_opportunity_totals fires per row in
        // a deterministic order. If any row fails we rethrow — the
        // parent surfaces the error and stays on the page.
        const ids = Object.keys(drafts);
        for (const id of ids) {
          const original = existingProducts.find((p) => p.id === id);
          if (!original) continue;
          await commitDraft(original);
        }
      },
    }),
    // Re-bind the handle whenever drafts or existingProducts change so
    // the closure always sees the latest values when the parent calls
    // flushDrafts().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, existingProducts],
  );

  // EDIT mode rows render as editable inputs that buffer in `drafts`
  // until the parent form's Save Changes click invokes `flushDrafts()`.
  // CREATE mode rows are read-only previews of staged products that
  // get flushed on Create.
  const editRows = isEditing
    ? existingProducts.map((p) => {
        const draft = getDraft(p);
        const previewQty = Number(draft.quantity) || 0;
        const previewPrice = Number(draft.unit_price) || 0;
        const previewDisc = Number(draft.discount_percent) || 0;
        // Match the API's arr_amount calc: percent vs flat-amount
        // discount means the preview total has to honor the type.
        const previewArr =
          draft.discount_type === "amount"
            ? Math.max(0, previewQty * previewPrice - previewDisc)
            : Math.max(0, previewQty * previewPrice * (1 - previewDisc / 100));
        const dirty = !!drafts[p.id];
        return {
          key: p.id,
          rowId: p.id,
          name: p.product?.name ?? "\u2014",
          code: p.product?.code ?? "\u2014",
          draft,
          dirty,
          previewArr,
          onRemove: () => onRemoveExisting(p.id),
          original: p,
        };
      })
    : [];
  const stagedRows = !isEditing
    ? stagedProducts.map((p, idx) => ({
        key: `staged-${idx}`,
        name: p.product_name || "\u2014",
        code: p.product_code || "\u2014",
        quantity: p.quantity,
        unitPrice: p.unit_price,
        arrAmount: p.arr_amount,
        onRemove: () => onRemoveStaged(idx),
      }))
    : [];

  const rowsCount = isEditing ? editRows.length : stagedRows.length;
  const totalARR = isEditing
    ? editRows.reduce((sum, r) => sum + (r.previewArr || 0), 0)
    : stagedRows.reduce((sum, r) => sum + (r.arrAmount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {rowsCount
            ? `${rowsCount} product${rowsCount !== 1 ? "s" : ""}${!isEditing ? " (will be attached on create)" : ""}`
            : isEditing
            ? "No products added yet"
            : "Add products to include on the opportunity. They'll be attached when you click Create."}
        </span>
        <Button type="button" size="sm" onClick={onOpenAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Add Product
        </Button>
      </div>

      {rowsCount > 0 && (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="text-right w-28">Unit $</TableHead>
                <TableHead className="text-right w-32">Discount</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-16 text-right">{isEditing ? "" : ""}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isEditing
                ? editRows.map((r) => (
                    <TableRow key={r.key} className={r.dirty ? "bg-amber-50/40" : ""}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          step="1"
                          value={r.draft.quantity}
                          onChange={(e) => setDraft(r.original, { quantity: e.target.value })}
                          className="h-8 w-20 text-right ml-auto"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={r.draft.unit_price}
                          onChange={(e) => setDraft(r.original, { unit_price: e.target.value })}
                          className="h-8 w-28 text-right ml-auto"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {/* $/% type selector + value input. Matches the
                            Add Products dialog so reps can switch a line
                            from a percent discount to a flat dollar
                            amount (or vice versa) without removing and
                            re-adding the product. */}
                        <div className="flex items-center justify-end gap-1">
                          <select
                            value={r.draft.discount_type}
                            onChange={(e) =>
                              setDraft(r.original, {
                                discount_type: e.target.value as "percent" | "amount",
                              })
                            }
                            className="h-8 border rounded text-xs px-1 bg-background"
                            aria-label="Discount type"
                          >
                            <option value="percent">%</option>
                            <option value="amount">$</option>
                          </select>
                          <Input
                            type="number"
                            min={0}
                            max={r.draft.discount_type === "percent" ? 100 : undefined}
                            // Allow decimal percents (e.g. 27.5%). Previously
                            // step="1" blocked the browser's HTML5 number-input
                            // validation, so the form refused to submit when a
                            // rep typed something like "27.5".
                            step="0.01"
                            value={r.draft.discount_percent}
                            onChange={(e) =>
                              setDraft(r.original, { discount_percent: e.target.value })
                            }
                            className="h-8 w-20 text-right"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrencyDetailed(r.previewArr)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={r.onRemove}
                          title="Remove product"
                          disabled={updateProductMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                : stagedRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.code}</TableCell>
                      <TableCell className="text-right">{r.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrencyDetailed(r.unitPrice)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrencyDetailed(r.arrAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={r.onRemove}
                          title="Remove product"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={5} className="text-right font-semibold">Total ARR</TableCell>
                <TableCell className="text-right font-bold">{formatCurrencyDetailed(totalARR)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
          {isEditing && (
            <p className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/20">
              Edits are saved when you click <strong>Save Changes</strong>. Click
              Cancel to discard.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

/* ---------- Custom Field Input ---------- */

function CustomFieldInput({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { field_key, label, field_type, options, is_required } = definition;
  const inputId = `custom_${field_key}`;

  switch (field_type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={inputId}
            type={field_type === "email" ? "email" : field_type === "url" ? "url" : "text"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "textarea":
      return (
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Textarea
            id={inputId}
            rows={3}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "number":
      return (
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={inputId}
            type="number"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      );

    case "currency":
      return (
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={inputId}
            type="number"
            step="0.01"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      );

    case "date":
      return (
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={inputId}
            type="date"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "checkbox":
      return (
        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            id={inputId}
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          <Label htmlFor={inputId} className="text-sm font-normal cursor-pointer">
            {label}
            {is_required && " *"}
          </Label>
        </div>
      );

    case "select":
      return (
        <div className="space-y-2">
          <Label>
            {label}
            {is_required && " *"}
          </Label>
          <Select
            value={String(value ?? "")}
            onValueChange={(v) => onChange(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {options?.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "multi_select":
      return (
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={inputId}
            placeholder="Comma-separated values"
            value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
          />
          {options && (
            <p className="text-xs text-muted-foreground">
              Options: {options.join(", ")}
            </p>
          )}
        </div>
      );

    default:
      return null;
  }
}
