import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// One row of already-column-mapped contact data sent to the RPC. All
// optional except the wizard requires last_name to be mapped.
export type ContactImportRow = Record<string, string | boolean | null | undefined>;

export interface ContactImportEvent {
  enabled: boolean;
  type: string; // 'webinar' | 'conference' | 'meeting' | 'call' | 'email'
  subject: string;
  date: string; // ISO timestamp (local noon of the event date)
}

export interface ContactImportOptions {
  dup_mode: "update" | "skip";
  owner_user_id?: string | null;
  event?: ContactImportEvent | null;
  /** Pen mode: new people land as PENDING imports (import_status='pending',
   * no account resolution — that happens at promote time). Rows matching an
   * existing live contact behave exactly as without pen. */
  pen?: boolean;
}

// Result shape from import_contacts_rows (per chunk). Classification counts
// (will_*) are populated in both dry-run and real runs; the actuals
// (created/updated/skipped/events_stamped) only on the real run.
export interface ContactImportResult {
  total: number;
  will_create: number;
  will_update: number;
  will_skip: number;
  invalid: number;
  ambiguous_account: number;
  will_stamp: number;
  created: number;
  updated: number;
  skipped: number;
  /** Rows refused because the address was Avoided/suppressed (v3 guard). */
  suppressed: number;
  events_stamped: number;
  errors: number;
  last_error: string | null;
  dry_run: boolean;
}

export function emptyResult(dryRun: boolean): ContactImportResult {
  return {
    total: 0, will_create: 0, will_update: 0, will_skip: 0, invalid: 0,
    ambiguous_account: 0, will_stamp: 0, created: 0, updated: 0, skipped: 0,
    suppressed: 0, events_stamped: 0, errors: 0, last_error: null, dry_run: dryRun,
  };
}

export function addResult(a: ContactImportResult, b: ContactImportResult): ContactImportResult {
  return {
    total: a.total + b.total,
    will_create: a.will_create + b.will_create,
    will_update: a.will_update + b.will_update,
    will_skip: a.will_skip + b.will_skip,
    invalid: a.invalid + b.invalid,
    ambiguous_account: a.ambiguous_account + b.ambiguous_account,
    will_stamp: a.will_stamp + b.will_stamp,
    created: a.created + b.created,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    suppressed: (a.suppressed ?? 0) + (b.suppressed ?? 0),
    events_stamped: a.events_stamped + b.events_stamped,
    errors: a.errors + b.errors,
    last_error: b.last_error ?? a.last_error,
    dry_run: a.dry_run,
  };
}

export function useImportContacts() {
  return useMutation({
    mutationFn: async (args: {
      rows: ContactImportRow[];
      options: ContactImportOptions;
      dryRun: boolean;
    }): Promise<ContactImportResult> => {
      const { data, error } = await supabase.rpc("import_contacts_rows", {
        p_rows: args.rows,
        p_options: args.options,
        p_dry_run: args.dryRun,
      });
      if (error) throw error;
      return data as ContactImportResult;
    },
  });
}
