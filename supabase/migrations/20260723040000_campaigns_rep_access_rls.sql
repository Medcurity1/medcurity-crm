-- ============================================================
-- Campaigns Phase 5 — rep-access RLS foundation (build now, flip later).
-- ----------------------------------------------------------------
-- Every campaign table today is admin-only (see 20260625000001's own
-- "Admin-only for now (matches the rest of the Campaigns/Playbook tab).
-- Phase 5 opens it to reps with their own RLS" note, and 20260722180000 /
-- 20260723020000 for campaign_events / campaign_suggestions). This
-- migration IS that Phase 5 — but only the backend half: additive SELECT
-- policies so a non-admin authenticated rep can read the campaigns,
-- enrollments, events, and templates they own. The matching write-side
-- ownership gates live in code, not SQL — see playbook-smartlead/index.ts's
-- callerCtx checks in launch()/setCampaignStatus()/setEnrollmentStatus().
--
-- NO UI CHANGE ships in this slice. The Campaigns tab stays behind
-- AdminGate (src/App.tsx, route "playbook") and ContactsList's own admin
-- check (src/features/contacts/ContactsList.tsx) — those two, plus the
-- edge function's own admin-or-service-role gate, are still the ONLY way a
-- browser reaches any of this today. The flip to give reps actual UI access
-- is a deliberate later decision that Nathan/Brayden make explicitly — when
-- it happens, search the codebase for "Rep rollout flip point" comments
-- (App.tsx, ContactsList.tsx, playbook-smartlead/index.ts) and adjust each
-- one; this RLS is already ready and needs no further migration.
--
-- What this migration does NOT do:
--   - No INSERT/UPDATE/DELETE policy for `authenticated` on any of these
--     tables — every write still goes exclusively through the
--     service-role playbook-smartlead edge function, same as before. A rep
--     reading their own row can never write it directly from the client.
--   - campaign_suggestions stays admin-only (AI-authored coaching notes;
--     not planned as a rep-facing surface even after the flip).
--   - No existing admin policy is touched or dropped — these are pure
--     additions. Postgres OR's multiple permissive policies for the same
--     command together, so admins keep exactly the access they have today;
--     a non-admin gains read access ONLY to rows they own (or, for
--     templates, presets).
--
-- auth.uid() is wrapped as (select auth.uid()) per the InitPlan convention
-- established in 20260721170000_wrap_rls_helper_calls.sql (STABLE/volatile
-- function calls in an RLS qual should be scalar-subselected so the planner
-- caches them once per query instead of re-evaluating per row).
--
-- Idempotent (drop-then-create); additive only.
--
-- To reverse: drop the four policies created below.
-- ============================================================

begin;

-- ── campaigns — a rep may read campaigns they own ───────────────────────────
drop policy if exists "campaigns_read_own" on public.campaigns;
create policy "campaigns_read_own"
  on public.campaigns
  for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

-- ── campaign_enrollments — a rep may read enrollments on campaigns they own ─
-- (owner_user_id is stamped onto the enrollment row itself at launch time —
-- see playbook-smartlead/index.ts's launch(), which always sets it from the
-- campaign's own owner_id — so this reads directly off the row rather than
-- joining back to campaigns.)
drop policy if exists "campaign_enrollments_read_own" on public.campaign_enrollments;
create policy "campaign_enrollments_read_own"
  on public.campaign_enrollments
  for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

-- ── campaign_events — no owner_user_id column here; go through the parent
-- campaign. campaign_id is nullable (an unresolved webhook event is still
-- logged for diagnosis) — those rows stay admin-only-visible, a rep gains
-- nothing from an event Pulse couldn't even attribute to a campaign.
drop policy if exists "campaign_events_read_own" on public.campaign_events;
create policy "campaign_events_read_own"
  on public.campaign_events
  for select
  to authenticated
  using (
    campaign_id is not null
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_events.campaign_id
        and c.owner_user_id = (select auth.uid())
    )
  );

-- ── campaign_templates — presets are shared reading material for everyone;
-- a rep's own custom (non-preset) templates are theirs to see too.
drop policy if exists "campaign_templates_read_own" on public.campaign_templates;
create policy "campaign_templates_read_own"
  on public.campaign_templates
  for select
  to authenticated
  using (is_preset = true or owner_user_id = (select auth.uid()));

commit;

notify pgrst, 'reload schema';
