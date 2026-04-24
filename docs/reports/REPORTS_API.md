# Standard Reports API

Every standard report is backed by a Postgres view that you can query
directly via the Supabase REST API. This is how the financial
spreadsheet and any other downstream tool should pull data.

## Base URL

```
https://<PROJECT_REF>.supabase.co/rest/v1/<VIEW_NAME>
```

- Staging: `<STAGING_PROJECT_REF>.supabase.co`
- Prod:    `<PROD_PROJECT_REF>.supabase.co`

(Project refs are in Supabase Dashboard → Project Settings → General.)

## Authentication

Include these headers on every request:

```
apikey:        <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
```

Use the **anon** key for read-only access. RLS is enabled on the
underlying tables — the view inherits that policy.

For the financial spreadsheet a simpler option: use the **service_role
key** in a server-side script (NOT in the spreadsheet itself — the
spreadsheet should go through a small proxy or Google Apps Script that
holds the key). The service_role key bypasses RLS, so it will see all
rows regardless of who the caller is.

## Views

### `v_arr_base_dataset`

Every ARR-relevant opportunity. Matches SF "ARR Base Dataset" report.

**Columns:** `account_name, account_number, opportunity_name,
opportunity_owner, owner_role, created_date, close_date, age, amount,
fiscal_period, payment_frequency, one_time_project, stage, type,
account_type, primary_partner, lead_source, probability, next_step,
account_id, owner_user_id`

**Filters (examples):**
```
?close_date=gte.2026-01-01&close_date=lte.2026-03-31
?stage=eq.closed_won
?type=eq.New%20Business
?limit=5000
```

### `v_arr_rolling_365`

Monthly closed-won revenue + trailing-365-day ARR. Feeds the "ARR by
Quarter" chart on the Team Dashboard.

**Columns:** `month_start, fiscal_period, closed_won_amount,
deal_count, trailing_365_arr`

### `v_new_customers_qtd`

New Business closed-won in the current fiscal quarter.

**Columns:** `opportunity_owner, account_name, opportunity_name, type,
amount, close_date, lead_source, fiscal_period, account_id,
owner_user_id`

### `v_lost_customers_qtd`

Existing Business closed-lost this quarter on inactive accounts.

**Columns:** `account_name, opportunity_name, stage, account_status,
fiscal_period, amount, probability, age, close_date, created_date,
next_step, lead_source, type, account_id`

### `v_active_pipeline`

All open opportunities (not Closed Won / Closed Lost).

**Columns:** `stage, type, opportunity_name, account_name, close_date,
amount, probability, weighted_amount, opportunity_owner, account_id,
owner_user_id`

### `v_renewals_qtd`

Existing Business closed-won this fiscal quarter (excludes EHR
Implementation).

**Columns:** `owner_role, opportunity_owner, account_name,
opportunity_name, stage, fiscal_period, amount, probability, age,
close_date, created_date, next_step, lead_source, type, account_id,
owner_user_id`

### `v_sql_accounts`

Contacts qualified as SQL, joined to their account.

**Columns:** `contact_id, account_id, first_name, last_name, title,
account_name, account_owner, account_created_date, lead_source,
description, sql_date, mql_date`

### `v_mql_contacts`

Marketable contacts with MQL date, not yet SQL.

**Columns:** `contact_id, first_name, last_name, title, account_name,
phone, mobile, email, account_owner, mql_date, account_id`

### `v_mql_leads_qtd`

Leads with MQL date this fiscal quarter, not yet converted.

**Columns:** `lead_id, lead_source, first_name, last_name, title,
email, phone, mobile, lead_owner, mql_date, do_not_market_to, status,
owner_user_id`

### `v_mql_dedup`

Unique MQL people across leads + contacts. Deduplicated by email →
phone → name+account. Earliest MQL date wins.

**Columns:** `dedup_key, earliest_source_kind, earliest_source_id,
earliest_mql_date`

### `v_dashboard_metrics`

Single-row scalar summary for the Team Dashboard.

**Columns:**
- `current_arr` — trailing-365-day ARR
- `new_customers_qtd` / `new_customer_amount_qtd`
- `renewals_qtd` / `renewals_amount_qtd`
- `pipeline_count` / `pipeline_amount` / `pipeline_weighted_amount`
- `lost_customers_qtd` / `lost_customer_amount_qtd`
- `starting_customers` / `starting_arr` (base for NRR calcs)
- `churn_customers_qtd` / `churn_amount_qtd`
- `nrr_by_customer_legacy_pct` / `nrr_by_dollar_legacy_pct`
  — `1 − churn%` formulas matching the dashboard today
- `nrr_by_customer_true_pct` / `nrr_by_dollar_true_pct`
  — `(starting − churn) / starting`, the conventional formula
- `sql_qtd` / `mql_leads_qtd` / `mql_contacts_qtd` / `mql_unique_qtd`

## Google Sheets / Excel integration

For direct Google Sheets integration, use the `IMPORTDATA` function:

```
=IMPORTDATA("https://<ref>.supabase.co/rest/v1/v_arr_base_dataset?select=*&apikey=<anon_key>")
```

**WARNING:** `IMPORTDATA` exposes the API key to anyone with the sheet.
For production spreadsheets, use a Google Apps Script that fetches
server-side and pastes the result — the key stays in Script properties
instead of the sheet.

Example Apps Script template:

```javascript
function refreshArrBaseDataset() {
  const SUPABASE_URL = PropertiesService.getScriptProperties()
    .getProperty('SUPABASE_URL');
  const ANON_KEY = PropertiesService.getScriptProperties()
    .getProperty('SUPABASE_ANON_KEY');
  const res = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/v_arr_base_dataset?select=*',
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + ANON_KEY,
      },
    }
  );
  const rows = JSON.parse(res.getContentText());
  if (!rows.length) return;
  const header = Object.keys(rows[0]);
  const data = [header, ...rows.map(r => header.map(k => r[k] ?? ''))];
  const sheet = SpreadsheetApp.getActive().getSheetByName('ARR Base');
  sheet.clearContents();
  sheet.getRange(1, 1, data.length, header.length).setValues(data);
}
```

Set a time-based trigger (e.g. daily at 6am) so the spreadsheet
auto-refreshes.

## Fiscal period convention

All `_qtd` views filter to the **current calendar quarter**
(Jan-Mar = Q1, Apr-Jun = Q2, Jul-Sep = Q3, Oct-Dec = Q4). To change
Medcurity to a custom fiscal year, edit
`public.current_fiscal_quarter_start()` and `_end()` functions in
`supabase/migrations/20260424000001_standard_report_views.sql`.

## Type mapping

SF `Type` picklist → CRM `opportunities.kind`:

| SF value            | CRM kind       |
|---------------------|----------------|
| `New Business`      | `new_business` |
| `Existing Business` | `renewal`      |
| (blank / other)     | (null)         |

The views return the SF-style string in the `type` column so CSV
exports and downstream pivots see the familiar labels.
