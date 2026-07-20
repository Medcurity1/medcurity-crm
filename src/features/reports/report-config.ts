import { ALL_STAGES } from "@/lib/formatters";
import type { ReportFilter } from "@/types/crm";

export interface ColumnDef {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "date" | "enum" | "boolean";
  enumValues?: string[];
  joinTable?: string;
  joinField?: string;
  /** Grouping label for the column picker sheet. */
  group?: string;
}

/** Relation filter types resolve UUIDs via a lookup dropdown. */
export type RelationFilterType = "user" | "account" | "contact" | "opportunity";

/**
 * A filterable column definition. For join columns the `filterKey` points to
 * the actual FK column in the database (e.g. `owner_user_id`) while the
 * `label` stays human-readable ("Owner").
 */
export interface FilterColumnDef {
  /** The key used when building the Supabase filter (DB column). */
  filterKey: string;
  /** Human-readable label shown in the UI dropdown. */
  label: string;
  /** Column type — drives which operators & value inputs are shown. */
  type: ColumnDef["type"] | RelationFilterType;
  /** For enum columns, the set of valid values. */
  enumValues?: string[];
  /**
   * When set, the ReportBuilder resolves this enum's dropdown options from the
   * admin-managed picklist with this `field_key` (e.g. "opportunities.lead_source")
   * instead of the static `enumValues` above — the same data-driven, drift-proof
   * source the Nexus report engine reads (see
   * src/features/nexus/report-engine.ts optionsSource/picklistFieldKey). This
   * prevents the "hardcoded list falls behind the admin picklist" bug. The
   * `enumValues` list is kept in sync with the canonical enum as a fallback for
   * when the picklist hasn't loaded.
   */
  picklistFieldKey?: string;
}

export interface EntityDef {
  key: string;
  label: string;
  table: string;
  columns: ColumnDef[];
  /** Every field the user can filter on — includes FK columns for joins. */
  filterColumns: FilterColumnDef[];
  defaultColumns: string[];
  joins: string;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const accountColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  { key: "name", label: "Name", type: "text", group: "Basic Info" },
  {
    // Derived customer-hood (see CustomerStatus in src/types/crm.ts). Surfaced
    // as "Account Status" per Summer's 2026-07 status restructure — stored
    // values are unchanged, only the display wording moved.
    key: "customer_status",
    label: "Account Status",
    type: "enum",
    enumValues: ["client", "prospect", "former_client"],
    group: "Basic Info",
  },
  // Sales-working fields (Summer's 2026-07 status restructure): sales_active =
  // is anyone actively working this account; sales_status = where in the
  // outreach motion (kept as history even when sales_active is false).
  { key: "sales_active", label: "Working (Active/Inactive)", type: "boolean", group: "Basic Info" },
  {
    key: "sales_status",
    label: "Sales Status",
    type: "enum",
    enumValues: ["prospecting", "identified_outreach", "engaged", "nurture"],
    group: "Basic Info",
  },
  { key: "next_follow_up_date", label: "Next Follow Up", type: "date", group: "Basic Info" },
  { key: "industry", label: "Industry", type: "text", group: "Basic Info" },
  { key: "website", label: "Website", type: "text", group: "Basic Info" },
  { key: "notes", label: "Notes", type: "text", group: "Basic Info" },
  {
    key: "owner",
    label: "Owner",
    type: "text",
    joinTable: "user_profiles",
    joinField: "full_name",
    group: "Basic Info",
  },
  { key: "current_contract_start_date", label: "Contract Start", type: "date", group: "Contract" },
  { key: "current_contract_end_date", label: "Contract End", type: "date", group: "Contract" },
  { key: "current_contract_length_months", label: "Contract Length (Months)", type: "number", group: "Contract" },
  {
    key: "renewal_type",
    label: "Renewal Type",
    type: "enum",
    // Canonical set: RenewalType in src/types/crm.ts (also the
    // accounts.renewal_type admin picklist). Was missing full_auto_renew /
    // platform_only_auto_renew.
    enumValues: ["auto_renew", "manual_renew", "no_auto_renew", "full_auto_renew", "platform_only_auto_renew"],
    group: "Contract",
  },
  { key: "active_since", label: "Active Since", type: "date", group: "Contract" },
  { key: "acv", label: "ACV", type: "currency", group: "Contract" },
  { key: "lifetime_value", label: "Lifetime Value", type: "currency", group: "Contract" },
  { key: "timezone", label: "Timezone", type: "text", group: "Company" },
  { key: "account_type", label: "Account Type", type: "text", group: "Company" },
  { key: "fte_count", label: "FTE Count", type: "number", group: "Company" },
  { key: "fte_range", label: "FTE Range", type: "text", group: "Company" },
  { key: "employees", label: "Employees", type: "number", group: "Company" },
  { key: "locations", label: "Locations", type: "number", group: "Company" },
  { key: "annual_revenue", label: "Annual Revenue", type: "currency", group: "Company" },
  { key: "billing_street", label: "Billing Street", type: "text", group: "Address" },
  { key: "billing_city", label: "Billing City", type: "text", group: "Address" },
  { key: "billing_state", label: "Billing State", type: "text", group: "Address" },
  { key: "billing_zip", label: "Billing Zip", type: "text", group: "Address" },
  { key: "billing_country", label: "Billing Country", type: "text", group: "Address" },
  { key: "shipping_street", label: "Shipping Street", type: "text", group: "Address" },
  { key: "shipping_city", label: "Shipping City", type: "text", group: "Address" },
  { key: "shipping_state", label: "Shipping State", type: "text", group: "Address" },
  { key: "shipping_zip", label: "Shipping Zip", type: "text", group: "Address" },
  { key: "shipping_country", label: "Shipping Country", type: "text", group: "Address" },
  { key: "created_at", label: "Created", type: "date", group: "System" },
  { key: "updated_at", label: "Updated", type: "date", group: "System" },
];

const accountFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  { filterKey: "name", label: "Name", type: "text" },
  {
    filterKey: "customer_status",
    label: "Account Status",
    type: "enum",
    enumValues: ["client", "prospect", "former_client"],
  },
  { filterKey: "sales_active", label: "Working (Active/Inactive)", type: "boolean" },
  {
    filterKey: "sales_status",
    label: "Sales Status",
    type: "enum",
    // Data-driven from the accounts.sales_status admin picklist; enumValues is
    // the loading fallback (canonical set from the 2026-07 restructure).
    enumValues: ["prospecting", "identified_outreach", "engaged", "nurture"],
    picklistFieldKey: "accounts.sales_status",
  },
  { filterKey: "next_follow_up_date", label: "Next Follow Up", type: "date" },
  { filterKey: "industry", label: "Industry", type: "text" },
  { filterKey: "website", label: "Website", type: "text" },
  { filterKey: "notes", label: "Notes", type: "text" },
  { filterKey: "owner_user_id", label: "Owner", type: "user" },
  { filterKey: "current_contract_start_date", label: "Contract Start", type: "date" },
  { filterKey: "current_contract_end_date", label: "Contract End", type: "date" },
  { filterKey: "current_contract_length_months", label: "Contract Length (Months)", type: "number" },
  {
    filterKey: "renewal_type",
    label: "Renewal Type",
    type: "enum",
    // Data-driven from the accounts.renewal_type admin picklist; enumValues
    // (canonical RenewalType set — src/types/crm.ts) is the loading fallback.
    enumValues: ["auto_renew", "manual_renew", "no_auto_renew", "full_auto_renew", "platform_only_auto_renew"],
    picklistFieldKey: "accounts.renewal_type",
  },
  { filterKey: "active_since", label: "Active Since", type: "date" },
  { filterKey: "acv", label: "ACV", type: "currency" },
  { filterKey: "lifetime_value", label: "Lifetime Value", type: "currency" },
  { filterKey: "timezone", label: "Timezone", type: "text" },
  { filterKey: "account_type", label: "Account Type", type: "text" },
  { filterKey: "fte_count", label: "FTE Count", type: "number" },
  { filterKey: "fte_range", label: "FTE Range", type: "text" },
  { filterKey: "employees", label: "Employees", type: "number" },
  { filterKey: "locations", label: "Locations", type: "number" },
  { filterKey: "annual_revenue", label: "Annual Revenue", type: "currency" },
  { filterKey: "billing_street", label: "Billing Street", type: "text" },
  { filterKey: "billing_city", label: "Billing City", type: "text" },
  { filterKey: "billing_state", label: "Billing State", type: "text" },
  { filterKey: "billing_zip", label: "Billing Zip", type: "text" },
  { filterKey: "billing_country", label: "Billing Country", type: "text" },
  { filterKey: "shipping_street", label: "Shipping Street", type: "text" },
  { filterKey: "shipping_city", label: "Shipping City", type: "text" },
  { filterKey: "shipping_state", label: "Shipping State", type: "text" },
  { filterKey: "shipping_zip", label: "Shipping Zip", type: "text" },
  { filterKey: "shipping_country", label: "Shipping Country", type: "text" },
  { filterKey: "created_at", label: "Created", type: "date" },
  { filterKey: "updated_at", label: "Updated", type: "date" },
];

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  { key: "first_name", label: "First Name", type: "text", group: "Basic Info" },
  { key: "last_name", label: "Last Name", type: "text", group: "Basic Info" },
  { key: "email", label: "Email", type: "text", group: "Basic Info" },
  { key: "title", label: "Title", type: "text", group: "Basic Info" },
  { key: "phone", label: "Phone", type: "text", group: "Basic Info" },
  { key: "is_primary", label: "Primary Contact", type: "boolean", group: "Basic Info" },
  { key: "department", label: "Department", type: "text", group: "Basic Info" },
  { key: "linkedin_url", label: "LinkedIn URL", type: "text", group: "Basic Info" },
  { key: "do_not_contact", label: "Do Not Contact", type: "boolean", group: "Basic Info" },
  {
    key: "account",
    label: "Account",
    type: "text",
    joinTable: "accounts",
    joinField: "name",
    group: "Relations",
  },
  {
    key: "owner",
    label: "Owner",
    type: "text",
    joinTable: "user_profiles",
    joinField: "full_name",
    group: "Relations",
  },
  { key: "mailing_street", label: "Mailing Street", type: "text", group: "Address" },
  { key: "mailing_city", label: "Mailing City", type: "text", group: "Address" },
  { key: "mailing_state", label: "Mailing State", type: "text", group: "Address" },
  { key: "mailing_zip", label: "Mailing Zip", type: "text", group: "Address" },
  { key: "mailing_country", label: "Mailing Country", type: "text", group: "Address" },
  { key: "created_at", label: "Created", type: "date", group: "System" },
  { key: "updated_at", label: "Updated", type: "date", group: "System" },
];

const contactFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  { filterKey: "first_name", label: "First Name", type: "text" },
  { filterKey: "last_name", label: "Last Name", type: "text" },
  { filterKey: "email", label: "Email", type: "text" },
  { filterKey: "title", label: "Title", type: "text" },
  { filterKey: "phone", label: "Phone", type: "text" },
  { filterKey: "is_primary", label: "Primary Contact", type: "boolean" },
  { filterKey: "department", label: "Department", type: "text" },
  { filterKey: "linkedin_url", label: "LinkedIn URL", type: "text" },
  { filterKey: "do_not_contact", label: "Do Not Contact", type: "boolean" },
  { filterKey: "account_id", label: "Account", type: "account" },
  { filterKey: "owner_user_id", label: "Owner", type: "user" },
  { filterKey: "mailing_street", label: "Mailing Street", type: "text" },
  { filterKey: "mailing_city", label: "Mailing City", type: "text" },
  { filterKey: "mailing_state", label: "Mailing State", type: "text" },
  { filterKey: "mailing_zip", label: "Mailing Zip", type: "text" },
  { filterKey: "mailing_country", label: "Mailing Country", type: "text" },
  { filterKey: "created_at", label: "Created", type: "date" },
  { filterKey: "updated_at", label: "Updated", type: "date" },
];

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

const opportunityColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  { key: "name", label: "Name", type: "text", group: "Basic Info" },
  {
    key: "stage",
    label: "Stage",
    type: "enum",
    // Canonical live stage set (formatters.ALL_STAGES). Migration
    // 20260422000001 rewrote every opportunity/history row onto the
    // SF-matching stages; the old legacy values (lead/qualified/proposal/
    // verbal_commit) now match zero live rows, so we must not offer them.
    enumValues: ALL_STAGES,
    group: "Basic Info",
  },
  {
    key: "team",
    label: "Team",
    type: "enum",
    enumValues: ["sales", "renewals"],
    group: "Basic Info",
  },
  {
    key: "kind",
    label: "Kind",
    type: "enum",
    enumValues: ["new_business", "renewal"],
    group: "Basic Info",
  },
  { key: "amount", label: "Amount", type: "currency", group: "Financial" },
  { key: "service_amount", label: "Service Amount", type: "currency", group: "Financial" },
  { key: "product_amount", label: "Product Amount", type: "currency", group: "Financial" },
  { key: "services_included", label: "Services Included", type: "boolean", group: "Financial" },
  { key: "service_description", label: "Service Description", type: "text", group: "Financial" },
  { key: "expected_close_date", label: "Expected Close", type: "date", group: "Dates" },
  { key: "close_date", label: "Close Date", type: "date", group: "Dates" },
  { key: "contract_start_date", label: "Contract Start", type: "date", group: "Contract" },
  { key: "contract_end_date", label: "Contract End", type: "date", group: "Contract" },
  { key: "contract_length_months", label: "Contract Length (Months)", type: "number", group: "Contract" },
  { key: "contract_year", label: "Contract Year", type: "number", group: "Contract" },
  { key: "loss_reason", label: "Loss Reason", type: "text", group: "Basic Info" },
  { key: "notes", label: "Notes", type: "text", group: "Basic Info" },
  { key: "probability", label: "Probability", type: "number", group: "Basic Info" },
  { key: "next_step", label: "Next Step", type: "text", group: "Basic Info" },
  {
    key: "lead_source",
    label: "Lead Source",
    type: "enum",
    // Channel values from the opportunities.lead_source admin picklist.
    // sql/mql retired from Source (Joe 2026-07-14): channel only; stage lives
    // in Qualification. Historic rows were migrated by 20260715150000.
    enumValues: ["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "other"],
    group: "Basic Info",
  },
  {
    key: "payment_frequency",
    label: "Payment Frequency",
    type: "enum",
    enumValues: ["monthly", "quarterly", "semi_annually", "annually", "one_time"],
    group: "Financial",
  },
  { key: "cycle_count", label: "Cycle Count", type: "number", group: "Financial" },
  { key: "auto_renewal", label: "Auto Renewal", type: "boolean", group: "Contract" },
  { key: "description", label: "Description", type: "text", group: "Basic Info" },
  { key: "promo_code", label: "Promo Code", type: "text", group: "Financial" },
  { key: "discount", label: "Discount", type: "currency", group: "Financial" },
  { key: "subtotal", label: "Subtotal", type: "currency", group: "Financial" },
  { key: "follow_up", label: "Follow Up", type: "boolean", group: "Basic Info" },
  {
    key: "account",
    label: "Account",
    type: "text",
    joinTable: "accounts",
    joinField: "name",
    group: "Relations",
  },
  {
    key: "owner",
    label: "Owner",
    type: "text",
    joinTable: "user_profiles",
    joinField: "full_name",
    group: "Relations",
  },
  {
    key: "primary_contact",
    label: "Primary Contact",
    type: "text",
    joinTable: "contacts",
    joinField: "first_name,last_name",
    group: "Relations",
  },
  { key: "created_at", label: "Created", type: "date", group: "System" },
  { key: "updated_at", label: "Updated", type: "date", group: "System" },
];

const opportunityFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  { filterKey: "name", label: "Name", type: "text" },
  {
    filterKey: "stage",
    label: "Stage",
    type: "enum",
    // Canonical live stage set (formatters.ALL_STAGES) — legacy values were
    // migrated off by 20260422000001 and match zero live rows.
    enumValues: ALL_STAGES,
  },
  { filterKey: "team", label: "Team", type: "enum", enumValues: ["sales", "renewals"] },
  { filterKey: "kind", label: "Kind", type: "enum", enumValues: ["new_business", "renewal"] },
  { filterKey: "amount", label: "Amount", type: "currency" },
  { filterKey: "service_amount", label: "Service Amount", type: "currency" },
  { filterKey: "product_amount", label: "Product Amount", type: "currency" },
  { filterKey: "services_included", label: "Services Included", type: "boolean" },
  { filterKey: "service_description", label: "Service Description", type: "text" },
  { filterKey: "expected_close_date", label: "Expected Close", type: "date" },
  { filterKey: "close_date", label: "Close Date", type: "date" },
  { filterKey: "contract_start_date", label: "Contract Start", type: "date" },
  { filterKey: "contract_end_date", label: "Contract End", type: "date" },
  { filterKey: "contract_length_months", label: "Contract Length (Months)", type: "number" },
  { filterKey: "contract_year", label: "Contract Year", type: "number" },
  { filterKey: "loss_reason", label: "Loss Reason", type: "text" },
  { filterKey: "notes", label: "Notes", type: "text" },
  { filterKey: "probability", label: "Probability", type: "number" },
  { filterKey: "next_step", label: "Next Step", type: "text" },
  {
    filterKey: "lead_source",
    label: "Lead Source",
    type: "enum",
    // Data-driven from the opportunities.lead_source admin picklist; enumValues
    // (canonical LeadSource set — src/types/crm.ts) is the loading fallback.
    // sql/mql retired from Source (Joe 2026-07-14): channel only; stage lives
    // in Qualification. Historic rows were migrated by 20260715150000.
    enumValues: ["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "other"],
    picklistFieldKey: "opportunities.lead_source",
  },
  {
    filterKey: "payment_frequency",
    label: "Payment Frequency",
    type: "enum",
    enumValues: ["monthly", "quarterly", "semi_annually", "annually", "one_time"],
  },
  { filterKey: "cycle_count", label: "Cycle Count", type: "number" },
  { filterKey: "auto_renewal", label: "Auto Renewal", type: "boolean" },
  { filterKey: "description", label: "Description", type: "text" },
  { filterKey: "promo_code", label: "Promo Code", type: "text" },
  { filterKey: "discount", label: "Discount", type: "currency" },
  { filterKey: "subtotal", label: "Subtotal", type: "currency" },
  { filterKey: "follow_up", label: "Follow Up", type: "boolean" },
  { filterKey: "account_id", label: "Account", type: "account" },
  { filterKey: "owner_user_id", label: "Owner", type: "user" },
  { filterKey: "primary_contact_id", label: "Primary Contact", type: "contact" },
  { filterKey: "source_opportunity_id", label: "Source Opportunity", type: "opportunity" },
  { filterKey: "renewal_from_opportunity_id", label: "Renewal From Opportunity", type: "opportunity" },
  { filterKey: "created_at", label: "Created", type: "date" },
  { filterKey: "updated_at", label: "Updated", type: "date" },
];

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const activityColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  {
    key: "activity_type",
    label: "Type",
    type: "enum",
    enumValues: ["call", "email", "meeting", "webinar", "conference", "note", "task"],
    group: "Basic Info",
  },
  { key: "subject", label: "Subject", type: "text", group: "Basic Info" },
  { key: "body", label: "Body", type: "text", group: "Basic Info" },
  { key: "due_at", label: "Due At", type: "date", group: "Dates" },
  { key: "completed_at", label: "Completed At", type: "date", group: "Dates" },
  {
    key: "account",
    label: "Account",
    type: "text",
    joinTable: "accounts",
    joinField: "name",
    group: "Relations",
  },
  {
    key: "contact",
    label: "Contact",
    type: "text",
    joinTable: "contacts",
    joinField: "first_name,last_name",
    group: "Relations",
  },
  {
    key: "opportunity",
    label: "Opportunity",
    type: "text",
    joinTable: "opportunities",
    joinField: "name",
    group: "Relations",
  },
  {
    key: "owner",
    label: "Owner",
    type: "text",
    joinTable: "user_profiles",
    joinField: "full_name",
    group: "Relations",
  },
  { key: "created_at", label: "Created", type: "date", group: "System" },
];

const activityFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  {
    filterKey: "activity_type",
    label: "Type",
    type: "enum",
    enumValues: ["call", "email", "meeting", "webinar", "conference", "note", "task"],
  },
  { filterKey: "subject", label: "Subject", type: "text" },
  { filterKey: "body", label: "Body", type: "text" },
  { filterKey: "due_at", label: "Due At", type: "date" },
  { filterKey: "completed_at", label: "Completed At", type: "date" },
  { filterKey: "account_id", label: "Account", type: "account" },
  { filterKey: "contact_id", label: "Contact", type: "contact" },
  { filterKey: "opportunity_id", label: "Opportunity", type: "opportunity" },
  { filterKey: "owner_user_id", label: "Owner", type: "user" },
  { filterKey: "created_at", label: "Created", type: "date" },
];

// ---------------------------------------------------------------------------
// Opportunity Products
// ---------------------------------------------------------------------------

const opportunityProductColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  { key: "quantity", label: "Quantity", type: "number", group: "Basic Info" },
  { key: "unit_price", label: "Unit Price", type: "currency", group: "Basic Info" },
  { key: "arr_amount", label: "ARR Amount", type: "currency", group: "Basic Info" },
  {
    key: "product",
    label: "Product",
    type: "text",
    joinTable: "products",
    joinField: "name,code",
    group: "Relations",
  },
  {
    key: "opportunity",
    label: "Opportunity",
    type: "text",
    joinTable: "opportunities",
    joinField: "name",
    group: "Relations",
  },
  { key: "created_at", label: "Created", type: "date", group: "System" },
];

const opportunityProductFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  { filterKey: "quantity", label: "Quantity", type: "number" },
  { filterKey: "unit_price", label: "Unit Price", type: "currency" },
  { filterKey: "arr_amount", label: "ARR Amount", type: "currency" },
  { filterKey: "product_id", label: "Product", type: "text" },
  { filterKey: "opportunity_id", label: "Opportunity", type: "opportunity" },
  { filterKey: "created_at", label: "Created", type: "date" },
];

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const leadColumns: ColumnDef[] = [
  { key: "id", label: "ID", type: "text", group: "System" },
  { key: "first_name", label: "First Name", type: "text", group: "Basic Info" },
  { key: "last_name", label: "Last Name", type: "text", group: "Basic Info" },
  { key: "email", label: "Email", type: "text", group: "Basic Info" },
  { key: "phone", label: "Phone", type: "text", group: "Basic Info" },
  { key: "company", label: "Company", type: "text", group: "Company" },
  { key: "title", label: "Title", type: "text", group: "Basic Info" },
  { key: "industry", label: "Industry", type: "text", group: "Company" },
  { key: "website", label: "Website", type: "text", group: "Company" },
  {
    key: "status",
    label: "Status",
    type: "enum",
    enumValues: ["new", "contacted", "qualified", "unqualified", "converted"],
    group: "Basic Info",
  },
  {
    key: "source",
    label: "Source",
    type: "enum",
    // Channel values from the leads.source admin picklist.
    // sql/mql retired from Source (Joe 2026-07-14): channel only; stage lives
    // in Qualification. Historic rows were migrated by 20260715150000.
    enumValues: ["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "other"],
    group: "Basic Info",
  },
  { key: "description", label: "Description", type: "text", group: "Basic Info" },
  { key: "employees", label: "Employees", type: "number", group: "Company" },
  { key: "annual_revenue", label: "Annual Revenue", type: "currency", group: "Company" },
  { key: "street", label: "Street", type: "text", group: "Address" },
  { key: "city", label: "City", type: "text", group: "Address" },
  { key: "state", label: "State", type: "text", group: "Address" },
  { key: "zip", label: "Zip", type: "text", group: "Address" },
  { key: "country", label: "Country", type: "text", group: "Address" },
  {
    key: "owner",
    label: "Owner",
    type: "text",
    joinTable: "user_profiles",
    joinField: "full_name",
    group: "Relations",
  },
  { key: "converted_at", label: "Converted At", type: "date", group: "System" },
  { key: "created_at", label: "Created", type: "date", group: "System" },
  { key: "updated_at", label: "Updated", type: "date", group: "System" },
];

const leadFilterColumns: FilterColumnDef[] = [
  { filterKey: "id", label: "ID", type: "text" },
  { filterKey: "first_name", label: "First Name", type: "text" },
  { filterKey: "last_name", label: "Last Name", type: "text" },
  { filterKey: "email", label: "Email", type: "text" },
  { filterKey: "phone", label: "Phone", type: "text" },
  { filterKey: "company", label: "Company", type: "text" },
  { filterKey: "title", label: "Title", type: "text" },
  { filterKey: "industry", label: "Industry", type: "text" },
  { filterKey: "website", label: "Website", type: "text" },
  {
    filterKey: "status",
    label: "Status",
    type: "enum",
    enumValues: ["new", "contacted", "qualified", "unqualified", "converted"],
  },
  {
    filterKey: "source",
    label: "Source",
    type: "enum",
    // Data-driven from the leads.source admin picklist; enumValues (canonical
    // LeadSource set — src/types/crm.ts) is the loading fallback.
    // sql/mql retired from Source (Joe 2026-07-14): channel only; stage lives
    // in Qualification. Historic rows were migrated by 20260715150000.
    enumValues: ["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "other"],
    picklistFieldKey: "leads.source",
  },
  { filterKey: "description", label: "Description", type: "text" },
  { filterKey: "employees", label: "Employees", type: "number" },
  { filterKey: "annual_revenue", label: "Annual Revenue", type: "currency" },
  { filterKey: "street", label: "Street", type: "text" },
  { filterKey: "city", label: "City", type: "text" },
  { filterKey: "state", label: "State", type: "text" },
  { filterKey: "zip", label: "Zip", type: "text" },
  { filterKey: "country", label: "Country", type: "text" },
  { filterKey: "owner_user_id", label: "Owner", type: "user" },
  { filterKey: "converted_at", label: "Converted At", type: "date" },
  { filterKey: "created_at", label: "Created", type: "date" },
  { filterKey: "updated_at", label: "Updated", type: "date" },
];

// ---------------------------------------------------------------------------
// Entity definitions
// ---------------------------------------------------------------------------

export const ENTITY_DEFS: Record<string, EntityDef> = {
  accounts: {
    key: "accounts",
    label: "Accounts",
    table: "accounts",
    columns: accountColumns,
    filterColumns: accountFilterColumns,
    defaultColumns: ["name", "customer_status", "industry", "owner", "current_contract_end_date"],
    joins: "*, owner:user_profiles!owner_user_id(full_name)",
  },

  contacts: {
    key: "contacts",
    label: "Contacts",
    table: "contacts",
    columns: contactColumns,
    filterColumns: contactFilterColumns,
    defaultColumns: ["first_name", "last_name", "email", "title", "account", "is_primary"],
    joins: "*, account:accounts!account_id(name), owner:user_profiles!owner_user_id(full_name)",
  },

  opportunities: {
    key: "opportunities",
    label: "Opportunities",
    table: "opportunities",
    columns: opportunityColumns,
    filterColumns: opportunityFilterColumns,
    defaultColumns: ["name", "stage", "amount", "account", "owner", "expected_close_date"],
    joins: "*, account:accounts!account_id(name), owner:user_profiles!owner_user_id(full_name), primary_contact:contacts!primary_contact_id(first_name, last_name)",
  },

  activities: {
    key: "activities",
    label: "Activities",
    table: "activities",
    columns: activityColumns,
    filterColumns: activityFilterColumns,
    defaultColumns: ["activity_type", "subject", "account", "owner", "due_at", "completed_at"],
    joins: "*, account:accounts!account_id(name), contact:contacts!contact_id(first_name, last_name), opportunity:opportunities!opportunity_id(name), owner:user_profiles!owner_user_id(full_name)",
  },

  opportunity_products: {
    key: "opportunity_products",
    label: "Opportunity Products",
    table: "opportunity_products",
    columns: opportunityProductColumns,
    filterColumns: opportunityProductFilterColumns,
    defaultColumns: ["product", "opportunity", "quantity", "unit_price", "arr_amount"],
    joins: "*, product:products!product_id(name, code), opportunity:opportunities!opportunity_id(name)",
  },

  // RETIRED 2026-07-20 (lead-type retirement): kept ONLY so saved reports
  // built before the cutover keep rendering (against the frozen, all-
  // archived leads table → empty results) instead of crashing getEntityDef.
  // Hidden from pickers via the ENTITY_KEYS filter below.
  leads: {
    key: "leads",
    label: "Leads (retired)",
    table: "leads",
    columns: leadColumns,
    filterColumns: leadFilterColumns,
    defaultColumns: ["first_name", "last_name", "company", "status", "source", "owner", "created_at"],
    joins: "*, owner:user_profiles!owner_user_id(full_name)",
  },
};

// 'leads' is def-only (legacy saved reports) — never offered in pickers.
export const ENTITY_KEYS = Object.keys(ENTITY_DEFS).filter(
  (k) => k !== "leads",
) as Array<keyof typeof ENTITY_DEFS>;

export function getEntityDef(entityKey: string): EntityDef {
  const def = ENTITY_DEFS[entityKey];
  if (!def) throw new Error(`Unknown entity: ${entityKey}`);
  return def;
}

export function getColumnDef(entityKey: string, columnKey: string): ColumnDef | undefined {
  const entity = getEntityDef(entityKey);
  return entity.columns.find((c) => c.key === columnKey);
}

/**
 * Get a filter column definition by its filterKey.
 */
export function getFilterColumnDef(entityKey: string, filterKey: string): FilterColumnDef | undefined {
  const entity = getEntityDef(entityKey);
  return entity.filterColumns.find((c) => c.filterKey === filterKey);
}

/** All relation filter types that require a lookup dropdown. */
export const RELATION_FILTER_TYPES: readonly RelationFilterType[] = [
  "user",
  "account",
  "contact",
  "opportunity",
] as const;

/** Check whether a filter type is a relation type requiring a lookup dropdown. */
export function isRelationFilterType(type: string): type is RelationFilterType {
  return (RELATION_FILTER_TYPES as readonly string[]).includes(type);
}

/**
 * For relation filter types we treat them like text (UUID) for operator
 * purposes — they support "eq", "neq", "is_null", "is_not_null".
 */
function resolveOperatorType(type: FilterColumnDef["type"]): ColumnDef["type"] {
  if (isRelationFilterType(type)) return "enum";
  return type;
}

/**
 * The relative-date operators (due_within_days / overdue) postdate the
 * ReportFilter["operator"] union in src/types/crm.ts (owned by the parallel
 * account-status work, so not widened here). Saved configs are JSON, so the
 * runtime value carries them fine — use this union wherever a filter's
 * operator is switched on.
 */
export type ReportFilterOperator = ReportFilter["operator"] | "due_within_days" | "overdue";

export const FILTER_OPERATORS: Array<{
  value: string;
  label: string;
  applicableTo: Array<ColumnDef["type"]>;
}> = [
  { value: "eq", label: "equals", applicableTo: ["text", "number", "currency", "date", "enum", "boolean"] },
  { value: "neq", label: "not equals", applicableTo: ["text", "number", "currency", "date", "enum", "boolean"] },
  { value: "gt", label: "greater than", applicableTo: ["number", "currency", "date"] },
  { value: "gte", label: "greater or equal", applicableTo: ["number", "currency", "date"] },
  { value: "lt", label: "less than", applicableTo: ["number", "currency", "date"] },
  { value: "lte", label: "less or equal", applicableTo: ["number", "currency", "date"] },
  { value: "like", label: "contains (case-sensitive)", applicableTo: ["text"] },
  { value: "ilike", label: "contains", applicableTo: ["text"] },
  // "is one of" = multi-value OR filter. Available for enums (pick several) and
  // free-text/number fields (comma-separated). Summer: filter a report by, e.g.,
  // Oregon AND Washington at once instead of being stuck with one value.
  { value: "in", label: "is one of", applicableTo: ["text", "number", "currency", "enum"] },
  // Relative-date windows (2026-07 restructure, built for Next Follow Up):
  // "due within N days" = today .. today+N inclusive (value = N, a day
  // count); "overdue" = strictly before today (needs no value; NULLs never
  // match). Both re-evaluate against today each run — no hardcoded dates.
  { value: "due_within_days", label: "due within N days", applicableTo: ["date"] },
  { value: "overdue", label: "overdue (before today)", applicableTo: ["date"] },
  { value: "is_null", label: "is empty", applicableTo: ["text", "number", "currency", "date", "enum", "boolean"] },
  { value: "is_not_null", label: "is not empty", applicableTo: ["text", "number", "currency", "date", "enum", "boolean"] },
];

export function getOperatorsForType(type: FilterColumnDef["type"]) {
  const resolved = resolveOperatorType(type);
  return FILTER_OPERATORS.filter((op) => op.applicableTo.includes(resolved));
}
