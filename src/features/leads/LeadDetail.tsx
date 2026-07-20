import { useParams, useNavigate, Link, useSearchParams, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ChevronDown, ChevronLeft, Phone, Mail, ArrowRightLeft, History, MapPin, Ban } from "lucide-react";
import { InlineEdit } from "@/components/InlineEdit";
import { useLead, useUpdateLead, useArchiveLead, useMarkImportAvoid } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RecordId } from "@/components/RecordId";
import { formatPhone } from "@/components/PhoneInput";
import { ConvertLeadDialog } from "./ConvertLeadDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { LeadSource } from "@/types/crm";
import { LayoutDrivenDetail } from "@/features/layouts/LayoutDrivenDetail";
import { looksLikeUsZip, zipToTimeZone } from "@/lib/us-zip";
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
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: lead, isLoading } = useLead(id);
  // Anyone admin OR who owns / created this lead can archive it. This
  // unblocks reps from cleaning up their own test/duplicate leads
  // without needing admin help.
  const isOwnLead =
    !!user && !!lead && (lead.owner_user_id === user.id || lead.created_by === user.id);
  const canArchive = isAdmin || isOwnLead;
  const { data: customFieldDefs } = useCustomFieldDefinitions("leads");
  const updateMutation = useUpdateLead();
  const archiveMutation = useArchiveLead();
  const markAvoid = useMarkImportAvoid();
  const [showArchive, setShowArchive] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const { addRecent } = useRecentRecords();

  // Breadcrumb back to a lead list when arriving via ?from=list:<id>.
  // We thread this through navigation in LeadListsPage so reps can click
  // a lead from a list, edit it, then return to the same list with sort
  // / filters / scroll preserved (URL state on the list page handles it).
  const fromParam = searchParams.get("from");
  const fromListId = fromParam?.startsWith("list:")
    ? fromParam.slice("list:".length)
    : null;
  useEffect(() => {
    if (lead) {
      const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
      addRecent({ id: lead.id, entity: "lead", name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  // Silent redirect: if the lead has been converted, the person now
  // lives as a Contact. We always send users to the contact page —
  // never let them land on the stale lead. This catches the edge cases
  // that GlobalSearch's filter can't (direct URL, bookmarks, old links
  // in emails / notifications). Conversion is one-way; no banner
  // needed because there's nothing the rep can do on the lead page
  // that they can't do better on the contact page.
  useEffect(() => {
    if (lead?.converted_at && lead.converted_contact_id) {
      navigate(`/contacts/${lead.converted_contact_id}`, { replace: true });
    }
  }, [lead?.id, lead?.converted_at, lead?.converted_contact_id, navigate]);

  // Leads are admin-only — a non-admin reaching a lead detail (old link,
  // bookmark, search) is redirected, mirroring the list.
  if (!isAdmin) {
    return <Navigate to="/accounts" replace />;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!lead) {
    return <div className="text-muted-foreground">Import not found.</div>;
  }

  function handleArchive() {
    if (!id) return;
    archiveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Import archived");
          navigate("/imports");
        },
        onError: (err) => {
          toast.error("Failed to archive import: " + (err as Error).message);
        },
      }
    );
  }

  const isConverted = lead.status === "converted";
  // An Avoided/archived import is set aside on purpose — it must not be
  // promotable or editable (the DB enforces this too), and we show why.
  const isAvoided = !isConverted && (!!lead.archived_at || !!lead.avoid_reason);

  return (
    <div>
      {/* --------- Back-to-list breadcrumb --------- */}
      {fromListId && (
        <button
          type="button"
          onClick={() => navigate("/imports")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Imports
        </button>
      )}

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
            {isAvoided && (
              <Badge variant="destructive">
                Avoided{lead.avoid_reason ? `: ${lead.avoid_reason.replace(/_/g, " ")}` : ""}
              </Badge>
            )}
            {/* Qualify + Change Owner removed 2026-07-20: the leads table is
                frozen (write policies dropped) — direct edits would fail.
                The RPC-backed actions below (Promote / Mark Avoid / Archive)
                still work for prod's cutover stragglers. */}
            {/* Converted leads are tombstones — read-only. Hide Edit
                so reps can't accidentally rewrite history. The contact
                that took over is the working record. */}
            {!isConverted && !isAvoided && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/imports/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            {!isConverted && !isAvoided && (
              <Button variant="default" size="sm" onClick={() => setShowConvert(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Promote to Contact
              </Button>
            )}
            {!isConverted && !isAvoided && canArchive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Ban className="h-4 w-4 mr-1" />
                    Mark Avoid
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {([
                    ["bounced", "Bounced"],
                    ["unsubscribed", "Unsubscribed"],
                    ["auto_reply", "Auto-reply"],
                    ["manual", "Other / manual"],
                  ] as const).map(([val, label]) => (
                    <DropdownMenuItem
                      key={val}
                      onSelect={() =>
                        markAvoid.mutate(
                          { id: lead.id, reason: val },
                          {
                            onSuccess: () => {
                              toast.success("Marked Avoid and archived");
                              navigate("/imports");
                            },
                            onError: (e) => toast.error((e as Error).message),
                          },
                        )
                      }
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canArchive && (
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
        // Frozen table (2026-07-20): inline edit disabled for ALL rows —
        // direct writes are blocked by RLS now. View-only history.
        onInlineSave={undefined}
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
        // Address is seeded as a single `__lead_address` custom block in
        // the layout (one widget, five fields together) instead of five
        // separate placements. Without a renderer it shows "Unrendered
        // custom block" — fix is to mirror AccountDetail's billing-address
        // pattern: stacked InlineEdits + a Maps link. Zip edits cascade
        // country + time_zone via the same rules as the per-field inline
        // edit handler above.
        customBlocks={{
          __lead_address: () => {
            const save = (field: "street" | "city" | "state" | "country") =>
              async (newValue: string) => {
                await updateMutation.mutateAsync({
                  id: lead.id,
                  [field]: newValue === "" ? null : newValue,
                } as Parameters<typeof updateMutation.mutateAsync>[0]);
              };
            const saveZip = async (newValue: string) => {
              const zip = (newValue ?? "").trim();
              const patch: Record<string, unknown> = {
                id: lead.id,
                zip: zip === "" ? null : zip,
              };
              if (looksLikeUsZip(zip)) {
                if (!lead.country) patch.country = "United States";
                const tz = zipToTimeZone(zip);
                if (tz) patch.time_zone = tz;
              }
              await updateMutation.mutateAsync(
                patch as Parameters<typeof updateMutation.mutateAsync>[0],
              );
            };
            const Row = ({
              label,
              value,
              onSave,
            }: {
              label: string;
              value: unknown;
              onSave?: (v: string) => Promise<void>;
            }) => (
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{label}</span>
                {onSave ? (
                  <InlineEdit value={value as string | number | null} onSave={onSave} />
                ) : (
                  <span className="text-sm font-medium">
                    {(value as string | null) ?? "\u2014"}
                  </span>
                )}
              </div>
            );
            const hasAddress = lead.street || lead.city;
            return (
              <div className="space-y-3">
                <Row
                  label="Street"
                  value={lead.street}
                  onSave={isConverted ? undefined : save("street")}
                />
                <Row
                  label="City"
                  value={lead.city}
                  onSave={isConverted ? undefined : save("city")}
                />
                <Row
                  label="State"
                  value={lead.state}
                  onSave={isConverted ? undefined : save("state")}
                />
                <Row
                  label="Zip"
                  value={lead.zip}
                  onSave={isConverted ? undefined : saveZip}
                />
                <Row
                  label="Country"
                  value={lead.country}
                  onSave={isConverted ? undefined : save("country")}
                />
                {hasAddress && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      [lead.street, lead.city, lead.state, lead.zip]
                        .filter(Boolean)
                        .join(", "),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                  >
                    <MapPin className="h-3 w-3" /> View on Map
                  </a>
                )}
              </div>
            );
          },
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
        title="Archive Import"
        description="This will hide the import from active views. An admin can restore it later."
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

    </div>
  );
}
