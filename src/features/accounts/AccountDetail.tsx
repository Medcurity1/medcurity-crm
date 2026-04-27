import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { useAuth } from "@/features/auth/AuthProvider";
import { Pencil, Archive, ExternalLink, ChevronDown, Phone, UserRoundCog, Plus, MapPin, History } from "lucide-react";
import { useAccount, useUpdateAccount, useArchiveAccount, useAccountContracts } from "./api";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { PageHeader } from "@/components/PageHeader";
import { formatPhone } from "@/components/PhoneInput";
import { StatusBadge } from "@/components/StatusBadge";
import { VerifiedBadge } from "@/components/VerifiedBadge";
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
  statusLabel,
  formatDate,
  formatDateTime,
  formatCurrency,
  industryCategoryLabel,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AccountContacts } from "./AccountContacts";
import { AccountOpportunities } from "./AccountOpportunities";
import { AccountPartners } from "./AccountPartners";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { TasksPanel } from "@/features/activities/TasksPanel";
import { DetailPageLayout } from "@/components/layout/DetailPageLayout";
import { LayoutDrivenDetail } from "@/features/layouts/LayoutDrivenDetail";
import type { AccountContract } from "@/types/crm";

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

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={account.name}
        actions={
          <div className="flex items-center gap-2">
            <VerifiedBadge
              table="accounts"
              recordId={account.id}
              verified={account.verified ?? false}
              verifiedAt={account.verified_at}
              ownerId={account.owner_user_id}
              invalidateKeys={[["account", account.id]]}
            />
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
            {/* Source of truth: industry_category (enum). accounts.industry
                is the legacy free-text column kept for historical trace of
                SF's original value — never surface it in the UI, since
                having both visible caused the "why does editing show a
                dropdown but the card shows free text?" bug. */}
            <p className="text-sm font-semibold truncate">{industryCategoryLabel(account.industry_category)}</p>
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
                ? formatPhone(`${account.phone}${account.phone_extension ? ` x${account.phone_extension}` : ""}`)
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
        sidePanels={[
          {
            key: "activity",
            label: "Activity",
            content: <ActivityTimeline accountId={account.id} compact />,
          },
          {
            key: "tasks",
            label: "Tasks",
            content: <TasksPanel accountId={account.id} />,
          },
        ]}
      >

      {/* Related tabs at the top. Collapsed by default so the page doesn't
          lead with a wall of related-record data before the user has seen
          the account's own fields. */}
      {/* Tab order per Brayden 2026-04-17: Opportunities used frequently,
          second-most after Contacts. Keeping Tasks + Contract History
          further right. */}
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
            // Always render the Partner tab — even when there's no
            // relationship yet — so users have a consistent place
            // to add one (matches SF UX shown in 2026-04-22 design
            // screenshots).
            value: "partners",
            label: "Partner",
            content: <AccountPartners accountId={account.id} />,
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

      {/* --------- Layout-driven sections (Basic → SF History) ---------
          Order, fields, collapsed defaults, etc. are configured via
          Admin → Page Layouts. Custom blocks below render the things
          a flat layout can't (address blocks with map links, etc.).
          Inline editing is preserved via onInlineSave. */}
      <LayoutDrivenDetail
        entity="accounts"
        record={account as unknown as Record<string, unknown>}
        onInlineSave={async (fieldKey, newValue) => {
          const numberFields = new Set([
            "fte_count",
            "employees",
            "number_of_providers",
            "locations",
            "annual_revenue",
            "acv",
          ]);
          const parser = numberFields.has(fieldKey)
            ? (v: string) => (v === "" ? null : Number(v))
            : (v: string) => (v === "" ? null : v);
          await updateMutation.mutateAsync({
            id: accountId,
            [fieldKey]: parser(newValue),
          } as Parameters<typeof updateMutation.mutateAsync>[0]);
        }}
        inlineEditExcluded={[
          // FK / lookup fields
          "owner_user_id",
          "parent_account_id",
          // Auto-set / read-only on detail
          "account_number",
          "lifecycle_status",
          "industry_category",
          "status",
          "renewal_type",
          "active_since",
          "current_contract_start_date",
          "current_contract_end_date",
          "current_contract_length_months",
          "lifetime_value",
          "churn_amount",
          "churn_date",
          "lead_source",
          // SF-imported audit
          "sf_created_by",
          "sf_created_date",
          "sf_last_modified_by",
          "sf_last_modified_date",
          // System
          "created_by",
          "updated_by",
          "created_at",
          "updated_at",
          // Booleans handled as read-only display for now
          "every_other_year",
          "do_not_auto_renew",
          "do_not_contact",
          "partner_prospect",
          "priority_account",
        ]}
        inlineEditTypes={{
          fte_count: "number",
          employees: "number",
          number_of_providers: "number",
          locations: "number",
          annual_revenue: "currency",
          acv: "currency",
          description: "textarea",
          notes: "textarea",
          next_steps: "textarea",
        }}
        customBlocks={{
          __billing_address: () => (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Billing Address
              </h4>
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
                          [account.billing_street, account.billing_city, account.billing_state, account.billing_zip].filter(Boolean).join(", ")
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
          ),
          __shipping_address: () => (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Shipping Address
              </h4>
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
                        [account.shipping_street, account.shipping_city, account.shipping_state, account.shipping_zip].filter(Boolean).join(", ")
                      )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm flex items-center gap-1 mt-2"
                >
                  <MapPin className="h-3 w-3" /> View on Map
                </a>
              )}
            </div>
          ),
        }}
      />

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
