-- ---------------------------------------------------------------------
-- Private meddy:dashboard realtime channel (overnight audit follow-up).
--
-- The staff dashboard broadcast channel carries visitor message previews
-- and staff names, but was a PUBLIC broadcast topic — anyone holding the
-- publishable anon key could subscribe and listen. The edge functions now
-- send it with private:true and the dashboard subscribes with
-- private:true; this policy is the authorization gate: only active staff
-- may receive it. The per-visitor widget channels (meddy:conv:<id>)
-- deliberately stay public — anonymous visitors subscribe to their own
-- conversation events with the anon key.
--
-- Sending is unaffected: the edge functions broadcast with the service
-- role, which bypasses RLS.
-- ---------------------------------------------------------------------

begin;

drop policy if exists "meddy_dashboard_staff_broadcast_read" on realtime.messages;
create policy "meddy_dashboard_staff_broadcast_read" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'meddy:dashboard'
    and realtime.messages.extension = 'broadcast'
    and public.current_app_role() is not null
  );

commit;
