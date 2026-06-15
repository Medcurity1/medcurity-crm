-- Seed task-email preferences for the two active reps to what they asked
-- for, so the digest "just works" without a settings hunt:
--   Molly Miller  → daily digest ON, per-task reminder emails OFF
--   Summer Hume   → both ON
-- Everyone else keeps the defaults (per-task on, digest off); they can
-- opt into the digest in My Settings → Notifications any time.
--
-- Pref keys (read by task-digest and task-reminders):
--   email_task_digest     true  → send the morning digest (opt-in)
--   email_task_per_task   false → suppress per-task reminder emails
--                                 (default/absent = send, today's behavior)
--
-- Idempotent: merges the keys into the existing prefs row, creating it if
-- absent. No-ops cleanly if a name doesn't resolve.

do $$
declare
  v_molly uuid;
  v_summer uuid;
begin
  select id into v_molly  from public.user_profiles where full_name = 'Molly Miller' limit 1;
  select id into v_summer from public.user_profiles where full_name = 'Summer Hume'  limit 1;

  if v_molly is not null then
    insert into public.user_notification_prefs (user_id, prefs)
    values (v_molly, jsonb_build_object('email_task_digest', true, 'email_task_per_task', false))
    on conflict (user_id) do update
      set prefs = coalesce(public.user_notification_prefs.prefs, '{}'::jsonb)
        || jsonb_build_object('email_task_digest', true, 'email_task_per_task', false);
  end if;

  if v_summer is not null then
    insert into public.user_notification_prefs (user_id, prefs)
    values (v_summer, jsonb_build_object('email_task_digest', true, 'email_task_per_task', true))
    on conflict (user_id) do update
      set prefs = coalesce(public.user_notification_prefs.prefs, '{}'::jsonb)
        || jsonb_build_object('email_task_digest', true, 'email_task_per_task', true);
  end if;
end $$;
