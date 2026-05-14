import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ChevronDown, Phone, Mail, UserRoundCog, History } from "lucide-react";
import { formatPhone } from "@/components/PhoneInput";
import { useContact, useUpdateContact, useArchiveContact, useOriginatingLead } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleTabs } from "@/components/CollapsibleTabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatName, formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AccountOpportunities } from "@/features/accounts/AccountOpportunities";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { DetailPageLayout } from "@/components/layout/DetailPageLayout";
import { TasksPanel } from "@/features/activities/TasksPanel";
import { SequencesTab } from "@/features/sequences/SequencesTab";
import { LayoutDrivenDetail } from "@/features/layouts/LayoutDrivenDetail";

/* ---------- Collapsible section ---------- */

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        {title}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ---------- Detail field ---------- */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? "\u2014"}</span>
    </div>
  );
}

/* ---------- Main component ---------- */

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: contact, isLoading } = useContact(id);
  const { data: originatingLead } = useOriginatingLead(id);
  const { data: customFieldDefs } = useCustomFieldDefinitions("contacts");
  const updateMutation = useUpdateContact();
  const archiveMutation = useArchiveContact();
  const [showArchive, setShowArchive] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const { addRecent } = useRecentRecords();

  useEffect(() => {
    if (contact) {
      const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "Unknown";
      addRecent({ id: contact.id, entity: "contact", name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!contact) {
    return <div className="text-muted-foreground">Contact not found.</div>;
  }

  const contactId = contact.id;

  function handleArchive() {
    if (!id) return;
    archiveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Contact archived");
          navigate("/contacts");
        },
        onError: (err) => {
          toast.error("Failed to archive: " + (err as Error).message);
        },
      }
    );
  }

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={formatName(contact.first_name, contact.last_name)}
        description={contact.title ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <VerifiedBadge
              table="contacts"
              recordId={contact.id}
              verified={contact.verified ?? false}
              verifiedAt={contact.verified_at}
              ownerId={contact.owner_user_id}
              invalidateKeys={[["contact", contact.id]]}
            />
            {contact.is_primary && (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                Primary Contact
              </Badge>
            )}
            {contact.do_not_contact && (
              <Badge variant="destructive">Do Not Contact</Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowChangeOwner(true)}>
              <UserRoundCog className="h-4 w-4 mr-1" />
              Change Owner
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/contacts/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            )}
          </div>
        }
      />

      <RecordId id={contact.id} sfId={contact.sf_id} />

      {/* --------- Converted-from-Lead callout ---------
          Mirrors Salesforce's affordance: this contact came from a
          lead, so give a one-click way to see the original lead's
          history (UTM source, MQL date, original sales notes).
          Only renders when a `leads.converted_contact_id = contact.id`
          row exists. */}
      {originatingLead && (
        <div className="mb-4 rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center gap-2">
          <span className="text-muted-foreground">Converted from lead:</span>
          <Link
            to={`/leads/${originatingLead.id}`}
            className="text-primary hover:underline font-medium"
          >
            {[originatingLead.first_name, originatingLead.last_name]
              .filter(Boolean)
              .join(" ") || originatingLead.company || "View lead"}
          </Link>
          {originatingLead.source && (
            <span className="text-xs text-muted-foreground">
              · source: {originatingLead.source}
            </span>
          )}
          {originatingLead.converted_at && (
            <span className="text-xs text-muted-foreground">
              · converted {formatDateTime(originatingLead.converted_at)}
            </span>
          )}
        </div>
      )}

      {/* --------- Key Info Bar --------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Account</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {contact.account ? (
              <Link
                to={`/accounts/${contact.account.id}`}
                className="text-sm font-semibold text-primary hover:underline truncate block"
              >
                {contact.account.name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">{"\u2014"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Email</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 truncate"
              >
                <Mail className="h-3 w-3 shrink-0" />
                {contact.email}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">{"\u2014"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Phone</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold inline-flex items-center gap-1">
              <Phone className="h-3 w-3 text-muted-foreground" />
              {contact.phone ? formatPhone(contact.phone) : "\u2014"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Title</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{contact.title ?? "\u2014"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Owner</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{contact.owner?.full_name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Department</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{contact.department ?? "\u2014"}</p>
          </CardContent>
        </Card>
      </div>

      <DetailPageLayout
        sidePanels={[
          {
            key: "activity",
            label: "Activity",
            content: (
              <ActivityTimeline
                contactId={contact.id}
                accountId={contact.account_id}
                contactEmail={contact.email ?? undefined}
                contactName={formatName(contact.first_name, contact.last_name)}
                compact
              />
            ),
          },
          {
            key: "tasks",
            label: "Tasks",
            content: <TasksPanel contactId={contact.id} />,
          },
        ]}
      >

      <CollapsibleTabs
        className="mt-2"
        defaultValue="opportunities"
        items={[
          {
            value: "opportunities",
            label: "Opportunities",
            content: <AccountOpportunities accountId={contact.account_id} />,
          },
          {
            value: "tasks",
            label: "Tasks",
            content: <TasksPanel contactId={contact.id} />,
          },
          {
            value: "sequences",
            label: "Sequences",
            content: <SequencesTab contactId={contact.id} accountId={contact.account_id} />,
          },
        ]}
      />

      {/* --------- Layout-driven sections (Contact Details, Mailing Address, ...) --------- */}
      <LayoutDrivenDetail
        entity="contacts"
        record={contact as unknown as Record<string, unknown>}
        onInlineSave={async (fieldKey, newValue) => {
          await updateMutation.mutateAsync({
            id: contactId,
            [fieldKey]: newValue === "" ? null : newValue,
          } as Parameters<typeof updateMutation.mutateAsync>[0]);
        }}
        inlineEditExcluded={[
          "account_id",
          "owner_user_id",
          "first_name",
          "last_name",
          "contact_number",
          "lead_source",
          "mql_date",
          "sql_date",
          "do_not_contact",
          "is_primary",
          "credential",
          "time_zone",
          "type",
          "business_relationship_tag",
          "created_by",
          "updated_by",
          "created_at",
          "updated_at",
        ]}
        inlineEditTypes={{
          notes: "textarea",
          next_steps: "textarea",
        }}
      />


      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && contact.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={contact.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- System Information --------- */}
      <CollapsibleSection title="System Information" defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Created By"
            value={contact.creator?.full_name ?? "\u2014"}
          />
          <Field
            label="Last Modified By"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${contact.id}`}
                className="text-primary hover:underline inline-flex items-center gap-1"
                title="View audit history for this record"
              >
                {contact.updater?.full_name ?? "\u2014"}
                <History className="h-3 w-3" />
              </Link>
            }
          />
          <Field label="Created" value={formatDateTime(contact.created_at)} />
          <Field
            label="Last Modified"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${contact.id}`}
                className="text-primary hover:underline"
                title="View audit history for this record"
              >
                {formatDateTime(contact.updated_at)}
              </Link>
            }
          />
        </div>
      </CollapsibleSection>

      </DetailPageLayout>

      <ConfirmDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        title="Archive Contact"
        description="This will hide the contact from active views."
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
      />

      <ChangeOwnerDialog
        open={showChangeOwner}
        onOpenChange={setShowChangeOwner}
        currentOwnerId={contact.owner_user_id}
        onConfirm={(newOwnerId) => {
          if (!id) return;
          updateMutation.mutate(
            { id, owner_user_id: newOwnerId },
            {
              onSuccess: () => toast.success("Owner updated"),
              onError: (err) => toast.error("Failed to update owner: " + (err as Error).message),
            }
          );
        }}
        title="Change Contact Owner"
      />
    </div>
  );
}
