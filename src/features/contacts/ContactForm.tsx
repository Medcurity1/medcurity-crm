import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useContact, useCreateContact, useUpdateContact } from "./api";
import type { Contact } from "@/types/crm";
import { PicklistSelect } from "@/features/picklists/PicklistSelect";
import { useAuth } from "@/features/auth/AuthProvider";
import { US_STATES } from "@/lib/us-states";
import { looksLikeUsZip, zipToTimeZone } from "@/lib/us-zip";
import { PhoneInput } from "@/components/PhoneInput";
import { useAccountsList } from "@/features/accounts/api";
import { useUsers } from "@/features/accounts/api";
import { useRequiredFields } from "@/hooks/useRequiredFields";
import { RequiredIndicator } from "@/components/RequiredIndicator";
import { contactSchema, type ContactFormValues } from "./schema";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Outer wrapper — handles the data-load gate. We must NOT mount the
 * inner form (and therefore useForm) until we have both the contact
 * record (edit mode) and the accounts list. See the matching comment
 * on LeadForm for the full rationale — short version: the previous
 * defaultValues={empty} + useEffect(reset) pattern raced with Radix
 * Select children (PicklistSelect), leaving picklist values blank on
 * edit.
 */
export function ContactForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { data: contact, isLoading: loadingContact } = useContact(id);
  const { data: accounts } = useAccountsList();

  if ((isEditing && (loadingContact || !contact)) || !accounts) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <ContactFormInner key={id ?? "new"} contact={contact} accounts={accounts} />;
}

/* ---------- Inner form ---------- */

interface AccountOption { id: string; name: string }

function ContactFormInner({
  contact,
  accounts,
}: {
  contact: Contact | undefined;
  accounts: AccountOption[];
}) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const { user } = useAuth();
  const { data: users } = useUsers();
  const { data: requiredFieldsData } = useRequiredFields("contacts");
  const requiredKeys = requiredFieldsData?.map((f) => f.field_key) ?? [];
  const createMutation = useCreateContact();
  const updateMutation = useUpdateContact();

  const preselectedAccountId = searchParams.get("account_id");

  // Merge the contact's current account into the dropdown even if it's
  // archived (and therefore filtered out by useAccountsList). Without
  // this, opening Edit on a contact whose account was later archived
  // shows an empty Select (placeholder), which then fails the
  // "Account is required" zod check on save.
  const accountOptions = useMemo(() => {
    const list = [...accounts];
    const contactAcc = contact?.account;
    if (contactAcc && !list.some((a) => a.id === contactAcc.id)) {
      list.unshift({ id: contactAcc.id, name: `${contactAcc.name} (archived)` });
    }
    return list;
  }, [accounts, contact?.account]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: isEditing && contact
      ? {
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
          credential: contact.credential ?? "",
          phone_ext: contact.phone_ext ?? "",
          mobile_phone: contact.mobile_phone ?? "",
          events_attended: contact.events_attended ?? null,
          time_zone: contact.time_zone ?? "",
          type: contact.type ?? "",
          business_relationship_tag: contact.business_relationship_tag ?? "",
          notes: contact.notes ?? "",
          next_steps: contact.next_steps ?? "",
        }
      : {
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
          // Default contact owner to current user (creator). Rep can
          // change.
          owner_user_id: user?.id ?? null,
          lead_source: null,
          mql_date: "",
          sql_date: "",
          credential: "",
          phone_ext: "",
          mobile_phone: "",
          events_attended: null,
          time_zone: "",
          type: "",
          business_relationship_tag: "",
          notes: "",
          next_steps: "",
        },
  });

  // Auto-fill country + time_zone from US ZIP. We previously tried
  // chaining this via register('mailing_zip', { onChange }) but the
  // RHF option-callback path proved unreliable in production
  // (different RHF re-render timing between dev / staging), so we
  // watch the value via a useEffect instead — strictly more robust
  // and matches the pattern other autofills in this file use.
  const watchedMailingZip = watch("mailing_zip");
  useEffect(() => {
    const zip = (watchedMailingZip ?? "").trim();
    if (!looksLikeUsZip(zip)) return;
    if (!getValues("mailing_country")) {
      setValue("mailing_country", "United States", {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
    const tz = zipToTimeZone(zip);
    if (tz && !getValues("time_zone")) {
      setValue("time_zone", tz as never, {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedMailingZip]);

  // Surface zod failures (most picklist fields don't render their own
  // error message — without this the click looks like a no-op).
  function onInvalid(formErrors: typeof errors) {
    const fields = Object.keys(formErrors);
    if (fields.length === 0) return;
    const detail = fields
      .map((f) => {
        const e = formErrors[f as keyof typeof formErrors] as
          | { message?: string }
          | undefined;
        const msg = e?.message ? `: ${e.message}` : "";
        return `${f.replace(/_/g, " ")}${msg}`;
      })
      .join("; ");
    toast.error(`Can't save — invalid field(s): ${detail}`);
    console.warn("Contact form validation errors:", formErrors);
  }

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
      credential: values.credential || null,
      phone_ext: values.phone_ext || null,
      mobile_phone: values.mobile_phone || null,
      events_attended:
        values.events_attended && values.events_attended.length > 0
          ? values.events_attended
          : null,
      time_zone: values.time_zone || null,
      type: values.type || null,
      business_relationship_tag: values.business_relationship_tag || null,
      notes: values.notes || null,
      next_steps: values.next_steps || null,
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
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Contact" : "New Contact"} />

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
                    {accountOptions.map((a) => (
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
                <Label htmlFor="phone">
                  Phone<RequiredIndicator fieldKey="phone" requiredFields={requiredKeys} />
                </Label>
                <PhoneInput
                  id="phone"
                  value={watch("phone") ?? ""}
                  onChange={(v) => setValue("phone", v)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone_ext">
                  Phone Ext<RequiredIndicator fieldKey="phone_ext" requiredFields={requiredKeys} />
                </Label>
                <Input
                  id="phone_ext"
                  inputMode="numeric"
                  placeholder="567"
                  {...register("phone_ext")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mobile_phone">
                  Mobile Phone<RequiredIndicator fieldKey="mobile_phone" requiredFields={requiredKeys} />
                </Label>
                <PhoneInput
                  id="mobile_phone"
                  value={watch("mobile_phone") ?? ""}
                  onChange={(v) => setValue("mobile_phone", v)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedin_url">LinkedIn URL<RequiredIndicator fieldKey="linkedin_url" requiredFields={requiredKeys} /></Label>
                <Input id="linkedin_url" type="url" placeholder="https://linkedin.com/in/..." {...register("linkedin_url")} />
                {errors.linkedin_url && <p className="text-sm text-destructive">{errors.linkedin_url.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Credential</Label>
                <PicklistSelect
                  fieldKey="contacts.credential"
                  value={watch("credential") as string | null | undefined}
                  onChange={(v) => setValue("credential", (v ?? "") as never)}
                  allowClear
                />
              </div>

              <div className="space-y-2">
                <Label>Time Zone</Label>
                <PicklistSelect
                  fieldKey="contacts.time_zone"
                  value={watch("time_zone") as string | null | undefined}
                  onChange={(v) => setValue("time_zone", (v ?? "") as never)}
                  allowClear
                />
              </div>

              <div className="space-y-2">
                <Label>Contact Type</Label>
                <PicklistSelect
                  fieldKey="contacts.type"
                  value={watch("type") as string | null | undefined}
                  onChange={(v) => setValue("type", (v ?? "") as never)}
                  allowClear
                />
              </div>

              <div className="space-y-2">
                <Label>Relationship Tag</Label>
                <PicklistSelect
                  fieldKey="contacts.business_relationship_tag"
                  value={watch("business_relationship_tag") as string | null | undefined}
                  onChange={(v) =>
                    setValue("business_relationship_tag", (v ?? "") as never)
                  }
                  allowClear
                />
              </div>

              <div className="space-y-2">
                <Label>Lead Source</Label>
                <PicklistSelect
                  fieldKey="contacts.lead_source"
                  value={watch("lead_source") as string | null | undefined}
                  onChange={(v) => setValue("lead_source", v ?? null)}
                  allowClear
                />
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
                  <Select
                    value={watch("mailing_state") || "none"}
                    onValueChange={(v) =>
                      setValue("mailing_state", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger id="mailing_state">
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

            <EventsAttendedField
              value={watch("events_attended") ?? null}
              onChange={(next) => setValue("events_attended", next)}
            />


            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={3} {...register("notes")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="next_steps">Next Steps</Label>
              <Textarea id="next_steps" rows={2} {...register("next_steps")} />
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

/**
 * Events Attended is conceptually an array of strings (one per event)
 * but the friendliest UI is a single comma-separated text field. The
 * earlier implementation parsed + re-joined on every keystroke, which
 * stripped trailing/leading whitespace mid-typing — so typing a space
 * after "HIMSS" got eaten before the user could finish "HIMSS 2026".
 *
 * Fix: track the raw input string locally and only normalize to the
 * array form when the user blurs the field (or the parent resets the
 * value externally). The form submit still receives the canonical
 * array, but the keystrokes feel like a normal text input.
 */
function EventsAttendedField({
  value,
  onChange,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [raw, setRaw] = useState(() => (value ?? []).join(", "));

  // If the form is reset externally (e.g. switching from one contact
  // to another in edit mode) and our locally-tracked text no longer
  // matches the canonical array, re-sync. Compare by canonicalized
  // representation so we don't clobber mid-typing punctuation.
  useEffect(() => {
    const canonical = (value ?? []).join(", ");
    setRaw((prev) => {
      const prevTokens = prev
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      return prevTokens === canonical ? prev : canonical;
    });
  }, [value]);

  return (
    <div className="space-y-2">
      <Label htmlFor="events_attended">Events Attended</Label>
      <Input
        id="events_attended"
        placeholder="HIMSS 2026, RSA 2025, ..."
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parts.length > 0 ? parts : null);
        }}
      />
      <p className="text-xs text-muted-foreground">
        Comma-separated list of conferences or events this contact has attended.
      </p>
    </div>
  );
}

