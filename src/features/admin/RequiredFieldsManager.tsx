import { useState, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { CLOSE_READINESS_KEYS, type CloseReadinessKey } from "@/lib/closeReadiness";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType =
  | "accounts"
  | "contacts"
  | "opportunities"
  | "leads"
  | "opportunity_close";

interface RequiredFieldConfig {
  id: string;
  entity: EntityType;
  field_key: string;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

interface FieldDef {
  key: string;
  label: string;
  /** Small muted caveat under the label (e.g. a conditional rule). */
  note?: string;
}

// Per-field caveats for inventory-discovered fields whose enforcement has
// a condition the flat toggle can't express. Keyed `<entity>.<field>`.
const FIELD_NOTES: Record<string, string> = {
  "opportunities.assigned_assessor_id":
    "Only enforced when the deal includes services (a service line item, a service amount, or “Services Included”). Deals without services are exempt. (Rachel, 2026-07-15)",
};

// ---------------------------------------------------------------------------
// Field definitions per entity — sourced dynamically from v_field_inventory
// so new columns auto-appear here without code edits.
// ---------------------------------------------------------------------------

// System / audit / computed columns that shouldn't be user-required.
// Anything not on this list (and not matched by the prefix rules below)
// shows up as a toggleable required-field candidate.
const SYSTEM_FIELDS = new Set<string>([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "owner_id", // accounts uses owner_user_id; opportunities uses owner_user_id
  // Computed / system-managed
  "search_text",
  "tsv",
  "lifecycle_derived_at",
  "lifecycle_source",
  "lifecycle_status_override",
  "lifecycle_status_override_reason",
  // Derived/automated status fields the account form never submits —
  // requiring one would block every account create (customer_status is
  // computed from deal history; status is being retired and its form
  // field is gone; the overrides are popup-managed). NOTE: SYSTEM_FIELDS
  // is name-based across entities, so this also hides leads.status —
  // fine: it's default-valued, requiring it was always a no-op, and
  // leads are slated for removal.
  "status",
  "lifecycle_status",
  "customer_status",
  "customer_status_override",
  "customer_status_override_reason",
  "customer_status_override_at",
  "customer_status_override_by",
  "customer_status_derived_at",
  // Sales toggle is a boolean with a default; "required" is meaningless
  // and the toggle-off flow would fight it.
  "sales_active",
  // Big jsonb blob — managed via Custom Fields admin, not required-fields
  "custom_fields",
  // External-system IDs (SF migration leftovers; not user-edited)
  "sf_id",
  "salesforce_id",
  "hubspot_id",
  "external_id",
]);

// Friendly label overrides for column names where snake_case prettify
// produces something awkward (e.g., "Acv" vs "ACV").
const LABEL_OVERRIDES: Record<string, string> = {
  acv: "ACV",
  fte_count: "FTE Count",
  fte_range: "FTE Range",
  ftes: "FTEs",
  mrr: "MRR",
  arr: "ARR",
  url: "URL",
  linkedin_url: "LinkedIn URL",
  owner_user_id: "Owner",
  account_id: "Account",
  contact_id: "Contact",
  partner_id: "Partner",
  parent_account_id: "Parent Account",
  primary_contact_id: "Primary Contact",
  current_contract_length_months: "Contract Length",
  current_contract_start_date: "Contract Start Date",
  current_contract_end_date: "Contract End Date",
};

function prettifyFieldName(field: string): string {
  if (LABEL_OVERRIDES[field]) return LABEL_OVERRIDES[field];
  // snake_case → Title Case, with "_id" suffix stripped for FK columns.
  const stripped = field.endsWith("_id") ? field.slice(0, -3) : field;
  return stripped
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

interface FieldInventoryRow {
  entity: string;
  field: string;
  data_type: string;
  ordinal_position: number;
}

function useEntityFields(entity: EntityType, enabled: boolean = true) {
  return useQuery({
    queryKey: ["required-fields-inventory", entity],
    queryFn: async (): Promise<FieldDef[]> => {
      const { data, error } = await supabase
        .from("v_field_inventory")
        .select("entity,field,data_type,ordinal_position")
        .eq("entity", entity)
        .order("ordinal_position");
      if (error) throw error;
      const rows = (data ?? []) as FieldInventoryRow[];
      return rows
        .filter((r) => !SYSTEM_FIELDS.has(r.field))
        .map((r) => ({
          key: r.field,
          label: prettifyFieldName(r.field),
          note: FIELD_NOTES[`${entity}.${r.field}`],
        }));
    },
    // The close-gate section (entity "opportunity_close") isn't backed by
    // real table columns, so it has no v_field_inventory rows — its fields
    // are hardcoded below instead of discovered. Skip the query entirely
    // for that entity rather than let it run and return nothing.
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Close-gate fields (entity "opportunity_close")
//
// These four keys aren't columns on any table — they're the checks the
// Closed Won gate runs against the opportunity's ACCOUNT (and its
// contacts). Source of truth for the key list + evaluation logic is
// src/lib/closeReadiness.ts (CLOSE_READINESS_KEYS / evaluateCloseReadiness).
// closeReadiness.ts's own LABELS constant isn't exported (it's private to
// that module), so the admin-friendly copy below is defined locally —
// keep it in sync with closeReadiness.ts's CLOSE_READINESS_KEYS if that
// list ever changes.
// ---------------------------------------------------------------------------

const CLOSE_GATE_LABELS: Record<CloseReadinessKey, string> = {
  account_phone: "Account phone number",
  account_billing_address: "Account billing address",
  account_fte_range: "Account FTE range",
  contact_email: "A contact email address",
  assigned_assessor: "An assigned assessor",
};

const CLOSE_GATE_NOTES: Partial<Record<CloseReadinessKey, string>> = {
  assigned_assessor:
    "Only enforced when the deal includes services — deals without services close without one. (Rachel, 2026-07-15)",
};

const CLOSE_GATE_FIELDS: FieldDef[] = CLOSE_READINESS_KEYS.map((key) => ({
  key,
  label: CLOSE_GATE_LABELS[key],
  note: CLOSE_GATE_NOTES[key],
}));

function CloseGateFallbackNote() {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
      <div className="flex gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Turning individual checks off narrows what's enforced. But turning{" "}
          <strong>all of them off</strong> does not disable the gate — with none
          marked required, the system falls back to enforcing every check
          automatically. This gate can be narrowed, but never fully emptied.
        </p>
      </div>
    </div>
  );
}

const ENTITY_TABS: { value: EntityType; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
  { value: "leads", label: "Leads" },
  { value: "opportunity_close", label: "Closing a Deal (Closed Won)" },
];

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

function useRequiredFieldConfigs(entity: EntityType) {
  return useQuery({
    queryKey: ["required_field_config", entity],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("required_field_config")
        .select("*")
        .eq("entity", entity);
      if (error) {
        // Table may not exist yet — return empty array gracefully
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          return [] as RequiredFieldConfig[];
        }
        throw error;
      }
      return (data ?? []) as RequiredFieldConfig[];
    },
    retry: false,
  });
}

function useUpsertRequiredField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entity,
      field_key,
      is_required,
    }: {
      entity: EntityType;
      field_key: string;
      is_required: boolean;
    }) => {
      // Try upsert — if table doesn't exist this will fail gracefully
      const { error } = await supabase
        .from("required_field_config")
        .upsert(
          { entity, field_key, is_required },
          { onConflict: "entity,field_key" },
        );
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["required_field_config", vars.entity] });
    },
  });
}

// ---------------------------------------------------------------------------
// Sub-component: entity fields table
// ---------------------------------------------------------------------------

function EntityRequiredFields({
  entity,
  fields: staticFields,
  helperText = "Toggle fields that must be filled before a record can be saved.",
  note,
}: {
  entity: EntityType;
  /** Pass a fixed list to skip schema discovery (e.g. the close-gate keys, which aren't real columns). */
  fields?: FieldDef[];
  helperText?: string;
  note?: ReactNode;
}) {
  const { data: configs, isLoading, isError } = useRequiredFieldConfigs(entity);
  const { data: fetchedFields, isLoading: fieldsLoading } = useEntityFields(
    entity,
    staticFields === undefined,
  );
  const fields = staticFields ?? fetchedFields;
  const isFieldsLoading = staticFields === undefined && fieldsLoading;
  const upsert = useUpsertRequiredField();

  // Build a lookup for current required state
  const requiredMap = new Map<string, boolean>();
  if (configs) {
    for (const c of configs) {
      requiredMap.set(c.field_key, c.is_required);
    }
  }

  // Track optimistic overrides locally so the switch feels instant
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const handleToggle = useCallback(
    (fieldKey: string, checked: boolean) => {
      setOptimistic((prev) => ({ ...prev, [fieldKey]: checked }));

      upsert.mutate(
        { entity, field_key: fieldKey, is_required: checked },
        {
          onSuccess: () => {
            toast.success(
              checked
                ? `"${fieldKey}" is now required`
                : `"${fieldKey}" is no longer required`,
            );
          },
          onError: (err) => {
            // Revert optimistic
            setOptimistic((prev) => {
              const next = { ...prev };
              delete next[fieldKey];
              return next;
            });
            toast.error(`Failed to update: ${err.message}`);
          },
        },
      );
    },
    [entity, upsert],
  );

  if (isLoading || isFieldsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
        The <code className="bg-muted px-1 py-0.5 rounded text-xs">required_field_config</code> table
        has not been created yet. Run the latest migration to enable this feature.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{helperText}</p>

      {note}

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead className="w-[120px] text-center">Required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(fields ?? []).map((f) => {
              const isRequired =
                optimistic[f.key] ?? requiredMap.get(f.key) ?? false;
              return (
                <TableRow key={f.key}>
                  <TableCell className="font-medium text-sm">
                    {f.label}
                    {f.note && (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">{f.note}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={isRequired}
                      onCheckedChange={(checked) => handleToggle(f.key, checked)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function RequiredFieldsManager() {
  return (
    <Tabs defaultValue="accounts" className="space-y-4">
      <TabsList>
        {ENTITY_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {ENTITY_TABS.map((tab) =>
        tab.value === "opportunity_close" ? (
          <TabsContent key={tab.value} value={tab.value}>
            <EntityRequiredFields
              entity="opportunity_close"
              fields={CLOSE_GATE_FIELDS}
              helperText="These must be complete before a deal can be marked Closed Won — account info checks plus the deal's assigned assessor when it includes services."
              note={<CloseGateFallbackNote />}
            />
          </TabsContent>
        ) : (
          <TabsContent key={tab.value} value={tab.value}>
            <EntityRequiredFields entity={tab.value} />
          </TabsContent>
        ),
      )}
    </Tabs>
  );
}
