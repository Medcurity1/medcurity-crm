import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { Pencil, Archive, ChevronDown, UserRoundCog, Plus, Trash2 } from "lucide-react";
import { useOpportunity, useUpdateOpportunity, useArchiveOpportunity, useStageHistory, useOpportunityProducts, useRemoveOpportunityProduct } from "./api";
import { AddProductDialog } from "./AddProductDialog";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { StageProgressBar } from "./StageProgressBar";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { CustomFieldsDisplay } from "@/components/CustomFieldsDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { RecordId } from "@/components/RecordId";
import { AccountContacts } from "@/features/accounts/AccountContacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  formatRelativeDate,
  leadSourceLabel,
  paymentFrequencyLabel,
} from "@/lib/formatters";
import { toast } from "sonner";
import { ActivityTimeline } from "@/features/activities/ActivityTimeline";
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? "\u2014"}</span>
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
  const removeProdMutation = useRemoveOpportunityProduct();
  const [showArchive, setShowArchive] = useState(false);
  const [showChangeOwner, setShowChangeOwner] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [pendingRemoveProduct, setPendingRemoveProduct] = useState<{ id: string; name: string } | null>(null);
  const [pendingStage, setPendingStage] = useState<OpportunityStage | null>(null);
  const { addRecent } = useRecentRecords();

  useEffect(() => {
    if (opp) {
      addRecent({ id: opp.id, entity: "opportunity", name: opp.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opp?.id]);

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

  const totalARR = products?.reduce((sum, p) => sum + Number(p.arr_amount), 0) ?? 0;

  return (
    <div>
      {/* --------- Header --------- */}
      <PageHeader
        title={opp.name}
        actions={
          <div className="flex items-center gap-2">
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
            <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
              <Archive className="h-4 w-4 mr-1" />
              Archive
            </Button>
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
            <CardTitle className="text-xs text-muted-foreground font-medium">Close Date</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-sm font-semibold">{formatDate(opp.close_date ?? opp.expected_close_date)}</p>
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
            <p className="text-sm font-semibold">{opp.account?.fte_range ?? "\u2014"}</p>
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

      {/* --------- Details Section --------- */}
      <div className="mt-4" />
      <CollapsibleSection title="Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <Field
            label="Opportunity Owner"
            value={opp.owner?.full_name ?? "Unassigned"}
          />
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
          <Field label="Type / Kind" value={kindLabel(opp.kind)} />
          <Field label="Stage" value={stageLabel(opp.stage)} />
          <Field
            label="Probability (%)"
            value={opp.probability != null ? `${opp.probability}%` : null}
          />
          <Field label="Start Date" value={formatDate(opp.contract_start_date)} />
          <Field label="Maturity Date" value={formatDate(opp.contract_end_date)} />
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
          />
          <Field
            label="Discount"
            value={opp.discount != null ? formatCurrencyDetailed(opp.discount) : null}
          />
          <Field label="Amount" value={formatCurrency(opp.amount)} />
          <Field label="FTE Range" value={opp.account?.fte_range} />
          <Field
            label="FTEs"
            value={opp.account?.fte_count != null ? opp.account.fte_count.toLocaleString() : null}
          />
          <Field label="Team" value={teamLabel(opp.team)} />
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
            label="Payment Frequency"
            value={opp.payment_frequency ? paymentFrequencyLabel(opp.payment_frequency) : null}
          />
          <Field
            label="Follow Up"
            value={opp.follow_up ? "\u2713 Yes" : "\u2717 No"}
          />
          <Field label="Next Step" value={opp.next_step} />
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
          <Field label="Expected Close Date" value={formatDate(opp.expected_close_date)} />
        </div>
        {opp.description && (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground">Description</span>
            <p className="text-sm whitespace-pre-wrap mt-1">{opp.description}</p>
          </div>
        )}
      </CollapsibleSection>

      {/* --------- Notes --------- */}
      {opp.notes && (
        <CollapsibleSection title="Notes">
          <p className="text-sm whitespace-pre-wrap">{opp.notes}</p>
        </CollapsibleSection>
      )}

      {/* --------- Custom Fields --------- */}
      {customFieldDefs && customFieldDefs.length > 0 && opp.custom_fields && (
        <CollapsibleSection title="Custom Fields">
          <CustomFieldsDisplay
            customFields={opp.custom_fields}
            definitions={customFieldDefs}
          />
        </CollapsibleSection>
      )}

      {/* --------- Tabs --------- */}
      <Tabs defaultValue="products" className="mt-2">
        <TabsList>
          <TabsTrigger value="products">Products ({products?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="history">Stage History</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">
              {products?.length
                ? `${products.length} product${products.length !== 1 ? "s" : ""}`
                : "No products added yet"}
            </span>
            <Button size="sm" onClick={() => setShowAddProduct(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Product
            </Button>
          </div>
          {products?.length ? (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.product?.name ?? "\u2014"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.product?.code ?? "\u2014"}</TableCell>
                      <TableCell className="text-right">{p.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrencyDetailed(Number(p.unit_price))}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrencyDetailed(Number(p.arr_amount))}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingRemoveProduct({ id: p.id, name: p.product?.name ?? "this product" })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={5} className="text-right font-semibold">Total ARR</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrencyDetailed(totalARR)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {history?.length ? (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 text-sm">
                  <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1">
                    {h.from_stage ? (
                      <span>
                        <span className="font-medium">{stageLabel(h.from_stage)}</span>
                        {" \u2192 "}
                        <span className="font-medium">{stageLabel(h.to_stage)}</span>
                      </span>
                    ) : (
                      <span>
                        Created as <span className="font-medium">{stageLabel(h.to_stage)}</span>
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
          ) : (
            <p className="text-sm text-muted-foreground py-4">No stage changes recorded.</p>
          )}
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          <ActivityTimeline opportunityId={opp.id} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TasksPanel opportunityId={opp.id} />
        </TabsContent>

        <TabsContent value="contacts" className="mt-4">
          {opp.account_id ? (
            <AccountContacts accountId={opp.account_id} />
          ) : (
            <p className="text-sm text-muted-foreground py-4">No account linked to this opportunity.</p>
          )}
        </TabsContent>
      </Tabs>

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
        <AddProductDialog
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
