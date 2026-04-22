#!/usr/bin/env node
// =================================================================
// Bulk Task.csv → public.activities importer.
//
// Why this exists: the in-browser SF importer goes through PostgREST
// one batch at a time and triggers a per-row retry whenever a single
// row fails — which made the user's 64k-row Task import take 30+
// minutes for 0 results. This script connects directly with the
// service-role key, pre-loads all lookup maps in parallel, applies
// the same business rules, and bulk-upserts in 500-row batches.
// Expected runtime: 2-5 minutes for 64k rows.
//
// USAGE:
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbG... node scripts/migration/import-tasks.mjs <path/to/Task.csv>
//
// OPTIONS (env vars):
//   SUPABASE_URL                 — defaults to .env's VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    — REQUIRED. Get from Supabase dashboard
//                                  → Project Settings → API → service_role
//   SKIP_OPEN_TASKS=false        — defaults true; set false to also import
//                                  open SF tasks (follow-ups not yet done)
//   SKIP_EMAIL_TASKS=false       — defaults true; set false to import the
//                                  Type=Email task rows too
//   USER_CSV=/path/to/User.csv   — optional; resolve owners by SF user id
//   DRY_RUN=true                 — parse + validate only, no DB writes
// =================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---------- env + args ----------
const taskPath = process.argv[2];
if (!taskPath) {
  console.error("Usage: node scripts/migration/import-tasks.mjs <Task.csv>");
  process.exit(1);
}

function readDotEnv(p) {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = { ...readDotEnv(".env"), ...readDotEnv(".env.local"), ...process.env };

const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  console.error("Get the service_role key from Supabase Dashboard → Project Settings → API.");
  process.exit(1);
}

const SKIP_OPEN_TASKS = env.SKIP_OPEN_TASKS !== "false";
const SKIP_EMAIL_TASKS = env.SKIP_EMAIL_TASKS !== "false";
const DRY_RUN = env.DRY_RUN === "true";
const USER_CSV = env.USER_CSV ?? resolve(dirname(taskPath), "User.csv");

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------- CSV parser (handles quoted fields with commas/newlines) ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        row.push(cur); rows.push(row); row = []; cur = "";
        if (c === "\r") i++;
      } else cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------- paginated fetch (works around 1000-row PostgREST cap) ----------
async function fetchAllRows(builder, pageSize = 1000) {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await builder().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
    from += pageSize;
  }
}

// ---------- main ----------
async function main() {
  console.log(`▶ Loading ${taskPath}`);
  const csvText = readFileSync(taskPath, "utf8");
  const rows = parseCSV(csvText);
  if (rows.length < 2) { console.error("CSV is empty"); process.exit(1); }
  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ""));
  console.log(`  ${dataRows.length.toLocaleString()} rows in CSV`);

  // Header → index helpers
  const idx = new Map(headers.map((h, i) => [h.toLowerCase(), i]));
  const col = (row, name) => row[idx.get(name.toLowerCase())] ?? "";

  // ---------- pre-fetch lookup maps in parallel ----------
  console.log("▶ Loading lookup maps...");
  const t0 = Date.now();
  const [accounts, contacts, opps, leads, users] = await Promise.all([
    fetchAllRows(() => sb.from("accounts").select("id, sf_id").not("sf_id", "is", null)),
    fetchAllRows(() => sb.from("contacts").select("id, sf_id").not("sf_id", "is", null)),
    fetchAllRows(() => sb.from("opportunities").select("id, sf_id").not("sf_id", "is", null)),
    fetchAllRows(() => sb.from("leads").select("id, sf_id").not("sf_id", "is", null)),
    fetchAllRows(() => sb.from("user_profiles").select("id, full_name")),
  ]);
  const accountSfMap = new Map(accounts.map((a) => [a.sf_id, a.id]));
  const contactSfMap = new Map(contacts.map((c) => [c.sf_id, c.id]));
  const opportunitySfMap = new Map(opps.map((o) => [o.sf_id, o.id]));
  const leadSfMap = new Map(leads.map((l) => [l.sf_id, l.id]));
  const userNameMap = new Map(
    users.filter((u) => u.full_name).map((u) => [u.full_name.toLowerCase(), u.id])
  );
  console.log(
    `  loaded ${accounts.length.toLocaleString()} accounts, ${contacts.length.toLocaleString()} contacts, ` +
    `${opps.length.toLocaleString()} opps, ${leads.length.toLocaleString()} leads, ${users.length.toLocaleString()} users ` +
    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );

  // ---------- optional User.csv side-load: SF user id → name ----------
  // Activities.owner_user_id is a CRM user uuid. SF Task.OwnerId is a SF user id (005…).
  // To bridge: load SF User.csv → build SF user id → name → CRM user id.
  let sfUserToCrm = new Map();
  if (existsSync(USER_CSV)) {
    const u = parseCSV(readFileSync(USER_CSV, "utf8"));
    const uH = u[0];
    const uIdI = uH.findIndex((h) => h.toLowerCase() === "id");
    const uNameI = uH.findIndex((h) => h.toLowerCase() === "name");
    if (uIdI >= 0 && uNameI >= 0) {
      let resolved = 0;
      for (const ur of u.slice(1)) {
        const sfId = ur[uIdI]?.trim();
        const name = ur[uNameI]?.trim();
        if (!sfId || !name) continue;
        const crm = userNameMap.get(name.toLowerCase());
        if (crm) { sfUserToCrm.set(sfId, crm); resolved++; }
      }
      console.log(`  resolved ${resolved} SF users → CRM users from ${USER_CSV}`);
    }
  } else {
    console.log(`  (no User.csv at ${USER_CSV} — owner_user_id will be null)`);
  }

  // ---------- transform ----------
  console.log("▶ Transforming rows...");
  const records = [];
  let skipped = 0;
  const skipReasons = new Map();
  let orphan = 0;

  function bump(map, k) { map.set(k, (map.get(k) ?? 0) + 1); }

  for (const r of dataRows) {
    if (col(r, "IsDeleted") === "1") { skipped++; bump(skipReasons, "IsDeleted=1"); continue; }
    const status = col(r, "Status").toLowerCase();
    const isClosed = col(r, "IsClosed") === "1" || status === "completed";
    if (SKIP_OPEN_TASKS && !isClosed) { skipped++; bump(skipReasons, "open task"); continue; }
    const sfType = col(r, "Type").toLowerCase();
    if (SKIP_EMAIL_TASKS && sfType === "email") { skipped++; bump(skipReasons, "Type=Email"); continue; }

    const whoId = col(r, "WhoId");
    const whatId = col(r, "WhatId");
    const accountIdSf = col(r, "AccountId");

    const ref = {};
    if (whoId.startsWith("003")) ref.contact_id = contactSfMap.get(whoId) ?? null;
    else if (whoId.startsWith("00Q")) ref.lead_id = leadSfMap.get(whoId) ?? null;
    if (whatId.startsWith("001")) ref.account_id = accountSfMap.get(whatId) ?? null;
    else if (whatId.startsWith("006")) ref.opportunity_id = opportunitySfMap.get(whatId) ?? null;
    if (!ref.account_id && accountIdSf && accountIdSf !== "000000000000000AAA") {
      ref.account_id = accountSfMap.get(accountIdSf) ?? null;
    }

    if (!ref.account_id && !ref.contact_id && !ref.opportunity_id && !ref.lead_id) {
      orphan++;
      continue;
    }

    const activityType =
      sfType === "call" ? "call"
      : sfType === "meeting" ? "meeting"
      : sfType === "email" ? "email"
      : "note";

    const ownerSf = col(r, "OwnerId");
    const ownerCrm = ownerSf ? sfUserToCrm.get(ownerSf) ?? null : null;

    const dueAt = col(r, "ActivityDate") || null;
    const completedAt = isClosed ? (col(r, "CompletedDateTime") || dueAt) : null;

    let priority = col(r, "Priority").toLowerCase();
    if (!["high", "normal", "low"].includes(priority)) priority = null;

    const callDuration = col(r, "CallDurationInSeconds");
    const recurInterval = col(r, "RecurrenceInterval");
    const recurDow = col(r, "RecurrenceDayOfWeekMask");
    const recurDom = col(r, "RecurrenceDayOfMonth");
    const recurMoy = col(r, "RecurrenceMonthOfYear");

    records.push({
      sf_id: col(r, "Id") || null,
      activity_type: activityType,
      subject: col(r, "Subject") || (sfType ? sfType[0].toUpperCase() + sfType.slice(1) : "Activity"),
      body: col(r, "Description") || null,
      due_at: dueAt,
      completed_at: completedAt,
      owner_user_id: ownerCrm,
      ...ref,
      priority,
      activity_origin_type: col(r, "ActivityOriginType") || null,
      sf_email_message_id: col(r, "EmailMessageId") || null,
      sf_reminder_datetime: col(r, "ReminderDateTime") || null,
      sf_is_reminder_set: col(r, "IsReminderSet") === "1" ? true : (col(r, "IsReminderSet") === "0" ? false : null),
      call_type: col(r, "CallType") || null,
      call_disposition: col(r, "CallDisposition") || null,
      call_object: col(r, "CallObject") || null,
      call_duration_seconds: callDuration ? Number(callDuration) || null : null,
      is_recurrence: col(r, "IsRecurrence") === "1" ? true : (col(r, "IsRecurrence") === "0" ? false : null),
      recurrence_type: col(r, "RecurrenceType") || null,
      recurrence_interval: recurInterval ? Number(recurInterval) || null : null,
      recurrence_start_date: col(r, "RecurrenceStartDateOnly") || null,
      recurrence_end_date: col(r, "RecurrenceEndDateOnly") || null,
      recurrence_timezone: col(r, "RecurrenceTimeZoneSidKey") || null,
      recurrence_day_of_week_mask: recurDow ? Number(recurDow) || null : null,
      recurrence_day_of_month: recurDom ? Number(recurDom) || null : null,
      recurrence_month_of_year: recurMoy ? Number(recurMoy) || null : null,
      recurrence_instance: col(r, "RecurrenceInstance") || null,
      sf_recurrence_activity_id: col(r, "RecurrenceActivityId") || null,
      sf_created_by: col(r, "CreatedById") || null,
      sf_created_date: col(r, "CreatedDate") || null,
      sf_last_modified_by: col(r, "LastModifiedById") || null,
      sf_last_modified_date: col(r, "LastModifiedDate") || null,
      // Preserve the SF timeline: without this the activity shows
      // today as its create date, which makes the timeline read
      // backwards and sort wrong on every detail page. imported_at
      // captures the moment this row landed in the CRM so we can
      // still tell "migrated" vs "native" records apart.
      created_at: col(r, "CreatedDate") || undefined,
      updated_at: col(r, "LastModifiedDate") || col(r, "CreatedDate") || undefined,
      imported_at: col(r, "CreatedDate") ? new Date().toISOString() : undefined,
    });
  }

  console.log(`  ${records.length.toLocaleString()} records ready, ${skipped.toLocaleString()} skipped, ${orphan.toLocaleString()} orphans`);
  if (skipReasons.size) {
    console.log("  Skip reasons:");
    for (const [k, v] of skipReasons.entries()) console.log(`    ${v.toLocaleString()} — ${k}`);
  }

  if (DRY_RUN) {
    console.log("(DRY_RUN=true — not writing to DB)");
    process.exit(0);
  }

  // ---------- bulk upsert ----------
  console.log("▶ Upserting in batches of 500...");
  const t1 = Date.now();
  const BATCH = 500;
  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error } = await sb
      .from("activities")
      .upsert(batch, { onConflict: "sf_id", ignoreDuplicates: false });
    if (error) {
      console.error(`  batch ${i / BATCH + 1}: ${error.message}`);
      // Fallback: try one by one to pinpoint bad rows
      for (const r of batch) {
        const { error: rowErr } = await sb.from("activities").upsert([r], { onConflict: "sf_id" });
        if (rowErr) { failed++; console.error(`    row sf_id=${r.sf_id}: ${rowErr.message}`); }
        else inserted++;
      }
    } else {
      inserted += batch.length;
    }
    process.stdout.write(`\r  ${inserted.toLocaleString()}/${records.length.toLocaleString()} (${((Date.now() - t1) / 1000).toFixed(1)}s)   `);
  }
  console.log(`\n✓ Done. ${inserted.toLocaleString()} upserted, ${failed.toLocaleString()} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
