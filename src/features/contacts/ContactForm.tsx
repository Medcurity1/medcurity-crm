import { useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useContact, useCreateContact, useUpdateContact } from "./api";
import { useAccounts } from "@/features/accounts/api";
import { useUsers } from "@/features/accounts/api";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { contactSchema, type ContactFormValues } from "./schema";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function ContactForm() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { data: contact, isLoading: loadingContact } = useContact(id);
  const { data: accountsResult } = useAccounts();
  const accounts = accountsResult?.data;
  const { data: users } = useUsers();
  const { data: requiredFieldsData } = useRequiredFields("contacts");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateContact();
  const updateMutation = useUpdateContact();

  const preselectedAccountId = searchParams.get("account_id");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      account_id: preselectedAccountId ?? "",
      first_name: "",
      last_name: "",
      email: "",
      title: "",
      phone: "",
      department: "",
      linkedin_url: "",
      do_not_contact: false,
      mailing_street: "",
      mailing_city: "",
      mailing_state: "",
      mailing_zip: "",
      mailing_country: "",
      is_primary: false,
      owner_user_id: null,
      lead_source: null,
      mql_date: "",
      sql_date: "",
    },
  });

  useEffect(() => {
    if (contact && isEditing) {
      reset({
        account_id: contact.account_id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email ?? "",
        title: contact.title ?? "",
        phone: contact.phone ?? "",
        department: contact.department ?? "",
        linkedin_url: contact.linkedin_url ?? "",
        do_not_contact: contact.do_not_contact ?? false,
        mailing_street: contact.mailing_street ?? "",
        mailing_city: contact.mailing_city ?? "",
        mailing_state: contact.mailing_state ?? "",
        mailing_zip: contact.mailing_zip ?? "",
        mailing_country: contact.mailing_country ?? "",
        is_primary: contact.is_primary,
        owner_user_id: contact.owner_user_id,
        lead_source: contact.lead_source ?? null,
        mql_date: contact.mql_date ?? "",
        sql_date: contact.sql_date ?? "",
      });
    }
  }, [contact, isEditing, reset]);

  async function onSubmit(values: ContactFormValues) {
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

    const payload = {
      ...values,
      email: values.email || null,
      title: values.title || null,
      phone: values.phone || null,
      department: values.department || null,
      linkedin_url: values.linkedin_url || null,
      mailing_street: values.mailing_street || null,
      mailing_city: values.mailing_city || null,
      mailing_state: values.mailing_state || null,
      mailing_zip: values.mailing_zip || null,
      mailing_country: values.mailing_country || null,
      mql_date: values.mql_date || null,
      sql_date: values.sql_date || null,
    };

    try {
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, ...payload } as Parameters<typeof updateMutation.mutateAsync>[0]);
        toast.success("Contact updated");
        navigate(`/contacts/${id}`);
      } else {
        const result = await createMutation.mutateAsync(payload as Parameters<typeof createMutation.mutateAsync>[0]);
        toast.success("Contact created");
        navigate(`/contacts/${result.id}`);
      }
    } catch (err) {
      console.error("Failed to save contact:", err);
      toast.error("Failed to save: " + (err as Error).message);
    }
  }

  if (isEditing && loadingContact) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Contact" : "New Contact"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Account *<RequiredIndicator fieldKey="account_id" requiredFields={requiredKeys} /></Label>
                <Select
                  value={watch("account_id")}
                  onValueChange={(v) => setValue("account_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.account_id && <p className="text-sm text-destructive">{errors.account_id.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="first_name">First Name *<RequiredIndicator fieldKey="first_name" requiredFields={requiredKeys} /></Label>
                <Input id="first_name" {...register("first_name")} />
                {errors.first_name && <p className="text-sm text-destructive">{errors.first_name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name *<RequiredIndicator fieldKey="last_name" requiredFields={requiredKeys} /></Label>
                <Input id="last_name" {...register("last_name")} />
                {errors.last_name && <p className="text-sm text-destructive">{errors.last_name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email<RequiredIndicator fieldKey="email" requiredFields={requiredKeys} /></Label>
                <Input id="email" type="email" {...register("email")} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>

              {!isEditing && (
                <div className="md:col-span-2">
                  <DuplicateWarning
                    entity="contacts"
                    email={watch("email")}
                    firstName={watch("first_name")}
                    lastName={watch("last_name")}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Title<RequiredIndicator fieldKey="title" requiredFields={requiredKeys} /></Label>
                <Input id="title" {...register("title")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="department">Department<RequiredIndicator fieldKey="department" requiredFields={requiredKeys} /></Label>
                <Input id="department" {...register("department")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} /></Label>
                <Input id="phone" {...register("phone")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedin_url">LinkedIn URL<RequiredIndicator fieldKey="linkedin_url" requiredFields={requiredKeys} /></Label>
                <Input id="linkedin_url" type="url" placeholder="https://linkedin.com/in/..." {...register("linkedin_url")} />
                {errors.linkedin_url && <p className="text-sm text-destructive">{errors.linkedin_url.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Lead Source</Label>
                <Select
                  value={watch("lead_source") ?? "none"}
                  onValueChange={(v) => setValue("lead_source", v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select source..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
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
                <Label htmlFor="mql_date">MQL Date<RequiredIndicator fieldKey="mql_date" requiredFields={requiredKeys} /></Label>
                <Input id="mql_date" type="date" {...register("mql_date")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sql_date">SQL Date<RequiredIndicator fieldKey="sql_date" requiredFields={requiredKeys} /></Label>
                <Input id="sql_date" type="date" {...register("sql_date")} />
              </div>
            </div>

            {/* Mailing address */}
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-medium text-muted-foreground">Mailing Address</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="mailing_street">Street</Label>
                  <Input id="mailing_street" {...register("mailing_street")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mailing_city">City</Label>
                  <Input id="mailing_city" {...register("mailing_city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mailing_state">State / Province</Label>
                  <Input id="mailing_state" {...register("mailing_state")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mailing_zip">Postal Code</Label>
                  <Input id="mailing_zip" {...register("mailing_zip")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mailing_country">Country</Label>
                  <Input id="mailing_country" {...register("mailing_country")} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_primary"
                  checked={watch("is_primary")}
                  onCheckedChange={(checked) => setValue("is_primary", !!checked)}
                />
                <Label htmlFor="is_primary" className="cursor-pointer">Primary contact for this account</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="do_not_contact"
                  checked={watch("do_not_contact")}
                  onCheckedChange={(checked) => setValue("do_not_contact", !!checked)}
                />
                <Label htmlFor="do_not_contact" className="cursor-pointer">Do not contact</Label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Contact"}
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
