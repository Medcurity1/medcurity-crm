-- Meddy: admin-editable "team notes" that supplement the crawled website
-- knowledge. Meddy only knows the public marketing site (auto-crawled into
-- meddy_kb_content.content nightly), so it has no source for in-app workflows
-- (e.g. how to approve a policy in app.medcurity.com) and guesses — wrongly.
--
-- This adds a manual_content column the team edits in Settings → Meddy. It is
-- injected into Meddy's system prompt as AUTHORITATIVE (trusted over the
-- crawled site content) and is NOT touched by the crawl (meddy-crawl only
-- updates `content`), so it survives the nightly recrawl.
--
-- Seeds the policy-approval correction (Rachel, 2026-06-22).

begin;

alter table public.meddy_kb_content
  add column if not exists manual_content text not null default '';

update public.meddy_kb_content
   set manual_content = $seed$POLICY APPROVAL WORKFLOW (Medcurity platform — authoritative; trust this over anything on the website):
- To ADOPT / APPROVE a policy: open the policy, make any needed edits, then click Save. After saving, return to the main policy dashboard — from there you will see an "Approve" option for that policy. Saving a policy alone does NOT approve it; approval is a separate step on the dashboard.
- The "Archive" button is for REMOVING policies you do not want to use. It is NOT how you adopt or approve a policy.
- When a policy is approved, the platform records WHO approved it and the date and time — both the approver and an approval timestamp are saved.$seed$
 where id = 1
   and (manual_content is null or btrim(manual_content) = '');

commit;

notify pgrst, 'reload schema';
