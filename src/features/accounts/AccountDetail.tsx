import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ExternalLink, ChevronDown, Phone, UserRoundCog, Plus, MapPin, History } from "lucide-react";
import { useAccount, useUpdateAccount, useArchiveAccount, useAccountContracts } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { InlineEdit, type InlineEditProps } from "@/components/InlineEdit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleTabs } from "@/components/CollapsibleTabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  lifecycleLabel,
  statusLabel,
  renewalTypeLabel,
  leadSourceLabel,
  formatDate,
  formatDateTime,
  formatCurrency,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AccountContacts } from "./AccountContacts";
import { AccountOpportunities } from "./AccountOpportunities";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { TasksPanel } from "@/features/activities/TasksPanel";
import { DetailPageLayout } from "@/components/layout/DetailPageLayout";
import type { AccountContract, LeadSource } from "@/types/crm";

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

/* ---------- Address helper ---------- */

function AddressBlock({
  street,
  city,
  state,
  zip,
  country,
}: {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}) {
  const parts = [street, [city, state, zip].filter(Boolean).join(", "), country].filter(Boolean);
  if (!parts.length) return <p className="text-sm text-muted-foreground">No address on file</p>;
  return (
    <p className="text-sm font-medium whitespace-pre-line">
      {parts.join("\n")}
    </p>
  );
}

/* ---------- Main component ---------- */

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Layout preference is now consumed inside DetailPageLayout. We kept the
  // hook import but no longer need the variable here.
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: account, isLoading } = useAccount(id);
  const { data: contracts } = useAccountContracts(id);
  const { data: customFieldDefs } = useCustomFieldDefinitions("accounts");
  const updateMutation = useUpdateAccount();
  const archiveMutation = useArchiveAccount();
  const [showArchive, setShowArchive] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const { addRecent } = useRecentRecords();

  useEffect(() => {
    if (account) {
      addRecent({ id: account.id, entity: "account", name: account.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!account) {
    return <div className="text-muted-foreground">Account not found.</div>;
  }

  const accountId = account.id;
  const saveField = (field: string, parser: (v: string) => unknown = (v) => (v === "" ? null : v)) =>
    async (newValue: string) => {
      await updateMutation.mutateAsync({ id: accountId, [field]: parser(newValue) } as Parameters<typeof updateMutation.mutateAsync>[0]);
    };
  const parseNumber = (v: string) => (v === "" ? null : Number(v));

  function handleArchive() {
    if (!id) return;
    archiveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Account archived");
          navigate("/accounts");
        },
        onError: (err) => {
          toast.error("Failed to archive account: " + (err as Error).message);
        },
      }
    );
  }

  const hasAddress = (prefix: "billing" | "shipping") => {
    const a = account as unknown as Record<string, unknown>;
    return [
      a[`${prefix}_street`],
      a[`${prefix}_city`],
      a[`${prefix}_state`],
      a[`${prefix}_zip`],
      a[`${prefix}_country`],
    ].some(Boolean);
  };

  const hasSfHistory =
    account.sf_created_by || account.sf_created_date || account.sf_last_modified_by || account.sf_last_modified_date;

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={account.name}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              value={account.status}
              variant="status"
              label={statusLabel(account.status)}
            />
            <Button variant="outline" size="sm" onClick={() => navigate(`/opportunities/new?account_id=${id}`)}>
              <Plus className="h-4 w-4 mr-1" />
              New Opportunity
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/contacts/new?account_id=${id}`)}>
              <Plus className="h-4 w-4 mr-1" />
              New Contact
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowChangeOwner(true)}>
              <UserRoundCog className="h-4 w-4 mr-1" />
              Change Owner
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/accounts/${id}/edit`)}>
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

      <RecordId id={account.id} sfId={account.sf_id} />

      {/* --------- Key Info Bar --------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Account Owner</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{account.owner?.full_name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Industry</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{account.industry ?? "\u2014"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Website</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {account.website ? (
              <a
                href={account.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1 truncate"
              >
                {account.website.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
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
              {account.phone
                ? `${account.phone}${account.phone_extension ? ` x${account.phone_extension}` : ""}`
                : "\u2014"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <StatusBadge
              value={account.status}
              variant="status"
              label={statusLabel(account.status)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">ACV</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">
              {account.acv != null ? formatCurrency(account.acv) : "\u2014"}
            </p>
          </CardContent>
        </Card>
      </div>

      <DetailPageLayout
        side={<ActivityTimeline accountId={account.id} compact />}
      >

      {/* Related tabs at the top. Collapsed by default so the page doesn't
          lead with a wall of related-record data before the user has seen
          the account's own fields. */}
      <CollapsibleTabs
        className="mt-2"
        defaultValue="contacts"
        items={[
          {
            value: "contacts",
            label: "Contacts",
            content: <AccountContacts accountId={account.id} />,
          },
          {
            value: "opportunities",
            label: "Opportunities",
            content: <AccountOpportunities accountId={account.id} />,
          },
          {
            value: "tasks",
            label: "Tasks",
            content: <TasksPanel accountId={account.id} />,
          },
          {
            value: "contract_history",
            label: "Contract History",
            content: <ContractHistoryTable contracts={contracts ?? []} />,
          },
        ]}
      />

      {/* --------- 1. Basic Information --------- */}
      <CollapsibleSection title="Basic Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <EditableField label="Account Type" value={account.account_type} onSave={saveField("account_type")} />
          <Field label="Account Number" value={account.account_number} />
          <Field label="Customer Type" value={lifecycleLabel(account.lifecycle_status)} />
          <EditableField label="Industry" value={account.industry} onSave={saveField("industry")} />
          <EditableField label="Website" value={account.website} onSave={saveField("website")} />
          <Field
            label="Parent Account"
            value={
              account.parent_account ? (
                <Link to={`/accounts/${account.parent_account.id}`} className="text-primary hover:underline">
                  {account.parent_account.name}
                </Link>
              ) : null
            }
          />
        </div>
      </CollapsibleSection>

      {/* --------- 2. Contact Information --------- */}
      <CollapsibleSection title="Contact Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <EditableField label="Phone" value={account.phone} onSave={saveField("phone")} />
          <EditableField label="Phone Extension" value={account.phone_extension} onSave={saveField("phone_extension")} />
        </div>
      </CollapsibleSection>

      {/* --------- 3. Address Information --------- */}
      <CollapsibleSection title="Address Information" defaultOpen={hasAddress("billing") || hasAddress("shipping")}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Billing Address</h4>
            <div className="space-y-3">
              <EditableField label="Street" value={account.billing_street} onSave={saveField("billing_street")} />
              <EditableField label="City" value={account.billing_city} onSave={saveField("billing_city")} />
              <EditableField label="State" value={account.billing_state} onSave={saveField("billing_state")} />
              <EditableField label="Zip" value={account.billing_zip} onSave={saveField("billing_zip")} />
              <EditableField label="Country" value={account.billing_country} onSave={saveField("billing_country")} />
              {(account.billing_street || account.billing_city) && (
                <a
                  href={account.billing_latitude && account.billing_longitude
                    ? `https://www.google.com/maps?q=${account.billing_latitude},${account.billing_longitude}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        [account.billing_street, account.billing_city, account.billing_state, account.billing_zip].filter(Boolean).join(', ')
                      )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                >
                  <MapPin className="h-3 w-3" /> View on Map
                </a>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Shipping Address</h4>
            <AddressBlock
              street={account.shipping_street}
              city={account.shipping_city}
              state={account.shipping_state}
              zip={account.shipping_zip}
              country={account.shipping_country}
            />
            {(account.shipping_street || account.shipping_city) && (
              <a
                href={account.shipping_latitude && account.shipping_longitude
                  ? `https://www.google.com/maps?q=${account.shipping_latitude},${account.shipping_longitude}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      [account.shipping_street, account.shipping_city, account.shipping_state, account.shipping_zip].filter(Boolean).join(', ')
                    )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm flex items-center gap-1 mt-2"
              >
                <MapPin className="h-3 w-3" /> View on Map
              </a>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* --------- 4. Company Details --------- */}
      <CollapsibleSection title="Company Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <EditableField
            label="FTE Count"
            value={account.fte_count}
            onSave={saveField("fte_count", parseNumber)}
            type="number"
          />
          <EditableField label="FTE Range" value={account.fte_range} onSave={saveField("fte_range")} />
          <EditableField
            label="Number of Employees"
            value={account.employees}
            onSave={saveField("employees", parseNumber)}
            type="number"
          />
          <EditableField
            label="Number of Providers"
            value={account.number_of_providers}
            onSave={saveField("number_of_providers", parseNumber)}
            type="number"
          />
          <EditableField
            label="Number of Locations"
            value={account.locations}
            onSave={saveField("locations", parseNumber)}
            type="number"
          />
          <EditableField
            label="Annual Revenue"
            value={account.annual_revenue}
            onSave={saveField("annual_revenue", parseNumber)}
            type="currency"
          />
          <EditableField label="Timezone" value={account.timezone} onSave={saveField("timezone")} />
        </div>
      </CollapsibleSection>

      {/* --------- 5. Contract & Renewal --------- */}
      <CollapsibleSection title="Contract & Renewal">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field label="Active Since" value={formatDate(account.active_since)} />
          <Field
            label="Renewal Type"
            value={account.renewal_type ? renewalTypeLabel(account.renewal_type) : null}
          />
          <Field label="Every Other Year" value={account.every_other_year ? "Yes" : "No"} />
          <EditableField label="Contracts (from SF)" value={account.contracts} onSave={saveField("contracts")} />
          <Field label="Contract Start" value={formatDate(account.current_contract_start_date)} />
          <Field label="Contract End" value={formatDate(account.current_contract_end_date)} />
          <Field
            label="Contract Length"
            value={
              account.current_contract_length_months != null
                ? `${account.current_contract_length_months} months`
                : null
            }
          />
          <EditableField
            label="ACV"
            value={account.acv}
            onSave={saveField("acv", parseNumber)}
            type="currency"
          />
          <Field
            label="Lifetime Value"
            value={account.lifetime_value != null ? formatCurrency(account.lifetime_value) : null}
          />
          <Field
            label="Churn Amount"
            value={account.churn_amount != null ? formatCurrency(account.churn_amount) : null}
          />
          <Field label="Churn Date" value={formatDate(account.churn_date)} />
        </div>
      </CollapsibleSection>

      {/* --------- 6. Partner Information --------- */}
      <CollapsibleSection title="Partner Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <EditableField label="Partner Account" value={account.partner_account} onSave={saveField("partner_account")} />
          <Field label="Partner Prospect" value={account.partner_prospect ? "Yes" : "No"} />
          <Field
            label="Lead Source"
            value={account.lead_source ? leadSourceLabel(account.lead_source as LeadSource) : null}
          />
          <EditableField label="Lead Source Detail" value={account.lead_source_detail} onSave={saveField("lead_source_detail")} />
        </div>
      </CollapsibleSection>

      {/* --------- 7. Additional Information --------- */}
      <CollapsibleSection
        title="Additional Information"
        defaultOpen={!!(account.priority_account || account.project || account.description || account.notes || account.next_steps)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field label="Priority Account" value={account.priority_account ? "Yes" : "No"} />
          <EditableField label="Project" value={account.project} onSave={saveField("project")} />
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs text-muted-foreground">Description</span>
            <InlineEdit
              value={account.description}
              onSave={saveField("description")}
              type="textarea"
              placeholder="Add description..."
            />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Notes</span>
            <InlineEdit
              value={account.notes}
              onSave={saveField("notes")}
              type="textarea"
              placeholder="Add notes..."
            />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Next Steps</span>
            <InlineEdit
              value={account.next_steps}
              onSave={saveField("next_steps")}
              type="textarea"
              placeholder="Add next steps..."
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* --------- 8. Salesforce History (only if data exists) --------- */}
      {hasSfHistory && (
        <CollapsibleSection title="Salesforce History" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <Field label="SF Created By" value={account.sf_created_by} />
            <Field label="SF Created Date" value={formatDateTime(account.sf_created_date)} />
            <Field label="SF Last Modified By" value={account.sf_last_modified_by} />
            <Field label="SF Last Modified Date" value={formatDateTime(account.sf_last_modified_date)} />
            <Field label="SF ID" value={account.sf_id} />
          </div>
        </CollapsibleSection>
      )}

      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && account.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={account.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- System Information --------- */}
      <CollapsibleSection title="System Information" defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Created By"
            value={account.creator?.full_name ?? "\u2014"}
          />
          <Field
            label="Last Modified By"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${account.id}`}
                className="text-primary hover:underline inline-flex items-center gap-1"
                title="View audit history for this record"
              >
                {account.updater?.full_name ?? "\u2014"}
                <History className="h-3 w-3" />
              </Link>
            }
          />
          <Field label="Created" value={formatDateTime(account.created_at)} />
          <Field
            label="Last Modified"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${account.id}`}
                className="text-primary hover:underline"
                title="View audit history for this record"
              >
                {formatDateTime(account.updated_at)}
              </Link>
            }
          />
        </div>
      </CollapsibleSection>

      </DetailPageLayout>

      <ConfirmDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        title="Archive Account"
        description="This will hide the account from active views. An admin can restore it later."
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
      />

      <ChangeOwnerDialog
        open={showChangeOwner}
        onOpenChange={setShowChangeOwner}
        currentOwnerId={account.owner_user_id}
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
        title="Change Account Owner"
      />
    </div>
  );
}

/* ---------- Contract History Table ---------- */

function ContractHistoryTable({ contracts }: { contracts: AccountContract[] }) {
  if (!contracts.length) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No contract history available.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Year</TableHead>
            <TableHead>Opportunity</TableHead>
            <TableHead>Start Date</TableHead>
            <TableHead>End Date</TableHead>
            <TableHead className="text-right">Total Amount</TableHead>
            <TableHead className="text-right">Services</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="text-center">Services Incl.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((c) => (
            <TableRow key={c.opportunity_id}>
              <TableCell>{c.contract_year ?? "\u2014"}</TableCell>
              <TableCell>
                <Link
                  to={`/opportunities/${c.opportunity_id}`}
                  className="text-primary hover:underline"
                >
                  {c.opportunity_name}
                </Link>
              </TableCell>
              <TableCell>{formatDate(c.contract_start_date)}</TableCell>
              <TableCell>{formatDate(c.contract_end_date)}</TableCell>
              <TableCell className="text-right">{formatCurrency(c.total_amount)}</TableCell>
              <TableCell className="text-right">
                {c.service_amount != null ? formatCurrency(c.service_amount) : "\u2014"}
              </TableCell>
              <TableCell className="text-right">
                {c.product_amount != null ? formatCurrency(c.product_amount) : "\u2014"}
              </TableCell>
              <TableCell className="text-center">
                {c.services_included ? "\u2713" : "\u2717"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
