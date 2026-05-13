import { useState, useCallback } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = "accounts" | "contacts" | "opportunities" | "leads";

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
}

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
  current_contract_length_months: "Contract Length (months)",
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

function useEntityFields(entity: EntityType) {
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
        .map((r) => ({ key: r.field, label: prettifyFieldName(r.field) }));
    },
  });
}

const ENTITY_TABS: { value: EntityType; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
  { value: "leads", label: "Leads" },
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

function EntityRequiredFields({ entity }: { entity: EntityType }) {
  const { data: configs, isLoading, isError } = useRequiredFieldConfigs(entity);
  const { data: fields, isLoading: fieldsLoading } = useEntityFields(entity);
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

  if (isLoading || fieldsLoading) {
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
      <p className="text-sm text-muted-foreground">
        Toggle fields that must be filled before a record can be saved.
      </p>

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
                  <TableCell className="font-medium text-sm">{f.label}</TableCell>
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
      {ENTITY_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <EntityRequiredFields entity={tab.value} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
