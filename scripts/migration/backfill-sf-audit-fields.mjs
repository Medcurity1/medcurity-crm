#!/usr/bin/env node
// =================================================================
// One-shot: update sf_created_date / sf_created_by /
// sf_last_modified_date / sf_last_modified_by on every row of every
// entity whose migration left them missing.
//
// Why a dedicated script instead of re-running the SF Import UI
// with "Update Existing" six times: the UI goes through the full
// field-mapping + validation pipeline for each row, plus
// PostgREST per-row round-trips on updates. For a column backfill
// that's pure overkill — this script just matches by sf_id and
// updates 4 columns. 32k rows = ~30 seconds total.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbG... \
//     node scripts/migration/backfill-sf-audit-fields.mjs \
//     /path/to/sf-export-folder
//
// Expects these CSVs in the folder (skips any that are missing):
//   Account.csv, Contact.csv, Lead.csv, Opportunity.csv,
//   Product2_canonical.csv (preferred) or Product2.csv,
//   Pricebook2.csv, PricebookEntry.csv
//
// After running, also run the stage + created_at backfill SQL —
// this script ONLY populates sf_*; the SQL copies those values
// into created_at / imported_at.
// =================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/migration/backfill-sf-audit-fields.mjs <sf-export-folder>");
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
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function parseCSV(text) {
  const rows = []; let row = []; let cur = ""; let inQ = false;
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

async function backfill({ entity, table, csvFile }) {
  const path = resolve(folder, csvFile);
  if (!existsSync(path)) {
    console.log(`⏭  ${entity.padEnd(22)} — ${csvFile} not found, skipping`);
    return;
  }

  const rows = parseCSV(readFileSync(path, "utf8"));
  if (rows.length < 2) {
    console.log(`⏭  ${entity.padEnd(22)} — ${csvFile} empty, skipping`);
    return;
  }

  const headers = rows[0];
  const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idI = idx("Id");
  const createdDateI = idx("CreatedDate");
  const createdByI = idx("CreatedById");
  const modDateI = idx("LastModifiedDate");
  const modByI = idx("LastModifiedById");
  const isDeletedI = idx("IsDeleted");

  if (idI < 0 || createdDateI < 0) {
    console.log(`⏭  ${entity.padEnd(22)} — ${csvFile} missing Id/CreatedDate columns, skipping`);
    return;
  }

  const data = rows.slice(1).filter((r) => r.some((c) => c !== ""));
  console.log(`▶  ${entity.padEnd(22)} — ${data.length.toLocaleString()} rows`);

  const updates = [];
  for (const r of data) {
    if (isDeletedI >= 0 && r[isDeletedI] === "1") continue;
    const sfId = r[idI]?.trim();
    if (!sfId) continue;
    updates.push({
      sf_id: sfId,
      sf_created_date: r[createdDateI]?.trim() || null,
      sf_created_by: r[createdByI]?.trim() || null,
      sf_last_modified_date: r[modDateI]?.trim() || null,
      sf_last_modified_by: r[modByI]?.trim() || null,
    });
  }

  const t0 = Date.now();
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  // Batch updates. We can't use upsert() because we don't have the
  // full row data — just match-by-sf_id and set the 4 audit fields.
  // Supabase's PostgREST doesn't support bulk updates with different
  // WHERE per row, so batch concurrent single-row updates.
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map((u) =>
        sb.from(table)
          .update({
            sf_created_date: u.sf_created_date,
            sf_created_by: u.sf_created_by,
            sf_last_modified_date: u.sf_last_modified_date,
            sf_last_modified_by: u.sf_last_modified_by,
          })
          .eq("sf_id", u.sf_id)
          .select("id")
      )
    );
    for (const { data, error } of results) {
      if (error) errors++;
      else if (!data || data.length === 0) notFound++;
      else updated += data.length;
    }
    process.stdout.write(
      `\r   ${(i + chunk.length).toLocaleString()}/${updates.length.toLocaleString()} · ` +
      `${updated.toLocaleString()} updated, ${notFound.toLocaleString()} no-match, ${errors} errors` +
      `  (${((Date.now() - t0) / 1000).toFixed(1)}s)   `
    );
  }
  console.log(`\n   ✓ done`);
}

const targets = [
  // entity label    table name               CSV file
  { entity: "Accounts",              table: "accounts",              csvFile: "Account.csv" },
  { entity: "Contacts",              table: "contacts",              csvFile: "Contact.csv" },
  { entity: "Leads",                 table: "leads",                 csvFile: "Lead.csv" },
  { entity: "Opportunities",         table: "opportunities",         csvFile: "Opportunity.csv" },
  { entity: "Products",              table: "products",              csvFile: "Product2.csv" },
  { entity: "Price Books",           table: "price_books",           csvFile: "Pricebook2.csv" },
  { entity: "Price Book Entries",    table: "price_book_entries",    csvFile: "PricebookEntry.csv" },
  { entity: "Opportunity Products",  table: "opportunity_products",  csvFile: "OpportunityLineItem.csv" },
];

console.log("Supabase audit-field backfill");
console.log(`Source folder: ${folder}`);
console.log(`Target DB:     ${SUPABASE_URL}\n`);

for (const t of targets) {
  try {
    await backfill(t);
  } catch (e) {
    console.error(`\n   ✗ ${t.entity}: ${e.message}`);
  }
}

console.log("\n✓ All entities processed.");
console.log("\nNext: run the SQL block in Supabase SQL Editor to copy sf_created_date → created_at.");
