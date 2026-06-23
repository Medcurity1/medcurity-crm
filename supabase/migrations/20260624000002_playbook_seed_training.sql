-- Seed the 7 default Playbook training notes (verbatim from Nexus
-- server.js seedPlaybookTraining, 6886-6894). These are the brand-voice
-- hard rules that steer every AI generation. Idempotent: only inserts a
-- note that isn't already present.

begin;

insert into public.playbook_training (note, source)
select v.note, 'manual'
from (values
  ('Lead with the SRA (Security Risk Analysis) product in all positioning. SPSRA is a segment-specific variant, not the flagship.'),
  ('Never use fear tactics or scare language in any marketing copy.'),
  ('No em dashes in any content.'),
  ('CTA should be low-friction: ''Book a demo'' or ''Learn more'', not ''Act now'' or ''Don''t miss out''.'),
  ('Emails should be concise. First email under 150 words, follow-ups under 100 words.'),
  ('PhishRx is NOT live. Never include in public-facing copy.'),
  ('PolicyScan scans existing policies to auto-fill SRA questions, not the reverse.')
) as v(note)
where not exists (
  select 1 from public.playbook_training t where t.note = v.note
);

commit;
