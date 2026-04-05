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
      is_primary: false,
      owner_user_id: null,
      lead_source: null,
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
        is_primary: contact.is_primary,
        owner_user_id: contact.owner_user_id,
        lead_source: contact.lead_source ?? null,
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
                <Label htmlFor="phone">Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} /></Label>
                <Input id="phone" {...register("phone")} />
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
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_primary"
                checked={watch("is_primary")}
                onCheckedChange={(checked) => setValue("is_primary", !!checked)}
              />
              <Label htmlFor="is_primary" className="cursor-pointer">Primary contact for this account</Label>
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
