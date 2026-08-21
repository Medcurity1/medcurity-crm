// Assessor requirement → follow-up task (Nathan + Rachel, 2026-08-21).
//
// Summer closes service deals before Jordan staffs the assessor, so the
// hard requirement at Closed Won (20260715170000) forced placeholders.
// The Rachel-approved replacement: assessor optional everywhere, an
// "Assign the assessor" task on close, auto-complete on assignment, and
// a daily reminder while any stay open. These tests pin the pieces that
// would fail silently if drifted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (relative: string) =>
  readFileSync(path.resolve(__dirname, "..", relative), "utf8");

const MIGRATION =
  "supabase/migrations/20260821190000_assessor_optional_with_followup.sql";

describe("assessor follow-up migration", () => {
  const sql = read(MIGRATION);

  it("turns OFF both requirement rows without deleting them", () => {
    // Upsert to false — the admin toggles must survive so turning the
    // hard gate back on stays a data flip, not a code change.
    expect(sql).toMatch(/\('opportunities', 'assigned_assessor_id', false\)/);
    expect(sql).toMatch(/\('opportunity_close', 'assigned_assessor', false\)/);
    expect(sql).toMatch(/on conflict \(entity, field_key\) do update set is_required = false/);
    expect(sql).not.toMatch(/delete from public\.required_field_config/i);
  });

  it("spawns tasks only from human actions, never machine writers", () => {
    // Imports, the renewal generator and pg_cron have no auth.uid();
    // they were never blocked by the old gate and must not spam Jordan.
    expect(sql).toMatch(/if v_actor is null then return new; end if;/);
    // The INSERT path additionally refuses historical closes, so an
    // in-app CSV load (which DOES run as a user) can't flood tasks.
    expect(sql).toMatch(/tg_op = 'INSERT'/);
    expect(sql).toMatch(/current_date - 30/);
  });

  it("uses the same three service signals as the old close gate", () => {
    expect(sql).toMatch(/services_included/);
    expect(sql).toMatch(/service_amount, 0\) > 0/);
    expect(sql).toMatch(/product_family ilike 'service%'/);
  });

  it("dedupes on an existing open task and routes Jordan-first with fallbacks", () => {
    expect(sql).toMatch(/t\.subject like 'Assign the assessor%'/);
    expect(sql).toMatch(/lower\(up\.full_name\) = 'jordan scherich'/);
    expect(sql).toMatch(/coalesce\(v_recipient, new\.owner_user_id, v_actor\)/);
  });

  it("auto-completes the task when the assessor lands on the deal", () => {
    expect(sql).toMatch(/trg_assessor_task_autocomplete/);
    expect(sql).toMatch(/after update of assigned_assessor_id on public\.opportunities/);
    expect(sql).toMatch(/set completed_at = now\(\)/);
  });

  it("daily reminder honors the pref, dedupes per day, and is registered fail-soft", () => {
    expect(sql).toMatch(/'assessor_needed'/);
    expect(sql).toMatch(/p\.prefs->>'assessor_needed'/);
    expect(sql).toMatch(/interval '20 hours'/);
    expect(sql).toMatch(/scheduled_job_registry/);
    expect(sql).toMatch(/assessor_needed_daily/);
    // Fail-soft cron install — a missing pg_cron must not break deploys.
    expect(sql).toMatch(/pg_extension where extname = 'pg_cron'/);
    // Cron-only writers stay unreachable through PostgREST.
    expect(sql).toMatch(
      /revoke all on function public\.notify_assessor_tasks_open\(\) from public, anon, authenticated/,
    );
  });
});

describe("assessor Training-placeholder sweep (20260821213000)", () => {
  const sweep = read(
    "supabase/migrations/20260821213000_assessor_training_placeholder_sweep.sql",
  );

  it("creates tasks the follow-up machinery recognizes as its own", () => {
    // The auto-complete trigger and the daily reminder both match on the
    // subject prefix AND this exact body marker — a drifted string would
    // orphan the swept tasks (never auto-complete, never remind).
    expect(sweep).toMatch(/'Assign the assessor: ' \|\|/);
    expect(sweep).toMatch(/Created by the assessor follow-up automation\./);
  });

  it("is a safe, idempotent, environment-aware data fix", () => {
    // No Training user (staging) → explicit no-op, never a guess.
    expect(sweep).toMatch(/if v_training_ids is null then/);
    // Clears the placeholder rather than deleting or reassigning users.
    expect(sweep).toMatch(/set assigned_assessor_id = null/);
    expect(sweep).not.toMatch(/delete from public\.user_profiles/i);
    // Re-run guard: skip deals that already have an open assessor task.
    expect(sweep).toMatch(/not exists \(\s*select 1 from public\.activities t/);
    // Jordan-first routing with the owner fallback, same as the trigger.
    expect(sweep).toMatch(/coalesce\(v_jordan, v_deal\.owner_user_id\)/);
  });
});

describe("assessor follow-up frontend wiring", () => {
  it("keeps the close-gate MECHANISM (config-driven), only the config flips", () => {
    const gate = read("src/lib/closeReadiness.ts");
    expect(gate).toMatch(/"assigned_assessor"/);
    expect(gate).toMatch(/opportunityHasServices/);
  });

  it("wires the assessor_needed notification type end to end", () => {
    expect(read("src/types/crm.ts")).toMatch(/"assessor_needed"/);
    const drop = read("src/components/NotificationsDropdown.tsx");
    expect(drop).toMatch(/assessor_needed: UserCheck/);
    expect(drop).toMatch(/assessor_needed: "text-cyan-600 dark:text-cyan-400"/);
    expect(read("src/lib/notification-sound-choice.ts")).toMatch(/assessor_needed: "lantern"/);
    const prefs = read("src/features/notifications/prefs-api.ts");
    expect(prefs).toMatch(/key: "assessor_needed"/);
    expect(prefs).toMatch(/label: "Assessor needed"/);
  });
});
