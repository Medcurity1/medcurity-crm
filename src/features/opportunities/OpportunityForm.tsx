import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useOpportunity,
  useCreateOpportunity,
  useUpdateOpportunity,
  useOpportunityProducts,
  useAddOpportunityProduct,
  useRemoveOpportunityProduct,
} from "./api";
import { AddProductDialog, type StagedOpportunityProduct } from "./AddProductDialog";
import { useAccountsList, useAccount, useUsers } from "@/features/accounts/api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { opportunitySchema, type OpportunityFormValues } from "./schema";
import { FTE_RANGES, employeesToFteRange } from "@/lib/formatters";
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
  const { data: accountsList } = useAccountsList();
  const { data: customFieldDefs } = useCustomFieldDefinitions("opportunities");
  const { data: requiredFieldsData } = useRequiredFields("opportunities");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateOpportunity();
  const updateMutation = useUpdateOpportunity();
  const { profile } = useAuth();
  const [newNote, setNewNote] = useState("");

  const preselectedAccountId = searchParams.get("account_id");

  // ----- Products state -----
  // Create mode: stage products locally and flush after the opp is created.
  // Edit mode: products come from the DB and are mutated directly.
  const [stagedProducts, setStagedProducts] = useState<StagedOpportunityProduct[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const [pendingRemoveProductId, setPendingRemoveProductId] = useState<string | null>(null);

  const { data: existingProducts } = useOpportunityProducts(isEditing ? id : undefined);
  const addProductMutation = useAddOpportunityProduct();
  const removeProductMutation = useRemoveOpportunityProduct();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
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
          owner_user_id: null,
          team: "sales",
          kind: "new_business",
          business_type: "",
          name: "",
          stage: "lead",
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

  const watchedAccountId = watch("account_id");
  const watchedStage = watch("stage");

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
    // Snapshot FTE from account for new opportunities
    if (acct.fte_count != null) {
      setValue("fte_count", acct.fte_count);
    }
    if (acct.fte_range) {
      setValue("fte_range", acct.fte_range as OpportunityFormValues["fte_range"]);
    }
  }, [watchedAccountId, selectedAccount, isEditing, setValue]);

  function emptyToNull(v: unknown): unknown {
    if (v === "" || v === undefined) return null;
    return v;
  }

  async function onSubmit(values: OpportunityFormValues) {
    // Check dynamic required fields
    const missingFields = requiredKeys.filter((key) => {
      const val = values[key as keyof typeof values];
      return val === null || val === undefined || val === "";
    });
    if (missingFields.length > 0) {
      toast.error(
        `Required fields missing: ${missingFields.map((k) => k.replace(/_/g, " ")).join(", ")}`
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
      cycle_count: values.cycle_count ?? null,
      auto_renewal: values.auto_renewal ?? false,
      description: emptyToNull(values.description),
      promo_code: emptyToNull(values.promo_code),
      discount: values.discount ?? null,
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
    };

    try {
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, ...payload } as Parameters<typeof updateMutation.mutateAsync>[0]);
        toast.success("Opportunity updated");
        navigate(`/opportunities/${id}`);
      } else {
        const result = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);

        // Flush any products the user staged before the opp existed. We do
        // these sequentially so one bad line doesn't silently skip others.
        if (stagedProducts.length > 0) {
          let productFailures = 0;
          for (const sp of stagedProducts) {
            try {
              await addProductMutation.mutateAsync({
                opportunity_id: result.id,
                product_id: sp.product_id,
                quantity: sp.quantity,
                unit_price: sp.unit_price,
                arr_amount: sp.arr_amount,
              });
            } catch (err) {
              productFailures += 1;
              console.error("Failed to attach staged product:", sp, err);
            }
          }
          if (productFailures > 0) {
            toast.error(
              `Opportunity created, but ${productFailures} of ${stagedProducts.length} products failed to attach. You can retry from the opportunity page.`
            );
          } else {
            toast.success(
              `Opportunity created with ${stagedProducts.length} product${stagedProducts.length !== 1 ? "s" : ""}`
            );
          }
        } else {
          toast.success("Opportunity created");
        }

        navigate(`/opportunities/${result.id}`);
      }
    } catch (err) {
      console.error("Failed to save opportunity:", err);
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

  // When creating from an account page, lock the account selection
  const accountLocked = isEditing || !!preselectedAccountId;

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Opportunity" : "New Opportunity"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* ---- Basic Info ---- */}
            <FormSection title="Basic Info">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="name">Opportunity Name *<RequiredIndicator fieldKey="name" requiredFields={requiredKeys} /></Label>
                  <Input id="name" {...register("name")} />
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
                    <Select value={watchedAccountId} onValueChange={(v) => setValue("account_id", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accountsList?.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

                <div className="space-y-2">
                  <Label>Team<RequiredIndicator fieldKey="team" requiredFields={requiredKeys} /></Label>
                  <Select value={watch("team")} onValueChange={(v) => setValue("team", v as "sales" | "renewals")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="renewals">Renewals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Kind<RequiredIndicator fieldKey="kind" requiredFields={requiredKeys} /></Label>
                  <Select value={watch("kind")} onValueChange={(v) => setValue("kind", v as "new_business" | "renewal")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_business">New Business</SelectItem>
                      <SelectItem value="renewal">Renewal</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Sales-team workflow: new_business or renewal. For revenue-reporting categorization, use Business Type below.
                  </p>
                </div>

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
                      <SelectItem value="opportunity">Opportunity (in-flight / unclassified)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Revenue-reporting category. Use "Opportunity" for in-flight deals or sales-team closed_lost so a single product loss doesn't roll up as losing a customer.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Stage<RequiredIndicator fieldKey="stage" requiredFields={requiredKeys} /></Label>
                  <Select value={watchedStage} onValueChange={(v) => setValue("stage", v as OpportunityFormValues["stage"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="proposal">Proposal</SelectItem>
                      <SelectItem value="verbal_commit">Verbal Commit</SelectItem>
                      <SelectItem value="closed_won">Closed Won</SelectItem>
                      <SelectItem value="closed_lost">Closed Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="probability">Probability (%)<RequiredIndicator fieldKey="probability" requiredFields={requiredKeys} /></Label>
                  <Input id="probability" type="number" min={0} max={100} step={1} {...register("probability")} />
                  {errors.probability && <p className="text-sm text-destructive">{errors.probability.message}</p>}
                </div>
              </div>
            </FormSection>

            {/* ---- Financial ---- */}
            <FormSection title="Financial">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount ($) *<RequiredIndicator fieldKey="amount" requiredFields={requiredKeys} /></Label>
                  <Input id="amount" type="number" step="0.01" disabled className="bg-muted" {...register("amount")} />
                  {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subtotal">Subtotal ($)</Label>
                  <Input id="subtotal" type="number" step="0.01" disabled className="bg-muted" {...register("subtotal")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="discount">Discount ($)</Label>
                  <Input id="discount" type="number" step="0.01" disabled className="bg-muted" {...register("discount")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="promo_code">Promo Code</Label>
                  <Input id="promo_code" {...register("promo_code")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="service_amount">Service Amount ($)</Label>
                  <Input id="service_amount" type="number" step="0.01" {...register("service_amount")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="product_amount">Product Amount ($)</Label>
                  <Input id="product_amount" type="number" step="0.01" {...register("product_amount")} />
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
                  <Select
                    value={watch("payment_frequency") ?? "none"}
                    onValueChange={(v) => setValue("payment_frequency", v === "none" ? null : v as OpportunityFormValues["payment_frequency"])}
                  >
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="semi_annually">Semi-Annually</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                      <SelectItem value="one_time">One-Time</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="contract_length_months">Contract Length (months)</Label>
                  <Input id="contract_length_months" type="number" {...register("contract_length_months")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contract_year">Contract Year</Label>
                  <Input id="contract_year" type="number" {...register("contract_year")} />
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
                  {/* Scrollable log of existing notes */}
                  {watch("notes") && (
                    <div className="border rounded-md p-3 max-h-48 overflow-y-auto bg-muted/30 space-y-1 text-sm">
                      {watch("notes")!.split("\n").filter(Boolean).map((line, i) => {
                        const parts = line.split(" | ");
                        if (parts.length >= 3) {
                          const [name, date, ...rest] = parts;
                          return (
                            <div key={i} className="py-1 border-b last:border-b-0 border-muted">
                              <span className="font-medium">{name}</span>
                              <span className="text-muted-foreground"> - {date}: </span>
                              <span>{rest.join(" | ")}</span>
                            </div>
                          );
                        }
                        return <div key={i} className="py-1 border-b last:border-b-0 border-muted">{line}</div>;
                      })}
                    </div>
                  )}
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

            {/* ---- Products ---- */}
            <FormSection title="Products">
              <OpportunityProductsEditor
                isEditing={isEditing}
                stagedProducts={stagedProducts}
                existingProducts={existingProducts ?? []}
                onOpenAdd={() => setShowAddProduct(true)}
                onRemoveStaged={(idx) => setPendingRemoveIdx(idx)}
                onRemoveExisting={(productRowId) => setPendingRemoveProductId(productRowId)}
              />
            </FormSection>

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
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Add Product dialog: immediate in edit mode, staged in create mode ---- */}
      {isEditing && id ? (
        <AddProductDialog
          mode="immediate"
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          opportunityId={id}
        />
      ) : (
        <AddProductDialog
          mode="staged"
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          fteRange={(watch("fte_range") as string | undefined) || null}
          onStage={(staged) => setStagedProducts((prev) => [...prev, staged])}
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

/* ---------- Products editor (staged for create, live for edit) ---------- */

function OpportunityProductsEditor({
  isEditing,
  stagedProducts,
  existingProducts,
  onOpenAdd,
  onRemoveStaged,
  onRemoveExisting,
}: {
  isEditing: boolean;
  stagedProducts: StagedOpportunityProduct[];
  existingProducts: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    arr_amount: number;
    product?: { name?: string | null; code?: string | null } | null;
  }>;
  onOpenAdd: () => void;
  onRemoveStaged: (idx: number) => void;
  onRemoveExisting: (productRowId: string) => void;
}) {
  const rows = isEditing
    ? existingProducts.map((p) => ({
        key: p.id,
        name: p.product?.name ?? "\u2014",
        code: p.product?.code ?? "\u2014",
        quantity: p.quantity,
        unitPrice: Number(p.unit_price),
        arrAmount: Number(p.arr_amount),
        onRemove: () => onRemoveExisting(p.id),
      }))
    : stagedProducts.map((p, idx) => ({
        key: `staged-${idx}`,
        name: p.product_name || "\u2014",
        code: p.product_code || "\u2014",
        quantity: p.quantity,
        unitPrice: p.unit_price,
        arrAmount: p.arr_amount,
        onRemove: () => onRemoveStaged(idx),
      }));

  const totalARR = rows.reduce((sum, r) => sum + (r.arrAmount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {rows.length
            ? `${rows.length} product${rows.length !== 1 ? "s" : ""}${!isEditing ? " (will be attached on create)" : ""}`
            : isEditing
            ? "No products added yet"
            : "Add products to include on the opportunity. They'll be attached when you click Create."}
        </span>
        <Button type="button" size="sm" onClick={onOpenAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Add Product
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">ARR</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.code}</TableCell>
                  <TableCell className="text-right">{r.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrencyDetailed(r.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrencyDetailed(r.arrAmount)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={r.onRemove}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={5} className="text-right font-semibold">Total ARR</TableCell>
                <TableCell className="text-right font-bold">{formatCurrencyDetailed(totalARR)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

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
