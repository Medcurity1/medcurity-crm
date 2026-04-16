import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ChevronDown, Phone, Mail, ArrowRightLeft, UserRoundCog, History } from "lucide-react";
import { useLead, useUpdateLead, useArchiveLead } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { InlineEdit, type InlineEditProps } from "@/components/InlineEdit";
import { ConvertLeadDialog } from "./ConvertLeadDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  leadStatusLabel,
  leadSourceLabel,
  qualificationLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
// ActivityTimeline isn't used here — leads don't have an activities FK
import { SequencesTab } from "@/features/sequences/SequencesTab";
import type { LeadSource, LeadQualification } from "@/types/crm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function EditableField({
  label,
  value,
  onSave,
  type,
}: {
  label: string;
  value: unknown;
  onSave: (newValue: string) => Promise<void>;
  type?: InlineEditProps["type"];
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <InlineEdit value={value as string | number | null} onSave={onSave} type={type} />
    </div>
  );
}

/* ---------- Main component ---------- */

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: lead, isLoading } = useLead(id);
  const { data: customFieldDefs } = useCustomFieldDefinitions("leads");
  const updateMutation = useUpdateLead();
  const archiveMutation = useArchiveLead();
  const [showArchive, setShowArchive] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const { addRecent } = useRecentRecords();

  useEffect(() => {
    if (lead) {
      const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
      addRecent({ id: lead.id, entity: "lead", name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!lead) {
    return <div className="text-muted-foreground">Lead not found.</div>;
  }

  const leadId = lead.id;
  const saveField = (field: string) => async (newValue: string) => {
    await updateMutation.mutateAsync({ id: leadId, [field]: newValue === "" ? null : newValue } as Parameters<typeof updateMutation.mutateAsync>[0]);
  };

  function handleArchive() {
    if (!id) return;
    archiveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Lead archived");
          navigate("/leads");
        },
        onError: (err) => {
          toast.error("Failed to archive lead: " + (err as Error).message);
        },
      }
    );
  }

  const isConverted = lead.status === "converted";
  const hasAddress = [lead.street, lead.city, lead.state, lead.zip, lead.country].some(Boolean);

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={`${lead.first_name} ${lead.last_name}`}
        description={lead.company ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              value={lead.status}
              variant="leadStatus"
              label={leadStatusLabel(lead.status)}
            />
            <StatusBadge
              value={lead.qualification}
              variant="qualification"
              label={qualificationLabel(lead.qualification)}
            />
            {lead.source && (
              <StatusBadge
                value={lead.source}
                variant="leadSource"
                label={leadSourceLabel(lead.source as LeadSource)}
              />
            )}
            {lead.do_not_market_to && (
              <Badge variant="destructive">Do Not Market To</Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Qualify
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {(["mql", "sql", "sal"] as LeadQualification[]).map((q) => (
                  <DropdownMenuItem
                    key={q}
                    onClick={() => {
                      if (!id) return;
                      updateMutation.mutate(
                        {
                          id,
                          qualification: q,
                          qualification_date: new Date().toISOString(),
                        } as Parameters<typeof updateMutation.mutate>[0],
                        {
                          onSuccess: () =>
                            toast.success(`Marked as ${qualificationLabel(q)}`),
                          onError: (err) =>
                            toast.error(
                              "Failed to update qualification: " +
                                (err as Error).message
                            ),
                        }
                      );
                    }}
                  >
                    Mark as {qualificationLabel(q)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => setShowChangeOwner(true)}>
              <UserRoundCog className="h-4 w-4 mr-1" />
              Change Owner
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/leads/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            {!isConverted && (
              <Button variant="default" size="sm" onClick={() => setShowConvert(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Convert
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            )}
          </div>
        }
      />

      <RecordId id={lead.id} sfId={lead.sf_id} />

      {/* --------- Key Info Bar --------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Company</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{lead.company ?? "\u2014"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Email</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 truncate"
              >
                <Mail className="h-3 w-3 shrink-0" />
                {lead.email}
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
              {lead.phone ?? "\u2014"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <StatusBadge
              value={lead.status}
              variant="leadStatus"
              label={leadStatusLabel(lead.status)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Qualification</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <StatusBadge
              value={lead.qualification}
              variant="qualification"
              label={qualificationLabel(lead.qualification)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Source</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {lead.source ? (
              <StatusBadge
                value={lead.source}
                variant="leadSource"
                label={leadSourceLabel(lead.source as LeadSource)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{"\u2014"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Score</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">{lead.score ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Owner</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{lead.owner?.full_name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
      </div>

      {/* --------- Top Tabs (sequences) --------- */}
      <Tabs defaultValue="sequences" className="mt-2 mb-6">
        <TabsList>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
        </TabsList>

        <TabsContent value="sequences" className="mt-4">
          <SequencesTab leadId={lead.id} />
        </TabsContent>
      </Tabs>

      {/* --------- Lead Details Section --------- */}
      <CollapsibleSection title="Lead Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field label="First Name" value={lead.first_name} />
          <Field label="Last Name" value={lead.last_name} />
          <EditableField label="Email" value={lead.email} onSave={saveField("email")} />
          <EditableField label="Phone" value={lead.phone} onSave={saveField("phone")} />
          <EditableField label="Title" value={lead.title} onSave={saveField("title")} />
          <EditableField label="Industry" value={lead.industry} onSave={saveField("industry")} />
          <EditableField label="Website" value={lead.website} onSave={saveField("website")} />
          <Field label="MQL Date" value={lead.mql_date ? formatDate(lead.mql_date) : null} />
          <Field
            label="Do Not Market To"
            value={lead.do_not_market_to ? "\u2713" : "\u2717"}
          />
          {lead.description && (
            <div className="md:col-span-2">
              <Field label="Description" value={lead.description} />
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* --------- Company Info Section --------- */}
      <CollapsibleSection title="Company Info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <EditableField label="Company" value={lead.company} onSave={saveField("company")} />
          <Field
            label="Employees"
            value={lead.employees != null ? lead.employees.toLocaleString() : null}
          />
          <Field
            label="Annual Revenue"
            value={lead.annual_revenue != null ? formatCurrency(lead.annual_revenue) : null}
          />
        </div>
      </CollapsibleSection>

      {/* --------- Address --------- */}
      {hasAddress && (
        <CollapsibleSection title="Address" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <Field label="Street" value={lead.street} />
            <Field label="City" value={lead.city} />
            <Field label="State" value={lead.state} />
            <Field label="Zip" value={lead.zip} />
            <Field label="Country" value={lead.country} />
          </div>
        </CollapsibleSection>
      )}

      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && lead.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={lead.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- Conversion Info --------- */}
      {isConverted && lead.converted_at && (
        <CollapsibleSection title="Conversion Info">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <Field label="Converted At" value={formatDate(lead.converted_at)} />
            {lead.converted_account_id && (
              <Field
                label="Account"
                value={
                  <Link
                    to={`/accounts/${lead.converted_account_id}`}
                    className="text-primary hover:underline"
                  >
                    View Account
                  </Link>
                }
              />
            )}
            {lead.converted_contact_id && (
              <Field
                label="Contact"
                value={
                  <Link
                    to={`/contacts/${lead.converted_contact_id}`}
                    className="text-primary hover:underline"
                  >
                    View Contact
                  </Link>
                }
              />
            )}
            {lead.converted_opportunity_id && (
              <Field
                label="Opportunity"
                value={
                  <Link
                    to={`/opportunities/${lead.converted_opportunity_id}`}
                    className="text-primary hover:underline"
                  >
                    View Opportunity
                  </Link>
                }
              />
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* --------- System Information --------- */}
      <CollapsibleSection title="System Information" defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Created By"
            value={lead.creator?.full_name ?? "\u2014"}
          />
          <Field
            label="Last Modified By"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${lead.id}`}
                className="text-primary hover:underline inline-flex items-center gap-1"
                title="View audit history for this record"
              >
                {lead.updater?.full_name ?? "\u2014"}
                <History className="h-3 w-3" />
              </Link>
            }
          />
          <Field label="Created" value={formatDateTime(lead.created_at)} />
          <Field
            label="Last Modified"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${lead.id}`}
                className="text-primary hover:underline"
                title="View audit history for this record"
              >
                {formatDateTime(lead.updated_at)}
              </Link>
            }
          />
        </div>
      </CollapsibleSection>

      <ConfirmDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        title="Archive Lead"
        description="This will hide the lead from active views. An admin can restore it later."
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
      />

      {showConvert && (
        <ConvertLeadDialog
          open={showConvert}
          onOpenChange={setShowConvert}
          lead={lead}
        />
      )}

      <ChangeOwnerDialog
        open={showChangeOwner}
        onOpenChange={setShowChangeOwner}
        currentOwnerId={lead.owner_user_id}
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
        title="Change Lead Owner"
      />
    </div>
  );
}
