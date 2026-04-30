import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { Pencil, Archive, ChevronDown, UserRoundCog, Plus, Trash2, History } from "lucide-react";
import { useOpportunity, useUpdateOpportunity, useArchiveOpportunity, useDeleteOpportunity, useStageHistory, useOpportunityProducts, useRemoveOpportunityProduct, useUpdateOpportunityProduct, useEnsureOpportunityAmountFresh } from "./api";
import { MultiProductPicker } from "./MultiProductPicker";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { StageProgressBar } from "./StageProgressBar";
import { PageHeader } from "@/components/PageHeader";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { InlineEdit, type InlineEditProps } from "@/components/InlineEdit";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useFieldHelpMap } from "@/features/layouts/api";
import { AccountContacts } from "@/features/accounts/AccountContacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import type { OpportunityStage } from "@/types/crm";
import {
  stageLabel,
  kindLabel,
  teamLabel,
  formatCurrency,
  formatCurrencyDetailed,
  formatDate,
  formatDateTime,
  formatRelativeDate,
  leadSourceLabel,
  paymentFrequencyLabel,
} from "@/lib/formatters";
import { toast } from "sonner";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
import { DetailPageLayout } from "@/components/layout/DetailPageLayout";
import { TasksPanel } from "@/features/activities/TasksPanel";

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

function Field({ label, value, helpText }: { label: string; value: React.ReactNode; helpText?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        <HelpTooltip text={helpText} />
      </span>
      <span className="text-sm font-medium">{value ?? "\u2014"}</span>
    </div>
  );
}

function EditableField({
  label,
  value,
  onSave,
  type,
  helpText,
}: {
  label: string;
  value: unknown;
  onSave: (newValue: string) => Promise<void>;
  type?: InlineEditProps["type"];
  helpText?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        <HelpTooltip text={helpText} />
      </span>
      <InlineEdit value={value as string | number | null} onSave={onSave} type={type} />
    </div>
  );
}

function DiscountField({
  discount,
  discountType,
  onSave,
  helpText,
}: {
  discount: number | null | undefined;
  discountType: string;
  onSave: (value: number | null, type: "percent" | "amount") => Promise<void>;
  helpText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [draftType, setDraftType] = useState<"percent" | "amount">(
    discountType === "amount" ? "amount" : "percent"
  );

  function startEdit() {
    setDraftValue(discount != null ? String(discount) : "");
    setDraftType(discountType === "amount" ? "amount" : "percent");
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const parsed = draftValue === "" ? null : Number(draftValue);
    if (parsed === discount && draftType === (discountType === "amount" ? "amount" : "percent")) return;
    try {
      await onSave(parsed, draftType);
    } catch {
      // error handled by mutation
    }
  }

  const displayValue = discount != null
    ? (discountType === "amount" ? `$${discount}` : `${discount}%`)
    : "\u2014";

  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        Overall Adjustment Discount
        <HelpTooltip text={helpText} />
      </span>
      {editing ? (
        <div
          className="flex items-center gap-1 mt-0.5"
          onBlur={(e) => {
            // Only commit when focus leaves the entire container (not when
            // moving between the select and the input within it).
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              commit();
            }
          }}
        >
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as "percent" | "amount")}
            className="h-7 border rounded text-xs px-1 bg-background"
          >
            <option value="percent">%</option>
            <option value="amount">$</option>
          </select>
          <input
            autoFocus
            type="number"
            min={0}
            max={draftType === "percent" ? 100 : undefined}
            step="0.01"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-7 w-24 border rounded text-sm px-2 bg-background"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="text-sm font-medium text-left hover:text-primary transition-colors cursor-text"
          title="Click to edit discount"
        >
          {displayValue}
        </button>
      )}
    </div>
  );
}

/* ---------- Main component ---------- */

export function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: opp, isLoading } = useOpportunity(id);
  const { data: history } = useStageHistory(id);
  const { data: products } = useOpportunityProducts(id);
  const { data: customFieldDefs } = useCustomFieldDefinitions("opportunities");
  const updateMutation = useUpdateOpportunity();
  const archiveMutation = useArchiveOpportunity();
  const deleteMutation = useDeleteOpportunity();
  const removeProdMutation = useRemoveOpportunityProduct();
  const [showArchive, setShowArchive] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [pendingRemoveProduct, setPendingRemoveProduct] = useState<{ id: string; name: string } | null>(null);
  const [pendingStage, setPendingStage] = useState<OpportunityStage | null>(null);
  const [newNote, setNewNote] = useState("");
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { addRecent } = useRecentRecords();
  const helpMap = useFieldHelpMap("opportunities");

  useEffect(() => {
    if (opp) {
      addRecent({ id: opp.id, entity: "opportunity", name: opp.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opp?.id]);

  // Self-healing: when products + opp are loaded, check whether the
  // displayed amount matches what the line items would compute. If
  // not, fire the recompute RPC (it's a no-op for opps without lines).
  // This catches drift from missing migrations or trigger silently
  // failing under RLS so users never see $0 on opps that have products.
  const ensureAmountFresh = useEnsureOpportunityAmountFresh(id);
  const ensureFiredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !opp || !products) return;
    if (ensureFiredForRef.current === id) return; // run once per opp visit
    if (products.length === 0) return; // nothing to recompute against
    // Only self-heal when amount is clearly unset/zero, not on every
    // discrepancy. Discrepancies are expected when the user has set a
    // custom amount or when discount_type='amount' lines differ from
    // %-math. Firing on every visit would overwrite those manual values.
    const amountIsUnset = !opp.amount || Number(opp.amount) === 0;
    ensureFiredForRef.current = id;
    if (amountIsUnset) {
      ensureAmountFresh.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, opp?.id, products?.length]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!opp) {
    return <div className="text-muted-foreground">Opportunity not found.</div>;
  }

  const oppId = opp.id;
  const saveField = (field: string, parser: (v: string) => unknown = (v) => (v === "" ? null : v)) =>
    async (newValue: string) => {
      await updateMutation.mutateAsync({ id: oppId, [field]: parser(newValue) } as Parameters<typeof updateMutation.mutateAsync>[0]);
    };
  const parseNumber = (v: string) => (v === "" ? null : Number(v));

  function handleArchive() {
    if (!id) return;
    archiveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Opportunity archived");
          navigate("/opportunities");
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
        title={opp.name}
        actions={
          <div className="flex items-center gap-2">
            <VerifiedBadge
              table="opportunities"
              recordId={opp.id}
              verified={opp.verified ?? false}
              verifiedAt={opp.verified_at}
              ownerId={opp.owner_user_id}
              invalidateKeys={[["opportunity", opp.id]]}
            />
            <StatusBadge value={opp.stage} variant="stage" label={stageLabel(opp.stage)} />
            <StatusBadge value={opp.kind} variant="kind" label={kindLabel(opp.kind)} />
            <Button variant="outline" size="sm" onClick={() => setShowChangeOwner(true)}>
              <UserRoundCog className="h-4 w-4 mr-1" />
              Change Owner
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/opportunities/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Permanently delete "${opp.name}"? This cannot be undone. Use Archive if you might need to restore it later.`,
                    )
                  ) return;
                  try {
                    await deleteMutation.mutateAsync({ id: opp.id });
                    toast.success("Opportunity deleted");
                    navigate("/opportunities");
                  } catch (err) {
                    toast.error("Failed to delete: " + (err as Error).message);
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
        }
      />

      <RecordId id={opp.id} sfId={opp.sf_id} />

      {/* --------- Key Info Bar --------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Account</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {opp.account ? (
              <Link to={`/accounts/${opp.account.id}`} className="text-sm font-semibold text-primary hover:underline truncate block">
                {opp.account.name}
              </Link>
            ) : <p className="text-sm text-muted-foreground">{"\u2014"}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Expected Close</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">
              {opp.expected_close_date ? formatDate(opp.expected_close_date) : "\u2014"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Close Date</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">
              {opp.close_date ? formatDate(opp.close_date) : "\u2014"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Amount</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold text-primary">{formatCurrency(opp.amount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Owner</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold truncate">{opp.owner?.full_name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">FTE Range</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">{opp.fte_range ?? opp.account?.fte_range ?? "\u2014"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">Maturity Date</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">{formatDate(opp.contract_end_date)}</p>
          </CardContent>
        </Card>
      </div>

      {/* --------- Stage Progress Bar --------- */}
      <StageProgressBar
        currentStage={opp.stage}
        onStageClick={(stage) => {
          if (stage !== opp.stage) setPendingStage(stage);
        }}
      />

      {/* --------- Loss Reason --------- */}
      {opp.stage === "closed_lost" && opp.loss_reason && (
        <Card className="my-4 border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Loss Reason</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{opp.loss_reason}</p>
          </CardContent>
        </Card>
      )}

      <DetailPageLayout
        sidePanels={[
          {
            key: "activity",
            label: "Activity",
            content: (
              <ActivityTimeline
                opportunityId={opp.id}
                compact
                enableReattribute
              />
            ),
          },
          {
            key: "tasks",
            label: "Tasks",
            content: <TasksPanel opportunityId={opp.id} />,
          },
        ]}
      >

      {/* Related-record tabs at the top, collapsed by default. */}
      <CollapsibleTabs
        className="mt-2"
        defaultValue="products"
        items={[
          {
            value: "products",
            label: `Products (${products?.length ?? 0})`,
            content: (
              <ProductsTabContent
                opportunityId={id!}
                products={products ?? []}
                onAddProduct={() => setShowAddProduct(true)}
                onRemoveProduct={(rowId, name) => setPendingRemoveProduct({ id: rowId, name })}
              />
            ),
          },
          {
            value: "history",
            label: "Stage History",
            content: <StageHistoryTabContent history={history ?? []} />,
          },
          {
            value: "tasks",
            label: "Tasks",
            content: <TasksPanel opportunityId={opp.id} />,
          },
          {
            value: "contacts",
            label: "Contacts",
            content: opp.account_id ? (
              <AccountContacts accountId={opp.account_id} />
            ) : (
              <p className="text-sm text-muted-foreground py-4">No account linked to this opportunity.</p>
            ),
          },
        ]}
      />

      {/* --------- Details Section --------- */}
      <div className="mt-4" />
      <CollapsibleSection title="Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Opportunity Owner"
            value={opp.owner?.full_name ?? "Unassigned"}
          />
          {opp.original_sales_rep && (
            <Field
              label="Original Sales Rep"
              value={opp.original_sales_rep.full_name}
            />
          )}
          {(opp.services_included || opp.assigned_assessor) && (
            <Field
              label="Assigned Assessor"
              value={opp.assigned_assessor?.full_name ?? "Unassigned"}
            />
          )}
          <Field label="Opportunity Name" value={opp.name} />
          <Field
            label="Account Name"
            value={
              opp.account ? (
                <Link to={`/accounts/${opp.account.id}`} className="text-primary hover:underline">
                  {opp.account.name}
                </Link>
              ) : null
            }
          />
          <Field
            label="Business Type"
            value={(() => {
              const bt = opp.business_type;
              if (!bt) return kindLabel(opp.kind);
              const labels: Record<string, string> = {
                new_business: "New Business",
                existing_business: "Existing Business",
                existing_business_new_product: "Existing Business — New Product",
                existing_business_new_service: "Existing Business — New Service",
                opportunity: "Opportunity",
              };
              return labels[bt] ?? bt;
            })()}
          />
          <Field label="Stage" value={stageLabel(opp.stage)} />
          <EditableField
            label="Probability (%)"
            value={opp.probability}
            onSave={saveField("probability", parseNumber)}
            type="number"
          />
          <Field label="Start Date" value={formatDate(opp.contract_start_date)} />
          <Field label="Maturity Date" value={formatDate(opp.contract_end_date)} />
          <Field label="Contract Signed" value={formatDate(opp.contract_signed_date)} />
          <Field
            label="Contract Length"
            value={opp.contract_length_months != null ? `${opp.contract_length_months} months` : null}
          />
          <Field
            label="Contract Year"
            value={opp.contract_year != null ? String(opp.contract_year) : null}
          />
          <Field
            label="Cycle Count"
            value={opp.cycle_count != null ? String(opp.cycle_count) : null}
          />
          <Field
            label="Auto Renewal"
            value={opp.auto_renewal ? "\u2713 Yes" : "\u2717 No"}
          />
          <Field label="Close Date" value={formatDate(opp.close_date)} />
          <Field label="Promo Code" value={opp.promo_code} />
          <Field
            label="Subtotal"
            value={opp.subtotal != null ? formatCurrencyDetailed(opp.subtotal) : null}
            helpText={helpMap.get("subtotal")}
          />
          <DiscountField
            discount={opp.discount}
            discountType={(opp as { discount_type?: string | null }).discount_type ?? "percent"}
            helpText={helpMap.get("discount")}
            onSave={async (value, type) => {
              await updateMutation.mutateAsync({
                id: oppId,
                discount: value,
                discount_type: type,
              } as Parameters<typeof updateMutation.mutateAsync>[0]);
            }}
          />
          {products && products.length > 0 ? (
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                Amount
                <HelpTooltip text={helpMap.get("amount")} />
              </span>
              <span className="text-sm font-medium">
                {opp.amount != null ? formatCurrencyDetailed(opp.amount) : "\u2014"}
                <span className="text-xs text-muted-foreground ml-1">(auto-calculated from line items)</span>
              </span>
            </div>
          ) : (
            <EditableField
              label="Amount"
              value={opp.amount}
              onSave={saveField("amount", (v) => (v === "" ? 0 : Number(v)))}
              type="currency"
              helpText={helpMap.get("amount")}
            />
          )}
          <Field label="FTE Range (at time of opp)" value={opp.fte_range ?? opp.account?.fte_range} />
          <Field
            label="FTEs (at time of opp)"
            value={opp.fte_count != null ? opp.fte_count.toLocaleString() : opp.account?.fte_count != null ? opp.account.fte_count.toLocaleString() : null}
          />
          {opp.account?.fte_range && opp.fte_range && opp.fte_range !== opp.account.fte_range && (
            <Field label="Current Account FTE Range" value={opp.account.fte_range} />
          )}
          <Field label="Partner" value={(opp.account as unknown as Record<string, unknown>)?.partner_account as string ?? null} />
          <Field label="Team" value={teamLabel(opp.team)} />
          <Field
            label="One Time Project"
            value={opp.one_time_project ? "\u2713 Yes" : "\u2717 No"}
          />
          <Field
            label="Created by Automation"
            value={
              opp.created_by_automation
                ? (() => {
                    const src = (opp as { automation_source?: string | null }).automation_source;
                    if (src === "sf_import") return "✓ Yes — Salesforce (imported)";
                    if (src === "crm_renewal_v1") return "✓ Yes — Medcurity CRM";
                    return "✓ Yes";
                  })()
                : "✗ No"
            }
          />
        </div>
      </CollapsibleSection>

      {/* --------- Additional Information --------- */}
      <CollapsibleSection title="Additional Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Lead Source"
            value={opp.lead_source ? leadSourceLabel(opp.lead_source) : null}
          />
          <Field
            label="Lead Source Detail"
            value={opp.lead_source_detail}
          />
          <Field
            label="Payment Frequency"
            value={opp.payment_frequency ? paymentFrequencyLabel(opp.payment_frequency) : null}
          />
          <Field
            label="Follow Up"
            value={opp.follow_up ? "\u2713 Yes" : "\u2717 No"}
          />
          {/* Full-row span so the textarea has horizontal room. */}
          <div className="md:col-span-2">
            <EditableField label="Next Step" value={opp.next_step} onSave={saveField("next_step")} type="textarea" />
          </div>
          <Field
            label="Service Amount"
            value={opp.service_amount != null ? formatCurrencyDetailed(opp.service_amount) : null}
          />
          <Field
            label="Product Amount"
            value={opp.product_amount != null ? formatCurrencyDetailed(opp.product_amount) : null}
          />
          <Field
            label="Services Included"
            value={opp.services_included ? "\u2713 Yes" : "\u2717 No"}
          />
          <EditableField
            label="Expected Close Date"
            value={opp.expected_close_date}
            onSave={saveField("expected_close_date")}
            type="date"
          />
        </div>
        {opp.description && (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground">Description</span>
            <p className="text-sm whitespace-pre-wrap mt-1">{opp.description}</p>
          </div>
        )}
      </CollapsibleSection>

      {/* --------- Notes --------- */}
      <CollapsibleSection title="Notes" defaultOpen={!!opp.notes}>
        {/* Scrollable log of existing notes */}
        {opp.notes && (
          <div className="border rounded-md p-3 max-h-64 overflow-y-auto bg-muted/30 space-y-1 text-sm mb-3">
            {opp.notes.split("\n").filter(Boolean).map((line, i) => {
              const parts = line.split(" | ");
              if (parts.length >= 3) {
                const [name, date, ...rest] = parts;
                return (
                  <div key={i} className="py-1 border-b last:border-b-0 border-muted">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground"> - {date}: </span>
                    <span>{rest.join(" | ")}</span>
                  </div>
                );
              }
              return <div key={i} className="py-1 border-b last:border-b-0 border-muted">{line}</div>;
            })}
          </div>
        )}
        {/* Add new note */}
        <div className="flex gap-2">
          <Input
            placeholder="Add a note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!newNote.trim() || !id) return;
                const userName = profile?.full_name ?? "Unknown";
                const now = new Date().toLocaleString();
                const entry = `${userName} | ${now} | ${newNote.trim()}`;
                const current = opp.notes ?? "";
                const updated = current ? `${entry}\n${current}` : entry;
                updateMutation.mutate(
                  { id, notes: updated },
                  {
                    onSuccess: () => { setNewNote(""); toast.success("Note added"); },
                    onError: (err) => toast.error("Failed to add note: " + (err as Error).message),
                  }
                );
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!newNote.trim() || !id) return;
              const userName = profile?.full_name ?? "Unknown";
              const now = new Date().toLocaleString();
              const entry = `${userName} | ${now} | ${newNote.trim()}`;
              const current = opp.notes ?? "";
              const updated = current ? `${entry}\n${current}` : entry;
              updateMutation.mutate(
                { id, notes: updated },
                {
                  onSuccess: () => { setNewNote(""); toast.success("Note added"); },
                  onError: (err) => toast.error("Failed to add note: " + (err as Error).message),
                }
              );
            }}
          >
            Add Note
          </Button>
        </div>
      </CollapsibleSection>

      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && opp.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={opp.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- System Information --------- */}
      <CollapsibleSection title="System Information" defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Created By"
            value={opp.creator?.full_name ?? "\u2014"}
          />
          <Field
            label="Last Modified By"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${opp.id}`}
                className="text-primary hover:underline inline-flex items-center gap-1"
                title="View audit history for this record"
              >
                {opp.updater?.full_name ?? "\u2014"}
                <History className="h-3 w-3" />
              </Link>
            }
          />
          <Field label="Created" value={formatDateTime(opp.created_at)} />
          <Field
            label="Last Modified"
            value={
              <Link
                to={`/admin?tab=audit-log&record_id=${opp.id}`}
                className="text-primary hover:underline"
                title="View audit history for this record"
              >
                {formatDateTime(opp.updated_at)}
              </Link>
            }
          />
        </div>
      </CollapsibleSection>

      </DetailPageLayout>

      <ConfirmDialog
        open={showArchive}
        onOpenChange={setShowArchive}
        title="Archive Opportunity"
        description="This will hide the opportunity from active views and pipeline."
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
      />

      <ConfirmDialog
        open={!!pendingStage}
        onOpenChange={(open) => { if (!open) setPendingStage(null); }}
        title="Change Stage"
        description={`Change stage to ${pendingStage ? stageLabel(pendingStage) : ""}?`}
        confirmLabel="Change Stage"
        onConfirm={() => {
          if (!id || !pendingStage) return;
          updateMutation.mutate(
            { id, stage: pendingStage },
            {
              onSuccess: () => {
                toast.success(`Stage changed to ${stageLabel(pendingStage)}`);
                setPendingStage(null);
              },
              onError: (err) => {
                toast.error("Failed to change stage: " + (err as Error).message);
                setPendingStage(null);
              },
            }
          );
        }}
      />

      <ChangeOwnerDialog
        open={showChangeOwner}
        onOpenChange={setShowChangeOwner}
        currentOwnerId={opp.owner_user_id}
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
        title="Change Opportunity Owner"
      />

      {id && (
        <MultiProductPicker
          open={showAddProduct}
          onOpenChange={setShowAddProduct}
          opportunityId={id}
        />
      )}

      <ConfirmDialog
        open={!!pendingRemoveProduct}
        onOpenChange={(open) => { if (!open) setPendingRemoveProduct(null); }}
        title="Remove Product"
        description={`Remove ${pendingRemoveProduct?.name ?? "this product"} from this opportunity?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (!id || !pendingRemoveProduct) return;
          removeProdMutation.mutate(
            { id: pendingRemoveProduct.id, opportunityId: id },
            {
              onSuccess: () => {
                toast.success("Product removed");
                setPendingRemoveProduct(null);
              },
              onError: (err) => {
                toast.error("Failed to remove product: " + (err as Error).message);
                setPendingRemoveProduct(null);
              },
            }
          );
        }}
      />
    </div>
  );
}

/* ---------- Tab content extracted for the CollapsibleTabs items ---------- */

interface ProductsTabContentProps {
  opportunityId: string;
  products: Array<{
    id: string;
    quantity: number;
    unit_price: number | string;
    arr_amount: number | string;
    discount_percent?: number | string | null;
    product?: { id?: string | null; name?: string | null; code?: string | null } | null;
  }>;
  onAddProduct: () => void;
  onRemoveProduct: (rowId: string, name: string) => void;
}

function ProductsTabContent({
  opportunityId,
  products,
  onAddProduct,
  onRemoveProduct,
}: ProductsTabContentProps) {
  // Live-edit drafts per row, keyed by line item id. Buffered locally
  // so we don't fire a mutation per keystroke; commit on blur. Mirrors
  // the MultiProductPicker UX so the detail page feels consistent with
  // the create flow (Brayden's request: "follow the same type of ui as
  // the adding product screen").
  type DiscType = "percent" | "amount";
  type RowDraft = { quantity: string; unit_price: string; discount_percent: string; discount_type: DiscType };
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const updateMutation = useUpdateOpportunityProduct();

  function getDraft(p: { id: string; quantity: number; unit_price: number | string; discount_percent?: number | string | null; discount_type?: DiscType }): RowDraft {
    return (
      drafts[p.id] ?? {
        quantity: String(p.quantity ?? 1),
        unit_price: String(p.unit_price ?? 0),
        discount_percent: String(p.discount_percent ?? 0),
        discount_type: (p.discount_type ?? "percent") as DiscType,
      }
    );
  }
  function setDraftField(rowId: string, patch: Partial<RowDraft>) {
    setDrafts((prev) => {
      const current =
        prev[rowId] ??
        (() => {
          const row = products.find((r) => r.id === rowId) as
            | { quantity?: number; unit_price?: number | string; discount_percent?: number | string | null; discount_type?: DiscType }
            | undefined;
          return {
            quantity: String(row?.quantity ?? 1),
            unit_price: String(row?.unit_price ?? 0),
            discount_percent: String(row?.discount_percent ?? 0),
            discount_type: (row?.discount_type ?? "percent") as DiscType,
          };
        })();
      return { ...prev, [rowId]: { ...current, ...patch } };
    });
  }
  async function commitDraft(p: { id: string; quantity: number; unit_price: number | string; discount_percent?: number | string | null; discount_type?: DiscType }) {
    const draft = drafts[p.id];
    if (!draft) return;
    const qty = Math.max(0, Number(draft.quantity) || 0);
    const price = Math.max(0, Number(draft.unit_price) || 0);
    let disc = Math.max(0, Number(draft.discount_percent) || 0);
    if (draft.discount_type === "percent") disc = Math.min(100, disc);
    const currentType = (p.discount_type ?? "percent") as DiscType;
    const noChange =
      qty === Number(p.quantity ?? 0) &&
      price === Number(p.unit_price ?? 0) &&
      disc === Number(p.discount_percent ?? 0) &&
      draft.discount_type === currentType;
    if (noChange) {
      setDrafts((prev) => {
        const out = { ...prev };
        delete out[p.id];
        return out;
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: p.id,
        opportunity_id: opportunityId,
        patch: {
          quantity: qty,
          unit_price: price,
          discount_percent: disc,
          discount_type: draft.discount_type,
        },
      });
      setDrafts((prev) => {
        const out = { ...prev };
        delete out[p.id];
        return out;
      });
    } catch (err) {
      console.error("Failed to update product line:", err);
    }
  }

  // Live total always computed from current values (draft or persisted)
  // so the footer is never stale. We never fall back to stored arr_amount
  // because it may be stale (set on insert, not updated on subsequent edits).
  const liveTotalARR = products.reduce((sum, p) => {
    const draft = drafts[p.id];
    const qty = Number(draft?.quantity ?? p.quantity) || 0;
    const price = Number(draft?.unit_price ?? p.unit_price) || 0;
    const disc = Number(draft?.discount_percent ?? (p as { discount_percent?: number | string | null }).discount_percent ?? 0) || 0;
    const discType = (draft?.discount_type ?? (p as { discount_type?: string | null }).discount_type ?? "percent") as "percent" | "amount";
    const lineTotal =
      discType === "amount"
        ? Math.max(0, qty * price - disc)
        : qty * price * (1 - disc / 100);
    return sum + lineTotal;
  }, 0);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">
          {products.length
            ? `${products.length} product${products.length !== 1 ? "s" : ""} — edits save when you click out of a field`
            : "No products added yet"}
        </span>
        <Button size="sm" onClick={onAddProduct}>
          <Plus className="h-4 w-4 mr-1" />
          Add Product
        </Button>
      </div>
      {products.length ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="text-right w-28">Unit $</TableHead>
                <TableHead className="text-right w-32">Discount</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const draft = getDraft(p);
                const previewQty = Number(draft.quantity) || 0;
                const previewPrice = Number(draft.unit_price) || 0;
                const previewDisc = Number(draft.discount_percent) || 0;
                const previewArr =
                  draft.discount_type === "amount"
                    ? Math.max(0, previewQty * previewPrice - previewDisc)
                    : previewQty * previewPrice * (1 - previewDisc / 100);
                const dirty = !!drafts[p.id];
                return (
                  <TableRow key={p.id} className={dirty ? "bg-amber-50/40" : ""}>
                    <TableCell className="font-medium">
                      {/* Plain text — used to be a Link to /products/:id
                          which routed users away from the opp. The line
                          item is editable here; click "Catalog" if you
                          want to view the master product. */}
                      {p.product?.name ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.product?.code ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={draft.quantity}
                        onChange={(e) => setDraftField(p.id, { quantity: e.target.value })}
                        onBlur={() => commitDraft(p)}
                        className="h-8 w-20 text-right ml-auto border rounded-md px-2 bg-background"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.unit_price}
                        onChange={(e) => setDraftField(p.id, { unit_price: e.target.value })}
                        onBlur={() => commitDraft(p)}
                        className="h-8 w-28 text-right ml-auto border rounded-md px-2 bg-background"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <select
                          value={draft.discount_type}
                          onChange={(e) => {
                            setDraftField(p.id, { discount_type: e.target.value as "percent" | "amount" });
                          }}
                          onBlur={() => commitDraft(p)}
                          className="h-8 border rounded-md bg-background text-xs px-1"
                          title="Discount type: % of unit price or flat $ amount"
                        >
                          <option value="percent">%</option>
                          <option value="amount">$</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={draft.discount_type === "percent" ? 100 : undefined}
                          step="0.01"
                          value={draft.discount_percent}
                          onChange={(e) => setDraftField(p.id, { discount_percent: e.target.value })}
                          onBlur={() => commitDraft(p)}
                          className="h-8 w-20 text-right border rounded-md px-2 bg-background"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrencyDetailed(previewArr)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveProduct(p.id, p.product?.name ?? "this product")}
                        disabled={updateMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={5} className="text-right font-semibold">Line Items Total</TableCell>
                <TableCell className="text-right font-bold">{formatCurrencyDetailed(liveTotalARR)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : null}
    </>
  );
}

interface StageHistoryEntry {
  id: number | string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  changer?: { full_name?: string | null } | null;
}

function StageHistoryTabContent({ history }: { history: StageHistoryEntry[] }) {
  if (!history.length) {
    return <p className="text-sm text-muted-foreground py-4">No stage changes recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {history.map((h) => (
        <div key={h.id} className="flex items-center gap-3 text-sm">
          <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
          <div className="flex-1">
            {h.from_stage ? (
              <span>
                <span className="font-medium">{stageLabel(h.from_stage as never)}</span>
                {" \u2192 "}
                <span className="font-medium">{stageLabel(h.to_stage as never)}</span>
              </span>
            ) : (
              <span>
                Created as <span className="font-medium">{stageLabel(h.to_stage as never)}</span>
              </span>
            )}
            {h.changer?.full_name && (
              <span className="text-muted-foreground"> by {h.changer.full_name}</span>
            )}
          </div>
          <span className="text-muted-foreground text-xs">{formatRelativeDate(h.changed_at)}</span>
        </div>
      ))}
    </div>
  );
}
