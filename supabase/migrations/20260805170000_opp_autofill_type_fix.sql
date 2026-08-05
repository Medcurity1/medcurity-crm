-- ---------------------------------------------------------------------
-- Type fix for 20260805160000: accounts.lead_source is the
-- public.lead_source ENUM (20260413000001), not text. The write-back
-- trigger coalesced enum with text (42804, blocked every opp insert
-- carrying a lead source on staging within minutes of applying; caught
-- by the post-deploy live test, no user impact). Both trigger functions
-- re-emitted with plain enum assignments and the pointless text-guard
-- casts removed. Behavior identical to the 20260805160000 intent.
-- ---------------------------------------------------------------------

begin;

-- 1. Opp-create defaults (BEFORE INSERT) -------------------------------
create or replace function public.opp_create_fill_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct_source  public.lead_source;
  v_acct_detail  text;
  v_c_source     public.lead_source;
  v_c_detail     text;
begin
  -- Original Sales Rep: the owner at creation is the seller. The renewal
  -- generator sets this explicitly, so it is never null there; this
  -- covers human-created opps on every surface.
  if new.original_sales_rep_id is null then
    new.original_sales_rep_id := new.owner_user_id;
  end if;

  -- Lead Source: account first, then primary contact. Fill the detail
  -- text only alongside its source so the pair stays coherent.
  if new.lead_source is null and new.account_id is not null then
    select a.lead_source, a.lead_source_detail
      into v_acct_source, v_acct_detail
      from public.accounts a
     where a.id = new.account_id;

    if v_acct_source is not null then
      new.lead_source := v_acct_source;
      if new.lead_source_detail is null then
        new.lead_source_detail := v_acct_detail;
      end if;
    end if;
  end if;

  if new.lead_source is null and new.primary_contact_id is not null then
    select c.lead_source, c.lead_source_detail
      into v_c_source, v_c_detail
      from public.contacts c
     where c.id = new.primary_contact_id;

    if v_c_source is not null then
      new.lead_source := v_c_source;
      if new.lead_source_detail is null then
        new.lead_source_detail := v_c_detail;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 2. Blank-only account write-back (AFTER INSERT OR UPDATE) ------------
create or replace function public.opp_backfill_account_basics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    return null;
  end if;
  -- Fast no-op: nothing to give.
  if new.fte_count is null and nullif(new.fte_range, '') is null
     and new.lead_source is null then
    return null;
  end if;

  update public.accounts a
  set
    fte_count = coalesce(a.fte_count, new.fte_count),
    fte_range = coalesce(
      a.fte_range,
      nullif(new.fte_range, ''),
      public.fte_count_to_range(coalesce(a.fte_count, new.fte_count))
    ),
    -- Lead source pair moves together: detail only lands when the
    -- account is taking the source from this opp too.
    lead_source = coalesce(a.lead_source, new.lead_source),
    lead_source_detail = case
      when a.lead_source is null and new.lead_source is not null
        then coalesce(a.lead_source_detail, new.lead_source_detail)
      else a.lead_source_detail
    end
  where a.id = new.account_id
    and (
      (a.fte_count is null and new.fte_count is not null)
      or (a.fte_range is null
          and (nullif(new.fte_range, '') is not null or new.fte_count is not null))
      or (a.lead_source is null and new.lead_source is not null)
    );

  return null;
end;
$$;

commit;

notify pgrst, 'reload schema';
