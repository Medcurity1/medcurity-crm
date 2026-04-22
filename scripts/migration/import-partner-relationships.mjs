#!/usr/bin/env node
// =================================================================
// Import SF Partner.csv into public.account_partners.
//
// SF stores account-to-account partnerships in the Partner object.
// Each row has AccountFromId + AccountToId + Role (and a
// ReversePartnerId pointing at the mirror row — SF stores every
// pair TWICE, once in each direction). We dedup on import so each
// CRM relationship is recorded once.
//
// Direction convention: SF's "From" is the origin account in the
// relationship setup. We treat AccountFromId as the PARTNER side
// (umbrella/referrer) and AccountToId as the MEMBER. Both rows of
// each SF mirror pair collapse to a single CRM row.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbG... \
//     node scripts/migration/import-partner-relationships.mjs <Partner.csv>
//
// Behavior:
//   - Skips IsDeleted=1 rows
//   - Resolves both account IDs via accounts.sf_id; rows where either
//     side isn't in the CRM are reported as "no-match"
//   - Dedups mirror pairs (only inserts {A,B} once even though SF
//     has both {A,B} and {B,A})
//   - Idempotent: ON CONFLICT DO NOTHING via the existing unique
//     constraint on (partner_account_id, member_account_id)
// =================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/migration/import-partner-relationships.mjs <Partner.csv>");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");

function readDotEnv(p) {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = {
  ...readDotEnv(resolve(REPO_ROOT, ".env")),
  ...readDotEnv(resolve(REPO_ROOT, ".env.local")),
  ...readDotEnv(".env"),
  ...readDotEnv(".env.local"),
  ...process.env,
};
const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("  Get the service_role key from Supabase Dashboard → Project Settings → API → service_role");
  process.exit(1);
}
if (SERVICE_KEY.length < 100 || !SERVICE_KEY.startsWith("eyJ")) {
  console.error("✗ Service role key looks invalid (length", SERVICE_KEY.length + ").");
  process.exit(1);
}
try {
  const payload = JSON.parse(Buffer.from(SERVICE_KEY.split(".")[1], "base64").toString("utf8"));
  if (payload.role !== "service_role") {
    console.error(`✗ JWT role is '${payload.role}', not 'service_role'. Use the service_role key.`);
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ Could not decode JWT: ${e.message}`);
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

console.log(`▶ Loading ${csvPath}`);
const rows = parseCSV(readFileSync(csvPath, "utf8"));
if (rows.length < 2) { console.error("CSV is empty"); process.exit(1); }

const headers = rows[0];
const idx = (n) => headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
const fromI = idx("AccountFromId");
const toI = idx("AccountToId");
const roleI = idx("Role");
const isDelI = idx("IsDeleted");
if (fromI < 0 || toI < 0) {
  console.error("✗ Partner.csv must have AccountFromId and AccountToId columns.");
  process.exit(1);
}

const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ""));
console.log(`  ${dataRows.length.toLocaleString()} rows in CSV`);

console.log("▶ Loading account sf_id → uuid map…");
const t0 = Date.now();
const accounts = await fetchAllRows(() =>
  sb.from("accounts").select("id, sf_id").not("sf_id", "is", null)
);
const accountMap = new Map(accounts.map((a) => [a.sf_id, a.id]));
console.log(`  ${accounts.length.toLocaleString()} accounts (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

console.log("▶ Resolving + deduping…");
let skippedDeleted = 0;
let skippedSelfRef = 0;
let skippedNoMatch = 0;
// Dedup pairs — SF stores each relationship in both directions, we
// only want one row per unordered pair. Key = "smaller-uuid|larger-uuid"
// preserves direction (which side is partner vs member).
const seen = new Set();
const records = [];
for (const r of dataRows) {
  if (isDelI >= 0 && r[isDelI] === "true") { skippedDeleted++; continue; }
  const fromSf = r[fromI]?.trim();
  const toSf = r[toI]?.trim();
  if (!fromSf || !toSf) { skippedNoMatch++; continue; }
  if (fromSf === toSf) { skippedSelfRef++; continue; }
  const partnerId = accountMap.get(fromSf);  // From = the partner side
  const memberId = accountMap.get(toSf);
  if (!partnerId || !memberId) { skippedNoMatch++; continue; }
  // Dedup by directional key — SF mirror pair {A→B, B→A} both
  // collapse to A→B (whichever side we see first).
  const key = `${partnerId}|${memberId}`;
  const reverseKey = `${memberId}|${partnerId}`;
  if (seen.has(key) || seen.has(reverseKey)) continue;
  seen.add(key);
  records.push({
    partner_account_id: partnerId,
    member_account_id: memberId,
    role: r[roleI]?.trim() || null,
  });
}
console.log(`  ${records.length.toLocaleString()} unique pairs ready (skipped ${skippedDeleted} deleted, ${skippedSelfRef} self-refs, ${skippedNoMatch} no-match)`);

console.log("▶ Inserting…");
const t1 = Date.now();
const BATCH = 500;
let inserted = 0;
let dupes = 0;
let errors = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const chunk = records.slice(i, i + BATCH);
  // upsert with ignoreDuplicates lets us re-run safely. The unique
  // constraint on (partner_account_id, member_account_id) handles dedup.
  const { error, count } = await sb
    .from("account_partners")
    .upsert(chunk, {
      onConflict: "partner_account_id,member_account_id",
      ignoreDuplicates: true,
      count: "exact",
    });
  if (error) {
    console.error(`  batch ${i / BATCH + 1}: ${error.message}`);
    errors += chunk.length;
  } else {
    const ins = count ?? chunk.length;
    inserted += ins;
    dupes += chunk.length - ins;
  }
  process.stdout.write(`\r  ${(i + chunk.length).toLocaleString()}/${records.length.toLocaleString()} (${((Date.now() - t1) / 1000).toFixed(1)}s)   `);
}
console.log(`\n✓ Done. ${inserted.toLocaleString()} new, ${dupes.toLocaleString()} duplicates, ${errors} errors.`);
