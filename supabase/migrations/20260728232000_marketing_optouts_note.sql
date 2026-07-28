-- marketing_optouts: a place for the admin's reason-in-their-own-words
-- (docket I33). The new "Opt out of marketing" admin action writes
-- reason='manual' rows; unlike webhook/sweep rows (which carry their
-- context in reason+source+campaign linkage), a manual opt-out's context
-- lives only in the admin's head — give it a column.

begin;

alter table public.marketing_optouts
  add column if not exists note text;

comment on column public.marketing_optouts.note is
  'Free-text context entered by the admin who created a manual opt-out (docket I33). Null for webhook/sweep-written rows.';

commit;

-- PostgREST must see the new objects immediately — without this, the
-- deploy window can 404 the RPCs (PGRST202), which for the launch-claims
-- function means every launch fails until the schema cache refreshes.
notify pgrst, 'reload schema';
