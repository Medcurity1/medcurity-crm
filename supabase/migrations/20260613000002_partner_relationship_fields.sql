-- Partner relationship fields (#8) + account "last contact" view (#3).
-- From Jordan M's doc: partner accounts need a dedicated relationship
-- notes field and a partnership status, plus a Last Contact date on the
-- Partners list.

begin;

-- ── #8: relationship_notes + partnership_status ──────────────────────
-- relationship_notes is separate from the generic accounts.notes so
-- partner-relationship context doesn't get mixed with operational notes.
alter table public.accounts
  add column if not exists relationship_notes text,
  add column if not exists partnership_status text;

-- partnership_status is a managed picklist (admin-editable, like the
-- other account picklists) rather than a hard CHECK constraint.
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.partnership_status', 'active',          'Active',          10),
  ('accounts.partnership_status', 'in_conversation', 'In Conversation', 20),
  ('accounts.partnership_status', 'on_hold',         'On Hold',         30),
  ('accounts.partnership_status', 'inactive',        'Inactive',        40)
on conflict (field_key, value) do nothing;

-- Surface both on the account Detail page, in the existing
-- "Partner Information" section. Idempotent: only inserts placements
-- that aren't already there.
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  select id into v_layout_id from public.page_layouts
    where entity = 'accounts' and name = 'standard';
  if v_layout_id is not null then
    select id into v_section_id from public.page_layout_sections
      where layout_id = v_layout_id and title = 'Partner Information'
      order by sort_order limit 1;
    if v_section_id is not null then
      insert into public.page_layout_fields (section_id, field_key, sort_order, width)
      select v_section_id, 'partnership_status', 50, 'half'
      where not exists (
        select 1 from public.page_layout_fields
        where section_id = v_section_id and field_key = 'partnership_status');
      insert into public.page_layout_fields (section_id, field_key, sort_order, width)
      select v_section_id, 'relationship_notes', 60, 'full'
      where not exists (
        select 1 from public.page_layout_fields
        where section_id = v_section_id and field_key = 'relationship_notes');
    end if;
  end if;
end $$;

-- ── #3: per-account most-recent activity timestamp ───────────────────
-- Mirrors v_lead_last_activity (20260505000002). A view, not a
-- trigger-synced column, so there's nothing to keep in sync — the same
-- choice the lead "Last Contacted" column already made. Powers the
-- Partners list "Last Contact" column. SECURITY INVOKER (default) so
-- RLS on activities still applies to the caller.
create or replace view public.v_account_last_activity as
select
  a.account_id,
  max(a.completed_at) filter (where a.completed_at is not null) as last_activity_at
from public.activities a
where a.account_id is not null
group by a.account_id;

comment on view public.v_account_last_activity is
  'Per-account most-recent activity completed_at. Powers the Partners list "Last Contact" column (request #3).';

grant select on public.v_account_last_activity to authenticated;

commit;
