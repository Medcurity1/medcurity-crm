-- ---------------------------------------------------------------------
-- v_dashboard_arr_financial: switch NRR (lost) calculation from
-- rolling-365 to current-quarter-to-date (QTD).
--
-- Background: the dashboard is a quarterly snapshot. NRR computed
-- over rolling-365 was including every churn from the prior 4
-- quarters as if they all happened this quarter, which made NRR
-- look much worse than the financial spreadsheet (which only
-- subtracts THIS quarter's churn).
--
-- New rule (mirrors spreadsheet's Summary!AE25 logic):
--   ARR (denominator)  = rolling-365 closed_won (unchanged — total
--                        annual recurring revenue we manage)
--   Lost (numerator)   = closed_lost in CURRENT QUARTER on accounts
--                        that previously had a closed_won  (true churn,
--                        bounded to the quarter being reported)
--
-- ARR_displayed stays as rolling-365 since that's the headline number
-- everyone watches. Only NRR's churn lookup window changes.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_dashboard_arr_financial as
with bounds as (
  select
    (current_date - interval '365 days')::date     as cutoff_365,
    public.current_fiscal_quarter_start()           as q_start,
    public.current_fiscal_quarter_end()             as q_end
),
won_365 as (
  -- Trailing 365 days of closed_won non-OTP. This is the ARR
  -- denominator (annual recurring revenue under management).
  select
    coalesce(sum(o.amount), 0)::numeric(14,2) as arr_amount,
    count(*)::int                              as won_count
  from public.opportunities o, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date > b.cutoff_365
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_won'
),
lost_qtd as (
  -- Current quarter only: closed_lost on accounts that had a prior
  -- closed_won. Mirrors spreadsheet's quarterly churn calc.
  select
    coalesce(sum(o.amount), 0)::numeric(14,2) as lost_amount,
    count(*)::int                              as lost_count
  from public.opportunities o, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date >= b.q_start
    and o.close_date <= b.q_end
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_lost'
    and o.kind = 'renewal'
    and exists (
      select 1
      from public.opportunities prior
      where prior.account_id = o.account_id
        and prior.archived_at is null
        and prior.stage = 'closed_won'
        and coalesce(prior.one_time_project, false) = false
        and prior.close_date is not null
        and prior.close_date < o.close_date
    )
)
select
  now()                                            as computed_at,
  -- Window bounds reported to the dashboard:
  -- arr_window_*  → covers the ARR (rolling-365) denominator
  -- lost_window_* → covers the lost-customers (QTD) numerator
  (select cutoff_365 from bounds)                  as window_start,        -- back-compat: legacy field name
  current_date                                     as window_end,          -- back-compat
  (select q_start from bounds)                     as lost_window_start,
  (select q_end from bounds)                       as lost_window_end,
  (select arr_amount from won_365)                 as arr,
  (select won_count from won_365)                  as won_count_rolling_365,
  (select lost_amount from lost_qtd)               as lost_amount_rolling_365,  -- back-compat field name
  (select lost_count from lost_qtd)                as lost_count_rolling_365,   -- back-compat field name
  case
    when (select arr_amount from won_365) > 0
      then (1 - (select lost_amount from lost_qtd) / nullif((select arr_amount from won_365), 0)) * 100
    else null
  end                                              as nrr_dollar_pct,
  case
    when (select won_count from won_365) > 0
      then (1 - (select lost_count from lost_qtd)::numeric / (select won_count from won_365)) * 100
    else null
  end                                              as nrr_customer_pct;

comment on view public.v_dashboard_arr_financial is
  'ARR (rolling 365) + NRR (denominator rolling-365, churn QTD only). Mirrors financial spreadsheet quarterly NRR rule. Updated 2026-04-27.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
