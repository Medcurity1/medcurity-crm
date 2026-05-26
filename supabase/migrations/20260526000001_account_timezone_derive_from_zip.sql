-- Canonicalize Account.timezone by deriving it from the zip code.
--
-- Why: the inline-editable timezone field on the Account detail page
-- has let reps type free-form values ("Eastern", "ET", "EST", etc.).
-- The app expects the canonical "US/{Region}" format the picklist uses.
-- Going forward the field is read-only and always derived from
-- shipping_zip (or billing_zip fallback) by the form / detail page;
-- this migration backfills existing rows so the value displayed
-- matches what the autofill would produce today.
--
-- Mirrors the JS lookup in src/lib/us-zip.ts (ZIP3 → state → tz).

begin;

create or replace function public.derive_timezone_from_zip(p_zip text)
returns text
language plpgsql
immutable
as $$
declare
  v_zip3  int;
  v_state text;
begin
  if p_zip is null or trim(p_zip) = '' then
    return null;
  end if;
  if substring(p_zip from 1 for 5) !~ '^\d{5}$' then
    return null;
  end if;
  v_zip3 := substring(p_zip from 1 for 3)::int;

  v_state := case
    when v_zip3 between  10 and  27 then 'MA'
    when v_zip3 between  28 and  29 then 'RI'
    when v_zip3 between  30 and  38 then 'NH'
    when v_zip3 between  39 and  39 then 'ME'
    when v_zip3 between  40 and  49 then 'ME'
    when v_zip3 between  50 and  59 then 'VT'
    when v_zip3 between  60 and  69 then 'CT'
    when v_zip3 between  70 and  89 then 'NJ'
    when v_zip3 between 100 and 149 then 'NY'
    when v_zip3 between 150 and 196 then 'PA'
    when v_zip3 between 197 and 199 then 'DE'
    when v_zip3 between 200 and 205 then 'DC'
    when v_zip3 between 206 and 219 then 'MD'
    when v_zip3 between 220 and 246 then 'VA'
    when v_zip3 between 247 and 268 then 'WV'
    when v_zip3 between 270 and 289 then 'NC'
    when v_zip3 between 290 and 299 then 'SC'
    when v_zip3 between 300 and 319 then 'GA'
    when v_zip3 between 320 and 339 then 'FL'
    when v_zip3 between 341 and 342 then 'FL'
    when v_zip3 between 344 and 349 then 'FL'
    when v_zip3 between 350 and 369 then 'AL'
    when v_zip3 between 370 and 385 then 'TN'
    when v_zip3 between 386 and 397 then 'MS'
    when v_zip3 between 398 and 399 then 'GA'
    when v_zip3 between 400 and 427 then 'KY'
    when v_zip3 between 430 and 459 then 'OH'
    when v_zip3 between 460 and 479 then 'IN'
    when v_zip3 between 480 and 499 then 'MI'
    when v_zip3 between 500 and 528 then 'IA'
    when v_zip3 between 530 and 549 then 'WI'
    when v_zip3 between 550 and 567 then 'MN'
    when v_zip3 between 570 and 577 then 'SD'
    when v_zip3 between 580 and 588 then 'ND'
    when v_zip3 between 590 and 599 then 'MT'
    when v_zip3 between 600 and 629 then 'IL'
    when v_zip3 between 630 and 658 then 'MO'
    when v_zip3 between 660 and 679 then 'KS'
    when v_zip3 between 680 and 693 then 'NE'
    when v_zip3 between 700 and 714 then 'LA'
    when v_zip3 between 716 and 729 then 'AR'
    when v_zip3 between 730 and 749 then 'OK'
    when v_zip3 between 750 and 799 then 'TX'
    when v_zip3 between 800 and 816 then 'CO'
    when v_zip3 between 820 and 831 then 'WY'
    when v_zip3 between 832 and 838 then 'ID'
    when v_zip3 between 840 and 847 then 'UT'
    when v_zip3 between 850 and 865 then 'AZ'
    when v_zip3 between 870 and 884 then 'NM'
    when v_zip3 between 889 and 898 then 'NV'
    when v_zip3 between 900 and 961 then 'CA'
    when v_zip3 between 967 and 968 then 'HI'
    when v_zip3 between 970 and 979 then 'OR'
    when v_zip3 between 980 and 994 then 'WA'
    when v_zip3 between 995 and 999 then 'AK'
    else null
  end;

  return case v_state
    when 'CT' then 'US/Eastern'  when 'DE' then 'US/Eastern'  when 'DC' then 'US/Eastern'
    when 'FL' then 'US/Eastern'  when 'GA' then 'US/Eastern'  when 'ME' then 'US/Eastern'
    when 'MD' then 'US/Eastern'  when 'MA' then 'US/Eastern'  when 'NH' then 'US/Eastern'
    when 'NJ' then 'US/Eastern'  when 'NY' then 'US/Eastern'  when 'NC' then 'US/Eastern'
    when 'OH' then 'US/Eastern'  when 'PA' then 'US/Eastern'  when 'RI' then 'US/Eastern'
    when 'SC' then 'US/Eastern'  when 'VT' then 'US/Eastern'  when 'VA' then 'US/Eastern'
    when 'WV' then 'US/Eastern'  when 'MI' then 'US/Eastern'  when 'IN' then 'US/Eastern'
    when 'KY' then 'US/Eastern'
    when 'AL' then 'US/Central'  when 'AR' then 'US/Central'  when 'IL' then 'US/Central'
    when 'IA' then 'US/Central'  when 'KS' then 'US/Central'  when 'LA' then 'US/Central'
    when 'MN' then 'US/Central'  when 'MS' then 'US/Central'  when 'MO' then 'US/Central'
    when 'NE' then 'US/Central'  when 'ND' then 'US/Central'  when 'OK' then 'US/Central'
    when 'SD' then 'US/Central'  when 'TN' then 'US/Central'  when 'TX' then 'US/Central'
    when 'WI' then 'US/Central'
    when 'CO' then 'US/Mountain' when 'ID' then 'US/Mountain' when 'MT' then 'US/Mountain'
    when 'NM' then 'US/Mountain' when 'UT' then 'US/Mountain' when 'WY' then 'US/Mountain'
    when 'AZ' then 'US/Arizona'
    when 'CA' then 'US/Pacific'  when 'NV' then 'US/Pacific'  when 'OR' then 'US/Pacific'
    when 'WA' then 'US/Pacific'
    when 'AK' then 'US/Alaska'
    when 'HI' then 'US/Hawaii'
    else null
  end;
end;
$$;

-- Backfill: shipping wins, fall back to billing. Only overwrite when
-- we can produce a value — never blank out an existing tz on a row
-- whose zip didn't map.
update public.accounts
   set timezone = derived
  from (
    select id,
           coalesce(
             public.derive_timezone_from_zip(shipping_zip),
             public.derive_timezone_from_zip(billing_zip)
           ) as derived
      from public.accounts
  ) src
 where accounts.id = src.id
   and src.derived is not null
   and (accounts.timezone is distinct from src.derived);

commit;
