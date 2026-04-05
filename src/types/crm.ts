export type AppRole = "sales" | "renewals" | "admin";
export type AccountLifecycle = "prospect" | "customer" | "former_customer";
export type AccountStatus = "discovery" | "pending" | "active" | "inactive" | "churned";
export type RenewalType = "auto_renew" | "manual_renew" | "no_auto_renew";
export type OpportunityTeam = "sales" | "renewals";
export type OpportunityKind = "new_business" | "renewal";
export type OpportunityStage =
  | "lead"
  | "qualified"
  | "proposal"
  | "verbal_commit"
  | "closed_won"
  | "closed_lost";
export type ActivityType = "call" | "email" | "meeting" | "note" | "task";
export type CustomFieldType = "text" | "textarea" | "number" | "currency" | "date" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone";
export type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted";
export type LeadSource = "website" | "referral" | "cold_call" | "trade_show" | "partner" | "social_media" | "email_campaign" | "other";
export type PaymentFrequency = "monthly" | "quarterly" | "semi_annually" | "annually" | "one_time";
export type LeadQualification = "unqualified" | "mql" | "sql" | "sal";

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  sf_id: string | null;
  name: string;
  owner_user_id: string | null;
  lifecycle_status: AccountLifecycle;
  status: AccountStatus;
  website: string | null;
  industry: string | null;
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
  // Custom
  custom_fields: Record<string, unknown>;
  // System
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
}

export interface Contact {
  id: string;
  sf_id: string | null;
  account_id: string;
  owner_user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  is_primary: boolean;
  department: string | null;
  linkedin_url: string | null;
  do_not_contact: boolean;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  mailing_country: string | null;
  lead_source: LeadSource | null;
  original_lead_id: string | null;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  account?: Account;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  product_family: string | null;
  description: string | null;
  is_active: boolean;
  default_arr: number | null;
  category: string | null;
  pricing_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  sf_id: string | null;
  account_id: string;
  primary_contact_id: string | null;
  owner_user_id: string | null;
  team: OpportunityTeam;
  kind: OpportunityKind;
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
  auto_renewal: boolean;
  description: string | null;
  promo_code: string | null;
  discount: number | null;
  subtotal: number | null;
  follow_up: boolean;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
  account?: Account;
  primary_contact?: Contact;
}

export interface Lead {
  id: string;
  sf_id: string | null;
  owner_user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  industry: string | null;
  website: string | null;
  status: LeadStatus;
  source: LeadSource | null;
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
  score: number;
  score_factors: Record<string, unknown>[];
  converted_at: string | null;
  converted_account_id: string | null;
  converted_contact_id: string | null;
  converted_opportunity_id: string | null;
  custom_fields: Record<string, unknown>;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
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
  created_at: string;
  updated_at: string;
  // joined fields
  product?: Product;
}

export interface Activity {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  owner_user_id: string | null;
  activity_type: ActivityType;
  subject: string;
  body: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  owner?: UserProfile;
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
  name: string;
  is_default: boolean;
  is_active: boolean;
  description: string | null;
  effective_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceBookEntry {
  id: string;
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

export interface PipelineSummaryRow {
  team: OpportunityTeam;
  stage: OpportunityStage;
  opportunity_count: number;
  total_amount: number;
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
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is_null" | "is_not_null";
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

// Sales sequences / cadences
export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  owner_user_id: string | null;
  steps: SequenceStep[];
  created_at: string;
  updated_at: string;
}

export interface SequenceStep {
  step_number: number;
  type: "email" | "call" | "task";
  delay_days: number;
  subject: string;
  body?: string;
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  lead_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  owner_user_id: string | null;
  current_step: number;
  status: "active" | "paused" | "completed" | "replied" | "bounced";
  next_touch_at: string | null;
  enrolled_at: string;
  completed_at: string | null;
  paused_reason: string | null;
  created_at: string;
  updated_at: string;
  sequence?: Sequence;
  lead?: Lead;
  contact?: Contact;
}

// Lead lists
export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
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
  type: "task_due" | "renewal_upcoming" | "deal_stage_change" | "mention" | "engagement" | "system";
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  is_shared: boolean;
  owner_user_id: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
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
