-- ============================================================
-- Joe (2026-07-14): Lead Source must be a CHANNEL, not a lifecycle stage.
--
-- Problem: the Source picklists mixed channels (Website, Referral, …) with
-- lifecycle stages (MQL, SQL), so any channel split computed from the field
-- is contaminated by rows where someone used it to mean stage. Stage already
-- has a proper home: leads.qualification (unqualified/mql/sql/sal) and
-- contacts.mql_date / sql_date.
--
-- This migration:
--   1) Retires 'mql'/'sql' as selectable Source options (picklist_options
--      is_active=false — the SF-style retire that preserves history). The
--      few hardcoded dropdowns are fixed in the same commit.
--   2) Seeds accounts.lead_source picklist rows — AccountForm now uses the
--      admin-managed picklist like the other source fields.
--   3) Migrates rows that used Source as a stage:
--        leads:         source mql/sql → qualification (never downgrades a
--                       stronger existing qualification), then source cleared.
--        contacts:      lead_source mql/sql → mql_date/sql_date backfilled
--                       from created_at ONLY when the date is missing (the
--                       source was set at creation; contacts promoted from
--                       leads already carry real dates), then cleared.
--        opportunities/accounts: lead_source mql/sql → cleared.
--      Cleared means NULL ("unattributed"), NOT 'other' — remapping stage
--      rows into a real channel bucket would corrupt the exact channel
--      split Joe is asking for. Cleared opps stay editable: the Lead Source
--      required-field rule only applies on create (grandfather rule,
--      20260710186000).
--
-- The pg enum public.lead_source keeps its mql/sql members (Postgres can't
-- drop enum values without a type rebuild); the deactivated options + this
-- data sweep make them unreachable, and PicklistSelect renders any
-- straggler as "(legacy)".
--
-- Idempotent: every statement re-runs safely (the sweeps match zero rows on
-- a second run).
-- ============================================================

begin;

-- ── 1. Retire mql/sql from every source picklist ──────────────────────────
-- Covers both historical field_key spellings for leads (seeds used
-- leads.lead_source; the form/report code reads leads.source).
update public.picklist_options
   set is_active = false
 where value in ('mql', 'sql')
   and field_key in (
     'leads.source', 'leads.lead_source',
     'contacts.lead_source',
     'opportunities.lead_source',
     'accounts.lead_source'
   );

-- ── 2. Seed accounts.lead_source from the opportunity channel list ────────
-- (Runs after the retire above so mql/sql don't copy over. Any channel an
-- admin later adds for opportunities can be added for accounts in the
-- Picklists admin the same way.)
insert into public.picklist_options (field_key, value, label, sort_order)
select 'accounts.lead_source', value, label, sort_order
  from public.picklist_options
 where field_key = 'opportunities.lead_source'
   and is_active
on conflict (field_key, value) do nothing;

-- ── 3a. Leads: source-as-stage → qualification, source cleared ────────────
-- The per-row audit trigger is paused for this sweep only: bulk-imported
-- lead lists can hold thousands of rows and each audit entry snapshots the
-- full lead twice. A single compact recovery record (below) preserves the
-- before-state instead. Contacts/opportunities/accounts keep their normal
-- per-row audit trail (small, business-critical).
alter table public.leads disable trigger trg_leads_audit;

do $$
declare
  v_moved int;
  v_txt   int;
begin
  -- Compact recovery record: which leads, what their source/qualification was.
  insert into public.audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  select 'leads', gen_random_uuid(), 'UPDATE', null,
         jsonb_build_object(
           'bulk_migration', '20260715150000_lead_source_channel_only',
           'what', 'source mql/sql moved into qualification; source cleared',
           'rows', jsonb_agg(jsonb_build_object(
             'id', id, 'source', source, 'qualification', qualification))
         ),
         null
    from public.leads
   where source in ('mql', 'sql')
  having count(*) > 0;

  update public.leads
     set qualification = case
           -- never downgrade: sql wins over mql wins over unqualified/null
           when source = 'sql' and (qualification is null or qualification in ('unqualified', 'mql'))
             then 'sql'::public.lead_qualification
           when source = 'mql' and (qualification is null or qualification = 'unqualified')
             then 'mql'::public.lead_qualification
           else qualification
         end,
         source = null
   where source in ('mql', 'sql');
  get diagnostics v_moved = row_count;

  -- Legacy text column (added by 20260424000001, unused by the app) — clear
  -- the same stage values so nothing can ever resurface them.
  update public.leads
     set lead_source = null
   where lead_source in ('mql', 'sql');
  get diagnostics v_txt = row_count;

  raise notice 'lead_source cleanup: % leads moved off stage-valued source (see audit_logs recovery record); % legacy text-column values cleared', v_moved, v_txt;
end $$;

alter table public.leads enable trigger trg_leads_audit;

-- ── 3b. Contacts: stage → mql_date/sql_date (only when missing), cleared ──
do $$
declare v_n int;
begin
  update public.contacts
     set mql_date = case when lead_source = 'mql' then coalesce(mql_date, created_at::date) else mql_date end,
         sql_date = case when lead_source = 'sql' then coalesce(sql_date, created_at::date) else sql_date end,
         lead_source = null
   where lead_source in ('mql', 'sql');
  get diagnostics v_n = row_count;
  raise notice 'lead_source cleanup: % contacts moved off stage-valued source (dates backfilled from created_at only where missing)', v_n;
end $$;

-- ── 3c. Opportunities: stage values cleared (→ unattributed) ──────────────
do $$
declare v_n int;
begin
  update public.opportunities
     set lead_source = null
   where lead_source in ('mql', 'sql');
  get diagnostics v_n = row_count;
  raise notice 'lead_source cleanup: % opportunities cleared to unattributed', v_n;
end $$;

-- ── 3d. Accounts: stage values cleared (→ unattributed) ───────────────────
do $$
declare v_n int;
begin
  update public.accounts
     set lead_source = null
   where lead_source in ('mql', 'sql');
  get diagnostics v_n = row_count;
  raise notice 'lead_source cleanup: % accounts cleared to unattributed', v_n;
end $$;

commit;
