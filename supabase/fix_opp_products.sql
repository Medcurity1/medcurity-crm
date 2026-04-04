-- Fix opportunity products: link using correct product codes (ASSESS, VENDOR, POLICY)
do $$
declare
  prod_assess_id uuid;
  prod_vendor_id uuid;
  prod_policy_id uuid;
  opp_tvfm_current uuid;
  opp_mvh uuid;
  opp_cascade uuid;
begin
  select id into prod_assess_id from public.products where code = 'ASSESS' limit 1;
  select id into prod_vendor_id from public.products where code = 'VENDOR' limit 1;
  select id into prod_policy_id from public.products where code = 'POLICY' limit 1;

  -- Find opps by SF ID
  select id into opp_tvfm_current from public.opportunities where sf_id = 'SF-O007' limit 1;
  select id into opp_mvh from public.opportunities where sf_id = 'SF-O008' limit 1;
  select id into opp_cascade from public.opportunities where sf_id = 'SF-O011' limit 1;

  if prod_assess_id is not null and opp_tvfm_current is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_tvfm_current, prod_assess_id, 1, 1980, 1980)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_vendor_id is not null and opp_tvfm_current is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_tvfm_current, prod_vendor_id, 1, 1500, 1500)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_assess_id is not null and opp_mvh is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_mvh, prod_assess_id, 1, 5000, 5000)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_vendor_id is not null and opp_mvh is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_mvh, prod_vendor_id, 1, 5000, 5000)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_policy_id is not null and opp_mvh is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_mvh, prod_policy_id, 1, 2500, 2500)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_assess_id is not null and opp_cascade is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_cascade, prod_assess_id, 1, 4800, 4800)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_vendor_id is not null and opp_cascade is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_cascade, prod_vendor_id, 1, 3000, 3000)
    on conflict (opportunity_id, product_id) do nothing;
  end if;

  if prod_policy_id is not null and opp_cascade is not null then
    insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
      (opp_cascade, prod_policy_id, 1, 2000, 2000)
    on conflict (opportunity_id, product_id) do nothing;
  end if;
end $$;

select count(*) as opp_products_count from public.opportunity_products;
