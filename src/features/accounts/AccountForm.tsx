import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAccount, useCreateAccount, useUpdateAccount, useUsers, useAccountsList } from "./api";
import { PicklistSelect } from "@/features/picklists/PicklistSelect";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { getMissingRequiredFields, formatFieldLabel } from "@/lib/requiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { accountSchema, type AccountFormValues } from "./schema";
import { FTE_RANGES, employeesToFteRange } from "@/lib/formatters";
import { US_STATES } from "@/lib/us-states";
import { looksLikeUsZip, zipToTimeZone } from "@/lib/us-zip";
import { PhoneInput } from "@/components/PhoneInput";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DuplicateWarning } from "@/components/DuplicateWarning";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Account, CustomFieldDefinition } from "@/types/crm";

/* ---------- Section wrapper (always open) ---------- */

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

/* ---------- Collapsible section wrapper ---------- */

function CollapsibleFormSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider hover:bg-muted/50 transition-colors"
      >
        {title}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
}

/* ---------- Wrapper: handles loading ---------- */

interface UserProfile { id: string; full_name: string | null; is_active: boolean }

export function AccountForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { data: account, isLoading: loadingAccount } = useAccount(id);
  const { data: users } = useUsers(true);

  if (isEditing && (loadingAccount || !account || !users)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <AccountFormInner key={id ?? "new"} account={account} users={users ?? []} />;
}

/* ---------- Inner form ---------- */

function AccountFormInner({ account, users }: { account: Account | undefined; users: UserProfile[] }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { user } = useAuth();
  const { data: allAccounts } = useAccountsList();
  const { data: customFieldDefs } = useCustomFieldDefinitions("accounts");
  const { data: requiredFieldsData } = useRequiredFields("accounts");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();

  const [sameAsBilling, setSameAsBilling] = useState(false);

  // Open-opportunity check (edit only): an account with a deal in flight
  // should carry a Next Follow Up Date, enforced with the same
  // touched-fields grandfathering as the sales-status rule below.
  const { data: openOpp } = useQuery({
    queryKey: ["account_open_opp", id],
    enabled: isEditing && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id")
        .eq("account_id", id!)
        .not("stage", "in", "(closed_won,closed_lost)")
        .is("archived_at", null)
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const hasOpenOpp = !!openOpp;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: isEditing && account
      ? {
          name: account.name,
          lifecycle_status: account.lifecycle_status,
          sales_active: account.sales_active ?? false,
          sales_status: account.sales_status ?? "",
          next_follow_up_date: account.next_follow_up_date ?? "",
          owner_user_id: account.owner_user_id,
          website: account.website ?? "",
          industry: account.industry ?? "",
          industry_category: account.industry_category ?? "",
          account_type: account.account_type ?? "",
          account_number: account.account_number ?? "",
          parent_account_id: account.parent_account_id ?? null,
          phone: account.phone ?? "",
          phone_extension: account.phone_extension ?? "",
          timezone: account.timezone ?? "",
          employees: account.employees ?? "",
          locations: account.locations ?? "",
          fte_count: account.fte_count ?? "",
          fte_range: (account.fte_range ?? "") as AccountFormValues["fte_range"],
          number_of_providers: account.number_of_providers ?? "",
          annual_revenue: account.annual_revenue ?? "",
          active_since: account.active_since ?? "",
          renewal_type: account.renewal_type ?? "",
          every_other_year: account.every_other_year ?? false,
          contracts: account.contracts ?? "",
          current_contract_start_date: account.current_contract_start_date ?? "",
          current_contract_end_date: account.current_contract_end_date ?? "",
          current_contract_length_months: account.current_contract_length_months ?? "",
          acv: account.acv ?? "",
          lifetime_value: account.lifetime_value ?? "",
          churn_amount: account.churn_amount ?? "",
          churn_date: account.churn_date ?? "",
          billing_street: account.billing_street ?? "",
          billing_city: account.billing_city ?? "",
          billing_state: account.billing_state ?? "",
          billing_zip: account.billing_zip ?? "",
          billing_country: account.billing_country ?? "",
          shipping_street: account.shipping_street ?? "",
          shipping_city: account.shipping_city ?? "",
          shipping_state: account.shipping_state ?? "",
          shipping_zip: account.shipping_zip ?? "",
          shipping_country: account.shipping_country ?? "",
          partner_account: account.partner_account ?? "",
          partner_prospect: account.partner_prospect ?? false,
          partnership_status: account.partnership_status ?? "",
          partner_type: account.partner_type ?? "",
          relationship_notes: account.relationship_notes ?? "",
          lead_source: account.lead_source ?? "",
          lead_source_detail: account.lead_source_detail ?? "",
          priority_account: account.priority_account ?? false,
          project: account.project ?? "",
          project_segment: account.project_segment ?? "",
          description: account.description ?? "",
          notes: account.notes ?? "",
          next_steps: account.next_steps ?? "",
          custom_fields: account.custom_fields ?? {},
        }
      : {
          name: "",
          lifecycle_status: "prospect",
          sales_active: false,
          sales_status: "",
          next_follow_up_date: "",
          // Default to current rep so "My Accounts" filter works on day 1.
          owner_user_id: user?.id ?? null,
          website: "",
          industry: "",
          industry_category: "",
          account_type: "",
          account_number: "",
          parent_account_id: null,
          phone: "",
          phone_extension: "",
          timezone: "",
          employees: "",
          locations: "",
          fte_count: "",
          fte_range: "",
          number_of_providers: "",
          annual_revenue: "",
          active_since: "",
          renewal_type: "",
          every_other_year: false,
          contracts: "",
          current_contract_start_date: "",
          current_contract_end_date: "",
          current_contract_length_months: "",
          acv: "",
          lifetime_value: "",
          churn_amount: "",
          churn_date: "",
          billing_street: "",
          billing_city: "",
          billing_state: "",
          billing_zip: "",
          billing_country: "",
          shipping_street: "",
          shipping_city: "",
          shipping_state: "",
          shipping_zip: "",
          shipping_country: "",
          partner_account: "",
          partner_prospect: false,
          partnership_status: "",
          partner_type: "",
          relationship_notes: "",
          lead_source: "",
          lead_source_detail: "",
          priority_account: false,
          project: "",
          project_segment: "",
          description: "",
          notes: "",
          next_steps: "",
          custom_fields: {},
        },
  });

  // Warn before losing unsaved edits — Cancel routes through
  // confirmIfDirty; the post-save navigate calls disarm() first so a
  // successful save never trips the prompt.
  const { confirmIfDirty, disarm, dialog: unsavedDialog } = useUnsavedChanges(isDirty);

  // When the rep types a US zip and tabs out, auto-fill country and
  // timezone if those fields are still blank. We never overwrite a
  // value the user already typed — this only fills in the empties.
  // The timezone field on Account is a free-text string (free-form so
  // it can hold IANA names for foreign offices later), so we use the
  // common US/* labels.
  const TIMEZONE_LABELS: Record<string, string> = {
    eastern: "US/Eastern",
    central: "US/Central",
    mountain: "US/Mountain",
    pacific: "US/Pacific",
    alaska: "US/Alaska",
    hawaii: "US/Hawaii",
    arizona_no_dst: "US/Arizona",
  };
  // Zip → country + timezone autofill. The team works off the BILLING address
  // (Summer: shipping is never used), so billing_zip is the timezone source.
  //   - billing_zip drives billing_country AND timezone, overwriting the tz on
  //     every valid change so a corrected zip updates it.
  //   - shipping_zip drives shipping_country, and only drives the tz as a
  //     FALLBACK when billing has no valid zip (so an account with only a
  //     shipping address still gets a sensible tz).
  // Country keeps the empty-check (we don't want to clobber a manual
  // "USA" / "United States of America" / etc. once the rep set it).
  const watchedBillingZip = watch("billing_zip");
  useEffect(() => {
    const zip = (watchedBillingZip ?? "").trim();
    if (!looksLikeUsZip(zip)) return;
    if (!getValues("billing_country")) {
      setValue("billing_country", "United States", {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
    const tz = zipToTimeZone(zip);
    if (tz) {
      setValue("timezone", TIMEZONE_LABELS[tz], {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedBillingZip]);

  const watchedShippingZip = watch("shipping_zip");
  useEffect(() => {
    const zip = (watchedShippingZip ?? "").trim();
    if (!looksLikeUsZip(zip)) return;
    if (!getValues("shipping_country")) {
      setValue("shipping_country", "United States", {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
    // Shipping only sets the tz as a fallback when billing has no valid zip —
    // billing is the source of truth.
    const billingZip = (getValues("billing_zip") ?? "").trim();
    if (!looksLikeUsZip(billingZip)) {
      const tz = zipToTimeZone(zip);
      if (tz) {
        setValue("timezone", TIMEZONE_LABELS[tz], {
          shouldDirty: true,
          shouldTouch: true,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedShippingZip]);

  // Copy billing -> shipping when checkbox toggled
  useEffect(() => {
    if (sameAsBilling) {
      setValue("shipping_street", watch("billing_street"));
      setValue("shipping_city", watch("billing_city"));
      setValue("shipping_state", watch("billing_state"));
      setValue("shipping_zip", watch("billing_zip"));
      setValue("shipping_country", watch("billing_country"));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameAsBilling]);

  function emptyToNull(v: unknown): unknown {
    if (v === "" || v === undefined) return null;
    return v;
  }

  // Sub-statuses that mean "being actively worked" — an account in one of
  // these needs a Next Follow Up Date ('prospecting' is the pre-outreach
  // pool and is exempt).
  const WORKING_SALES_STATUSES = ["identified_outreach", "engaged", "nurture"];

  // Grandfathering (mirrors the partner_type conditional + the admin
  // required-fields ratchet): the date is only demanded when the user is
  // the one putting the account into a "needs follow-up" state in THIS
  // save — a create, a change to the sales fields, or clearing a date that
  // was set. Pre-existing accounts already in that state save untouched.
  function followUpDateRequired(values: {
    sales_active?: boolean;
    sales_status?: string | null;
    next_follow_up_date?: string | null;
  }): boolean {
    // The open-opp branch also demands sales_active: with it false, both the
    // form (toggle-off clears the input) and the DB trigger wipe the date, so
    // requiring one would be unsatisfiable.
    const needsFollowUp =
      (values.sales_active ?? false) &&
      (WORKING_SALES_STATUSES.includes(values.sales_status || "") ||
        (isEditing && hasOpenOpp));
    if (!needsFollowUp) return false;
    const salesTouched =
      !isEditing ||
      (values.sales_active ?? false) !== (account?.sales_active ?? false) ||
      (values.sales_status || "") !== (account?.sales_status ?? "");
    const clearedDate =
      isEditing && !!account?.next_follow_up_date && !values.next_follow_up_date;
    return salesTouched || clearedDate;
  }

  const watchedSalesActive = watch("sales_active") ?? false;
  const watchedSalesStatus = watch("sales_status") || "";
  const watchedFollowUpDate = watch("next_follow_up_date") || "";
  const followUpRequiredNow = followUpDateRequired({
    sales_active: watchedSalesActive,
    sales_status: watchedSalesStatus,
    next_follow_up_date: watchedFollowUpDate,
  });

  async function onSubmit(values: AccountFormValues) {
    // Check dynamic required fields. In edit mode, a field that was
    // already empty on the original account is grandfathered — it only
    // blocks the save if we're clearing a value that used to be there.
    // See src/lib/requiredFields.ts for the full rationale.
    const missingFields = getMissingRequiredFields(
      // `status` is being phased out and is no longer on the form — a stale
      // required_field_config row for it must not brick account saves.
      requiredKeys.filter((k) => k !== "status"),
      values,
      account as Record<string, unknown> | undefined
    );
    if (missingFields.length > 0) {
      toast.error(
        `Required fields missing: ${missingFields.map(formatFieldLabel).join(", ")}`
      );
      return;
    }

    // Rachel's rule: a record marked as a partner must say WHAT KIND of
    // partner it is (keeps partner data consistent for reporting/filtering).
    // Conditional, not in required_field_config — only applies to partners.
    if ((values.account_type ?? "").startsWith("Partner") && !values.partner_type) {
      toast.error(
        "Partner Type is required for partner accounts — pick one in the Partner Information section."
      );
      return;
    }

    // Actively-worked accounts (or accounts with a deal in flight) need a
    // Next Follow Up Date — but only when this save is what puts them in
    // that state (see followUpDateRequired for the grandfather rule).
    if (followUpDateRequired(values) && !values.next_follow_up_date) {
      toast.error(
        "Next Follow Up Date is required — this account is being actively worked. Set one in the Sales Status section."
      );
      return;
    }

    const payload: Record<string, unknown> = {
      name: values.name,
      lifecycle_status: values.lifecycle_status,
      // Legacy `status` is intentionally NOT sent — the column stays in the
      // DB for now but the form no longer reads or writes it.
      sales_active: values.sales_active ?? false,
      sales_status: emptyToNull(values.sales_status),
      next_follow_up_date: emptyToNull(values.next_follow_up_date),
      owner_user_id: values.owner_user_id ?? null,
      website: emptyToNull(values.website),
      industry: emptyToNull(values.industry),
      industry_category: emptyToNull(values.industry_category),
      account_type: emptyToNull(values.account_type),
      // account_number is auto-assigned by DB trigger; never written from form.
      parent_account_id: values.parent_account_id ?? null,
      phone: emptyToNull(values.phone),
      phone_extension: emptyToNull(values.phone_extension),
      timezone: emptyToNull(values.timezone),
      employees: emptyToNull(values.employees),
      locations: emptyToNull(values.locations),
      fte_count: emptyToNull(values.fte_count),
      fte_range: emptyToNull(values.fte_range),
      number_of_providers: emptyToNull(values.number_of_providers),
      annual_revenue: emptyToNull(values.annual_revenue),
      active_since: emptyToNull(values.active_since),
      renewal_type: emptyToNull(values.renewal_type),
      every_other_year: values.every_other_year ?? false,
      contracts: emptyToNull(values.contracts),
      current_contract_start_date: emptyToNull(values.current_contract_start_date),
      current_contract_end_date: emptyToNull(values.current_contract_end_date),
      current_contract_length_months: emptyToNull(values.current_contract_length_months),
      acv: emptyToNull(values.acv),
      lifetime_value: emptyToNull(values.lifetime_value),
      churn_amount: emptyToNull(values.churn_amount),
      churn_date: emptyToNull(values.churn_date),
      billing_street: emptyToNull(values.billing_street),
      billing_city: emptyToNull(values.billing_city),
      billing_state: emptyToNull(values.billing_state),
      billing_zip: emptyToNull(values.billing_zip),
      billing_country: emptyToNull(values.billing_country),
      shipping_street: emptyToNull(values.shipping_street),
      shipping_city: emptyToNull(values.shipping_city),
      shipping_state: emptyToNull(values.shipping_state),
      shipping_zip: emptyToNull(values.shipping_zip),
      shipping_country: emptyToNull(values.shipping_country),
      partner_account: emptyToNull(values.partner_account),
      partner_prospect: values.partner_prospect ?? false,
      partnership_status: emptyToNull(values.partnership_status),
      partner_type: emptyToNull(values.partner_type),
      relationship_notes: emptyToNull(values.relationship_notes),
      lead_source: emptyToNull(values.lead_source),
      lead_source_detail: emptyToNull(values.lead_source_detail),
      priority_account: values.priority_account ?? false,
      project: emptyToNull(values.project),
      project_segment: emptyToNull(values.project_segment),
      description: emptyToNull(values.description),
      notes: emptyToNull(values.notes),
      next_steps: emptyToNull(values.next_steps),
      custom_fields: Object.keys(values.custom_fields ?? {}).length > 0 ? values.custom_fields : {},
    };

    try {
      let savedId: string;
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, ...payload } as Parameters<typeof updateMutation.mutateAsync>[0]);
        savedId = id;
      } else {
        const result = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);
        savedId = result.id;
      }
      toast.success(isEditing ? "Account updated" : "Account created");
      disarm();
      navigate(`/accounts/${savedId}`);
    } catch (err) {
      console.error("Failed to save account:", err);
      toast.error("Failed to save account: " + errorMessage(err));
    }
  }

  // Filter out current account from parent account list
  const parentAccountOptions = allAccounts?.filter((a) => a.id !== id) ?? [];

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Account" : "New Account"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* ---- 1. Basic Information (always open) ---- */}
            <FormSection title="Basic Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Account Name *<RequiredIndicator fieldKey="name" requiredFields={requiredKeys} /></Label>
                  <Input id="name" {...register("name")} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                </div>

                <div className="md:col-span-2">
                  {!isEditing && (
                    <DuplicateWarning entity="accounts" name={watch("name")} />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Account Owner<RequiredIndicator fieldKey="owner_user_id" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("owner_user_id") ?? "unassigned"}
                    onValueChange={(v) => setValue("owner_user_id", v === "unassigned" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name ?? u.id}{!u.is_active ? " (inactive)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>
                    Account Type<RequiredIndicator fieldKey="account_type" requiredFields={requiredKeys} />
                  </Label>
                  <div className="flex items-center gap-2 pt-1.5">
                    <Checkbox
                      id="is_partner"
                      checked={(watch("account_type") ?? "").startsWith("Partner")}
                      onCheckedChange={(v) => {
                        if (v === true) {
                          setValue("account_type", "Partner", { shouldDirty: true });
                        } else {
                          // Legacy-preservation rule: only the two canonical
                          // partner values clear to empty. Any other stored
                          // value (CHC, Direct, …) is restored untouched so
                          // unchecking never destroys legacy data.
                          const stored = account?.account_type ?? "";
                          const clearable =
                            stored === "" || stored === "Partner" || stored === "Partner - Alliance";
                          setValue("account_type", clearable ? "" : stored, { shouldDirty: true });
                        }
                      }}
                    />
                    <Label htmlFor="is_partner" className="cursor-pointer text-sm font-normal">
                      Partner
                    </Label>
                  </div>
                  {!!account?.account_type &&
                    !account.account_type.startsWith("Partner") &&
                    !(watch("account_type") ?? "").startsWith("Partner") && (
                      <p className="text-xs text-muted-foreground">
                        Legacy type: {account.account_type}
                      </p>
                    )}
                  <p className="text-xs text-muted-foreground">
                    Use this to mark partner accounts. Customer / Prospect /
                    Former Customer is set automatically from deal history (see
                    Account Status on the account).
                  </p>
                </div>

                {/* Account Number field removed from the form (Summer: not
                    needed). It's still auto-assigned by the DB trigger and the
                    column/data are untouched — just no longer shown here. */}

                {/* ---- Sales Status (replaces the retired `status` field) ----
                    sales_active is also auto-set by a DB trigger from
                    call-list membership; the form just reads/writes the
                    columns. lifecycle_status remains on the column so
                    existing dashboard/ARR/churn views don't break — it will
                    be retired in a follow-up once views migrate. */}
                <div className="space-y-2 md:col-span-2">
                  <Label>Sales Status</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-2 pt-1.5">
                      <Switch
                        id="sales_active"
                        checked={watchedSalesActive}
                        onCheckedChange={(v) => {
                          setValue("sales_active", v === true, { shouldDirty: true });
                          // Mirrors the DB trigger: going inactive clears the
                          // follow-up date.
                          if (v !== true) {
                            setValue("next_follow_up_date", "", { shouldDirty: true });
                          }
                        }}
                      />
                      <Label htmlFor="sales_active" className="cursor-pointer text-sm font-normal">
                        {watchedSalesActive ? "Active — being worked" : "Inactive"}
                      </Label>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="sales_status" className="text-xs text-muted-foreground">
                        Sub-Status
                      </Label>
                      <PicklistSelect
                        id="sales_status"
                        fieldKey="accounts.sales_status"
                        value={watchedSalesStatus}
                        onChange={(v) => setValue("sales_status", v ?? "", { shouldDirty: true })}
                        allowClear
                        placeholder="Select…"
                        disabled={!watchedSalesActive}
                        className={!watchedSalesActive ? "opacity-60" : undefined}
                      />
                      {!watchedSalesActive && !!watchedSalesStatus && (
                        <p className="text-[11px] text-muted-foreground">
                          Kept as history while inactive
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="next_follow_up_date" className="text-xs text-muted-foreground">
                        Next Follow Up Date
                        {followUpRequiredNow && (
                          <span className="text-destructive ml-0.5">
                            *{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              (required)
                            </span>
                          </span>
                        )}
                      </Label>
                      <Input
                        id="next_follow_up_date"
                        type="date"
                        {...register("next_follow_up_date")}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Industry<RequiredIndicator fieldKey="industry_category" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={(watch("industry_category") as string) || "none"}
                    onValueChange={(v) =>
                      setValue("industry_category", v === "none" ? "" : (v as never))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select industry..." />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Sorted alphabetically by display label so users
                          can find values quickly. "None" pinned at top
                          and "Other" / "Other Healthcare" pinned at the
                          bottom intentionally. Full list mirrors the
                          industry_category enum (see
                          20260418000001_field_decisions_april_18.sql +
                          20260506000002_industry_category_expand.sql). */}
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="accounting">Accounting</SelectItem>
                      <SelectItem value="allergy_immunology">Allergy &amp; Immunology</SelectItem>
                      <SelectItem value="anesthesiology">Anesthesiology</SelectItem>
                      <SelectItem value="association">Association</SelectItem>
                      <SelectItem value="audiology">Audiology</SelectItem>
                      <SelectItem value="behavioral_health">Behavioral Health</SelectItem>
                      <SelectItem value="business_associate">Business Associate</SelectItem>
                      <SelectItem value="cardiology">Cardiology</SelectItem>
                      <SelectItem value="chiropractic">Chiropractic</SelectItem>
                      <SelectItem value="colon_rectal">Colon &amp; Rectal</SelectItem>
                      <SelectItem value="community_health_center">Community Health Center</SelectItem>
                      <SelectItem value="consulting">Consulting</SelectItem>
                      <SelectItem value="dental">Dental</SelectItem>
                      <SelectItem value="dermatology">Dermatology</SelectItem>
                      <SelectItem value="direct_care">Direct Care</SelectItem>
                      <SelectItem value="emergency_medicine">Emergency Medicine</SelectItem>
                      <SelectItem value="endocrinology">Endocrinology</SelectItem>
                      <SelectItem value="ent_otolaryngology">ENT / Otolaryngology</SelectItem>
                      <SelectItem value="family_medicine">Family Medicine</SelectItem>
                      <SelectItem value="fqhc">FQHC</SelectItem>
                      <SelectItem value="gastroenterology">Gastroenterology</SelectItem>
                      <SelectItem value="general_surgery">General Surgery</SelectItem>
                      <SelectItem value="geriatrics">Geriatrics</SelectItem>
                      <SelectItem value="government">Government</SelectItem>
                      <SelectItem value="group_purchasing_organization">Group Purchasing Organization (GPO)</SelectItem>
                      <SelectItem value="healthcare_consulting">Healthcare Consulting</SelectItem>
                      <SelectItem value="healthcare_it_vendor">Healthcare IT Vendor</SelectItem>
                      <SelectItem value="higher_education">Higher Education</SelectItem>
                      <SelectItem value="home_health">Home Health</SelectItem>
                      <SelectItem value="hospice">Hospice</SelectItem>
                      <SelectItem value="hospital">Hospital</SelectItem>
                      <SelectItem value="imaging_center">Imaging Center</SelectItem>
                      <SelectItem value="insurance_payer">Insurance / Payer</SelectItem>
                      <SelectItem value="internal_medicine">Internal Medicine</SelectItem>
                      <SelectItem value="lab_services">Lab Services</SelectItem>
                      <SelectItem value="long_term_care">Long-Term Care</SelectItem>
                      <SelectItem value="managed_service_provider">Managed Service Provider</SelectItem>
                      <SelectItem value="medical_device">Medical Device</SelectItem>
                      <SelectItem value="medical_group">Medical Group</SelectItem>
                      <SelectItem value="medical_practice">Medical Practice</SelectItem>
                      <SelectItem value="mental_health">Mental Health</SelectItem>
                      <SelectItem value="multi_specialty">Multi-Specialty</SelectItem>
                      <SelectItem value="naturopathy">Naturopathy</SelectItem>
                      <SelectItem value="nephrology">Nephrology</SelectItem>
                      <SelectItem value="neurology">Neurology</SelectItem>
                      <SelectItem value="non_profit">Non-Profit</SelectItem>
                      <SelectItem value="oncology">Oncology</SelectItem>
                      <SelectItem value="ophthalmology">Ophthalmology</SelectItem>
                      <SelectItem value="optometry">Optometry</SelectItem>
                      <SelectItem value="orthopedics">Orthopedics</SelectItem>
                      <SelectItem value="pain_management">Pain Management</SelectItem>
                      <SelectItem value="pediatrics">Pediatrics</SelectItem>
                      <SelectItem value="pharmaceuticals">Pharmaceuticals</SelectItem>
                      <SelectItem value="pharmacy">Pharmacy</SelectItem>
                      <SelectItem value="physical_therapy">Physical Therapy</SelectItem>
                      <SelectItem value="plastic_surgery">Plastic Surgery</SelectItem>
                      <SelectItem value="podiatry">Podiatry</SelectItem>
                      <SelectItem value="primary_care">Primary Care</SelectItem>
                      <SelectItem value="primary_care_association">Primary Care Association (PCA)</SelectItem>
                      <SelectItem value="psychiatry">Psychiatry</SelectItem>
                      <SelectItem value="public_health_agency">Public Health Agency</SelectItem>
                      <SelectItem value="pulmonology">Pulmonology</SelectItem>
                      <SelectItem value="radiology">Radiology</SelectItem>
                      <SelectItem value="rehabilitation">Rehabilitation</SelectItem>
                      <SelectItem value="reproductive_medicine">Reproductive Medicine</SelectItem>
                      <SelectItem value="rheumatology">Rheumatology</SelectItem>
                      <SelectItem value="rural_health_clinic">Rural Health Clinic</SelectItem>
                      <SelectItem value="rural_hospital">Rural Hospital</SelectItem>
                      <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                      <SelectItem value="sleep_medicine">Sleep Medicine</SelectItem>
                      <SelectItem value="specialty_clinic">Specialty Clinic</SelectItem>
                      <SelectItem value="technology">Technology</SelectItem>
                      <SelectItem value="telemedicine">Telemedicine</SelectItem>
                      <SelectItem value="tribal_health">Tribal Health</SelectItem>
                      <SelectItem value="university_hospital">University Hospital</SelectItem>
                      <SelectItem value="urgent_care">Urgent Care</SelectItem>
                      <SelectItem value="urology">Urology</SelectItem>
                      <SelectItem value="vascular">Vascular</SelectItem>
                      <SelectItem value="women_health">Women&apos;s Health</SelectItem>
                      <SelectItem value="other_healthcare">Other Healthcare</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website<RequiredIndicator fieldKey="website" requiredFields={requiredKeys} /></Label>
                  <Input id="website" placeholder="https://..." {...register("website")} />
                  {errors.website && (
                    <p className="text-sm text-destructive">{errors.website.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Parent Account<RequiredIndicator fieldKey="parent_account_id" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("parent_account_id") ?? "none"}
                    onValueChange={(v) => setValue("parent_account_id", v === "none" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {parentAccountOptions.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Company sizing (moved here from the old Company Details
                    section per Summer): Number of Employees auto-sets FTE Range. */}
                <div className="space-y-2">
                  <Label htmlFor="employees">Number of Employees<RequiredIndicator fieldKey="employees" requiredFields={requiredKeys} /></Label>
                  <Input
                    id="employees"
                    type="number"
                    {...register("employees", {
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        const num = parseInt(e.target.value, 10);
                        if (!isNaN(num) && num > 0) {
                          setValue("fte_range", employeesToFteRange(num) as AccountFormValues["fte_range"]);
                        }
                      },
                    })}
                  />
                  <p className="text-[11px] text-muted-foreground">Auto-sets FTE Range</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fte_range">FTE Range<RequiredIndicator fieldKey="fte_range" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("fte_range") || "none"}
                    onValueChange={(v) => setValue("fte_range", v === "none" ? "" as AccountFormValues["fte_range"] : v as AccountFormValues["fte_range"])}
                  >
                    <SelectTrigger id="fte_range">
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

                <div className="flex items-center gap-2 md:col-span-2 pt-2">
                  <Checkbox
                    id="priority_account_basic"
                    checked={watch("priority_account") ?? false}
                    onCheckedChange={(v) => setValue("priority_account", v === true)}
                  />
                  <Label htmlFor="priority_account_basic" className="cursor-pointer text-sm font-medium">
                    🎯 Priority Account
                  </Label>
                  <span className="text-xs text-muted-foreground ml-2">
                    Flag for leadership attention / weekly pipeline review
                  </span>
                </div>
              </div>
            </FormSection>

            {/* ---- 2. Contact Information (always open) ---- */}
            <FormSection title="Contact Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">
                    Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} />
                  </Label>
                  <PhoneInput
                    id="phone"
                    value={watch("phone") ?? ""}
                    onChange={(v) => setValue("phone", v)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Include extension after the number: "(208) 555-1234 x567"
                  </p>
                </div>
              </div>
            </FormSection>

            {/* ---- 3. Address Information (collapsible, open by default) ---- */}
            <CollapsibleFormSection title="Address Information" defaultOpen={true}>
              {/* Billing */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing Address</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="billing_street">Street</Label>
                  <Input id="billing_street" {...register("billing_street")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing_city">City</Label>
                  <Input id="billing_city" {...register("billing_city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing_state">State</Label>
                  <Select
                    value={watch("billing_state") || "none"}
                    onValueChange={(v) =>
                      setValue("billing_state", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger id="billing_state">
                      <SelectValue placeholder="Select state..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing_zip">Zip</Label>
                  <Input id="billing_zip" {...register("billing_zip")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing_country">Country</Label>
                  <Input id="billing_country" {...register("billing_country")} />
                </div>
              </div>

              {/* Shipping */}
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">Shipping Address</h4>
              <div className="flex items-center gap-2 mb-1">
                <Checkbox
                  id="same_as_billing"
                  checked={sameAsBilling}
                  onCheckedChange={(v) => setSameAsBilling(v === true)}
                />
                <Label htmlFor="same_as_billing" className="text-sm font-normal cursor-pointer">
                  Same as billing
                </Label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="shipping_street">Street</Label>
                  <Input id="shipping_street" disabled={sameAsBilling} {...register("shipping_street")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_city">City</Label>
                  <Input id="shipping_city" disabled={sameAsBilling} {...register("shipping_city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_state">State</Label>
                  <Select
                    value={watch("shipping_state") || "none"}
                    onValueChange={(v) =>
                      setValue("shipping_state", v === "none" ? "" : v)
                    }
                    disabled={sameAsBilling}
                  >
                    <SelectTrigger id="shipping_state">
                      <SelectValue placeholder="Select state..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_zip">Zip</Label>
                  <Input
                    id="shipping_zip"
                    disabled={sameAsBilling}
                    {...register("shipping_zip")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_country">Country</Label>
                  <Input id="shipping_country" disabled={sameAsBilling} {...register("shipping_country")} />
                </div>
              </div>

              {/* Timezone (moved here from Company Details per Summer): it's
                  auto-derived from the billing zip, so it lives where the zip
                  is. Read-only. */}
              <div className="space-y-2 mt-4 md:w-1/3">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  placeholder="Derived from billing zip"
                  {...register("timezone")}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  title="Timezone is derived from the billing (or shipping) zip code automatically — it can't be edited directly."
                />
              </div>
            </CollapsibleFormSection>

            {/* Company Details section removed per Summer — FTE Range +
                Number of Employees moved to Basic Information, Timezone moved to
                Address Information, and FTE Count / Number of Providers / Number
                of Locations / Annual Revenue dropped from the visible form.
                Those four still load via defaultValues and save back via the
                payload unchanged (round-tripped, shouldUnregister is off), so no
                existing data is lost — they're just no longer shown or edited. */}

            {/* ---- Contract & Renewal (collapsible) ---- */}
            <CollapsibleFormSection title="Contract & Renewal">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="active_since">Active Since<RequiredIndicator fieldKey="active_since" requiredFields={requiredKeys} /></Label>
                  <Input id="active_since" type="date" {...register("active_since")} />
                </div>
                <div className="space-y-2">
                  <Label>Renewal Type<RequiredIndicator fieldKey="renewal_type" requiredFields={requiredKeys} /></Label>
                  <PicklistSelect
                    fieldKey="accounts.renewal_type"
                    value={watch("renewal_type")}
                    onChange={(v) =>
                      setValue(
                        "renewal_type",
                        (v ?? "") as AccountFormValues["renewal_type"],
                      )
                    }
                    allowClear
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="every_other_year"
                    checked={watch("every_other_year") ?? false}
                    onCheckedChange={(v) => setValue("every_other_year", v === true)}
                  />
                  <Label htmlFor="every_other_year" className="text-sm font-normal cursor-pointer">
                    Every Other Year
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contracts">Contracts<RequiredIndicator fieldKey="contracts" requiredFields={requiredKeys} /></Label>
                  <Input id="contracts" {...register("contracts")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_start_date">Contract Start<RequiredIndicator fieldKey="current_contract_start_date" requiredFields={requiredKeys} /></Label>
                  <Input id="current_contract_start_date" type="date" {...register("current_contract_start_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_end_date">Contract End<RequiredIndicator fieldKey="current_contract_end_date" requiredFields={requiredKeys} /></Label>
                  <Input id="current_contract_end_date" type="date" {...register("current_contract_end_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_length_months">Contract Length<RequiredIndicator fieldKey="current_contract_length_months" requiredFields={requiredKeys} /></Label>
                  <PicklistSelect
                    id="current_contract_length_months"
                    fieldKey="accounts.current_contract_length_months"
                    value={watch("current_contract_length_months") as number | null | undefined}
                    onChange={(v) =>
                      setValue(
                        "current_contract_length_months",
                        v == null || v === "" ? "" : Number(v),
                        { shouldDirty: true },
                      )
                    }
                    allowClear
                    placeholder="Select length…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acv">ACV<RequiredIndicator fieldKey="acv" requiredFields={requiredKeys} /></Label>
                  <Input id="acv" type="number" step="0.01" {...register("acv")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lifetime_value">Lifetime Value<RequiredIndicator fieldKey="lifetime_value" requiredFields={requiredKeys} /></Label>
                  <Input id="lifetime_value" type="number" step="0.01" {...register("lifetime_value")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="churn_amount">Churn Amount<RequiredIndicator fieldKey="churn_amount" requiredFields={requiredKeys} /></Label>
                  <Input id="churn_amount" type="number" step="0.01" {...register("churn_amount")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="churn_date">Churn Date<RequiredIndicator fieldKey="churn_date" requiredFields={requiredKeys} /></Label>
                  <Input id="churn_date" type="date" {...register("churn_date")} />
                </div>
              </div>
            </CollapsibleFormSection>

            {/* ---- 6. Partner Information (collapsible) ---- */}
            <CollapsibleFormSection title="Partner Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="partner_account">Partner Account<RequiredIndicator fieldKey="partner_account" requiredFields={requiredKeys} /></Label>
                  <Input id="partner_account" {...register("partner_account")} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Checkbox
                    id="partner_prospect"
                    checked={watch("partner_prospect") ?? false}
                    onCheckedChange={(v) => setValue("partner_prospect", v === true)}
                  />
                  <Label htmlFor="partner_prospect" className="text-sm font-normal cursor-pointer">
                    Partner Prospect
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Lead Source<RequiredIndicator fieldKey="lead_source" requiredFields={requiredKeys} /></Label>
                  {/* Admin-managed picklist (Joe: Source = CHANNEL only — mql/sql
                      retired). Options seeded by 20260715150000; a stored legacy
                      value still displays via PicklistSelect's "(legacy)" entry. */}
                  <PicklistSelect
                    fieldKey="accounts.lead_source"
                    value={watch("lead_source") ?? null}
                    onChange={(v) => setValue("lead_source", v ?? "")}
                    allowClear
                    placeholder="Select..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead_source_detail">Lead Source Detail<RequiredIndicator fieldKey="lead_source_detail" requiredFields={requiredKeys} /></Label>
                  <Input id="lead_source_detail" {...register("lead_source_detail")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partnership_status">Partnership Status</Label>
                  <PicklistSelect
                    id="partnership_status"
                    fieldKey="accounts.partnership_status"
                    value={watch("partnership_status") ?? ""}
                    onChange={(v) => setValue("partnership_status", v ?? "")}
                    allowClear
                    placeholder="Select status…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partner_type">
                    Partner Type
                    {/* Conditionally required (Rachel's rule): only when the
                        account is marked as a partner. Same mark as the other
                        required fields so it's obvious BEFORE hitting Save. */}
                    {(watch("account_type") ?? "").startsWith("Partner") && (
                      <span className="text-destructive ml-0.5">
                        *{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          (required for partners)
                        </span>
                      </span>
                    )}
                  </Label>
                  <PicklistSelect
                    id="partner_type"
                    fieldKey="accounts.partner_type"
                    value={watch("partner_type") ?? ""}
                    onChange={(v) => setValue("partner_type", v ?? "")}
                    allowClear
                    placeholder="Select type…"
                  />
                </div>
              </div>
              <div className="space-y-2 mt-4">
                <Label htmlFor="relationship_notes">Relationship Notes</Label>
                <Textarea
                  id="relationship_notes"
                  rows={4}
                  placeholder="Partnership plan, history, and next steps with this partner…"
                  {...register("relationship_notes")}
                />
              </div>
            </CollapsibleFormSection>

            {/* ---- 7. Additional Information (collapsible, collapsed by default)
                 Priority Account moved up to Basic Information for visibility. ---- */}
            <CollapsibleFormSection title="Additional Information" defaultOpen={false}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Project Segment<RequiredIndicator fieldKey="project_segment" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={(watch("project_segment") as string) || "none"}
                    onValueChange={(v) =>
                      setValue("project_segment", v === "none" ? "" : (v as never))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select segment..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="rural_hospital">Rural Hospital</SelectItem>
                      <SelectItem value="community_hospital">Community Hospital</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                      <SelectItem value="medium_sized">Medium Sized</SelectItem>
                      <SelectItem value="small_sized">Small Sized</SelectItem>
                      <SelectItem value="fqhc">FQHC</SelectItem>
                      <SelectItem value="voa">VoA</SelectItem>
                      <SelectItem value="franchise">Franchise</SelectItem>
                      <SelectItem value="strategic_partner">Strategic Partner</SelectItem>
                      <SelectItem value="it_vendor_third_party">IT Vendor / 3rd Party</SelectItem>
                      <SelectItem value="independent_associations">Independent Associations</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="description">Description<RequiredIndicator fieldKey="description" requiredFields={requiredKeys} /></Label>
                  <Textarea id="description" rows={3} {...register("description")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">Notes<RequiredIndicator fieldKey="notes" requiredFields={requiredKeys} /></Label>
                  <Textarea id="notes" rows={3} {...register("notes")} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="next_steps">Next Steps<RequiredIndicator fieldKey="next_steps" requiredFields={requiredKeys} /></Label>
                  <Textarea id="next_steps" rows={3} {...register("next_steps")} />
                </div>
              </div>
            </CollapsibleFormSection>

            {/* ---- Custom Fields ---- */}
            {customFieldDefs && customFieldDefs.length > 0 && (
              <CollapsibleFormSection title="Custom Fields" defaultOpen={true}>
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
              </CollapsibleFormSection>
            )}

            {/* ---- Actions ---- */}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Account"}
              </Button>
              {unsavedDialog}
              <Button type="button" variant="outline" onClick={() => confirmIfDirty(() => navigate(-1))}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
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
  const id = `custom_${field_key}`;

  switch (field_type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={id}
            type={field_type === "email" ? "email" : field_type === "url" ? "url" : "text"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "textarea":
      return (
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Textarea
            id={id}
            rows={3}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "number":
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={id}
            type="number"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      );

    case "currency":
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={id}
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
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={id}
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
            id={id}
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
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
          <Label htmlFor={id}>
            {label}
            {is_required && " *"}
          </Label>
          <Input
            id={id}
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
