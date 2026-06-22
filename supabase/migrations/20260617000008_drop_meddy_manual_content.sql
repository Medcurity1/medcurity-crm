-- Revert meddy_kb_content.manual_content (added in 20260617000007).
--
-- Meddy's training is its system prompt (meddy-prompt.ts) + the website crawl
-- — two sources, no settings box. The policy-approval correction now lives in
-- the system-prompt addendum (MEDDY_PROMPT_ADDENDUM), the established place for
-- post-Nexus training changes, so this extra editable field isn't needed.

begin;

alter table public.meddy_kb_content drop column if exists manual_content;

commit;

notify pgrst, 'reload schema';
