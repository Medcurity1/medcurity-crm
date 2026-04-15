-- Harden activities (soft-delete, archive policies), opportunity_stage_history
-- (missing write policies), archive_record/restore_record (extend to activities
-- + leads), and add missing audit triggers on automation_rules, price_books,
-- price_book_entries, account_contracts, pandadoc_documents.

begin;

-- -------------------------------------------------------------------
-- 1. activities: add soft-delete columns + scope select to non-archived
-- -------------------------------------------------------------------
alter table public.activities
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.user_profiles(id),
  add column if not exists archive_reason text;

create index if not exists idx_activities_archived_at
  on public.activities (archived_at);

drop policy if exists "activities_read_authenticated" on public.activities;
drop policy if exists "activities_read_active" on public.activities;
create policy "activities_read_active"
on public.activities
for select
to authenticated
using (archived_at is null or public.is_admin());

-- Delete policy (for hard-delete, admin only)
drop policy if exists "activities_delete_admin" on public.activities;
create policy "activities_delete_admin"
on public.activities
for delete
to authenticated
using (public.is_admin());

-- -------------------------------------------------------------------
-- 2. opportunity_stage_history: add missing INSERT / UPDATE / DELETE policies.
--    History is write-only from app code (via trigger), but we need explicit
--    policies so the trigger's insert passes RLS under invoker context.
-- -------------------------------------------------------------------
drop policy if exists "stage_history_insert_crm_roles" on public.opportunity_stage_history;
create policy "stage_history_insert_crm_roles"
on public.opportunity_stage_history
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

-- No UPDATE allowed on history (immutable log).
drop policy if exists "stage_history_update_none" on public.opportunity_stage_history;
create policy "stage_history_update_none"
on public.opportunity_stage_history
for update
to authenticated
using (false)
with check (false);

-- Only admin can delete history entries.
drop policy if exists "stage_history_delete_admin" on public.opportunity_stage_history;
create policy "stage_history_delete_admin"
on public.opportunity_stage_history
for delete
to authenticated
using (public.is_admin());

-- -------------------------------------------------------------------
-- 3. Extend archive_record / restore_record to cover activities + leads.
-- -------------------------------------------------------------------
create or replace function public.archive_record(
  target_table text,
  target_id uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() is null then
    raise exception 'Not authorized';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  execute format(
    'update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null',
    target_table
  )
  using reason, target_id;
end;
$$;

create or replace function public.restore_record(
  target_table text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can restore records';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  execute format(
    'update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1',
    target_table
  )
  using target_id;
end;
$$;

-- -------------------------------------------------------------------
-- 4. Missing audit triggers.
--    Already covered: accounts, contacts, products, opportunities,
--    opportunity_products, activities, leads.
--    Adding: automation_rules, price_books, price_book_entries,
--            pandadoc_documents.
--    Note: account_contracts is intentionally excluded because in this
--    schema it exists as a VIEW, and Postgres forbids row-level triggers
--    on views. The underlying table it draws from is already audited
--    through the accounts/opportunities triggers.
-- -------------------------------------------------------------------
do $$
declare
  v_relkind char;
begin
  -- Helper pattern: only install the trigger if the relation exists AND
  -- is an ordinary table (relkind = 'r') or partitioned table ('p').
  --
  -- We use pg_class.relkind directly because to_regclass() resolves views
  -- as well, and row-level triggers are illegal on views.

  select c.relkind into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'automation_rules';
  if v_relkind in ('r', 'p') then
    execute 'drop trigger if exists trg_automation_rules_audit on public.automation_rules';
    execute 'create trigger trg_automation_rules_audit
             after insert or update or delete on public.automation_rules
             for each row execute function public.log_row_change()';
  end if;

  select c.relkind into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'price_books';
  if v_relkind in ('r', 'p') then
    execute 'drop trigger if exists trg_price_books_audit on public.price_books';
    execute 'create trigger trg_price_books_audit
             after insert or update or delete on public.price_books
             for each row execute function public.log_row_change()';
  end if;

  select c.relkind into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'price_book_entries';
  if v_relkind in ('r', 'p') then
    execute 'drop trigger if exists trg_price_book_entries_audit on public.price_book_entries';
    execute 'create trigger trg_price_book_entries_audit
             after insert or update or delete on public.price_book_entries
             for each row execute function public.log_row_change()';
  end if;

  select c.relkind into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'pandadoc_documents';
  if v_relkind in ('r', 'p') then
    execute 'drop trigger if exists trg_pandadoc_documents_audit on public.pandadoc_documents';
    execute 'create trigger trg_pandadoc_documents_audit
             after insert or update or delete on public.pandadoc_documents
             for each row execute function public.log_row_change()';
  end if;
end $$;

commit;
