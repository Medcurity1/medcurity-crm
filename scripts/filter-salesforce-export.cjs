/**
 * Salesforce Export Filter Script
 *
 * Reads Account TEST.csv to get the list of test account IDs,
 * then filters all related Salesforce CSVs to only include records
 * linked to those accounts. Outputs filtered TEST CSVs.
 *
 * Usage: node scripts/filter-salesforce-export.js "/path/to/TEST DATA"
 */

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

// ── Config ──────────────────────────────────────────────────────────
const BASE_DIR = process.argv[2];
if (!BASE_DIR) {
  console.error("Usage: node scripts/filter-salesforce-export.js \"/path/to/TEST DATA\"");
  process.exit(1);
}

const FULL_COPY_DIR = path.join(BASE_DIR, "WE_00D5w000002rxCXEAY_1 copy");

// ── Helpers ─────────────────────────────────────────────────────────
function readCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ File not found: ${path.basename(filePath)}`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const result = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    console.warn(`  ⚠ Parse warnings for ${path.basename(filePath)}:`, result.errors.slice(0, 3));
  }
  return result.data;
}

function writeCSV(rows, filePath) {
  if (!rows || rows.length === 0) {
    console.log(`  ⚠ No matching rows — skipping ${path.basename(filePath)}`);
    return;
  }
  const csv = Papa.unparse(rows);
  fs.writeFileSync(filePath, csv, "utf-8");
  console.log(`  ✅ ${path.basename(filePath)} → ${rows.length} rows`);
}

function filterRows(rows, column, idSet) {
  return rows.filter((r) => idSet.has(r[column]));
}

// ── Main ────────────────────────────────────────────────────────────
console.log("\n🔍 Salesforce Export Filter\n");
console.log(`📁 TEST DATA dir: ${BASE_DIR}`);
console.log(`📁 Full copy dir: ${FULL_COPY_DIR}\n`);

// Step 1: Load Account TEST.csv to get the account IDs
console.log("Step 1: Loading Account TEST.csv...");
const accountTestPath = path.join(BASE_DIR, "Account TEST.csv");
const accounts = readCSV(accountTestPath);
if (!accounts) {
  console.error("❌ Cannot find Account TEST.csv — this is required.");
  process.exit(1);
}

const accountIds = new Set(accounts.map((a) => a.Id));
console.log(`  Found ${accountIds.size} test accounts\n`);

// Step 2: Filter Contacts (from full copy if not already done)
// Check if Contacts TEST already exists as xlsx — we'll still create a CSV version from full data
console.log("Step 2: Filtering Contacts...");
const contactsFullPath = path.join(FULL_COPY_DIR, "Contact.csv");
const contacts = readCSV(contactsFullPath);
if (contacts) {
  const filteredContacts = filterRows(contacts, "AccountId", accountIds);
  writeCSV(filteredContacts, path.join(BASE_DIR, "Contact TEST.csv"));
  // Collect contact IDs for downstream filtering
  var contactIds = new Set(filteredContacts.map((c) => c.Id));
  console.log(`  Contact IDs collected: ${contactIds.size}\n`);
} else {
  var contactIds = new Set();
  console.log("");
}

// Step 3: Filter Opportunities
console.log("Step 3: Filtering Opportunities...");
const oppsFullPath = path.join(FULL_COPY_DIR, "Opportunity.csv");
const opps = readCSV(oppsFullPath);
if (opps) {
  const filteredOpps = filterRows(opps, "AccountId", accountIds);
  writeCSV(filteredOpps, path.join(BASE_DIR, "Opportunity TEST.csv"));
  var oppIds = new Set(filteredOpps.map((o) => o.Id));
  console.log(`  Opportunity IDs collected: ${oppIds.size}\n`);
} else {
  var oppIds = new Set();
  console.log("");
}

// Step 4: Filter Opportunity Line Items
console.log("Step 4: Filtering OpportunityLineItems...");
const oliPath = path.join(BASE_DIR, "OpportunityLineItem.csv");
const oliFallbackPath = path.join(FULL_COPY_DIR, "OpportunityLineItem.csv");
const oliRows = readCSV(oliPath) || readCSV(oliFallbackPath);
if (oliRows) {
  const filteredOLI = filterRows(oliRows, "OpportunityId", oppIds);
  writeCSV(filteredOLI, path.join(BASE_DIR, "OpportunityLineItem TEST.csv"));

  // Collect PricebookEntryIds for downstream
  var pricebookEntryIds = new Set(filteredOLI.map((o) => o.PricebookEntryId).filter(Boolean));
  console.log(`  PricebookEntry IDs collected: ${pricebookEntryIds.size}\n`);
} else {
  var pricebookEntryIds = new Set();
  console.log("");
}

// Step 5: Filter PricebookEntry (links Products to Pricebooks with prices)
console.log("Step 5: Filtering PricebookEntries...");
const pbeFullPath = path.join(FULL_COPY_DIR, "PricebookEntry.csv");
const pbeRows = readCSV(pbeFullPath);
if (pbeRows) {
  const filteredPBE = filterRows(pbeRows, "Id", pricebookEntryIds);
  writeCSV(filteredPBE, path.join(BASE_DIR, "PricebookEntry TEST.csv"));

  // Also collect Product2Ids used
  var productIds = new Set(filteredPBE.map((p) => p.Product2Id).filter(Boolean));
  console.log(`  Product IDs collected: ${productIds.size}\n`);
} else {
  var productIds = new Set();
  console.log("");
}

// Step 6: Copy Products (full — they're small, but also filter to relevant ones)
console.log("Step 6: Filtering Products...");
const productsPath = path.join(BASE_DIR, "Product2.csv");
const productsFallbackPath = path.join(FULL_COPY_DIR, "Product2.csv");
const productRows = readCSV(productsPath) || readCSV(productsFallbackPath);
if (productRows) {
  // Include all products since the catalog is small, but mark which are used
  writeCSV(productRows, path.join(BASE_DIR, "Product2 TEST.csv"));
  // Add all product IDs to set for completeness
  productRows.forEach((p) => productIds.add(p.Id));
  console.log("");
}

// Step 7: Copy Pricebook2 (full — just the pricebook definitions)
console.log("Step 7: Copying Pricebook2...");
const pb2Path = path.join(BASE_DIR, "Pricebook2.csv");
const pb2FallbackPath = path.join(FULL_COPY_DIR, "Pricebook2.csv");
const pb2Rows = readCSV(pb2Path) || readCSV(pb2FallbackPath);
if (pb2Rows) {
  writeCSV(pb2Rows, path.join(BASE_DIR, "Pricebook2 TEST.csv"));
  console.log("");
}

// Step 8: Filter Tasks (activity history — calls, todos, logged activities)
console.log("Step 8: Filtering Tasks (activity history)...");
const tasksFullPath = path.join(FULL_COPY_DIR, "Task.csv");
const tasks = readCSV(tasksFullPath);
if (tasks) {
  // Tasks link via AccountId, WhatId (account/opp), or WhoId (contact)
  const filteredTasks = tasks.filter((t) => {
    return accountIds.has(t.AccountId) ||
           accountIds.has(t.WhatId) ||
           oppIds.has(t.WhatId) ||
           contactIds.has(t.WhoId);
  });
  writeCSV(filteredTasks, path.join(BASE_DIR, "Task TEST.csv"));
  console.log("");
}

// Step 9: Filter Events (meetings, calendar events)
console.log("Step 9: Filtering Events (meetings)...");
const eventsFullPath = path.join(FULL_COPY_DIR, "Event.csv");
const events = readCSV(eventsFullPath);
if (events) {
  const filteredEvents = events.filter((e) => {
    return accountIds.has(e.AccountId) ||
           accountIds.has(e.WhatId) ||
           oppIds.has(e.WhatId) ||
           contactIds.has(e.WhoId);
  });
  writeCSV(filteredEvents, path.join(BASE_DIR, "Event TEST.csv"));
  console.log("");
}

// Step 10: Filter EmailMessages
console.log("Step 10: Filtering EmailMessages...");
const emailFullPath = path.join(FULL_COPY_DIR, "EmailMessage.csv");
const emails = readCSV(emailFullPath);
if (emails) {
  // EmailMessages link via RelatedToId (account/opp) or ParentId (case, but could be account)
  // Also via ActivityId which links to Task
  const taskIds = tasks ? new Set(tasks.filter((t) => {
    return accountIds.has(t.AccountId) || accountIds.has(t.WhatId) || oppIds.has(t.WhatId) || contactIds.has(t.WhoId);
  }).map((t) => t.Id)) : new Set();

  const filteredEmails = emails.filter((e) => {
    return accountIds.has(e.RelatedToId) ||
           oppIds.has(e.RelatedToId) ||
           taskIds.has(e.ActivityId) ||
           contactIds.has(e.RelatedToId);
  });
  writeCSV(filteredEmails, path.join(BASE_DIR, "EmailMessage TEST.csv"));
  console.log("");
}

// Step 11: Filter Notes
console.log("Step 11: Filtering Notes...");
const notesFullPath = path.join(FULL_COPY_DIR, "Note.csv");
const notes = readCSV(notesFullPath);
if (notes) {
  const filteredNotes = notes.filter((n) => {
    return accountIds.has(n.ParentId) ||
           accountIds.has(n.AccountId) ||
           oppIds.has(n.ParentId) ||
           contactIds.has(n.ParentId);
  });
  writeCSV(filteredNotes, path.join(BASE_DIR, "Note TEST.csv"));
  console.log("");
}

// Step 12: Filter Leads
console.log("Step 12: Filtering Leads...");
const leadsPath = path.join(BASE_DIR, "Lead.csv");
const leadsFallbackPath = path.join(FULL_COPY_DIR, "Lead.csv");
const leadRows = readCSV(leadsPath) || readCSV(leadsFallbackPath);
if (leadRows) {
  // Leads that converted to one of our test accounts
  const convertedLeads = leadRows.filter((l) => accountIds.has(l.ConvertedAccountId));
  // Also grab some unconverted leads for testing (first 10)
  const unconvertedLeads = leadRows.filter((l) => !l.IsConverted || l.IsConverted === "0" || l.IsConverted === "false").slice(0, 10);

  // Merge and deduplicate
  const leadMap = new Map();
  [...convertedLeads, ...unconvertedLeads].forEach((l) => leadMap.set(l.Id, l));
  const filteredLeads = Array.from(leadMap.values());

  writeCSV(filteredLeads, path.join(BASE_DIR, "Lead TEST.csv"));
  console.log("");
}

// Step 13: Copy Users (full — small and needed for owner mapping)
console.log("Step 13: Copying Users...");
const usersPath = path.join(BASE_DIR, "User.csv");
const usersFallbackPath = path.join(FULL_COPY_DIR, "User.csv");
const userRows = readCSV(usersPath) || readCSV(usersFallbackPath);
if (userRows) {
  writeCSV(userRows, path.join(BASE_DIR, "User TEST.csv"));
  console.log("");
}

// Step 14: Filter OpportunityContactRole (links contacts to opportunities)
console.log("Step 14: Filtering OpportunityContactRoles...");
const ocrFullPath = path.join(FULL_COPY_DIR, "OpportunityContactRole.csv");
const ocrRows = readCSV(ocrFullPath);
if (ocrRows) {
  const filteredOCR = ocrRows.filter((r) => oppIds.has(r.OpportunityId));
  writeCSV(filteredOCR, path.join(BASE_DIR, "OpportunityContactRole TEST.csv"));
  console.log("");
}

// Step 15: Filter OpportunityHistory (stage change history)
console.log("Step 15: Filtering OpportunityHistory...");
const ohFullPath = path.join(FULL_COPY_DIR, "OpportunityHistory.csv");
const ohRows = readCSV(ohFullPath);
if (ohRows) {
  const filteredOH = ohRows.filter((r) => oppIds.has(r.OpportunityId));
  writeCSV(filteredOH, path.join(BASE_DIR, "OpportunityHistory TEST.csv"));
  console.log("");
}

// ── Summary ─────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════");
console.log("📊 Summary");
console.log("═══════════════════════════════════════════");
console.log(`  Accounts:              ${accountIds.size}`);
console.log(`  Contacts:              ${contactIds.size}`);
console.log(`  Opportunities:         ${oppIds.size}`);
console.log(`  Products:              ${productIds.size}`);
console.log("");
console.log("All TEST files saved to:");
console.log(`  ${BASE_DIR}`);
console.log("\n✅ Done! Review the TEST files, then import into the CRM.\n");
