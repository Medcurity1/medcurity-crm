import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAccount, useCreateAccount, useUpdateAccount, useUsers } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { accountSchema, type AccountFormValues } from "./schema";
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
import type { CustomFieldDefinition } from "@/types/crm";

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

/* ---------- Main component ---------- */

export function AccountForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { data: account, isLoading: loadingAccount } = useAccount(id);
  const { data: users } = useUsers();
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
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: "",
      lifecycle_status: "prospect",
      status: "discovery",
      owner_user_id: null,
      website: "",
      industry: "",
      account_type: "",
      timezone: "",
      employees: "",
      locations: "",
      fte_count: "",
      fte_range: "",
      annual_revenue: "",
      active_since: "",
      renewal_type: "",
      current_contract_start_date: "",
      current_contract_end_date: "",
      current_contract_length_months: "",
      acv: "",
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
      notes: "",
      custom_fields: {},
    },
  });

  useEffect(() => {
    if (account && isEditing) {
      reset({
        name: account.name,
        lifecycle_status: account.lifecycle_status,
        status: account.status ?? "discovery",
        owner_user_id: account.owner_user_id,
        website: account.website ?? "",
        industry: account.industry ?? "",
        account_type: account.account_type ?? "",
        timezone: account.timezone ?? "",
        employees: account.employees ?? "",
        locations: account.locations ?? "",
        fte_count: account.fte_count ?? "",
        fte_range: account.fte_range ?? "",
        annual_revenue: account.annual_revenue ?? "",
        active_since: account.active_since ?? "",
        renewal_type: account.renewal_type ?? "",
        current_contract_start_date: account.current_contract_start_date ?? "",
        current_contract_end_date: account.current_contract_end_date ?? "",
        current_contract_length_months: account.current_contract_length_months ?? "",
        acv: account.acv ?? "",
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
        notes: account.notes ?? "",
        custom_fields: account.custom_fields ?? {},
      });
    }
  }, [account, isEditing, reset]);

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
      account_type: emptyToNull(values.account_type),
      timezone: emptyToNull(values.timezone),
      employees: emptyToNull(values.employees),
      locations: emptyToNull(values.locations),
      fte_count: emptyToNull(values.fte_count),
      fte_range: emptyToNull(values.fte_range),
      annual_revenue: emptyToNull(values.annual_revenue),
      active_since: emptyToNull(values.active_since),
      renewal_type: emptyToNull(values.renewal_type),
      current_contract_start_date: emptyToNull(values.current_contract_start_date),
      current_contract_end_date: emptyToNull(values.current_contract_end_date),
      current_contract_length_months: emptyToNull(values.current_contract_length_months),
      acv: emptyToNull(values.acv),
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
      notes: emptyToNull(values.notes),
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
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to save account: " + message);
    }
  }

  if (isEditing && loadingAccount) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Account" : "New Account"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* ---- Basic Info ---- */}
            <FormSection title="Basic Info">
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
                  <Label>Lifecycle Status<RequiredIndicator fieldKey="lifecycle_status" requiredFields={requiredKeys} /></Label>
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

                <div className="space-y-2">
                  <Label>Owner<RequiredIndicator fieldKey="owner_user_id" requiredFields={requiredKeys} /></Label>
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
                          {u.full_name ?? u.id}
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
                  <Label htmlFor="industry">Industry<RequiredIndicator fieldKey="industry" requiredFields={requiredKeys} /></Label>
                  <Input id="industry" {...register("industry")} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="website">Website<RequiredIndicator fieldKey="website" requiredFields={requiredKeys} /></Label>
                  <Input id="website" placeholder="https://..." {...register("website")} />
                  {errors.website && (
                    <p className="text-sm text-destructive">{errors.website.message}</p>
                  )}
                </div>
              </div>
            </FormSection>

            {/* ---- Company Details ---- */}
            <FormSection title="Company Details">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone<RequiredIndicator fieldKey="timezone" requiredFields={requiredKeys} /></Label>
                  <Input id="timezone" placeholder="US/Eastern" {...register("timezone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employees">Employees<RequiredIndicator fieldKey="employees" requiredFields={requiredKeys} /></Label>
                  <Input id="employees" type="number" {...register("employees")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locations">Locations<RequiredIndicator fieldKey="locations" requiredFields={requiredKeys} /></Label>
                  <Input id="locations" type="number" {...register("locations")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fte_count">FTE Count<RequiredIndicator fieldKey="fte_count" requiredFields={requiredKeys} /></Label>
                  <Input id="fte_count" type="number" {...register("fte_count")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fte_range">FTE Range<RequiredIndicator fieldKey="fte_range" requiredFields={requiredKeys} /></Label>
                  <Input id="fte_range" placeholder="e.g. 100-500" {...register("fte_range")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="annual_revenue">Annual Revenue<RequiredIndicator fieldKey="annual_revenue" requiredFields={requiredKeys} /></Label>
                  <Input id="annual_revenue" type="number" step="0.01" {...register("annual_revenue")} />
                </div>
              </div>
            </FormSection>

            {/* ---- Contract ---- */}
            <FormSection title="Contract">
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
                      <SelectItem value="manual_renew">Manual Renew</SelectItem>
                      <SelectItem value="no_auto_renew">No Auto Renew</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_start_date">Contract Start<RequiredIndicator fieldKey="current_contract_start_date" requiredFields={requiredKeys} /></Label>
                  <Input
                    id="current_contract_start_date"
                    type="date"
                    {...register("current_contract_start_date")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_end_date">Contract End<RequiredIndicator fieldKey="current_contract_end_date" requiredFields={requiredKeys} /></Label>
                  <Input
                    id="current_contract_end_date"
                    type="date"
                    {...register("current_contract_end_date")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current_contract_length_months">Contract Length (months)<RequiredIndicator fieldKey="current_contract_length_months" requiredFields={requiredKeys} /></Label>
                  <Input
                    id="current_contract_length_months"
                    type="number"
                    {...register("current_contract_length_months")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acv">ACV<RequiredIndicator fieldKey="acv" requiredFields={requiredKeys} /></Label>
                  <Input id="acv" type="number" step="0.01" {...register("acv")} />
                </div>
              </div>
            </FormSection>

            {/* ---- Billing Address ---- */}
            <FormSection title="Billing Address">
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
                  <Input id="billing_state" {...register("billing_state")} />
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
            </FormSection>

            {/* ---- Shipping Address ---- */}
            <FormSection title="Shipping Address">
              <div className="flex items-center gap-2 mb-3">
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
                  <Input
                    id="shipping_street"
                    disabled={sameAsBilling}
                    {...register("shipping_street")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_city">City</Label>
                  <Input
                    id="shipping_city"
                    disabled={sameAsBilling}
                    {...register("shipping_city")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping_state">State</Label>
                  <Input
                    id="shipping_state"
                    disabled={sameAsBilling}
                    {...register("shipping_state")}
                  />
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
                  <Input
                    id="shipping_country"
                    disabled={sameAsBilling}
                    {...register("shipping_country")}
                  />
                </div>
              </div>
            </FormSection>

            {/* ---- Notes ---- */}
            <FormSection title="Notes">
              <div className="space-y-2">
                <Textarea id="notes" rows={4} {...register("notes")} />
              </div>
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
      // For multi_select, fall back to text input with comma-separated values
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
