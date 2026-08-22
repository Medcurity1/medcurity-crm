begin;

-- Company-wide Campaigns launch: each authenticated user may resume only
-- their own builder draft. The existing admin policy remains unchanged.
drop policy if exists campaign_drafts_self on public.campaign_drafts;
create policy campaign_drafts_self
  on public.campaign_drafts
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Enrollment rows carry the contact owner, which may differ from the person
-- who owns the campaign. Let a campaign owner read every enrollment attached
-- to their campaign while preserving the existing contact-owner policy.
drop policy if exists campaign_enrollments_read_campaign_owner on public.campaign_enrollments;
create policy campaign_enrollments_read_campaign_owner
  on public.campaign_enrollments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.campaigns c
      where c.id = campaign_enrollments.campaign_id
        and c.owner_user_id = (select auth.uid())
    )
  );

commit;

notify pgrst, 'reload schema';
