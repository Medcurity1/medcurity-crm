import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAccount, useCreateAccount, useUpdateAccount, useUsers, useAccountsList } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { accountSchema, type AccountFormValues } from "./schema";
import { FTE_RANGES, employeesToFteRange } from "@/lib/formatters";
import { US_STATES } from "@/lib/us-states";
import { errorMessage } from "@/lib/errors";
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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: isEditing && account
      ? {
          name: account.name,
          lifecycle_status: account.lifecycle_status,
          status: account.status ?? "discovery",
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
          status: "discovery",
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

  async function onSubmit(values: AccountFormValues) {
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
      name: values.name,
      lifecycle_status: values.lifecycle_status,
      status: emptyToNull(values.status),
      owner_user_id: values.owner_user_id ?? null,
      website: emptyToNull(values.website),
      industry: emptyToNull(values.industry),
      industry_category: emptyToNull(values.industry_category),
      account_type: emptyToNull(values.account_type),
      account_number: emptyToNull(values.account_number),
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
                  <Label htmlFor="account_type">Account Type<RequiredIndicator fieldKey="account_type" requiredFields={requiredKeys} /></Label>
                  <Input id="account_type" {...register("account_type")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account_number">Account Number<RequiredIndicator fieldKey="account_number" requiredFields={requiredKeys} /></Label>
                  <Input id="account_number" {...register("account_number")} />
                </div>

                <div className="space-y-2">
                  <Label>Status<RequiredIndicator fieldKey="status" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("status") ?? "discovery"}
                    onValueChange={(v) =>
                      setValue("status", v as NonNullable<AccountFormValues["status"]>)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discovery">Discovery</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="churned">Churned</SelectItem>
                    </SelectContent>
                  </Select>
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
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="hospital">Hospital</SelectItem>
                      <SelectItem value="medical_group">Medical Group</SelectItem>
                      <SelectItem value="fqhc">FQHC</SelectItem>
                      <SelectItem value="rural_health_clinic">Rural Health Clinic</SelectItem>
                      <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                      <SelectItem value="long_term_care">Long-Term Care</SelectItem>
                      <SelectItem value="home_health">Home Health</SelectItem>
                      <SelectItem value="hospice">Hospice</SelectItem>
                      <SelectItem value="behavioral_health">Behavioral Health</SelectItem>
                      <SelectItem value="dental">Dental</SelectItem>
                      <SelectItem value="pediatrics">Pediatrics</SelectItem>
                      <SelectItem value="specialty_clinic">Specialty Clinic</SelectItem>
                      <SelectItem value="urgent_care">Urgent Care</SelectItem>
                      <SelectItem value="imaging_center">Imaging Center</SelectItem>
                      <SelectItem value="lab_services">Lab Services</SelectItem>
                      <SelectItem value="pharmacy">Pharmacy</SelectItem>
                      <SelectItem value="telemedicine">Telemedicine</SelectItem>
                      <SelectItem value="tribal_health">Tribal Health</SelectItem>
                      <SelectItem value="public_health_agency">Public Health Agency</SelectItem>
                      <SelectItem value="healthcare_it_vendor">Healthcare IT Vendor</SelectItem>
                      <SelectItem value="managed_service_provider">Managed Service Provider</SelectItem>
                      <SelectItem value="healthcare_consulting">Healthcare Consulting</SelectItem>
                      <SelectItem value="insurance_payer">Insurance / Payer</SelectItem>
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
                  <Label htmlFor="phone">Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} /></Label>
                  <Input id="phone" type="tel" {...register("phone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone_extension">Phone Extension<RequiredIndicator fieldKey="phone_extension" requiredFields={requiredKeys} /></Label>
                  <Input id="phone_extension" {...register("phone_extension")} />
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
                  <Input id="shipping_zip" disabled={sameAsBilling} {...register("shipping_zip")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_country">Country</Label>
                  <Input id="shipping_country" disabled={sameAsBilling} {...register("shipping_country")} />
                </div>
              </div>
            </CollapsibleFormSection>

            {/* ---- 4. Company Details (collapsible) ---- */}
            <CollapsibleFormSection title="Company Details">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fte_count">FTE Count<RequiredIndicator fieldKey="fte_count" requiredFields={requiredKeys} /></Label>
                  <Input id="fte_count" type="number" {...register("fte_count")} />
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
                  <Label htmlFor="number_of_providers">Number of Providers<RequiredIndicator fieldKey="number_of_providers" requiredFields={requiredKeys} /></Label>
                  <Input id="number_of_providers" type="number" {...register("number_of_providers")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locations">Number of Locations<RequiredIndicator fieldKey="locations" requiredFields={requiredKeys} /></Label>
                  <Input id="locations" type="number" {...register("locations")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="annual_revenue">Annual Revenue<RequiredIndicator fieldKey="annual_revenue" requiredFields={requiredKeys} /></Label>
                  <Input id="annual_revenue" type="number" step="0.01" {...register("annual_revenue")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone<RequiredIndicator fieldKey="timezone" requiredFields={requiredKeys} /></Label>
                  <Input id="timezone" placeholder="US/Eastern" {...register("timezone")} />
                </div>
                <div className="space-y-2">
                  <Label>Customer Type<RequiredIndicator fieldKey="lifecycle_status" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("lifecycle_status")}
                    onValueChange={(v) =>
                      setValue("lifecycle_status", v as AccountFormValues["lifecycle_status"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prospect">Prospect</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="former_customer">Former Customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleFormSection>

            {/* ---- 5. Contract & Renewal (collapsible) ---- */}
            <CollapsibleFormSection title="Contract & Renewal">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="active_since">Active Since<RequiredIndicator fieldKey="active_since" requiredFields={requiredKeys} /></Label>
                  <Input id="active_since" type="date" {...register("active_since")} />
                </div>
                <div className="space-y-2">
                  <Label>Renewal Type<RequiredIndicator fieldKey="renewal_type" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("renewal_type") ?? ""}
                    onValueChange={(v) =>
                      setValue("renewal_type", v as AccountFormValues["renewal_type"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto_renew">Auto Renew</SelectItem>
                      <SelectItem value="full_auto_renew">Full Auto Renew</SelectItem>
                      <SelectItem value="manual_renew">Manual Renew</SelectItem>
                      <SelectItem value="no_auto_renew">No Auto Renew</SelectItem>
                      <SelectItem value="platform_only_auto_renew">Platform Only Auto Renew</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="current_contract_length_months">Contract Length (months)<RequiredIndicator fieldKey="current_contract_length_months" requiredFields={requiredKeys} /></Label>
                  <Input id="current_contract_length_months" type="number" {...register("current_contract_length_months")} />
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
                  <Select
                    value={watch("lead_source") ?? ""}
                    onValueChange={(v) => setValue("lead_source", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="cold_call">Cold Call</SelectItem>
                      <SelectItem value="trade_show">Trade Show</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="email_campaign">Email Campaign</SelectItem>
                      <SelectItem value="webinar">Webinar</SelectItem>
                      <SelectItem value="podcast">Podcast</SelectItem>
                      <SelectItem value="conference">Conference</SelectItem>
                      <SelectItem value="sql">SQL</SelectItem>
                      <SelectItem value="mql">MQL</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead_source_detail">Lead Source Detail<RequiredIndicator fieldKey="lead_source_detail" requiredFields={requiredKeys} /></Label>
                  <Input id="lead_source_detail" {...register("lead_source_detail")} />
                </div>
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
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
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
