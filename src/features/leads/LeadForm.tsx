import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLead, useCreateLead, useUpdateLead, useUsers } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { leadSchema, type LeadFormValues } from "./schema";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

export function LeadForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { data: lead, isLoading: loadingLead } = useLead(id);
  const { data: users } = useUsers();
  const { data: customFieldDefs } = useCustomFieldDefinitions("leads");
  const { data: requiredFieldsData } = useRequiredFields("leads");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateLead();
  const updateMutation = useUpdateLead();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      company: "",
      title: "",
      industry: "",
      website: "",
      status: "new",
      source: "",
      qualification: "unqualified",
      score: "",
      mql_date: "",
      do_not_market_to: false,
      description: "",
      employees: "",
      annual_revenue: "",
      owner_user_id: null,
      street: "",
      city: "",
      state: "",
      zip: "",
      country: "",
      credential: "",
      phone_ext: "",
      time_zone: "",
      type: "",
      priority_lead: false,
      project: "",
      business_relationship_tag: "",
      linkedin_url: "",
      cold_lead: false,
      cold_lead_source: "",
      custom_fields: {},
    },
  });

  useEffect(() => {
    if (lead && isEditing) {
      reset({
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        company: lead.company ?? "",
        title: lead.title ?? "",
        industry: lead.industry ?? "",
        website: lead.website ?? "",
        status: lead.status,
        source: lead.source ?? "",
        qualification: lead.qualification ?? "unqualified",
        score: lead.score ?? "",
        mql_date: lead.mql_date ?? "",
        do_not_market_to: lead.do_not_market_to ?? false,
        description: lead.description ?? "",
        employees: lead.employees ?? "",
        annual_revenue: lead.annual_revenue ?? "",
        owner_user_id: lead.owner_user_id,
        street: lead.street ?? "",
        city: lead.city ?? "",
        state: lead.state ?? "",
        zip: lead.zip ?? "",
        country: lead.country ?? "",
        credential: lead.credential ?? "",
        phone_ext: lead.phone_ext ?? "",
        time_zone: lead.time_zone ?? "",
        type: lead.type ?? "",
        priority_lead: lead.priority_lead ?? false,
        project: lead.project ?? "",
        business_relationship_tag: lead.business_relationship_tag ?? "",
        linkedin_url: lead.linkedin_url ?? "",
        cold_lead: lead.cold_lead ?? false,
        cold_lead_source: lead.cold_lead_source ?? "",
        custom_fields: lead.custom_fields ?? {},
      });
    }
  }, [lead, isEditing, reset]);

  function emptyToNull(v: unknown): unknown {
    if (v === "" || v === undefined) return null;
    return v;
  }

  async function onSubmit(values: LeadFormValues) {
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
      first_name: values.first_name,
      last_name: values.last_name,
      email: emptyToNull(values.email),
      phone: emptyToNull(values.phone),
      company: emptyToNull(values.company),
      title: emptyToNull(values.title),
      industry: emptyToNull(values.industry),
      website: emptyToNull(values.website),
      status: values.status,
      source: emptyToNull(values.source),
      qualification: values.qualification ?? "unqualified",
      score: emptyToNull(values.score),
      mql_date: emptyToNull(values.mql_date),
      description: emptyToNull(values.description),
      employees: emptyToNull(values.employees),
      annual_revenue: emptyToNull(values.annual_revenue),
      owner_user_id: values.owner_user_id ?? null,
      street: emptyToNull(values.street),
      city: emptyToNull(values.city),
      state: emptyToNull(values.state),
      zip: emptyToNull(values.zip),
      country: emptyToNull(values.country),
      do_not_market_to: values.do_not_market_to ?? false,
      credential: emptyToNull(values.credential),
      phone_ext: emptyToNull(values.phone_ext),
      time_zone: emptyToNull(values.time_zone),
      type: emptyToNull(values.type),
      priority_lead: values.priority_lead ?? false,
      project: emptyToNull(values.project),
      business_relationship_tag: emptyToNull(values.business_relationship_tag),
      linkedin_url: emptyToNull(values.linkedin_url),
      cold_lead: values.cold_lead ?? false,
      cold_lead_source: emptyToNull(values.cold_lead_source),
      custom_fields: values.custom_fields ?? {},
    };

    try {
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, ...payload } as Parameters<typeof updateMutation.mutateAsync>[0]);
        toast.success("Lead updated");
        navigate(`/leads/${id}`);
      } else {
        const result = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);
        toast.success("Lead created");
        navigate(`/leads/${result.id}`);
      }
    } catch (err) {
      console.error("Failed to save lead:", err);
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

  if (isEditing && loadingLead) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Lead" : "New Lead"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* ---- Basic Info ---- */}
            <FormSection title="Basic Info">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">First Name *<RequiredIndicator fieldKey="first_name" requiredFields={requiredKeys} /></Label>
                  <Input id="first_name" {...register("first_name")} />
                  {errors.first_name && (
                    <p className="text-sm text-destructive">{errors.first_name.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="last_name">Last Name *<RequiredIndicator fieldKey="last_name" requiredFields={requiredKeys} /></Label>
                  <Input id="last_name" {...register("last_name")} />
                  {errors.last_name && (
                    <p className="text-sm text-destructive">{errors.last_name.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email<RequiredIndicator fieldKey="email" requiredFields={requiredKeys} /></Label>
                  <Input id="email" type="email" {...register("email")} />
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} /></Label>
                  <Input id="phone" {...register("phone")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone_ext">Phone Ext</Label>
                  <Input id="phone_ext" {...register("phone_ext")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company<RequiredIndicator fieldKey="company" requiredFields={requiredKeys} /></Label>
                  <Input id="company" {...register("company")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="linkedin_url">LinkedIn URL</Label>
                  <Input id="linkedin_url" type="url" placeholder="https://linkedin.com/in/..." {...register("linkedin_url")} />
                  {errors.linkedin_url && <p className="text-sm text-destructive">{errors.linkedin_url.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Credential</Label>
                  <Select
                    value={(watch("credential") as string) || "none"}
                    onValueChange={(v) => setValue("credential", v === "none" ? "" : (v as never))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="md">MD</SelectItem>
                      <SelectItem value="do">DO</SelectItem>
                      <SelectItem value="rn">RN</SelectItem>
                      <SelectItem value="np">NP</SelectItem>
                      <SelectItem value="pa">PA</SelectItem>
                      <SelectItem value="chc">CHC</SelectItem>
                      <SelectItem value="chps">CHPS</SelectItem>
                      <SelectItem value="ceo">CEO</SelectItem>
                      <SelectItem value="cfo">CFO</SelectItem>
                      <SelectItem value="coo">COO</SelectItem>
                      <SelectItem value="cio">CIO</SelectItem>
                      <SelectItem value="cto">CTO</SelectItem>
                      <SelectItem value="ciso">CISO</SelectItem>
                      <SelectItem value="cmo">CMO</SelectItem>
                      <SelectItem value="practice_manager">Practice Manager</SelectItem>
                      <SelectItem value="office_manager">Office Manager</SelectItem>
                      <SelectItem value="compliance_officer">Compliance Officer</SelectItem>
                      <SelectItem value="privacy_officer">Privacy Officer</SelectItem>
                      <SelectItem value="security_officer">Security Officer</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Time Zone</Label>
                  <Select
                    value={(watch("time_zone") as string) || "none"}
                    onValueChange={(v) => setValue("time_zone", v === "none" ? "" : (v as never))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select time zone..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="eastern">Eastern</SelectItem>
                      <SelectItem value="central">Central</SelectItem>
                      <SelectItem value="mountain">Mountain</SelectItem>
                      <SelectItem value="pacific">Pacific</SelectItem>
                      <SelectItem value="alaska">Alaska</SelectItem>
                      <SelectItem value="hawaii">Hawaii</SelectItem>
                      <SelectItem value="arizona_no_dst">Arizona (no DST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Lead Type</Label>
                  <Select
                    value={(watch("type") as string) || "none"}
                    onValueChange={(v) => setValue("type", v === "none" ? "" : (v as never))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="inbound_website">Inbound (Website)</SelectItem>
                      <SelectItem value="inbound_referral">Inbound (Referral)</SelectItem>
                      <SelectItem value="outbound_cold">Outbound / Cold</SelectItem>
                      <SelectItem value="purchased_list">Purchased List</SelectItem>
                      <SelectItem value="conference">Conference</SelectItem>
                      <SelectItem value="webinar">Webinar</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="existing_customer_expansion">Existing Customer Expansion</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Relationship Tag</Label>
                  <Select
                    value={(watch("business_relationship_tag") as string) || "none"}
                    onValueChange={(v) =>
                      setValue("business_relationship_tag", v === "none" ? "" : (v as never))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select relationship..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="decision_maker">Decision Maker</SelectItem>
                      <SelectItem value="influencer">Influencer</SelectItem>
                      <SelectItem value="economic_buyer">Economic Buyer</SelectItem>
                      <SelectItem value="technical_buyer">Technical Buyer</SelectItem>
                      <SelectItem value="champion">Champion</SelectItem>
                      <SelectItem value="detractor">Detractor</SelectItem>
                      <SelectItem value="end_user">End User</SelectItem>
                      <SelectItem value="gatekeeper">Gatekeeper</SelectItem>
                      <SelectItem value="executive_sponsor">Executive Sponsor</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="project">Project / Interest</Label>
                  <Input
                    id="project"
                    placeholder="e.g. SRA, HIPAA certification"
                    {...register("project")}
                  />
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-6">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="priority_lead"
                      checked={watch("priority_lead")}
                      onCheckedChange={(checked) => setValue("priority_lead", !!checked)}
                    />
                    <Label htmlFor="priority_lead" className="cursor-pointer">
                      Priority lead (needs immediate attention)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="cold_lead"
                      checked={watch("cold_lead")}
                      onCheckedChange={(checked) => setValue("cold_lead", !!checked)}
                    />
                    <Label htmlFor="cold_lead" className="cursor-pointer">
                      Cold lead (purchased list, pre-validation)
                    </Label>
                  </div>
                </div>

                {watch("cold_lead") && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="cold_lead_source">Cold Lead List Name</Label>
                    <Input
                      id="cold_lead_source"
                      placeholder="e.g. Cold Call SMB, Athena List, eClinicalWorks List"
                      {...register("cold_lead_source")}
                    />
                  </div>
                )}

                {!isEditing && (
                  <div className="md:col-span-2">
                    <DuplicateWarning
                      entity="leads"
                      email={watch("email")}
                      company={watch("company")}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="title">Title<RequiredIndicator fieldKey="title" requiredFields={requiredKeys} /></Label>
                  <Input id="title" {...register("title")} />
                </div>

                <div className="space-y-2">
                  <Label>Status<RequiredIndicator fieldKey="status" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("status")}
                    onValueChange={(v) =>
                      setValue("status", v as LeadFormValues["status"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="unqualified">Unqualified</SelectItem>
                      <SelectItem value="converted">Converted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Source<RequiredIndicator fieldKey="source" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("source") ?? ""}
                    onValueChange={(v) =>
                      setValue("source", v as LeadFormValues["source"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="cold_call">Cold Call</SelectItem>
                      <SelectItem value="trade_show">Trade Show</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="social_media">Social Media</SelectItem>
                      <SelectItem value="email_campaign">Email Campaign</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Qualification<RequiredIndicator fieldKey="qualification" requiredFields={requiredKeys} /></Label>
                  <Select
                    value={watch("qualification") ?? "unqualified"}
                    onValueChange={(v) =>
                      setValue("qualification", v as LeadFormValues["qualification"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unqualified">Unqualified</SelectItem>
                      <SelectItem value="mql">MQL</SelectItem>
                      <SelectItem value="sql">SQL</SelectItem>
                      <SelectItem value="sal">SAL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="score">Score<RequiredIndicator fieldKey="score" requiredFields={requiredKeys} /></Label>
                  <Input id="score" type="number" min={0} {...register("score")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mql_date">MQL Date<RequiredIndicator fieldKey="mql_date" requiredFields={requiredKeys} /></Label>
                  <Input id="mql_date" type="date" {...register("mql_date")} />
                </div>

                <div className="flex items-center space-x-2 pt-6">
                  <Checkbox
                    id="do_not_market_to"
                    checked={watch("do_not_market_to")}
                    onCheckedChange={(checked) => setValue("do_not_market_to", !!checked)}
                  />
                  <Label htmlFor="do_not_market_to" className="cursor-pointer text-destructive font-medium">
                    Do Not Market To
                  </Label>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry<RequiredIndicator fieldKey="industry" requiredFields={requiredKeys} /></Label>
                  <Input id="industry" {...register("industry")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employees">Employees<RequiredIndicator fieldKey="employees" requiredFields={requiredKeys} /></Label>
                  <Input id="employees" type="number" {...register("employees")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="annual_revenue">Annual Revenue<RequiredIndicator fieldKey="annual_revenue" requiredFields={requiredKeys} /></Label>
                  <Input id="annual_revenue" type="number" step="0.01" {...register("annual_revenue")} />
                </div>
              </div>
            </FormSection>

            {/* ---- Address ---- */}
            <FormSection title="Address">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="street">Street</Label>
                  <Input id="street" {...register("street")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" {...register("city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" {...register("state")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">Zip</Label>
                  <Input id="zip" {...register("zip")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" {...register("country")} />
                </div>
              </div>
            </FormSection>

            {/* ---- Description ---- */}
            <FormSection title="Description">
              <div className="space-y-2">
                <Textarea id="description" rows={4} {...register("description")} />
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
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Lead"}
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
          <input
            type="checkbox"
            id={id}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
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
