#!/usr/bin/env node
// =================================================================
// Scan distinct values for every picklist-eligible field in the CRM
// and write a CSV report. Use this to seed picklist_options with
// the REAL values present in your data, not guessed-at lists.
//
// USAGE:
//   SUPABASE_URL=https://<ref>.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/migration/scan-picklist-values.mjs > picklist-scan.csv
//
// Output: CSV with columns
//   table | column | value | count
// =================================================================

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

// Fields to scan, grouped by table. Add/remove to control coverage.
const FIELDS = {
  accounts: [
    "account_type",
    "industry",
    "industry_category",
    "renewal_type",
    "status",
    "lifecycle_status",
    "ownership",
    "rating",
    "lead_source",
    "lead_source_detail",
    "timezone",
    "fte_range",
  ],
  contacts: [
    "credential",
    "time_zone",
    "type",
    "business_relationship_tag",
    "lead_source",
    "department",
  ],
  leads: [
    "status",
    "source",
    "qualification",
    "type",
    "project_segment",
    "industry_category",
    "credential",
    "time_zone",
    "business_relationship_tag",
    "rating",
    "lead_source",
    "cold_lead_source",
  ],
  opportunities: [
    "stage",
    "kind",
    "team",
    "lead_source",
    "lead_source_detail",
    "payment_frequency",
    "contract_length_months",
    "contract_year",
    "fte_range",
  ],
};

console.log("table,column,value,count");

for (const [table, columns] of Object.entries(FIELDS)) {
  for (const col of columns) {
    let from = 0;
    const counts = new Map();
    const pageSize = 1000;
    while (from < 200_000) {
      const { data, error } = await sb
        .from(table)
        .select(col)
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`# ${table}.${col}: ${error.message}`);
        break;
      }
      const rows = data ?? [];
      for (const r of rows) {
        const v = r[col];
        const key = v === null || v === undefined || v === "" ? "(null)" : String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [v, c] of sorted) {
      // Escape quotes and commas for CSV.
      const safe = (s) => `"${String(s).replace(/"/g, '""')}"`;
      console.log(`${safe(table)},${safe(col)},${safe(v)},${c}`);
    }
  }
}

console.error("Done.");
