-- Website-inquiry bell (lead-type retirement piece 2, revised per Nathan
-- 7/20): the inbound-lead fn pings users whose
-- user_notification_prefs.prefs->>'website_inquiry_bell' resolves true.
-- OPT-IN key (absent = off), seeded ON for Nathan, Summer, and Molly —
-- anyone can flip it either way in My Settings → Notifications.
--
-- Idempotent; the WHERE on the conflict update means an explicit existing
-- choice (someone already flipped the switch) is never overwritten.

insert into public.user_notification_prefs (user_id, prefs)
select up.id, jsonb_build_object('website_inquiry_bell', true)
from public.user_profiles up
where coalesce(up.is_active, true)
  and (
    lower(up.full_name) like 'nathan %'
    or lower(up.full_name) like 'summer %'
    or lower(up.full_name) like 'molly %'
  )
on conflict (user_id) do update
  set prefs = public.user_notification_prefs.prefs
              || jsonb_build_object('website_inquiry_bell', true)
  where not (public.user_notification_prefs.prefs ? 'website_inquiry_bell');
