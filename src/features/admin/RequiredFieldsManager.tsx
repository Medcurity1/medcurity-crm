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
// Field definitions per entity
// ---------------------------------------------------------------------------

const ACCOUNT_FIELDS: FieldDef[] = [
  { key: "name", label: "Account Name" },
  { key: "lifecycle_status", label: "Lifecycle Status" },
  { key: "status", label: "Status" },
  { key: "owner_user_id", label: "Owner" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "account_type", label: "Account Type" },
  { key: "timezone", label: "Timezone" },
  { key: "employees", label: "Employees" },
  { key: "locations", label: "Locations" },
  { key: "fte_count", label: "FTE Count" },
  { key: "fte_range", label: "FTE Range" },
  { key: "annual_revenue", label: "Annual Revenue" },
  { key: "active_since", label: "Active Since" },
  { key: "renewal_type", label: "Renewal Type" },
  { key: "current_contract_start_date", label: "Contract Start Date" },
  { key: "current_contract_end_date", label: "Contract End Date" },
  { key: "current_contract_length_months", label: "Contract Length (months)" },
  { key: "acv", label: "ACV" },
  { key: "billing_street", label: "Billing Street" },
  { key: "billing_city", label: "Billing City" },
  { key: "billing_state", label: "Billing State" },
  { key: "billing_zip", label: "Billing Zip" },
  { key: "billing_country", label: "Billing Country" },
  { key: "notes", label: "Notes" },
];

const CONTACT_FIELDS: FieldDef[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "title", label: "Title" },
  { key: "department", label: "Department" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "mailing_street", label: "Mailing Street" },
  { key: "mailing_city", label: "Mailing City" },
  { key: "mailing_state", label: "Mailing State" },
  { key: "mailing_zip", label: "Mailing Zip" },
  { key: "mailing_country", label: "Mailing Country" },
];

const OPPORTUNITY_FIELDS: FieldDef[] = [
  { key: "name", label: "Opportunity Name" },
  { key: "stage", label: "Stage" },
  { key: "amount", label: "Amount" },
  { key: "expected_close_date", label: "Expected Close Date" },
  { key: "close_date", label: "Close Date" },
  { key: "probability", label: "Probability" },
  { key: "next_step", label: "Next Step" },
  { key: "lead_source", label: "Lead Source" },
  { key: "payment_frequency", label: "Payment Frequency" },
  { key: "description", label: "Description" },
  { key: "notes", label: "Notes" },
];

const LEAD_FIELDS: FieldDef[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "description", label: "Description" },
];

const ENTITY_FIELD_MAP: Record<EntityType, FieldDef[]> = {
  accounts: ACCOUNT_FIELDS,
  contacts: CONTACT_FIELDS,
  opportunities: OPPORTUNITY_FIELDS,
  leads: LEAD_FIELDS,
};

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
  const upsert = useUpsertRequiredField();
  const fields = ENTITY_FIELD_MAP[entity];

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

  if (isLoading) {
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
            {fields.map((f) => {
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
