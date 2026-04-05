import { useParams, useNavigate, Link } from "react-router-dom";
import { useState } from "react";
import { Pencil, Archive, ExternalLink, ChevronDown, Phone, Mail, UserRoundCog } from "lucide-react";
import { useContact, useUpdateContact, useArchiveContact } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatName, leadSourceLabel } from "@/lib/formatters";
import { StatusBadge } from "@/components/StatusBadge";
import type { LeadSource } from "@/types/crm";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AccountOpportunities } from "@/features/accounts/AccountOpportunities";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { TasksPanel } from "@/features/activities/TasksPanel";
import { SequencesTab } from "@/features/sequences/SequencesTab";

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
  const { data: contact, isLoading } = useContact(id);
  const { data: customFieldDefs } = useCustomFieldDefinitions("contacts");
  const updateMutation = useUpdateContact();
  const archiveMutation = useArchiveContact();
  const [showArchive, setShowArchive] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);

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

  const hasMailingAddress = [
    contact.mailing_street,
    contact.mailing_city,
    contact.mailing_state,
    contact.mailing_zip,
    contact.mailing_country,
  ].some(Boolean);

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={formatName(contact.first_name, contact.last_name)}
        description={contact.title ?? undefined}
        actions={
          <div className="flex items-center gap-2">
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
            <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
              <Archive className="h-4 w-4 mr-1" />
              Archive
            </Button>
          </div>
        }
      />

      <RecordId id={contact.id} sfId={contact.sf_id} />

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
              {contact.phone ?? "\u2014"}
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

      {/* --------- Contact Details Section --------- */}
      <CollapsibleSection title="Contact Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field label="First Name" value={contact.first_name} />
          <Field label="Last Name" value={contact.last_name} />
          <Field
            label="Email"
            value={
              contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                  {contact.email}
                </a>
              ) : null
            }
          />
          <Field label="Phone" value={contact.phone} />
          <Field label="Title" value={contact.title} />
          <Field label="Department" value={contact.department} />
          <Field
            label="LinkedIn URL"
            value={
              contact.linkedin_url ? (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {contact.linkedin_url.replace(/^https?:\/\/(www\.)?/, "")}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : null
            }
          />
          <Field
            label="Do Not Contact"
            value={contact.do_not_contact ? "\u2713" : "\u2717"}
          />
          {contact.lead_source && (
            <Field
              label="Lead Source"
              value={
                <StatusBadge
                  value={contact.lead_source}
                  variant="leadSource"
                  label={leadSourceLabel(contact.lead_source as LeadSource)}
                />
              }
            />
          )}
        </div>
      </CollapsibleSection>

      {/* --------- Mailing Address --------- */}
      {hasMailingAddress && (
        <CollapsibleSection title="Mailing Address" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <Field label="Street" value={contact.mailing_street} />
            <Field label="City" value={contact.mailing_city} />
            <Field label="State" value={contact.mailing_state} />
            <Field label="Zip" value={contact.mailing_zip} />
            <Field label="Country" value={contact.mailing_country} />
          </div>
        </CollapsibleSection>
      )}

      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && contact.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={contact.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- Tabs --------- */}
      <Tabs defaultValue="opportunities" className="mt-2">
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="mt-4">
          <AccountOpportunities accountId={contact.account_id} />
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          <ActivityTimeline
            contactId={contact.id}
            accountId={contact.account_id}
            contactEmail={contact.email ?? undefined}
            contactName={formatName(contact.first_name, contact.last_name)}
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TasksPanel contactId={contact.id} />
        </TabsContent>

        <TabsContent value="sequences" className="mt-4">
          <SequencesTab contactId={contact.id} accountId={contact.account_id} />
        </TabsContent>
      </Tabs>

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
