import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ChevronDown, Phone, Mail, ArrowRightLeft, UserRoundCog, History } from "lucide-react";
import { useLead, useUpdateLead, useArchiveLead } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { formatPhone } from "@/components/PhoneInput";
import { ConvertLeadDialog } from "./ConvertLeadDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleTabs } from "@/components/CollapsibleTabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  leadStatusLabel,
  leadSourceLabel,
  qualificationLabel,
  formatDate,
  formatDateTime,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { TasksPanel } from "@/features/activities/TasksPanel";
import { DetailPageLayout } from "@/components/layout/DetailPageLayout";
import { SequencesTab } from "@/features/sequences/SequencesTab";
import type { LeadSource, LeadQualification } from "@/types/crm";
import { LayoutDrivenDetail } from "@/features/layouts/LayoutDrivenDetail";
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

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={`${lead.first_name} ${lead.last_name}`}
        description={lead.company ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <VerifiedBadge
              table="leads"
              recordId={lead.id}
              verified={lead.verified ?? false}
              verifiedAt={lead.verified_at}
              ownerId={lead.owner_user_id}
              invalidateKeys={[["lead", lead.id]]}
            />
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
            {/* Converted leads are tombstones — read-only. Hide Edit
                so reps can't accidentally rewrite history. The contact
                that took over is the working record. */}
            {!isConverted && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/leads/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
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
        <Card className="min-w-0">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Email</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 min-w-0">
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                title={lead.email}
                // block + truncate handles overflow correctly; inline-flex
                // here was ignoring the truncate because it expands to
                // content width. Icon moved next to a separate span so
                // the anchor itself can truncate.
                className="text-sm text-primary hover:underline flex items-center gap-1 min-w-0"
              >
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{lead.email}</span>
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
              {lead.phone ? formatPhone(lead.phone) : "\u2014"}
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

      <DetailPageLayout
        sidePanels={[
          {
            key: "activity",
            label: "Activity",
            content: (
              <ActivityTimeline
                leadId={lead.id}
                contactEmail={lead.email ?? undefined}
                contactName={`${lead.first_name} ${lead.last_name}`}
                compact
              />
            ),
          },
          {
            key: "tasks",
            label: "Tasks",
            content: <TasksPanel leadId={lead.id} />,
          },
        ]}
      >

      <CollapsibleTabs
        className="mt-2"
        defaultValue="sequences"
        items={[
          {
            value: "sequences",
            label: "Sequences",
            content: <SequencesTab leadId={lead.id} />,
          },
        ]}
      />

      {/* --------- Lead Details Section ---------
          Full field surface so reps can see everything that's on the
          edit form without having to click Edit. Inline editable via
          EditableField (click a row, type, ✓ to save, ✗ to cancel).
          Website is bumped to the top per Summer 2026-04-19. Do Not
          Contact + Do Not Market are side-by-side with clear yes/no
          indicators. */}
      {/* --------- Layout-driven sections (Lead Details, Company Info, Address, Marketing & Pardot, Conversion Info) --------- */}
      <LayoutDrivenDetail
        entity="leads"
        record={lead as unknown as Record<string, unknown>}
        // Converted leads are tombstones — disable inline edit by
        // omitting onInlineSave. Reps can still see all fields but
        // can't modify them.
        onInlineSave={isConverted ? undefined : async (fieldKey, newValue) => {
          await updateMutation.mutateAsync({
            id: lead.id,
            [fieldKey]: newValue === "" ? null : newValue,
          } as Parameters<typeof updateMutation.mutateAsync>[0]);
        }}
        inlineEditExcluded={[
          "first_name",
          "last_name",
          "owner_user_id",
          "industry_category",
          "rating",
          "source",
          "type",
          "project_segment",
          "business_relationship_tag",
          "credential",
          "time_zone",
          "status",
          "qualification",
          "mql_date",
          "do_not_market_to",
          "do_not_contact",
          "priority_lead",
          "cold_lead",
          "score",
          "first_activity_date",
          "pardot_last_activity_date",
          "conversion_date",
          "pardot_campaign",
          "pardot_grade",
          "pardot_score",
          "pardot_url",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_content",
          "utm_term",
          "pardot_comments",
          "converted_at",
          "converted_account_id",
          "converted_contact_id",
          "converted_opportunity_id",
          "created_by",
          "updated_by",
          "created_at",
          "updated_at",
        ]}
        inlineEditTypes={{
          description: "textarea",
          employees: "number",
          annual_revenue: "currency",
        }}
      />


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

      </DetailPageLayout>

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
