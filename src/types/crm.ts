export type AppRole = "sales" | "renewals" | "admin" | "super_admin" | "read_only";
// Automatic customer-hood, derived from closed-won contract dates (NOT set by
// hand). client = a live contract; former_client = bought before, nothing live
// now; prospect = never closed-won. See 20260630000002_account_customer_status.
// Stored values stay client/prospect/former_client; the UI labels them
// Customer / Prospect / Former Customer ("Account Status") per Summer's
// 2026-07-14 status restructure.
export type CustomerStatus = "client" | "prospect" | "former_client";
// Sales working sub-status (picklist 'accounts.sales_status'). Only
// meaningful alongside accounts.sales_active; kept as history when the
// account goes inactive.
export type SalesStatus = "prospecting" | "identified_outreach" | "engaged" | "nurture";
export type RenewalType = "auto_renew" | "manual_renew" | "no_auto_renew" | "full_auto_renew" | "platform_only_auto_renew";
export type OpportunityTeam = "sales" | "renewals";
export type OpportunityKind = "new_business" | "renewal";
// Matches public.opportunity_stage enum. SF-matching values are the
// primary six; the legacy four (lead, qualified, proposal,
// verbal_commit) remain as valid type members so old history rows
// still type-check but are not surfaced in the UI. Migration
// 20260422000001 migrated all rows off them.
export type OpportunityStage =
  | "details_analysis"
  | "demo"
  | "proposal_and_price_quote"
  | "proposal_conversation"
  | "closed_won"
  | "closed_lost"
  | "lead"
  | "qualified"
  | "proposal"
  | "verbal_commit";
export type ActivityType = "call" | "email" | "meeting" | "note" | "task" | "webinar" | "conference";
export type CustomFieldType = "text" | "textarea" | "number" | "currency" | "date" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone";
export type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted";
export type LeadSource = "website" | "referral" | "cold_call" | "trade_show" | "partner" | "social_media" | "email_campaign" | "webinar" | "podcast" | "conference" | "sql" | "mql" | "other";
export type PaymentFrequency = "monthly" | "quarterly" | "semi_annually" | "annually" | "one_time";
export type LeadQualification = "unqualified" | "mql" | "sql" | "sal";

export type CredentialType =
  | "md" | "do" | "rn" | "lpn" | "np" | "pa"
  | "chc" | "chps" | "chpc" | "hipaa_certified"
  | "ceo" | "cfo" | "coo" | "cio" | "cto" | "ciso" | "cmo"
  | "it_director" | "practice_manager" | "office_manager"
  | "compliance_officer" | "privacy_officer" | "security_officer"
  | "other";

export type UsTimeZone =
  | "eastern" | "central" | "mountain" | "pacific"
  | "alaska" | "hawaii" | "arizona_no_dst";

export type ContactType =
  | "prospect" | "customer" | "partner" | "vendor"
  | "referral_source" | "internal" | "other";

// LeadTypeEnum restored 2026-04-18 — kept distinct from lead_source so we can
// track BOTH organizational origin (source: partner/website/etc.) AND the
// specific event that converted them (type: webinar/conference/etc.).
// Final design TBD; review when revisiting Partners build.
export type LeadTypeEnum =
  | "inbound_website" | "inbound_referral"
  | "outbound_cold" | "purchased_list"
  | "conference" | "webinar"
  | "partner" | "existing_customer_expansion"
  | "other";

export type OpportunityBusinessType =
  | "new_business"
  | "existing_business"
  | "existing_business_new_product"
  | "existing_business_new_service"
  | "opportunity";

// Full mirror of the public.industry_category Postgres enum: the original
// 25 (20260418000001) + the 56 added May 6 (20260506000002). Kept in sync
// with accounts/schema.ts's Zod mirror; every UI options list derives from
// INDUSTRY_CATEGORY_LABELS in lib/formatters.ts (closed the ~55-value
// display/filter gap 2026-07-17, Summer's "Rural Hospital in lead lists"
// request — do NOT hand-maintain per-page industry lists again).
export type IndustryCategory =
  | "accounting" | "allergy_immunology" | "anesthesiology" | "association"
  | "audiology" | "behavioral_health" | "business_associate" | "cardiology"
  | "chiropractic" | "colon_rectal" | "community_health_center" | "consulting"
  | "dental" | "dermatology" | "direct_care" | "emergency_medicine"
  | "endocrinology" | "ent_otolaryngology" | "family_medicine" | "fqhc"
  | "gastroenterology" | "general_surgery" | "geriatrics" | "government"
  | "group_purchasing_organization" | "healthcare_consulting"
  | "healthcare_it_vendor" | "higher_education" | "home_health" | "hospice"
  | "hospital" | "imaging_center" | "insurance_payer" | "internal_medicine"
  | "lab_services" | "long_term_care" | "managed_service_provider"
  | "medical_device" | "medical_group" | "medical_practice" | "mental_health"
  | "multi_specialty" | "naturopathy" | "nephrology" | "neurology"
  | "non_profit" | "oncology" | "ophthalmology" | "optometry" | "orthopedics"
  | "pain_management" | "pediatrics" | "pharmaceuticals" | "pharmacy"
  | "physical_therapy" | "plastic_surgery" | "podiatry" | "primary_care"
  | "primary_care_association" | "psychiatry" | "public_health_agency"
  | "pulmonology" | "radiology" | "rehabilitation" | "reproductive_medicine"
  | "rheumatology" | "rural_health_clinic" | "rural_hospital"
  | "skilled_nursing" | "sleep_medicine" | "specialty_clinic" | "technology"
  | "telemedicine" | "tribal_health" | "university_hospital" | "urgent_care"
  | "urology" | "vascular" | "women_health"
  | "other_healthcare" | "other";

export type ProjectSegment =
  | "rural_hospital" | "community_hospital" | "enterprise"
  | "medium_sized" | "small_sized" | "fqhc" | "voa" | "franchise"
  | "strategic_partner" | "it_vendor_third_party"
  | "independent_associations" | "other";

// NOTE: the previous "first-class Partners table" model
// (PartnerRelationshipType / PartnerStatus / Partner interface /
// AccountPartner with relationship_role) was removed on 2026-04-22.
// The new model treats partners as plain accounts and stores
// relationships in account_partners. See AccountPartnership below
// and migration 20260422000005.

/**
 * One row in account_partners — a single partnership between two
 * accounts. partner is the umbrella/referrer side, member is the
 * account that came in via the partner.
 */
export interface AccountPartnership {
  id: string;
  partner_account_id: string;
  member_account_id: string;
  role: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined helpers (populated by the API layer)
  partner_account?: { id: string; name: string; account_type: string | null; customer_status: CustomerStatus | null } | null;
  member_account?:  { id: string; name: string; account_type: string | null; customer_status: CustomerStatus | null } | null;
}

/**
 * A row from the v_partner_accounts view: an Account plus the
 * partnership rollups computed in Postgres (member count, whether it's
 * an umbrella/member/top-level partner, and the owner's name). Powers
 * the /partners list so it paginates server-side.
 */
export interface PartnerAccount extends Account {
  member_count: number;
  is_umbrella: boolean;
  is_member: boolean;
  is_top_level: boolean;
  owner_full_name: string | null;
}

export type BusinessRelationshipTag =
  | "decision_maker" | "influencer" | "economic_buyer"
  | "technical_buyer" | "champion" | "detractor"
  | "end_user" | "gatekeeper"
  | "executive_sponsor" | "other";

export type RenewalCyclePattern =
  | "annual" | "three_year"
  | "years_1_and_3_services" | "year_2_services_only"
  | "one_time";

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  sf_id: string | null;
  name: string;
  owner_user_id: string | null;
  // Automatic; maintained by triggers + a daily sweep. Never set on the form.
  customer_status: CustomerStatus;
  // Set ONLY by the closed-lost "still contracted?" prompt (or an admin clear).
  // null = fully automatic.
  customer_status_override: "client" | "former_client" | null;
  customer_status_override_reason: string | null;
  customer_status_override_at: string | null;
  // Sales working state (Summer's 2026-07 status restructure). sales_active
  // is auto-set from call-list membership by a DB trigger; sales_status is
  // preserved as history while inactive; next_follow_up_date is cleared by
  // the trigger when sales_active flips false.
  sales_active: boolean;
  sales_status: string | null;
  next_follow_up_date: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  website: string | null;
  industry: string | null;
  industry_category: IndustryCategory | null;
  notes: string | null;
  // Contract
  current_contract_start_date: string | null;
  current_contract_end_date: string | null;
  current_contract_length_months: number | null;
  renewal_type: RenewalType | null;
  active_since: string | null;
  acv: number | null;
  lifetime_value: number | null;
  // Company info
  timezone: string | null;
  account_type: string | null;
  fte_count: number | null;
  fte_range: string | null;
  employees: number | null;
  locations: number | null;
  annual_revenue: number | null;
  // Billing address
  billing_street: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_country: string | null;
  // Shipping address
  shipping_street: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;
  // Geo-coordinates
  billing_latitude?: number | null;
  billing_longitude?: number | null;
  shipping_latitude?: number | null;
  shipping_longitude?: number | null;
  // Contact info
  phone: string | null;
  phone_extension: string | null;
  fax?: string | null;
  // Parent account
  parent_account_id: string | null;
  account_number: string | null;
  // Scheduling
  every_other_year: boolean;
  do_not_auto_renew: boolean;
  // Description & next steps
  description: string | null;
  next_steps: string | null;
  // Provider info
  number_of_providers: number | null;
  // Additional Salesforce fields
  sic?: string | null;
  sic_description?: string | null;
  ownership?: string | null;
  rating?: string | null;
  site?: string | null;
  ticker_symbol?: string | null;
  last_activity_date?: string | null;
  do_not_contact?: boolean;
  // Priority
  priority_account: boolean;
  // Contracts & churn
  contracts: string | null;
  churn_amount: number | null;
  churn_date: string | null;
  // Project
  project: string | null;
  project_segment: ProjectSegment | null;
  // Salesforce audit fields
  sf_created_by: string | null;
  sf_created_date: string | null;
  sf_last_modified_by: string | null;
  sf_last_modified_date: string | null;
  // Lead / Partner
  lead_source: string | null;
  lead_source_detail: string | null;
  partner_account: string | null;
  referring_partner: string | null;
  partner_prospect: boolean;
  partnership_status: string | null;
  /** Kind of partner (picklist accounts.partner_type): Referral Partner, Alliance Partner, … */
  partner_type: string | null;
  relationship_notes: string | null;
  // Custom
  custom_fields: Record<string, unknown>;
  // System
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  creator?: UserProfile;
  updater?: UserProfile;
  parent_account?: { id: string; name: string } | null;
  /**
   * Most recent real interaction on this account (call/email/meeting or
   * completed task), attached per-page by useAccounts from
   * v_account_last_activity. Drives the Accounts list "Last Touch" column.
   * Undefined until hydrated; null when the account has no logged activity.
   * Mirrors Opportunity.last_activity_at.
   */
  last_activity_at?: string | null;
  /**
   * This account's primary contact (contacts.is_primary = true, scoped to
   * this account_id via set_primary_contact), attached per-page by
   * useAccounts. Undefined until hydrated; null when no contact is marked
   * primary. Unlike Opportunity.primary_contact (sourced from a FK column,
   * primary_contact_id), this is sourced from contacts.is_primary — the
   * account-level "who do we call" flag maintained by AccountContacts.tsx.
   */
  primary_contact?: { id: string; first_name: string; last_name: string } | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactTag {
  contact_id: string;
  tag_id: string;
  tagged_by: string | null;
  tagged_at: string;
  // joined
  tag?: Tag;
}

export interface Contact {
  id: string;
  sf_id: string | null;
  contact_number: string | null;
  account_id: string | null;
  owner_user_id: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  email2: string | null;
  email3: string | null;
  title: string | null;
  phone: string | null;
  phone_ext: string | null;
  mobile_phone: string | null;
  is_primary: boolean;
  department: string | null;
  // Partner/channel this contact was sourced through (SF Partner_Source).
  partner_source: string | null;
  linkedin_url: string | null;
  credential: CredentialType | null;
  time_zone: UsTimeZone | null;
  type: ContactType | null;
  business_relationship_tag: BusinessRelationshipTag | null;
  events_attended: string[] | null;
  notes: string | null;
  next_steps: string | null;
  do_not_contact: boolean;
  // Call-suppression preference + No-Longer-Employed flag (V3-B). NLE is
  // excluded from outreach but stays visible/searchable (unlike archive).
  do_not_call: boolean;
  no_longer_employed: boolean;
  no_longer_employed_at: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  mailing_country: string | null;
  lead_source: LeadSource | null;
  lead_source_detail?: string | null;
  original_lead_id: string | null;
  /** Imports-pen membership: 'pending' = raw imported row awaiting
   * clean/promote (hidden from normal contact surfaces); null = regular. */
  import_status?: "pending" | null;
  /** Raw company string from the import file (promote-time matching +
   * provenance; survives promotion). */
  import_company?: string | null;
  mql_date: string | null;
  sql_date: string | null;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  account?: Account;
  creator?: UserProfile;
  updater?: UserProfile;
}

export interface Product {
  id: string;
  sf_id: string | null;
  code: string;
  name: string;
  /** Short abbreviation used in opportunity auto-naming. */
  short_name: string | null;
  product_family: string | null;
  description: string | null;
  is_active: boolean;
  default_arr: number | null;
  has_flat_price: boolean;
  category: string | null;
  pricing_model: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface ProductFamily {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  sf_id: string | null;
  account_id: string;
  primary_contact_id: string | null;
  owner_user_id: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  team: OpportunityTeam;
  kind: OpportunityKind;
  business_type: OpportunityBusinessType | null;
  originating_partner_id: string | null;
  sourcing_partner_id: string | null;
  name: string;
  stage: OpportunityStage;
  amount: number;
  service_amount: number | null;
  product_amount: number | null;
  services_included: boolean;
  service_description: string | null;
  expected_close_date: string | null;
  close_date: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_length_months: number | null;
  contract_year: number | null;
  contract_signed_date: string | null;
  source_opportunity_id: string | null;
  renewal_from_opportunity_id: string | null;
  loss_reason: string | null;
  notes: string | null;
  // New fields
  probability: number | null;
  next_step: string | null;
  lead_source: LeadSource | null;
  payment_frequency: PaymentFrequency | null;
  cycle_count: number | null;
  renewal_cycle_pattern: RenewalCyclePattern | null;
  auto_renewal: boolean;
  description: string | null;
  promo_code: string | null;
  discount: number | null;
  /** 'percent' = discount field is %; 'amount' = discount field is $. */
  discount_type?: "percent" | "amount";
  /**
   * True when this opp was sold as a bundle/flat-rate deal. Any
   * per-line discounts on it are bundle adjustments (back into a
   * target total) rather than promo markdowns. Used by reporting to
   * split bundle adjustments from promo discounts.
   */
  is_bundle_deal?: boolean;
  subtotal: number | null;
  follow_up: boolean;
  one_time_project?: boolean;
  lead_source_detail?: string | null;
  // FTE snapshot (captured at opp creation for historical tracking)
  fte_count: number | null;
  fte_range: string | null;
  created_by_automation: boolean;
  /** True = trigger keeps opp.name in sync with attached products. */
  name_auto_sync: boolean;
  // Assignment tracking
  assigned_assessor_id: string | null;
  original_sales_rep_id: string | null;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  account?: Account;
  primary_contact?: Contact;
  assigned_assessor?: UserProfile;
  original_sales_rep?: UserProfile;
  creator?: UserProfile;
  updater?: UserProfile;
  /**
   * Most recent real interaction on this deal (call/email/meeting or completed
   * task), attached per-page by useOpportunities from v_opportunity_last_activity.
   * Drives the "Last Touch" stale-deal column. Undefined until hydrated; null
   * when the deal has no logged activity.
   */
  last_activity_at?: string | null;
}

export interface Lead {
  id: string;
  sf_id: string | null;
  owner_user_id: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  do_not_contact: boolean;
  company: string | null;
  title: string | null;
  industry: string | null;
  industry_category: IndustryCategory | null;
  website: string | null;
  status: LeadStatus;
  source: LeadSource | null;
  lead_source_detail?: string | null;
  // Partner/channel this lead was sourced through (SF Partner_Source).
  partner_source: string | null;
  description: string | null;
  employees: number | null;
  annual_revenue: number | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  qualification: LeadQualification;
  qualification_date: string | null;
  mql_date: string | null;
  score: number;
  score_factors: Record<string, unknown>[];
  converted_at: string | null;
  converted_account_id: string | null;
  converted_contact_id: string | null;
  converted_opportunity_id: string | null;
  do_not_market_to: boolean;
  credential: CredentialType | null;
  phone_ext: string | null;
  time_zone: UsTimeZone | null;
  type: LeadTypeEnum | null;
  priority_lead: boolean;
  project: string | null;
  project_segment: ProjectSegment | null;
  business_relationship_tag: BusinessRelationshipTag | null;
  linkedin_url: string | null;
  cold_lead: boolean;
  cold_lead_source: string | null;
  rating: LeadRating | null;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  avoid_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  creator?: UserProfile;
  updater?: UserProfile;
  parent_account?: { id: string; name: string };
}

export interface CustomFieldDefinition {
  id: string;
  entity: "accounts" | "contacts" | "opportunities" | "leads";
  field_key: string;
  label: string;
  field_type: CustomFieldType;
  is_required: boolean;
  options: string[] | null;
  default_value: string | null;
  sort_order: number;
  section: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountContract {
  account_id: string;
  account_name: string;
  opportunity_id: string;
  opportunity_name: string;
  contract_year: number | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_length_months: number | null;
  total_amount: number;
  service_amount: number | null;
  product_amount: number | null;
  services_included: boolean;
  service_description: string | null;
  stage: OpportunityStage;
  kind: OpportunityKind;
  renewal_from_opportunity_id: string | null;
  owner_user_id: string | null;
}

export interface OpportunityProduct {
  id: string;
  opportunity_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  arr_amount: number;
  /** Either a percent (0-100) or a flat dollar amount, per `discount_type`. */
  discount_percent?: number | null;
  /** 'percent' = discount_percent is %; 'amount' = discount_percent is $. */
  discount_type?: "percent" | "amount";
  created_at: string;
  updated_at: string;
  // joined fields
  product?: Product;
}

export type ReminderSchedule =
  | "none" | "once" | "daily" | "weekdays" | "weekly";
export type ReminderChannel = "in_app" | "email";
export type ActivityPriority = "high" | "normal" | "low";
export type TaskRecurrenceFreq = "daily" | "weekly" | "monthly";
export type LeadRating = "hot" | "warm" | "cold";

export interface Activity {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  owner_user_id: string | null;
  activity_type: ActivityType;
  subject: string;
  body: string | null;
  due_at: string | null;
  // When the interaction actually happened (or was logged). For
  // tasks this is the create date; for calls/meetings/emails it's
  // the date the rep selected. Distinct from due_at which is task-
  // specific. See migration 20260522000002.
  activity_date: string | null;
  completed_at: string | null;
  created_at: string;
  /** Generated: coalesce(activity_date, created_at). The real interaction
   *  date when set, else the logged date. Used to order/filter the Activities
   *  list so back-dated entries sort into the right spot. */
  effective_at?: string;
  updated_at: string;
  // Email-specific metadata (null for non-email activities)
  email_direction: "sent" | "received" | null;
  email_from: string | null;
  email_to: string[] | null;
  email_cc: string[] | null;
  email_html_body: string | null;
  email_thread_id: string | null;
  // Provider message id (Graph/Gmail). Set for synced emails; null for
  // manually-logged ones. dce9b1f logs one synced email to EVERY matched
  // contact under an account, so this is the identity to dedupe on when a
  // consumer needs "one real email" rather than "one activity row" — see
  // src/features/nexus/metrics.ts, activityFeedDedupe.ts, and the
  // groupActivitiesForTimeline dedupeFanOut option.
  external_message_id: string | null;
  // Reminders (tasks) — see migration 20260417000007
  reminder_schedule: ReminderSchedule;
  reminder_at: string | null;
  reminder_channels: ReminderChannel[];
  last_reminder_sent_at: string | null;
  priority: ActivityPriority | null;
  // Live task recurrence (V2-A3) — null recur_freq = not recurring.
  recur_freq: TaskRecurrenceFreq | null;
  recur_interval: number;
  recur_weekday: number | null;
  recur_monthday: number | null;
  recur_until: string | null;
  recurrence_parent_id: string | null;
  // Outlook calendar sync (tasks)
  outlook_event_id: string | null;
  outlook_sync_error: string | null;
  outlook_synced_at: string | null;
  // joined fields
  owner?: UserProfile;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
}

export interface OpportunityStageHistory {
  id: number;
  opportunity_id: string;
  from_stage: OpportunityStage | null;
  to_stage: OpportunityStage;
  changed_by: string | null;
  changed_at: string;
  // joined fields
  changer?: UserProfile;
}

export interface ReportFolder {
  id: string;
  name: string;
  is_public: boolean;
  owner_user_id: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export type DashboardWidgetDisplay = "table" | "bar" | "pie" | "number";

export type DashboardLayoutWidget =
  | { i: string; x: number; y: number; w: number; h: number; type: "kpi"; metric: DashboardKpiMetric; title?: string }
  | {
      i: string;
      x: number;
      y: number;
      w: number;
      h: number;
      type: "report";
      report_id: string;
      title?: string;
      /**
       * How to render the saved report inside the widget. Defaults to
       * "table" if missing (back-compat with widgets created before
       * 2026-04-19 when this field was added).
       */
      display?: DashboardWidgetDisplay;
      /** For bar/pie: which column to group by (column key). */
      group_by?: string;
      /** For bar/pie: which column to aggregate (column key). Defaults to count. */
      value_column?: string;
    }
  | { i: string; x: number; y: number; w: number; h: number; type: "builtin"; builtin: DashboardBuiltinWidget; title?: string };

export type DashboardKpiMetric =
  | "pipeline_arr"
  | "closed_won_qtd"
  | "closed_won_ytd"
  | "renewals_next_30"
  | "renewals_next_60"
  | "renewals_next_90"
  | "new_leads_week"
  | "mql_count_week"
  | "sql_count_week"
  | "active_customers"
  | "churn_qtd";

export type DashboardBuiltinWidget =
  | "pipeline_by_stage"
  | "closed_won_by_owner_qtr"
  | "product_growth_yoy"
  | "churn_metrics"
  | "arr_by_product"
  | "renewals_calendar";

export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  is_public: boolean;
  layout: DashboardLayoutWidget[];
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export interface PriceBook {
  id: string;
  sf_id: string | null;
  name: string;
  is_default: boolean;
  is_active: boolean;
  description: string | null;
  effective_date: string | null;
  /**
   * FTE tier this price book serves ("1-20", "21-50", ..., "5001-10000").
   * Null for flat-rate books (e.g. SF's "Standard Price Book") whose
   * products are priced the same regardless of customer size.
   */
  fte_range: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceBookEntry {
  id: string;
  sf_id: string | null;
  price_book_id: string;
  product_id: string;
  fte_range: string | null;
  unit_price: number;
  created_at: string;
  updated_at: string;
  product?: Product;
}

// View types
export interface ActivePipelineRow {
  id: string;
  name: string;
  team: OpportunityTeam;
  kind: OpportunityKind;
  stage: OpportunityStage;
  amount: number;
  expected_close_date: string | null;
  owner_user_id: string | null;
  owner_name?: string | null;
  account_id: string;
  account_name: string;
}

export interface RenewalQueueRow {
  source_opportunity_id: string;
  account_id: string;
  account_name: string;
  owner_user_id: string | null;
  contract_end_date: string;
  current_arr: number;
  days_until_renewal: number | null;
}

// Custom pipeline views
export interface PipelineViewConfig {
  stages: OpportunityStage[];
  team_filter?: OpportunityTeam;
  kind_filter?: OpportunityKind;
  sort_by?: string;
}

export interface PipelineView {
  id: string;
  name: string;
  owner_user_id: string;
  is_shared: boolean;
  config: PipelineViewConfig;
  created_at: string;
  updated_at: string;
}

// Saved reports
export interface ReportFilter {
  field: string;
  // due_within_days / overdue are date-column relative operators (account
  // restructure 2026-07-15): value holds a day count / nothing.
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is_null" | "is_not_null" | "due_within_days" | "overdue";
  value: string;
}

export interface ReportSort {
  field: string;
  direction: "asc" | "desc";
}

export interface ReportConfig {
  entity: "accounts" | "contacts" | "opportunities" | "activities" | "opportunity_products" | "leads";
  columns: string[];
  filters: ReportFilter[];
  sort?: ReportSort;
  group_by?: string;
}

export interface SavedReport {
  id: string;
  name: string;
  owner_user_id: string;
  is_shared: boolean;
  folder: string | null;
  config: ReportConfig;
  created_at: string;
  updated_at: string;
}


// Lead lists
export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  /** true = working call list: membership drives accounts.sales_active.
   * false (default) = neutral categorization - never touches status. */
  is_working_list: boolean;
  is_dynamic: boolean;
  filter_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LeadListMember {
  id: string;
  list_id: string;
  lead_id: string | null;
  contact_id: string | null;
  added_at: string;
  lead?: Lead;
  contact?: Contact;
}

// Notifications
export interface Notification {
  id: string;
  user_id: string;
  type:
    | "task_due"
    | "renewal_upcoming"
    | "deal_stage_change"
    | "mention"
    | "engagement"
    | "system"
    | "meddy_new_chat"
    | "meddy_human_requested"
    | "meddy_buying_intent"
    | "meddy_missed_chat"
    | "meddy_contact_received"
    | "follow_up_due";
  title: string;
  message: string | null;
  link: string | null;
  conversation_id: string | null;
  is_read: boolean;
  created_at: string;
}

// Requests (collateral / product / crm) — ported from Nexus
export type RequestType = "collateral" | "product" | "crm";
export type RequestStatus =
  | "pending"
  | "completed"
  | "approved"
  | "denied"
  | "cancelled";
export type RequestPriority = "low" | "medium" | "high";

// Named CrmRequest (not Request) to avoid clashing with the DOM global.
export interface CrmRequest {
  id: string;
  type: RequestType;
  status: RequestStatus;
  priority: RequestPriority;
  title: string;
  description: string | null;
  details: Record<string, unknown>;
  requester_user_id: string | null;
  requester_name: string | null;
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  ai_summary: string | null;
  design_prompt: string | null;
  completed_at: string | null;
  completed_by: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  // joined
  requester?: { id: string; full_name: string | null } | null;
}

export interface RequestAttachment {
  id: string;
  request_id: string;
  original_filename: string;
  storage_path: string;
  mimetype: string | null;
  size_bytes: number | null;
  created_at: string;
}

// Dashboard widgets
export interface DashboardWidget {
  id: string;
  user_id: string;
  widget_type: string;
  config: Record<string, unknown>;
  position: number;
  is_visible: boolean;
}
