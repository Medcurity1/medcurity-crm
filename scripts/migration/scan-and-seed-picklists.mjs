#!/usr/bin/env node
// =================================================================
// Scan every picklist-eligible column for distinct values + seed
// any missing rows into picklist_options. Handles missing columns
// gracefully (some staging envs don't have every column the master
// list expects).
//
// USAGE:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/migration/scan-and-seed-picklists.mjs
//
// Logs to stderr while running. Run twice and the second run is a
// no-op (rows are deduped via unique(field_key, value)).
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

const FIELDS = {
  accounts: [
    "account_type", "industry", "industry_category", "renewal_type",
    "status", "lifecycle_status", "rating", "lead_source", "timezone",
  ],
  contacts: [
    "credential", "time_zone", "type", "business_relationship_tag", "lead_source",
  ],
  leads: [
    "status", "source", "qualification", "type", "project_segment",
    "industry_category", "credential", "time_zone",
    "business_relationship_tag", "rating",
  ],
  opportunities: [
    "lead_source", "payment_frequency", "contract_length_months",
    "contract_year",
  ],
};

function humanize(v) {
  // 'no_auto_renew' → 'No Auto Renew'. Acronyms uppercased.
  const ACR = new Set([
    "mql","sql","sal","arr","fte","crm","voa","fqhc",
    "ceo","cfo","coo","cto","cio","cmo","ciso","md","do","rn","np","pa","lpn",
    "chc","chps","chpc","it",
  ]);
  return v
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACR.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

let totalNew = 0;
let totalSkipped = 0;

for (const [table, columns] of Object.entries(FIELDS)) {
  for (const col of columns) {
    const counts = new Map();
    let from = 0;
    const pageSize = 1000;
    let columnMissing = false;

    while (from < 200_000) {
      const { data, error } = await sb
        .from(table)
        .select(col)
        .range(from, from + pageSize - 1);
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42703") {
          console.error(`! skip ${table}.${col} — column missing on this DB`);
          columnMissing = true;
          break;
        }
        console.error(`! ${table}.${col}: ${error.message}`);
        break;
      }
      const rows = data ?? [];
      for (const r of rows) {
        const v = r[col];
        if (v === null || v === undefined || v === "") continue;
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    if (columnMissing || counts.size === 0) continue;

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const fieldKey = `${table}.${col}`;
    console.error(`> ${fieldKey}: ${counts.size} distinct values`);

    // For each value, upsert. ON CONFLICT lets us re-run safely.
    let nextSort = 100;
    for (const [value] of sorted) {
      nextSort += 10;
      const { error: insertErr, count } = await sb
        .from("picklist_options")
        .upsert(
          {
            field_key: fieldKey,
            value,
            label: humanize(value),
            sort_order: nextSort,
            is_active: true,
          },
          { onConflict: "field_key,value", ignoreDuplicates: true, count: "exact" },
        );
      if (insertErr) {
        console.error(`  ! ${value}: ${insertErr.message}`);
      } else if ((count ?? 0) > 0) {
        totalNew += 1;
      } else {
        totalSkipped += 1;
      }
    }
  }
}

console.error(`\nDone. ${totalNew} new options inserted, ${totalSkipped} already existed.`);
