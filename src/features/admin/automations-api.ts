import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerCondition {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte";
  value: string;
}

export interface AutomationAction {
  type: "update_field" | "create_activity" | "send_notification";
  // update_field
  entity?: string;
  field?: string;
  value?: string;
  // create_activity
  activity_type?: string;
  subject?: string;
  due_offset_days?: number;
  // send_notification
  message?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_entity: "accounts" | "contacts" | "opportunities" | "leads";
  trigger_event: "created" | "updated" | "stage_changed" | "status_changed";
  trigger_conditions: TriggerCondition[];
  actions: AutomationAction[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationLogEntry {
  id: number;
  rule_id: string;
  trigger_record_id: string;
  trigger_entity: string;
  actions_executed: AutomationAction[];
  success: boolean;
  error_message: string | null;
  executed_at: string;
}

export type CreateAutomationInput = Pick<
  AutomationRule,
  "name" | "description" | "trigger_entity" | "trigger_event" | "trigger_conditions" | "actions" | "is_active"
>;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch all automation rules. */
export function useAutomationRules() {
  return useQuery({
    queryKey: ["automation_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AutomationRule[];
    },
  });
}

/** Create a new automation rule. */
export function useCreateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAutomationInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("automation_rules")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Update an existing automation rule (partial update). */
export function useUpdateAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<AutomationRule> & { id: string }) => {
      const { data, error } = await supabase
        .from("automation_rules")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Delete an automation rule. */
export function useDeleteAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("automation_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
    },
  });
}

/** Fetch execution log for a specific rule (or all rules). */
export function useAutomationLog(ruleId?: string) {
  return useQuery({
    queryKey: ["automation_log", ruleId],
    queryFn: async () => {
      let query = supabase
        .from("automation_log")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(50);

      if (ruleId) {
        query = query.eq("rule_id", ruleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AutomationLogEntry[];
    },
  });
}

// ---------------------------------------------------------------------------
// Renewal automation (Phase 8)
// ---------------------------------------------------------------------------

export interface RenewalAutomationConfig {
  id: number;
  enabled: boolean;
  lookahead_days: number;
  last_run_at: string | null;
  last_run_created_count: number | null;
  last_run_error: string | null;
  updated_at: string;
  /** When set, automation only runs against this single account. */
  test_account_id: string | null;
  pullback_days_auto_renew: number;
  pullback_days_signature_required: number;
  /**
   * Fresh-start date: contracts already inside the renewal window on this
   * date are the team's manual backlog and are never auto-created. Set by
   * migration when the automation went live on this environment.
   */
  baseline_date: string | null;
}

/**
 * One row from v_renewal_audit. Categories surface different reasons
 * the automation will or won't act on a given opp/account on its
 * next run. See migration 20260508000004.
 */
export interface RenewalAuditRow {
  audit_category:
    | "missing_renewal"
    | "past_due_no_renewal"
    | "missing_dates"
    | "missing_contract_year"
    | "every_other_year_skip"
    | "auto_renew_null"
    | "do_not_auto_renew";
  parent_opportunity_id: string | null;
  account_id: string;
  account_name: string;
  opportunity_name: string | null;
  close_date: string | null;
  contract_end_date: string | null;
  effective_end_date: string | null;
  contract_length_months: number | null;
  contract_year: number | null;
  cycle_count: number | null;
  lifecycle_status: string | null;
  renewal_type: string | null;
  auto_renew: boolean | null;
  every_other_year: boolean | null;
  do_not_auto_renew: boolean | null;
  note: string;
}

export interface RenewalAutomationRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  created_count: number;
  skipped_count: number;
  error_message: string | null;
  triggered_by: "cron" | "manual";
}

/** Fetch the singleton renewal automation config row. */
export function useRenewalAutomationConfig() {
  return useQuery({
    queryKey: ["renewal_automation_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_automation_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as RenewalAutomationConfig | null;
    },
  });
}

/** Update the singleton config row. */
export function useUpdateRenewalAutomationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Partial<
        Pick<
          RenewalAutomationConfig,
          | "enabled"
          | "lookahead_days"
          | "test_account_id"
          | "pullback_days_auto_renew"
          | "pullback_days_signature_required"
        >
      >
    ) => {
      const { data, error } = await supabase
        .from("renewal_automation_config")
        .update(values)
        .eq("id", 1)
        .select()
        .single();
      if (error) throw error;
      return data as RenewalAutomationConfig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["renewal_automation_config"] });
      qc.invalidateQueries({ queryKey: ["renewal_audit"] });
      // Changing the config (lookahead/pullback/test account) changes what the
      // next run would generate, so refresh the preview too.
      qc.invalidateQueries({ queryKey: ["renewal_preview"] });
    },
  });
}

/** Fetch the most recent renewal automation runs. */
export function useRenewalAutomationRuns(limit = 10) {
  return useQuery({
    queryKey: ["renewal_automation_runs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_automation_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RenewalAutomationRun[];
    },
  });
}

/**
 * Fetch the renewal audit view — what the automation would (or wouldn't)
 * do on its next run. Honors `renewal_automation_config.test_account_id`
 * scoping at the DB level.
 */
export function useRenewalAudit() {
  return useQuery({
    queryKey: ["renewal_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_renewal_audit")
        .select("*")
        .order("audit_category")
        .order("effective_end_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as RenewalAuditRow[];
    },
  });
}

/**
 * One row from preview_upcoming_renewals(). Mirrors the renewals
 * function's filter exactly (including the close_date + 12 months
 * anniversary anchor), so the preview shows precisely what Run Now
 * would do — and surfaces a reason for every rejection.
 */
export interface RenewalPreviewRow {
  status:
    | "will_create"
    | "anniversary_outside_window"
    | "before_baseline"
    | "has_live_renewal"
    | "account_not_customer"
    | "account_do_not_auto_renew"
    | "one_time_project"
    | "no_close_date"
    | "archived"
    | "not_test_account";
  parent_opportunity_id: string;
  parent_opportunity_name: string;
  account_id: string;
  account_name: string;
  account_status: string | null;
  close_date: string | null;
  contract_signed_date: string | null;
  contract_end_date: string | null;
  contract_length_months: number | null;
  contract_year: number | null;
  cycle_count: number | null;
  one_time_project: boolean;
  do_not_auto_renew: boolean;
  archived: boolean;
  computed_anniversary: string | null;
  anchor_field:
    | "contract_end_date"
    | "contract_signed_date_plus_length"
    | "close_date_plus_length"
    | "none";
  days_until_anniversary: number | null;
  lookahead_days: number;
  test_account_id: string | null;
  reason: string;
}

/**
 * Preview every closed-won opp the next renewal run will touch,
 * with the precise reason it will or won't generate a renewal.
 * Read-only RPC; see migration 20260519000009.
 */
export function useRenewalPreview() {
  return useQuery({
    queryKey: ["renewal_preview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_upcoming_renewals");
      if (error) throw error;
      return (data ?? []) as RenewalPreviewRow[];
    },
  });
}

/**
 * Lightweight account picker for the test_account_id selector. We
 * deliberately don't filter by lifecycle_status here — Brayden's test
 * account may be a prospect with one manually-flipped closed_won opp.
 */
export function useAccountsForPicker() {
  return useQuery({
    queryKey: ["accounts_for_picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, lifecycle_status")
        .is("archived_at", null)
        .order("name", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        lifecycle_status: string | null;
      }>;
    },
  });
}

/** Trigger a manual renewal automation run via the admin RPC. */
export function useRunRenewalAutomationNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("run_renewal_automation_now");
      if (error) throw error;
      return (data ?? []) as { created_count: number; skipped_count: number }[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["renewal_automation_config"] });
      qc.invalidateQueries({ queryKey: ["renewal_automation_runs"] });
      qc.invalidateQueries({ queryKey: ["renewal_audit"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}
