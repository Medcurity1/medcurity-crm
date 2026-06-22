-- ============================================================
-- Contacts: No-Longer-Employed (NLE) + Do-Not-Call flags (V3-B)
-- ----------------------------------------------------------------
-- Two new plain booleans on contacts, independent of the existing
-- `do_not_contact` (the blanket no-outreach preference):
--
--   do_not_call        — call-suppression preference. The cold-call
--                        widget (V3-C) excludes these.
--   no_longer_employed — contact has left the company (NLE). Excluded
--                        from outreach but kept visible/searchable
--                        (unlike archive, which hides them). Set both
--                        by users in the form AND programmatically by
--                        the Cowork bounce handler (service-role key).
--
-- NLE is modeled as a BOOLEAN, not a status enum: contacts have no
-- status enum today (only archived_at), NLE is orthogonal to archive,
-- and a boolean is trivially settable by an external service.
-- Reversible: drop columns / drop indexes.
-- ============================================================

alter table public.contacts
  add column if not exists do_not_call boolean not null default false,
  add column if not exists no_longer_employed boolean not null default false,
  add column if not exists no_longer_employed_at timestamptz;

comment on column public.contacts.do_not_call is
  'Call-suppression preference, independent of do_not_contact. The cold-call list excludes these.';
comment on column public.contacts.no_longer_employed is
  'NLE — the contact has left the company. Excluded from outreach but stays visible/searchable (unlike archive). Settable by the Cowork bounce handler via the service-role key.';
comment on column public.contacts.no_longer_employed_at is
  'When no_longer_employed was last set true (stamped by the bounce handler / form). NULL when not NLE.';

-- Cheap partial indexes so the cold-call exclusion filter and any
-- "show me NLE contacts" report stay fast.
create index if not exists idx_contacts_do_not_call
  on public.contacts (id) where do_not_call;
create index if not exists idx_contacts_no_longer_employed
  on public.contacts (id) where no_longer_employed;

-- Keep no_longer_employed_at in sync no matter who writes the flag (form,
-- the RPC below, or a direct Cowork service-role UPDATE). Stamps now() the
-- moment NLE flips true; clears the timestamp when it's turned back off.
create or replace function public.stamp_contact_nle_at()
returns trigger
language plpgsql
as $$
begin
  if new.no_longer_employed and not coalesce(old.no_longer_employed, false) then
    new.no_longer_employed_at := coalesce(new.no_longer_employed_at, now());
  elsif not new.no_longer_employed then
    new.no_longer_employed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contacts_nle_stamp on public.contacts;
create trigger trg_contacts_nle_stamp
before insert or update on public.contacts
for each row
execute function public.stamp_contact_nle_at();

-- Convenience RPC so the Cowork bounce handler (or an admin) can flag a
-- contact NLE by any of its email slots in one atomic call, stamping the
-- timestamp. Runs as SECURITY DEFINER but is grantable to authenticated;
-- Cowork can equally use a direct service-role UPDATE (this is optional
-- hardening so Cowork need not know the multi-email column layout).
create or replace function public.mark_contact_nle(p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := lower(btrim(p_email));
  v_count integer;
begin
  if v_norm is null or v_norm = '' then
    return 0;
  end if;
  -- no_longer_employed_at is stamped by trg_contacts_nle_stamp.
  update public.contacts
     set no_longer_employed = true
   where lower(btrim(email))  = v_norm
      or lower(btrim(email2)) = v_norm
      or lower(btrim(email3)) = v_norm;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- SECURITY DEFINER + writes: strip the implicit PUBLIC execute grant so an
-- unauthenticated (anon) caller can't flip NLE flags via PostgREST.
revoke execute on function public.mark_contact_nle(text) from public;
grant execute on function public.mark_contact_nle(text) to authenticated, service_role;

notify pgrst, 'reload schema';
