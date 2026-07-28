-- ============================================================
-- Merge retired partner-notes fields into the account Notes card.
--
-- Nathan (2026-07-27), follow-up to Summer's Partner tab cleanup: the tab no
-- longer shows accounts.relationship_notes or the per-partnership
-- account_partners.notes, so any text in them would be invisibly stranded.
-- Counted on prod BEFORE writing this (read-only REST):
--   accounts.relationship_notes non-empty ... 4
--   account_partners.notes non-empty ........ 2
--   (staging: 0 and 0 — this runs as a no-op there)
--
-- This MOVES the text into accounts.notes with a "Partner notes:" label and
-- clears the source, so a re-run finds empty sources and does nothing
-- (idempotent by construction). Per-partnership notes land on the
-- PARTNER-side account, tagged with the member account's name so the context
-- survives. Deliberately untouched: accounts.partnership_status (picklist,
-- not notes; 7 prod values) and account_partners.role (71 values) — retired
-- from display only, data kept.
-- ============================================================

begin;

-- 1) accounts.relationship_notes -> accounts.notes (append, labeled)
update public.accounts a
set notes = case
      when a.notes is null or btrim(a.notes) = '' then 'Partner notes: ' || a.relationship_notes
      else a.notes || E'\n\n' || 'Partner notes: ' || a.relationship_notes
    end,
    relationship_notes = null
where a.relationship_notes is not null
  and btrim(a.relationship_notes) <> '';

-- 2) account_partners.notes -> the partner-side account's notes, tagged with
--    the member account's name. string_agg handles a partner with several
--    noted relationships in one append.
update public.accounts a
set notes = case
      when a.notes is null or btrim(a.notes) = '' then merged.txt
      else a.notes || E'\n\n' || merged.txt
    end
from (
  select ap.partner_account_id as account_id,
         string_agg(
           'Partner notes (re: ' || coalesce(m.name, 'linked account') || '): ' || ap.notes,
           E'\n\n' order by ap.created_at
         ) as txt
  from public.account_partners ap
  left join public.accounts m on m.id = ap.member_account_id
  where ap.notes is not null and btrim(ap.notes) <> ''
  group by ap.partner_account_id
) merged
where a.id = merged.account_id;

update public.account_partners
set notes = null
where notes is not null and btrim(notes) <> '';

commit;
