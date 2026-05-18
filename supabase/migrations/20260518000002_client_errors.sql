-- client_errors — telemetry sink for every mutation that fails on the
-- client. Catches the "I saved that call last week but it's not there"
-- class of bug, where the rep didn't see (or didn't catch) the failure
-- toast and walked away thinking the save worked.
--
-- The frontend's MutationCache global onError fires log_client_error for
-- every TanStack mutation that throws, regardless of whether the local
-- caller also handled the error. That gives us a server-side trail that
-- survives the rep closing the tab.

begin;

create table if not exists public.client_errors (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  user_full_name text,
  route text,
  mutation_key text,
  error_message text,
  error_code text,
  error_details jsonb,
  payload_summary jsonb,
  user_agent text,
  app_version text
);

create index if not exists idx_client_errors_occurred_at
  on public.client_errors (occurred_at desc);
create index if not exists idx_client_errors_user_id
  on public.client_errors (user_id, occurred_at desc);
create index if not exists idx_client_errors_mutation_key
  on public.client_errors (mutation_key, occurred_at desc);

alter table public.client_errors enable row level security;

-- Anyone authenticated can INSERT their own row (logging their own
-- failure). They cannot read or update.
drop policy if exists "client_errors_self_insert" on public.client_errors;
create policy "client_errors_self_insert"
on public.client_errors
for insert
to authenticated
with check (user_id = auth.uid() or user_id is null);

-- Admins can read everything.
drop policy if exists "client_errors_admin_read" on public.client_errors;
create policy "client_errors_admin_read"
on public.client_errors
for select
to authenticated
using (public.is_admin());

-- RPC the frontend uses. SECURITY DEFINER so we can stamp the user info
-- consistently even if the caller forgot to pass it.
create or replace function public.log_client_error(
  p_mutation_key text,
  p_error_message text,
  p_error_code text default null,
  p_error_details jsonb default null,
  p_payload_summary jsonb default null,
  p_route text default null,
  p_user_agent text default null,
  p_app_version text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_email text;
  v_name text;
begin
  select up.email, up.full_name
    into v_email, v_name
  from public.user_profiles up
  where up.id = auth.uid();

  insert into public.client_errors (
    user_id, user_email, user_full_name,
    route, mutation_key,
    error_message, error_code, error_details, payload_summary,
    user_agent, app_version
  ) values (
    auth.uid(), v_email, v_name,
    p_route, p_mutation_key,
    -- Cap text fields so a runaway stack trace can't bloat the table.
    left(coalesce(p_error_message, ''), 2000),
    left(coalesce(p_error_code, ''), 100),
    p_error_details,
    p_payload_summary,
    left(coalesce(p_user_agent, ''), 500),
    left(coalesce(p_app_version, ''), 100)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_client_error(
  text, text, text, jsonb, jsonb, text, text, text
) to authenticated;

commit;
