-- ---------------------------------------------------------------------
-- Seed default page layouts for all 7 entities.
-- Mirrors the CURRENT detail-page structure so nothing visually
-- changes on day 1. Admins can rearrange via the layout editor later.
--
-- IDEMPOTENCY: each entity's seed is wrapped in a guard that only
-- runs if no sections exist yet for that layout. Once an admin starts
-- customizing, re-runs of this migration won't clobber their changes.
-- ---------------------------------------------------------------------

begin;

-- Helper: seed a layout's sections + fields only if the layout has no sections yet.
-- p_fields format: array of (section_title, field_key, sort_order, width)
-- For now we use a procedural approach via DO blocks per entity.

-- ---------------------------------------------------------------------
-- ACCOUNTS
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('accounts', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'accounts' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Basic Information
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Basic Information', 1, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'name',                1, 'half'),
      (v_section_id, 'owner_user_id',       2, 'half'),
      (v_section_id, 'account_type',        3, 'half'),
      (v_section_id, 'account_number',      4, 'half'),
      (v_section_id, 'status',              5, 'half'),
      (v_section_id, 'lifecycle_status',    6, 'half'),
      (v_section_id, 'industry_category',   7, 'half'),
      (v_section_id, 'website',             8, 'half'),
      (v_section_id, 'parent_account_id',   9, 'half'),
      (v_section_id, 'priority_account',   10, 'half');

    -- Contact Information
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Contact Information', 2, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'phone',           1, 'half'),
      (v_section_id, 'phone_extension', 2, 'half');

    -- Address Information
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Address Information', 3, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, '__billing_address',  1, 'full'),
      (v_section_id, '__shipping_address', 2, 'full');

    -- Company Details
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Company Details', 4, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'fte_count',            1, 'half'),
      (v_section_id, 'fte_range',            2, 'half'),
      (v_section_id, 'employees',            3, 'half'),
      (v_section_id, 'number_of_providers',  4, 'half'),
      (v_section_id, 'locations',            5, 'half'),
      (v_section_id, 'annual_revenue',       6, 'half'),
      (v_section_id, 'timezone',             7, 'half');

    -- Contract & Renewal
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Contract & Renewal', 5, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'active_since',                    1, 'half'),
      (v_section_id, 'renewal_type',                    2, 'half'),
      (v_section_id, 'every_other_year',                3, 'half'),
      (v_section_id, 'do_not_auto_renew',               4, 'half'),
      (v_section_id, 'contracts',                       5, 'half'),
      (v_section_id, 'current_contract_start_date',     6, 'half'),
      (v_section_id, 'current_contract_end_date',       7, 'half'),
      (v_section_id, 'current_contract_length_months',  8, 'half'),
      (v_section_id, 'acv',                             9, 'half'),
      (v_section_id, 'lifetime_value',                 10, 'half'),
      (v_section_id, 'churn_amount',                   11, 'half'),
      (v_section_id, 'churn_date',                     12, 'half');

    -- Partner Information
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Partner Information', 6, false)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'partner_account',     1, 'half'),
      (v_section_id, 'partner_prospect',    2, 'half'),
      (v_section_id, 'lead_source',         3, 'half'),
      (v_section_id, 'lead_source_detail',  4, 'half');

    -- Additional Information
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Additional Information', 7, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'project',         1, 'half'),
      (v_section_id, 'do_not_contact',  2, 'half'),
      (v_section_id, 'description',     3, 'full'),
      (v_section_id, 'notes',           4, 'full'),
      (v_section_id, 'next_steps',      5, 'full');

    -- Salesforce History (detail-only, collapsed)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'Salesforce History', 8, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'sf_created_by',          1, 'half'),
      (v_section_id, 'sf_created_date',        2, 'half'),
      (v_section_id, 'sf_last_modified_by',    3, 'half'),
      (v_section_id, 'sf_last_modified_date',  4, 'half');

    -- System Information (detail-only, collapsed)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 9, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'created_by',  1, 'half'),
      (v_section_id, 'updated_by',  2, 'half'),
      (v_section_id, 'created_at',  3, 'half'),
      (v_section_id, 'updated_at',  4, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- CONTACTS
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('contacts', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'contacts' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Contact Details
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Contact Details', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'account_id',                1, 'full'),
      (v_section_id, 'first_name',                2, 'half'),
      (v_section_id, 'last_name',                 3, 'half'),
      (v_section_id, 'email',                     4, 'half'),
      (v_section_id, 'phone',                     5, 'half'),
      (v_section_id, 'phone_ext',                 6, 'half'),
      (v_section_id, 'title',                     7, 'half'),
      (v_section_id, 'department',                8, 'half'),
      (v_section_id, 'linkedin_url',              9, 'half'),
      (v_section_id, 'credential',               10, 'half'),
      (v_section_id, 'time_zone',                11, 'half'),
      (v_section_id, 'type',                     12, 'half'),
      (v_section_id, 'business_relationship_tag',13, 'half'),
      (v_section_id, 'lead_source',              14, 'half'),
      (v_section_id, 'owner_user_id',            15, 'half'),
      (v_section_id, 'mql_date',                 16, 'half'),
      (v_section_id, 'sql_date',                 17, 'half'),
      (v_section_id, 'is_primary',               18, 'half'),
      (v_section_id, 'do_not_contact',           19, 'half');

    -- Mailing Address
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Mailing Address', 2)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, '__mailing_address', 1, 'full');

    -- Notes & Next Steps
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Notes & Next Steps', 3, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'notes',      1, 'full'),
      (v_section_id, 'next_steps', 2, 'full');

    -- System Information (detail-only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 4, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'contact_number', 1, 'half'),
      (v_section_id, 'created_by',     2, 'half'),
      (v_section_id, 'updated_by',     3, 'half'),
      (v_section_id, 'created_at',     4, 'half'),
      (v_section_id, 'updated_at',     5, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- LEADS
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('leads', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'leads' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Lead Details
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Lead Details', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'first_name',                 1, 'half'),
      (v_section_id, 'last_name',                  2, 'half'),
      (v_section_id, 'email',                      3, 'half'),
      (v_section_id, 'phone',                      4, 'half'),
      (v_section_id, 'mobile_phone',               5, 'half'),
      (v_section_id, 'phone_ext',                  6, 'half'),
      (v_section_id, 'title',                      7, 'half'),
      (v_section_id, 'linkedin_url',               8, 'half'),
      (v_section_id, 'website',                    9, 'half'),
      (v_section_id, 'industry_category',         10, 'half'),
      (v_section_id, 'time_zone',                 11, 'half'),
      (v_section_id, 'credential',                12, 'half'),
      (v_section_id, 'rating',                    13, 'half'),
      (v_section_id, 'source',                    14, 'half'),
      (v_section_id, 'lead_source_detail',        15, 'half'),
      (v_section_id, 'type',                      16, 'half'),
      (v_section_id, 'project_segment',           17, 'half'),
      (v_section_id, 'business_relationship_tag', 18, 'half'),
      (v_section_id, 'priority_lead',             19, 'half'),
      (v_section_id, 'cold_lead',                 20, 'half'),
      (v_section_id, 'status',                    21, 'half'),
      (v_section_id, 'qualification',             22, 'half'),
      (v_section_id, 'mql_date',                  23, 'half'),
      (v_section_id, 'do_not_market_to',          24, 'half'),
      (v_section_id, 'do_not_contact',            25, 'half'),
      (v_section_id, 'owner_user_id',             26, 'half'),
      (v_section_id, 'project',                   27, 'full'),
      (v_section_id, 'description',               28, 'full');

    -- Company Info
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Company Info', 2)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'company',          1, 'half'),
      (v_section_id, 'employees',        2, 'half'),
      (v_section_id, 'annual_revenue',   3, 'half');

    -- Address
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Address', 3)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, '__lead_address', 1, 'full');

    -- Marketing & Pardot (collapsed by default; mostly read-only since Pardot writes to it)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Marketing & Pardot', 4, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width, read_only_on_form) values
      (v_section_id, 'score',                       1, 'half', true),
      (v_section_id, 'first_activity_date',         2, 'half', true),
      (v_section_id, 'pardot_last_activity_date',   3, 'half', true),
      (v_section_id, 'conversion_date',             4, 'half', true),
      (v_section_id, 'pardot_campaign',             5, 'half', true),
      (v_section_id, 'pardot_grade',                6, 'half', true),
      (v_section_id, 'pardot_score',                7, 'half', true),
      (v_section_id, 'pardot_url',                  8, 'half', true),
      (v_section_id, 'utm_source',                  9, 'half', true),
      (v_section_id, 'utm_medium',                 10, 'half', true),
      (v_section_id, 'utm_campaign',               11, 'half', true),
      (v_section_id, 'utm_content',                12, 'half', true),
      (v_section_id, 'utm_term',                   13, 'half', true),
      (v_section_id, 'pardot_comments',            14, 'full', true);

    -- Conversion Info (detail only — populated post-conversion)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'Conversion Info', 5, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'converted_at',              1, 'half'),
      (v_section_id, 'converted_account_id',      2, 'half'),
      (v_section_id, 'converted_contact_id',      3, 'half'),
      (v_section_id, 'converted_opportunity_id',  4, 'half');

    -- System Information (detail only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 6, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'created_by',  1, 'half'),
      (v_section_id, 'updated_by',  2, 'half'),
      (v_section_id, 'created_at',  3, 'half'),
      (v_section_id, 'updated_at',  4, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- OPPORTUNITIES
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('opportunities', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'opportunities' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Basic Info
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Basic Info', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'name',                      1, 'full'),
      (v_section_id, 'account_id',                2, 'half'),
      (v_section_id, 'primary_contact_id',        3, 'half'),
      (v_section_id, 'owner_user_id',             4, 'half'),
      (v_section_id, 'original_sales_rep_id',     5, 'half'),
      (v_section_id, 'assigned_assessor_id',      6, 'half'),
      (v_section_id, 'team',                      7, 'half'),
      (v_section_id, 'kind',                      8, 'half'),
      (v_section_id, 'business_type',             9, 'half'),
      (v_section_id, 'stage',                    10, 'half'),
      (v_section_id, 'probability',              11, 'half');

    -- Dates & Contract
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Dates & Contract', 2)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'expected_close_date',     1, 'half'),
      (v_section_id, 'close_date',              2, 'half'),
      (v_section_id, 'contract_start_date',     3, 'half'),
      (v_section_id, 'contract_end_date',       4, 'half'),
      (v_section_id, 'contract_signed_date',    5, 'half'),
      (v_section_id, 'contract_length_months',  6, 'half'),
      (v_section_id, 'contract_year',           7, 'half'),
      (v_section_id, 'cycle_count',             8, 'half'),
      (v_section_id, 'auto_renewal',            9, 'half');

    -- Financial (amount/subtotal read-only on form: auto-calculated)
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Financial', 3)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width, read_only_on_form, help_text) values
      (v_section_id, 'amount',             1, 'half', true,  'Auto-calculated from product line items minus discount'),
      (v_section_id, 'subtotal',           2, 'half', true,  'Auto-calculated sum of product line items'),
      (v_section_id, 'discount',           3, 'half', false, null),
      (v_section_id, 'promo_code',         4, 'half', false, null),
      (v_section_id, 'service_amount',     5, 'half', false, null),
      (v_section_id, 'product_amount',     6, 'half', false, null),
      (v_section_id, 'services_included',  7, 'half', false, null),
      (v_section_id, 'one_time_project',   8, 'half', false, null),
      (v_section_id, 'payment_frequency',  9, 'half', false, null);

    -- Source & Next Steps
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Source & Next Steps', 4)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'lead_source',         1, 'half'),
      (v_section_id, 'lead_source_detail',  2, 'half'),
      (v_section_id, 'next_step',           3, 'full'),
      (v_section_id, 'follow_up',           4, 'half'),
      (v_section_id, 'loss_reason',         5, 'full');

    -- FTE Snapshot
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'FTE Snapshot', 5)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'fte_count', 1, 'half'),
      (v_section_id, 'fte_range', 2, 'half');

    -- Notes & Description
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default)
    values (v_layout_id, 'Notes & Description', 6, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'description',            1, 'full'),
      (v_section_id, 'notes',                  2, 'full'),
      (v_section_id, 'created_by_automation',  3, 'half');

    -- Products (custom block — handled by MultiProductPicker)
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Products', 7)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, '__opportunity_products', 1, 'full');

    -- System Information (detail only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 8, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'created_by',  1, 'half'),
      (v_section_id, 'updated_by',  2, 'half'),
      (v_section_id, 'created_at',  3, 'half'),
      (v_section_id, 'updated_at',  4, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ACTIVITIES
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('activities', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'activities' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Activity Info
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Activity', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'activity_type',  1, 'half'),
      (v_section_id, 'subject',        2, 'full'),
      (v_section_id, 'body',           3, 'full'),
      (v_section_id, 'due_at',         4, 'half'),
      (v_section_id, 'completed_at',   5, 'half'),
      (v_section_id, 'priority',       6, 'half'),
      (v_section_id, 'owner_user_id',  7, 'half');

    -- Related Records (detail-only — set via the calling page)
    insert into public.page_layout_sections (layout_id, title, sort_order, detail_only)
    values (v_layout_id, 'Related Records', 2, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'account_id',     1, 'half'),
      (v_section_id, 'contact_id',     2, 'half'),
      (v_section_id, 'lead_id',        3, 'half'),
      (v_section_id, 'opportunity_id', 4, 'half');

    -- Reminders (form-only, only relevant for tasks; UI hides for non-task types)
    insert into public.page_layout_sections (layout_id, title, sort_order, form_only)
    values (v_layout_id, 'Reminders', 3, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'reminder_schedule', 1, 'half'),
      (v_section_id, 'reminder_at',       2, 'half'),
      (v_section_id, 'reminder_channels', 3, 'full');

    -- Email (detail only — populated for synced emails)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'Email', 4, false, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'email_direction', 1, 'half'),
      (v_section_id, 'email_from',      2, 'full'),
      (v_section_id, 'email_to',        3, 'full'),
      (v_section_id, 'email_cc',        4, 'full'),
      (v_section_id, 'email_html_body', 5, 'full');

    -- Call (detail only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'Call Details', 5, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'call_type',              1, 'half'),
      (v_section_id, 'call_disposition',       2, 'half'),
      (v_section_id, 'call_duration_seconds',  3, 'half');

    -- System Information (detail only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 6, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'created_at', 1, 'half'),
      (v_section_id, 'updated_at', 2, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('products', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'products' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    -- Details
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Details', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'name',            1, 'half'),
      (v_section_id, 'code',            2, 'half'),
      (v_section_id, 'product_family',  3, 'half'),
      (v_section_id, 'pricing_model',   4, 'half'),
      (v_section_id, 'has_flat_price',  5, 'half'),
      (v_section_id, 'default_arr',     6, 'half'),
      (v_section_id, 'is_active',       7, 'half'),
      (v_section_id, 'description',     8, 'full');

    -- System Information (detail only)
    insert into public.page_layout_sections (layout_id, title, sort_order, collapsed_by_default, detail_only)
    values (v_layout_id, 'System Information', 2, true, true)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'sf_id',       1, 'half'),
      (v_section_id, 'created_by',  2, 'half'),
      (v_section_id, 'updated_by',  3, 'half'),
      (v_section_id, 'created_at',  4, 'half'),
      (v_section_id, 'updated_at',  5, 'half');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PARTNERS (account_partners junction — used in PartnersPage)
-- ---------------------------------------------------------------------
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  insert into public.page_layouts (entity, name, is_default, is_locked)
  values ('account_partners', 'standard', true, false)
  on conflict (entity, name) do nothing;

  select id into v_layout_id from public.page_layouts where entity = 'account_partners' and name = 'standard';

  if not exists (select 1 from public.page_layout_sections where layout_id = v_layout_id) then
    insert into public.page_layout_sections (layout_id, title, sort_order)
    values (v_layout_id, 'Partner Relationship', 1)
    returning id into v_section_id;
    insert into public.page_layout_fields (section_id, field_key, sort_order, width) values
      (v_section_id, 'partner_account_id',  1, 'half'),
      (v_section_id, 'member_account_id',   2, 'half'),
      (v_section_id, 'role',                3, 'half'),
      (v_section_id, 'notes',               4, 'full');
  end if;
end $$;

commit;
