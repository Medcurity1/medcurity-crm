-- ---------------------------------------------------------------------
-- Pin search_path on the three functions added in
-- 20260601152933_financial_saas_metrics_quarterly_fn to clear the
-- function_search_path_mutable advisor warning.
--
-- Pure metadata change; no behavioral difference for callers.
-- ---------------------------------------------------------------------

alter function public.quarter_start(date)                            set search_path = public;
alter function public.quarter_end(date)                              set search_path = public;
alter function public.f_financial_saas_metrics_quarterly(date, date) set search_path = public;
