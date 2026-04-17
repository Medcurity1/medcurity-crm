# Contract management spec

Covers the 4 real-world scenarios Brayden described 2026-04-17, how
they map to the data model, and what UI is built vs. still to build.

## The 4 scenarios

### 1. Fixed-term contract WITHOUT auto-renew language
- 1yr or 3yr signed agreement.
- Every renewal needs a fresh signature.
- **Migration goal**: Medcurity is updating these to scenario 2 over
  time so each renewal doesn't require chasing a signature.

**Data model:**
```
contract_type = 'signed_fixed_term'
has_auto_renew_clause = false
needs_new_signature_yearly = true
contract_start_date, contract_end_date set from the signed agreement
```

**Workflow:**
- Renewal automation creates Year N+1 opp on maturity.
- Sales sends a new DocuSign/PandaDoc.
- On Closed Won + file uploaded, the opp is marked signed.

### 2. Fixed-term contract WITH auto-renew language
- Original contract carries past the initial term until one side
  terminates within the notice window.

**Data model:**
```
contract_type = 'signed_auto_renew'
has_auto_renew_clause = true
needs_new_signature_yearly = false
contract_notice_days = e.g. 60 or 90
price_escalator_pct = e.g. 3.00 for annual 3% increase
```

**Workflow:**
- Renewal automation still creates Year N+1 opp for forecasting +
  CSM visibility.
- Renewal opp is pre-marked `created_by_automation = true` and
  inherits the parent's signed contract file.
- Renewals team can close it won without a new signature — the
  existing contract carries.

### 3. Invoice-only (no signed contract)
- Rare — customer just pays off an invoice with no MSA / order form.

**Data model:**
```
contract_type = 'invoice_only'
has_auto_renew_clause = false
needs_new_signature_yearly = false
No file upload required.
```

**Workflow:**
- Reports flag these so leadership can see the unsigned-contract
  revenue exposure at a glance.

### 4. Split contracts
- Customer buys multiple products/services at different times. Each
  one is its own agreement.

**Data model:**
```
First contract opp: standard
Subsequent opps: parent_contract_opportunity_id -> primary opp
                 contract_type = 'amendment'
```

**Workflow:**
- All children roll up to the parent for ARR reporting.
- Each child has its own file + dates + renewal cadence (may differ).
- Parent's "Contracts" tab shows children nested beneath it.

## What's built

### Schema (migration 20260417000010)
- `opportunities.contract_type` enum: signed_fixed_term /
  signed_auto_renew / invoice_only / amendment / other
- `opportunities.has_auto_renew_clause` boolean
- `opportunities.needs_new_signature_yearly` boolean
- `opportunities.parent_contract_opportunity_id` FK for splits
- `opportunities.contract_notice_days` integer
- `opportunities.billing_frequency_override` text
- `opportunities.price_escalator_pct` numeric
- `contract_files` table for signed PDFs:
  - `storage_path` (manual Supabase Storage uploads) OR
    `external_url` (PandaDoc doc URL, Box link, etc.)
  - `external_source` / `external_id` for dedup on webhook re-runs
  - `signed_at`, `uploaded_by`, `file_name`, `file_size_bytes`, `mime_type`
  - RLS: read for all authenticated, write for sales/renewals/admin/super_admin

### PandaDoc infrastructure (shipped earlier)
- Edge function `pandadoc-sync` receives webhooks for
  document_state_changed events
- Matches documents to CRM contacts + opportunities by recipient
  email + document name
- Stores in `pandadoc_documents` table with
  status/url/completed_date metadata
- Webhook signature verification + service-role DB writes

## What's still to build (in priority order)

### A. Contract form fields on the Opportunity edit page
Add a "Contract" section to `OpportunityForm.tsx` with:
- Contract Type dropdown
- Auto-renew checkbox (auto-sets `has_auto_renew_clause`)
- "Requires new signature yearly" checkbox
- Notice days
- Price escalator %
- Parent contract selector (for scenario 4)

### B. Manual contract file upload UI
On the Opportunity detail page, a "Contract Files" card with:
- List of files (external_url or storage_path)
- "Upload new file" button → Supabase Storage upload to a private
  bucket `contract-files/{opp_id}/{uuid}.{ext}`
- Signed-URL generation for reads (server-side RLS-scoped)
- Delete / archive

Storage setup required:
- Create bucket `contract-files` in Supabase Storage (private)
- RLS policies on `storage.objects`: read+write for users who can
  read the underlying opportunity

### C. PandaDoc → contract_files auto-link
Update `pandadoc-sync` webhook handler:
- On document_state_changed=document.completed, call PandaDoc API to
  get the download URL
- Write a `contract_files` row with `external_source='pandadoc'`,
  `external_id=<pandadoc id>`, `external_url`, `signed_at`
- Link to the matching opportunity via existing matching logic

### D. Contract-aware renewal automation (small tweak)
Current renewal automation creates a new opp on maturity regardless
of contract type. Improvement:
- When `parent.has_auto_renew_clause = true`, still create the child
  opp (for forecasting), but:
  - Pre-populate `contract_type = 'signed_auto_renew'`
  - Copy the parent's most recent `contract_files` row (link, not
    duplicate) so the same signed agreement travels forward

### E. Opportunity-level Contracts tab
Add a "Contracts" entry to the CollapsibleTabs on Opportunity detail
that shows:
- The signed file for THIS opportunity (if any)
- Children (if this is a parent of split contracts)
- A "View parent" link (if this is a child amendment)
- Plus the contract metadata fields for at-a-glance reference

### F. Reports
- Contracts missing signed files (compliance check)
- Contracts expiring in next N days WITHOUT auto-renew clause (needs
  re-signature action)
- Revenue on invoice_only contracts (risk exposure)
- Price-escalator coverage: % of ARR with escalators vs flat

## PandaDoc wiring checklist

To test: go to Admin → Integrations → PandaDoc. Need:
- `PANDADOC_API_KEY` set as Supabase secret
  (`supabase secrets set PANDADOC_API_KEY=<key>`)
- Webhook URL `https://baekcgdyjedgxmejbytc.supabase.co/functions/v1/pandadoc-sync`
  registered in PandaDoc's webhook settings
- Test: create + complete a doc in PandaDoc → within a few
  seconds a row appears in `pandadoc_documents` table; linked opp
  gets an activity entry; `contract_files` row is written (after
  change D ships).
