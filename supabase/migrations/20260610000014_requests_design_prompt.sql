-- ---------------------------------------------------------------------
-- Collateral requests: cache the generated Claude-design prompt.
--
-- The design-prompt generator (ported from OG Nexus) writes its output
-- here so reopening the request popup shows the prompt instantly instead
-- of re-billing the API. Regeneration overwrites it.
-- ---------------------------------------------------------------------

begin;

alter table public.requests
  add column if not exists design_prompt text;

commit;

notify pgrst, 'reload schema';
