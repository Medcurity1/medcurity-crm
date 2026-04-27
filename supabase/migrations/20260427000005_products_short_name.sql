-- ---------------------------------------------------------------------
-- Add products.short_name for opportunity auto-naming.
--
-- The opportunity form auto-suggests a name by joining product
-- abbreviations like "CO Training | SRA | Remote Services". Today it
-- uses products.code which after the post-migration rename now
-- contains slugs ("compliance-officer-training") rather than the SF
-- abbreviations users want to see.
--
-- short_name is editable from the Products admin page. When set, the
-- opp auto-name uses it. When NULL, falls back to code, then name.
-- ---------------------------------------------------------------------

begin;

alter table public.products
  add column if not exists short_name text;

comment on column public.products.short_name is
  'Optional short abbreviation used when joining product names into an opportunity name. Falls back to code, then name.';

-- Best-effort backfill so the auto-naming starts working immediately
-- on common products. Admins can edit any of these via Products admin.
update public.products
set short_name = case lower(coalesce(code, name))
  -- Training products
  when 'compliance-officer-training' then 'CO Training'
  when 'co-training'                 then 'CO Training'
  when 'employee-hipaa-training'     then 'GE Training'
  when 'general-employee-training'   then 'GE Training'
  when 'ge-training'                 then 'GE Training'
  when 'phishing-training'           then 'Phishing'

  -- Risk Assessment + Analysis
  when 'security-risk-assessment'                    then 'SRA'
  when 'security-risk-analysis'                      then 'SRA'
  when 'security-risk-analysis-services-remote'      then 'Remote Services'
  when 'remote-services'                             then 'Remote Services'
  when 'security-risk-analysis-services-onsite'      then 'Onsite Services'
  when 'onsite-services'                             then 'Onsite Services'
  when 'safer-assessment'                            then 'SAFER Assessment'
  when 'safer-ehr-self-assessment'                   then 'SAFER Assessment'

  -- Other common
  when 'business-associate-agreement'   then 'BAA'
  when 'baa'                            then 'BAA'
  when 'policy-and-procedures'          then 'P+P'
  when 'policies-and-procedures'        then 'P+P'
  when 'p-and-p'                        then 'P+P'
  when 'network-vulnerability-assessment' then 'NVA'
  when 'nva'                            then 'NVA'
  when 'basic-network-vulnerability-assessment' then 'BNVA'
  when 'bnva'                           then 'BNVA'
  when 'custom-service'                 then 'Custom Service'

  else null
end
where short_name is null;

commit;
