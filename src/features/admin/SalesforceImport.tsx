import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { employeesToFteRange } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Download,
  Clock,
  RotateCcw,
  Pencil,
  Trash2,
} from "lucide-react";

/* ================================================================
   Types
   ================================================================ */

type EntityType = "accounts" | "contacts" | "opportunities" | "leads" | "products" | "price_books" | "price_book_entries";

type MappingConfidence = "exact" | "fuzzy" | "unmapped";

interface ColumnMapping {
  csvColumn: string;
  crmField: string;
  confidence: MappingConfidence;
}

interface FailedRow {
  rowNumber: number;
  csvData: Record<string, string>;
  crmRecord: Record<string, unknown>;
  error: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
  failedRows: FailedRow[];
  importedIds: string[];
  entity: EntityType;
  timestamp: string;
}

interface ValidationIssue {
  rowNumber: number;
  type: "warning" | "skip";
  message: string;
}

interface ValidationSummary {
  willImport: number;
  warnings: ValidationIssue[];
  willSkip: ValidationIssue[];
}

/* ================================================================
   CSV Parser - handles quoted fields, newlines inside quotes, etc.
   ================================================================ */

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip next quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        current = "";
        if (ch === "\r") i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field / row
  row.push(current.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

/* ================================================================
   FTE-range cleanup helpers
   ----------------------------------------------------------------
   Medcurity's Salesforce data has FTE ranges baked into product /
   price-book names as prefixes like "51-100 Security Risk Assessment"
   or "1-20 Price Book". The CRM schema expects ONE product ("Security
   Risk Assessment") with per-tier entries in price_book_entries whose
   fte_range column carries "51-100", "1-20", etc.

   During import we:
     1. Detect FTE prefixes on product + price-book names
     2. Strip the prefix so the canonical name survives
     3. Dedupe products by code so the 157 SF products collapse to ~16
     4. Collapse all tier-specific SF price books into ONE canonical
        "Medcurity Standard" price book
     5. For price_book_entries, parse the fte_range from the original
        SF pricebook name and set it on the entry, while pointing
        price_book_id at the single master book.
   ================================================================ */

// Matches leading FTE tier prefixes like "1-20", "21-50", "5001-10000",
// "501+", followed by one or more spaces / hyphens / underscores.
// We anchor to start-of-string so a product called "SRA for 1-20 orgs"
// isn't accidentally stripped.
const FTE_PREFIX_RE = /^(\d+-\d+|\d+\+)[\s_-]+/;

// The single canonical price book name used after cleanup.
const MASTER_PRICE_BOOK_NAME = "Medcurity Standard";

function stripFtePrefix(value: unknown): { base: string; fteRange: string | null } {
  if (typeof value !== "string") {
    return { base: (value as string) ?? "", fteRange: null };
  }
  const trimmed = value.trim();
  const match = trimmed.match(FTE_PREFIX_RE);
  if (!match) return { base: trimmed, fteRange: null };
  // match[1] is the range alone ("51-100"), match[0] includes the trailing separator.
  return { base: trimmed.slice(match[0].length).trim(), fteRange: match[1] };
}

/* ================================================================
   Field mappings per entity
   ================================================================ */

const ACCOUNT_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  "account id": "sf_id",
  "account name": "name",
  name: "name",
  // Owner — only map the 005 ID column, NOT the text name column
  // (text "Account Owner" column causes false warnings; users can manually map if needed)
  ownerid: "owner_user_id",
  "owner id": "owner_user_id",
  // Basic info
  industry: "industry",
  website: "website",
  phone: "phone",
  description: "description",
  type: "account_type",
  "annual revenue": "annual_revenue",
  annualrevenue: "annual_revenue",
  employees: "employees",
  "number of employees": "employees",
  numberofemployees: "employees",
  // Billing address
  "billing street": "billing_street",
  billingstreet: "billing_street",
  "billing city": "billing_city",
  billingcity: "billing_city",
  "billing state/province": "billing_state",
  "billing state": "billing_state",
  billingstate: "billing_state",
  "billing zip/postal code": "billing_zip",
  "billing zip": "billing_zip",
  "billing postal code": "billing_zip",
  billingpostalcode: "billing_zip",
  "billing country": "billing_country",
  billingcountry: "billing_country",
  "billing latitude": "billing_latitude",
  billinglatitude: "billing_latitude",
  "billing longitude": "billing_longitude",
  billinglongitude: "billing_longitude",
  // Shipping address
  "shipping street": "shipping_street",
  shippingstreet: "shipping_street",
  "shipping city": "shipping_city",
  shippingcity: "shipping_city",
  "shipping state/province": "shipping_state",
  "shipping state": "shipping_state",
  shippingstate: "shipping_state",
  "shipping zip/postal code": "shipping_zip",
  "shipping zip": "shipping_zip",
  "shipping postal code": "shipping_zip",
  shippingpostalcode: "shipping_zip",
  "shipping country": "shipping_country",
  shippingcountry: "shipping_country",
  "shipping latitude": "shipping_latitude",
  shippinglatitude: "shipping_latitude",
  "shipping longitude": "shipping_longitude",
  shippinglongitude: "shipping_longitude",
  // Misc fields
  fax: "fax",
  sic: "sic",
  "sic desc": "sic_description",
  sicdesc: "sic_description",
  rating: "rating",
  site: "site",
  "ticker symbol": "ticker_symbol",
  tickersymbol: "ticker_symbol",
  ownership: "ownership",
  "last activity date": "last_activity_date",
  lastactivitydate: "last_activity_date",
  "do not contact": "do_not_contact",
  // Source & partner
  "lead source": "lead_source",
  leadsource: "lead_source",
  "lead source detail": "lead_source_detail",
  "partner account": "partner_account",
  "referring partner": "partner_account",
  "partner prospect": "partner_prospect",
  "partner source": "lead_source_detail",
  "account source": "lead_source",
  // Company details
  locations: "locations",
  status: "status",
  "active since": "active_since",
  // FTE — support both "FTEs" label and "FTEs__c" API name
  ftes: "fte_count",
  "ftes__c": "fte_count",
  "fte count": "fte_count",
  "fte range": "fte_range",
  "fte_range__c": "fte_range",
  // Financial
  "lifetime value": "lifetime_value",
  lifetime_value__c: "lifetime_value",
  // Settings
  "time zone": "timezone",
  timezone: "timezone",
  "renewal type": "renewal_type",
  renewal_type__c: "renewal_type",
  "account number": "account_number",
  accountnumber: "account_number",
  // SF metadata
  "created date": "sf_created_date",
  createddate: "sf_created_date",
  "created by id": "sf_created_by",
  createdbyid: "sf_created_by",
  "last modified date": "sf_last_modified_date",
  lastmodifieddate: "sf_last_modified_date",
  "last modified by id": "sf_last_modified_by",
  lastmodifiedbyid: "sf_last_modified_by",
  // Parent & hierarchy
  "parent id": "parent_account_id",
  parentid: "parent_account_id",
  "number of providers": "number_of_providers",
  number_of_providers__c: "number_of_providers",
  // Custom fields
  project: "project",
  project__c: "project",
  "churn amount": "churn_amount",
  churn_amount__c: "churn_amount",
  "churn date": "churn_date",
  churn_date__c: "churn_date",
  contracts: "contracts",
  contracts__c: "contracts",
  "next steps": "next_steps",
  next_steps__c: "next_steps",
  "priority account": "priority_account",
  priority_account__c: "priority_account",
  "every other year": "every_other_year",
  every_other_year__c: "every_other_year",
};

const CONTACT_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  contactid: "sf_id",
  "contact id": "sf_id",
  "first name": "first_name",
  firstname: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  name: "first_name", // Will need manual adjustment if full name
  email: "email",
  "email address": "email",
  title: "title",
  phone: "phone",
  "phone number": "phone",
  "business phone": "phone",
  mobilephone: "mobile_phone",
  "mobile phone": "mobile_phone",
  "mobile number": "mobile_phone",
  homephone: "home_phone",
  "home phone": "home_phone",
  otherphone: "other_phone",
  "other phone": "other_phone",
  fax: "fax",
  salutation: "salutation",
  // References
  accountid: "account_id_sf_lookup",
  "account id": "account_id_sf_lookup",
  "account name": "account_id_sf_lookup",
  ownerid: "owner_user_id",
  "owner id": "owner_user_id",
  "contact owner": "owner_user_id",
  reportstoid: "reports_to",
  "reports to id": "reports_to",
  "reports to": "reports_to",
  // Details
  department: "department",
  description: "description",
  "contact description": "description",
  "do not call": "do_not_contact",
  donotcall: "do_not_contact",
  "has opted out of email": "do_not_contact",
  hasoptedoutofemail: "do_not_contact",
  "email opt out": "do_not_contact",
  hasoptedoutoffax: "do_not_contact",
  "lead source": "lead_source",
  leadsource: "lead_source",
  "is primary": "is_primary",
  birthdate: "birthdate",
  "date of birth": "birthdate",
  assistantname: "assistant_name",
  "assistant name": "assistant_name",
  "assistant's name": "assistant_name",
  assistantphone: "assistant_phone",
  "assistant phone": "assistant_phone",
  linkedin: "linkedin_url",
  "linkedin url": "linkedin_url",
  "linkedin profile": "linkedin_url",
  linkedin__c: "linkedin_url",
  // Mailing address
  "mailing street": "mailing_street",
  mailingstreet: "mailing_street",
  "mailing city": "mailing_city",
  mailingcity: "mailing_city",
  "mailing state/province": "mailing_state",
  "mailing state": "mailing_state",
  mailingstate: "mailing_state",
  "mailing zip/postal code": "mailing_zip",
  "mailing zip": "mailing_zip",
  mailingpostalcode: "mailing_zip",
  "mailing country": "mailing_country",
  mailingcountry: "mailing_country",
  // Other address
  "other street": "other_street",
  otherstreet: "other_street",
  "other city": "other_city",
  othercity: "other_city",
  "other state/province": "other_state",
  "other state": "other_state",
  otherstate: "other_state",
  "other zip/postal code": "other_zip",
  "other zip": "other_zip",
  otherpostalcode: "other_zip",
  "other country": "other_country",
  othercountry: "other_country",
  // Email bounce
  emailbouncedreason: "email_bounced_reason",
  "email bounced reason": "email_bounced_reason",
  emailbounceddate: "email_bounced_date",
  "email bounced date": "email_bounced_date",
  // Activity
  lastactivitydate: "last_activity_date",
  "last activity date": "last_activity_date",
  "last activity": "last_activity_date",
  // MQL/SQL
  "mql date": "mql_date",
  mql_date__c: "mql_date",
  mql__c: "mql_date",
  "mql": "mql_date",
  "sql date": "sql_date",
  sql_date__c: "sql_date",
  sql__c: "sql_date",
  "sql": "sql_date",
  // Partner & next steps
  "partner source": "partner_source",
  partner_source__c: "partner_source",
  partner__c: "partner_source",
  "partner": "partner_source",
  "next steps": "next_steps",
  next_steps__c: "next_steps",
  "next step": "next_steps",
  next_step__c: "next_steps",
  // SF metadata
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  createdbyid: "sf_created_by",
  "created by id": "sf_created_by",
  "created by": "sf_created_by",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
  lastmodifiedbyid: "sf_last_modified_by",
  "last modified by id": "sf_last_modified_by",
  "last modified by": "sf_last_modified_by",
};

const OPPORTUNITY_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  opportunityid: "sf_id",
  "opportunity id": "sf_id",
  name: "name",
  "opportunity name": "name",
  // References
  accountid: "account_id_sf_lookup",
  "account id": "account_id_sf_lookup",
  "account name": "account_id_sf_lookup",
  ownerid: "owner_user_id",
  "owner id": "owner_user_id",
  "opportunity owner": "owner_user_id",
  contactid: "primary_contact_id_sf_lookup",
  "contact id": "primary_contact_id_sf_lookup",
  "primary contact id": "primary_contact_id_sf_lookup",
  "primary contact": "primary_contact_id_sf_lookup",
  // Stage & type
  stagename: "stage",
  stage: "stage",
  "stage name": "stage",
  type: "kind",
  "opportunity type": "kind",
  team: "team",
  team__c: "team",
  isclosed: "is_closed",
  "is closed": "is_closed",
  iswon: "is_won",
  "is won": "is_won",
  forecastcategory: "forecast_category",
  "forecast category": "forecast_category",
  forecastcategoryname: "forecast_category",
  "forecast category name": "forecast_category",
  stagesortorder: "stage_sort_order",
  "stage sort order": "stage_sort_order",
  // Contract reference (SF Contract object, NOT contract_year)
  contractid: "sf_contract_id",
  "contract id": "sf_contract_id",
  // Product / pricebook
  hasopportunitylineitem: "has_opportunity_line_items",
  "has opportunity line item": "has_opportunity_line_items",
  pricebook2id: "sf_pricebook_id",
  "price book id": "sf_pricebook_id",
  "pricebook id": "sf_pricebook_id",
  // Quantity
  totalopportunityquantity: "total_opportunity_quantity",
  "total opportunity quantity": "total_opportunity_quantity",
  total_opportunity_quantity__c: "total_opportunity_quantity",
  // Automation
  created_by_automation__c: "created_by_automation",
  "created by automation": "created_by_automation",
  // Financial
  amount: "amount",
  discount: "discount",
  discount__c: "discount",
  subtotal: "subtotal",
  subtotal__c: "subtotal",
  probability: "probability",
  "probability (%)": "probability",
  expectedrevenue: "expected_revenue",
  "expected revenue": "expected_revenue",
  service_amount__c: "service_amount",
  "service amount": "service_amount",
  product_amount__c: "product_amount",
  "product amount": "product_amount",
  services_included__c: "services_included",
  "services included": "services_included",
  service_description__c: "service_description",
  "service description": "service_description",
  // Dates
  closedate: "close_date",
  "close date": "close_date",
  "expected close date": "expected_close_date",
  expected_close_date__c: "expected_close_date",
  "contract start date": "contract_start_date",
  contract_start_date__c: "contract_start_date",
  "contract end date": "contract_end_date",
  contract_end_date__c: "contract_end_date",
  "maturity date": "contract_end_date",
  maturity_date__c: "contract_end_date",
  "current contract start date": "contract_start_date",
  "current contract end date": "contract_end_date",
  current_contract_start_date__c: "contract_start_date",
  current_contract_end_date__c: "contract_end_date",
  // Contract details
  "contract length": "contract_length_months",
  "contract length (months)": "contract_length_months",
  contract_length__c: "contract_length_months",
  contract_length_months__c: "contract_length_months",
  "contract year": "contract_year",
  contract_year__c: "contract_year",
  "payment frequency": "payment_frequency",
  payment_frequency__c: "payment_frequency",
  "cycle count": "cycle_count",
  cycle_count__c: "cycle_count",
  "auto renewal": "auto_renewal",
  auto_renewal__c: "auto_renewal",
  "one time project": "one_time_project",
  one_time_project__c: "one_time_project",
  "promo code": "promo_code",
  promo_code__c: "promo_code",
  "follow up": "follow_up",
  follow_up__c: "follow_up",
  // Source
  "lead source": "lead_source",
  leadsource: "lead_source",
  "lead source detail": "lead_source_detail",
  lead_source_detail__c: "lead_source_detail",
  campaignid: "campaign_id",
  "campaign id": "campaign_id",
  "campaign": "campaign_id",
  // Details
  description: "description",
  "next step": "next_step",
  nextstep: "next_step",
  next_step__c: "next_step",
  notes: "notes",
  notes__c: "notes",
  "loss reason": "loss_reason",
  loss_reason__c: "loss_reason",
  // FTE snapshot
  ftes__c: "fte_count",
  "fte count": "fte_count",
  fte_count__c: "fte_count",
  "number of ftes": "fte_count",
  fte_range__c: "fte_range",
  "fte range": "fte_range",
  // Activity
  lastactivitydate: "last_activity_date",
  "last activity date": "last_activity_date",
  "last activity": "last_activity_date",
  laststagechangedate: "last_stage_change_date",
  "last stage change date": "last_stage_change_date",
  // SF metadata
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  createdbyid: "sf_created_by",
  "created by id": "sf_created_by",
  "created by": "sf_created_by",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
  lastmodifiedbyid: "sf_last_modified_by",
  "last modified by id": "sf_last_modified_by",
  "last modified by": "sf_last_modified_by",
  fiscalyear: "fiscal_year",
  "fiscal year": "fiscal_year",
  fiscalquarter: "fiscal_quarter",
  "fiscal quarter": "fiscal_quarter",
};

const LEAD_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  leadid: "sf_id",
  "lead id": "sf_id",
  "first name": "first_name",
  firstname: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  name: "first_name",
  salutation: "salutation",
  email: "email",
  "email address": "email",
  company: "company",
  "company name": "company",
  // Status & source
  status: "status",
  "lead status": "status",
  "lead source": "source",
  leadsource: "source",
  rating: "rating",
  "lead rating": "rating",
  // Owner
  ownerid: "owner_user_id",
  "owner id": "owner_user_id",
  "lead owner": "owner_user_id",
  // Contact info
  phone: "phone",
  "phone number": "phone",
  mobilephone: "mobile_phone",
  "mobile phone": "mobile_phone",
  "mobile number": "mobile_phone",
  fax: "fax",
  title: "title",
  "job title": "title",
  // Company details
  industry: "industry",
  website: "website",
  employees: "employees",
  numberofemployees: "employees",
  "number of employees": "employees",
  "annual revenue": "annual_revenue",
  annualrevenue: "annual_revenue",
  // Address
  street: "street",
  address: "street",
  city: "city",
  state: "state",
  "state/province": "state",
  "zip/postal code": "zip",
  postalcode: "zip",
  zip: "zip",
  "postal code": "zip",
  country: "country",
  // Details
  description: "description",
  "lead description": "description",
  // Conversion
  isconverted: "is_converted",
  "is converted": "is_converted",
  converteddate: "converted_at",
  "converted date": "converted_at",
  convertedaccountid: "converted_account_id",
  "converted account id": "converted_account_id",
  convertedcontactid: "converted_contact_id",
  "converted contact id": "converted_contact_id",
  convertedopportunityid: "converted_opportunity_id",
  "converted opportunity id": "converted_opportunity_id",
  // Activity
  lastactivitydate: "last_activity_date",
  "last activity date": "last_activity_date",
  "last activity": "last_activity_date",
  // MQL
  "mql date": "mql_date",
  mql_date__c: "mql_date",
  mql__c: "mql_date",
  "mql": "mql_date",
  // Partner & next steps
  "partner source": "partner_source",
  partner_source__c: "partner_source",
  "next steps": "next_steps",
  next_steps__c: "next_steps",
  "next step": "next_steps",
  // Opt-out & do-not flags
  hasoptedoutofemail: "has_opted_out_of_email",
  "has opted out of email": "has_opted_out_of_email",
  emailoptout: "has_opted_out_of_email",
  "email opt out": "has_opted_out_of_email",
  has_opted_out_of_email__c: "has_opted_out_of_email",
  donotcall: "do_not_call",
  "do not call": "do_not_call",
  do_not_call__c: "do_not_call",
  donotmarketto: "do_not_market_to",
  "do not market to": "do_not_market_to",
  do_not_market_to__c: "do_not_market_to",
  // Type
  type: "lead_type",
  "lead type": "lead_type",
  type__c: "lead_type",
  // Notes / comments
  notes: "notes",
  "lead notes": "notes",
  notes__c: "notes",
  comments: "comments",
  "lead comments": "comments",
  comments__c: "comments",
  // LinkedIn
  linkedin: "linkedin_url",
  "linkedin profile": "linkedin_url",
  "linkedin url": "linkedin_url",
  linkedin_profile__c: "linkedin_url",
  linkedin_url__c: "linkedin_url",
  linkedinprofile: "linkedin_url",
  linkedinurl: "linkedin_url",
  // Priority
  "priority lead": "priority_lead",
  priority_lead__c: "priority_lead",
  prioritylead: "priority_lead",
  // Email bounce
  emailbouncedreason: "email_bounced_reason",
  "email bounced reason": "email_bounced_reason",
  emailbounceddate: "email_bounced_date",
  "email bounced date": "email_bounced_date",
  // SF metadata
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  createdbyid: "sf_created_by",
  "created by id": "sf_created_by",
  "created by": "sf_created_by",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
  lastmodifiedbyid: "sf_last_modified_by",
  "last modified by id": "sf_last_modified_by",
  "last modified by": "sf_last_modified_by",
};

/* ---- Products ---- */
const PRODUCT_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  product2id: "sf_id",
  "product id": "sf_id",
  productcode: "code",
  "product code": "code",
  code: "code",
  name: "name",
  "product name": "name",
  // Details
  family: "product_family",
  "product family": "product_family",
  productfamily: "product_family",
  description: "description",
  "product description": "description",
  isactive: "is_active",
  "is active": "is_active",
  active: "is_active",
  // Pricing
  "default arr": "default_arr",
  default_arr__c: "default_arr",
  defaultarr: "default_arr",
  category: "category",
  "product category": "category",
  "pricing model": "pricing_model",
  pricing_model__c: "pricing_model",
  pricingmodel: "pricing_model",
  // SF metadata
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
};

/* ---- Price Books ---- */
const PRICE_BOOK_FIELDS: Record<string, string> = {
  id: "sf_id",
  pricebook2id: "sf_id",
  "price book id": "sf_id",
  "pricebook id": "sf_id",
  name: "name",
  "price book name": "name",
  pricebookname: "name",
  description: "description",
  isactive: "is_active",
  "is active": "is_active",
  active: "is_active",
  isstandard: "is_default",
  "is standard": "is_default",
  "is default": "is_default",
  effectivedate: "effective_date",
  "effective date": "effective_date",
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
};

/* ---- Price Book Entries ---- */
const PRICE_BOOK_ENTRY_FIELDS: Record<string, string> = {
  // Identity
  id: "sf_id",
  pricebookentryid: "sf_id",
  "pricebook entry id": "sf_id",
  // References
  pricebook2id: "price_book_sf_id",
  "price book id": "price_book_sf_id",
  "pricebook id": "price_book_sf_id",
  product2id: "product_sf_id",
  "product id": "product_sf_id",
  "product 2 id": "product_sf_id",
  productcode: "product_code_lookup",
  "product code": "product_code_lookup",
  // Pricing
  unitprice: "unit_price",
  "unit price": "unit_price",
  "list price": "unit_price",
  listprice: "unit_price",
  price: "unit_price",
  // FTE range
  "fte range": "fte_range",
  fte_range__c: "fte_range",
  fterange: "fte_range",
  // Status
  isactive: "is_active",
  "is active": "is_active",
  active: "is_active",
  // Product name (informational, for display)
  name: "product_name",
  "product name": "product_name",
  // Price book name (informational)
  "pricebook name": "price_book_name",
  "price book name": "price_book_name",
  pricebook2name: "price_book_name",
  // SF metadata
  createddate: "sf_created_date",
  "created date": "sf_created_date",
  lastmodifieddate: "sf_last_modified_date",
  "last modified date": "sf_last_modified_date",
};

function getFieldMap(entity: EntityType): Record<string, string> {
  switch (entity) {
    case "accounts":
      return ACCOUNT_FIELDS;
    case "contacts":
      return CONTACT_FIELDS;
    case "opportunities":
      return OPPORTUNITY_FIELDS;
    case "leads":
      return LEAD_FIELDS;
    case "products":
      return PRODUCT_FIELDS;
    case "price_books":
      return PRICE_BOOK_FIELDS;
    case "price_book_entries":
      return PRICE_BOOK_ENTRY_FIELDS;
  }
}

/** All possible CRM target fields for a given entity. */
function getCRMFields(entity: EntityType): string[] {
  switch (entity) {
    case "accounts":
      return [
        // Basic
        "name",
        "sf_id",
        "owner_user_id",
        "account_type",
        "account_number",
        "status",
        "lifecycle_status",
        "industry",
        "website",
        "parent_account_id",
        // Contact
        "phone",
        "phone_extension",
        // Billing Address
        "billing_street",
        "billing_city",
        "billing_state",
        "billing_zip",
        "billing_country",
        // Shipping Address
        "shipping_street",
        "shipping_city",
        "shipping_state",
        "shipping_zip",
        "shipping_country",
        // Geo-coordinates
        "billing_latitude",
        "billing_longitude",
        "shipping_latitude",
        "shipping_longitude",
        // Company Details
        "fte_count",
        "fte_range",
        "employees",
        "number_of_providers",
        "locations",
        "annual_revenue",
        "timezone",
        // Contract & Renewal
        "active_since",
        "renewal_type",
        "every_other_year",
        "contracts",
        "acv",
        "lifetime_value",
        "churn_amount",
        "churn_date",
        "current_contract_start_date",
        "current_contract_end_date",
        "current_contract_length_months",
        // Partner
        "partner_account",
        "partner_prospect",
        "lead_source",
        "lead_source_detail",
        // Additional
        "fax",
        "sic",
        "sic_description",
        "ownership",
        "rating",
        "site",
        "ticker_symbol",
        "last_activity_date",
        "do_not_contact",
        "priority_account",
        "project",
        "description",
        "notes",
        "next_steps",
        // SF History
        "sf_created_by",
        "sf_created_date",
        "sf_last_modified_by",
        "sf_last_modified_date",
      ];
    case "contacts":
      return [
        // Identity
        "first_name",
        "last_name",
        "email",
        "title",
        "phone",
        "mobile_phone",
        "home_phone",
        "other_phone",
        "fax",
        "salutation",
        "sf_id",
        // References
        "account_id_sf_lookup",
        "owner_user_id",
        "reports_to",
        // Details
        "is_primary",
        "department",
        "description",
        "linkedin_url",
        "do_not_contact",
        "lead_source",
        "lead_source_detail",
        "birthdate",
        "assistant_name",
        "assistant_phone",
        // Mailing address
        "mailing_street",
        "mailing_city",
        "mailing_state",
        "mailing_zip",
        "mailing_country",
        // Other address
        "other_street",
        "other_city",
        "other_state",
        "other_zip",
        "other_country",
        // MQL/SQL
        "mql_date",
        "sql_date",
        // Partner & next steps
        "partner_source",
        "next_steps",
        // Email bounce
        "email_bounced_reason",
        "email_bounced_date",
        // Activity
        "last_activity_date",
        // SF History
        "sf_created_by",
        "sf_created_date",
        "sf_last_modified_by",
        "sf_last_modified_date",
      ];
    case "opportunities":
      return [
        "name",
        "sf_id",
        "account_id_sf_lookup",
        "primary_contact_id_sf_lookup",
        "owner_user_id",
        "stage",
        "amount",
        "close_date",
        "expected_close_date",
        "kind",
        "team",
        "probability",
        // Status flags
        "is_closed",
        "is_won",
        "forecast_category",
        "stage_sort_order",
        // Automation
        "created_by_automation",
        // SF references
        "sf_contract_id",
        "has_opportunity_line_items",
        "sf_pricebook_id",
        "total_opportunity_quantity",
        // Contract
        "contract_start_date",
        "contract_end_date",
        "contract_length_months",
        "contract_year",
        // Financial
        "discount",
        "subtotal",
        "expected_revenue",
        "service_amount",
        "product_amount",
        "services_included",
        "service_description",
        "promo_code",
        "payment_frequency",
        "cycle_count",
        "auto_renewal",
        "one_time_project",
        // FTE snapshot
        "fte_count",
        "fte_range",
        // Lead / Source
        "lead_source",
        "lead_source_detail",
        "campaign_id",
        // Details
        "description",
        "notes",
        "next_step",
        "follow_up",
        "loss_reason",
        // Activity
        "last_activity_date",
        "last_stage_change_date",
        // SF History
        "sf_created_by",
        "sf_created_date",
        "sf_last_modified_by",
        "sf_last_modified_date",
        "fiscal_year",
        "fiscal_quarter",
      ];
    case "leads":
      return [
        // Identity
        "first_name",
        "last_name",
        "email",
        "salutation",
        "company",
        "sf_id",
        // Status & source
        "status",
        "source",
        "rating",
        // Owner
        "owner_user_id",
        // Contact info
        "phone",
        "mobile_phone",
        "fax",
        "title",
        // Company details
        "industry",
        "website",
        "employees",
        "annual_revenue",
        // Address
        "street",
        "city",
        "state",
        "zip",
        "country",
        // Details
        "description",
        "lead_source_detail",
        "qualification",
        "score",
        // MQL
        "mql_date",
        // Partner & next steps
        "partner_source",
        "next_steps",
        // Opt-out & flags
        "has_opted_out_of_email",
        "do_not_call",
        "do_not_market_to",
        // Type / notes
        "lead_type",
        "notes",
        "comments",
        // LinkedIn
        "linkedin_url",
        // Priority
        "priority_lead",
        // Conversion
        "is_converted",
        "converted_at",
        "converted_account_id",
        "converted_contact_id",
        "converted_opportunity_id",
        // Email bounce
        "email_bounced_reason",
        "email_bounced_date",
        // Activity
        "last_activity_date",
        // SF History
        "sf_created_by",
        "sf_created_date",
        "sf_last_modified_by",
        "sf_last_modified_date",
      ];
    case "products":
      return [
        "sf_id",
        "code",
        "name",
        "product_family",
        "description",
        "is_active",
        "default_arr",
        "category",
        "pricing_model",
        "sf_created_date",
        "sf_last_modified_date",
      ];
    case "price_books":
      return [
        "sf_id",
        "name",
        "description",
        "is_active",
        "is_default",
        "effective_date",
        "sf_created_date",
        "sf_last_modified_date",
      ];
    case "price_book_entries":
      return [
        "sf_id",
        "price_book_sf_id",
        "product_sf_id",
        "product_code_lookup",
        "unit_price",
        "fte_range",
        "is_active",
        "product_name",
        "price_book_name",
        "sf_created_date",
        "sf_last_modified_date",
      ];
  }
}

/** Human-readable label overrides for specific CRM field keys. */
const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  owner_user_id: "Owner",
  sf_id: "Salesforce ID",
  account_id_sf_lookup: "Account (SF ID Lookup)",
  primary_contact_id_sf_lookup: "Primary Contact (SF ID Lookup)",
  sf_created_by: "SF Created By",
  sf_created_date: "SF Created Date",
  sf_last_modified_by: "SF Last Modified By",
  sf_last_modified_date: "SF Last Modified Date",
  acv: "ACV (Annual Contract Value)",
  fte_count: "FTE Count",
  fte_range: "FTE Range",
  billing_latitude: "Billing Latitude",
  billing_longitude: "Billing Longitude",
  shipping_latitude: "Shipping Latitude",
  shipping_longitude: "Shipping Longitude",
  sic_description: "SIC Description",
  do_not_contact: "Do Not Contact",
  last_activity_date: "Last Activity Date",
  // Contact fields
  mobile_phone: "Mobile Phone",
  home_phone: "Home Phone",
  other_phone: "Other Phone",
  linkedin_url: "LinkedIn URL",
  is_primary: "Is Primary Contact",
  reports_to: "Reports To",
  assistant_name: "Assistant Name",
  assistant_phone: "Assistant Phone",
  email_bounced_reason: "Email Bounced Reason",
  email_bounced_date: "Email Bounced Date",
  other_street: "Other Street",
  other_city: "Other City",
  other_state: "Other State",
  other_zip: "Other Zip",
  other_country: "Other Country",
  // Opportunity fields
  is_closed: "Is Closed",
  is_won: "Is Won",
  forecast_category: "Forecast Category",
  expected_revenue: "Expected Revenue",
  services_included: "Services Included",
  service_description: "Service Description",
  service_amount: "Service Amount",
  product_amount: "Product Amount",
  contract_length_months: "Contract Length (Months)",
  payment_frequency: "Payment Frequency",
  auto_renewal: "Auto Renewal",
  one_time_project: "One-Time Project",
  campaign_id: "Campaign",
  last_stage_change_date: "Last Stage Change Date",
  fiscal_year: "Fiscal Year",
  fiscal_quarter: "Fiscal Quarter",
  loss_reason: "Loss Reason",
  // Lead fields
  is_converted: "Is Converted",
  converted_at: "Converted Date",
  converted_account_id: "Converted Account ID",
  converted_contact_id: "Converted Contact ID",
  converted_opportunity_id: "Converted Opportunity ID",
  lead_source_detail: "Lead Source Detail",
  mql_date: "MQL Date",
  sql_date: "SQL Date",
  partner_source: "Partner Source",
  next_steps: "Next Steps",
  created_by_automation: "Created by Automation",
  sf_contract_id: "SF Contract ID",
  has_opportunity_line_items: "Has Line Items",
  sf_pricebook_id: "SF Price Book ID",
  stage_sort_order: "Stage Sort Order",
  total_opportunity_quantity: "Total Opportunity Quantity",
  // Lead opt-out & flags
  has_opted_out_of_email: "Has Opted Out of Email",
  do_not_call: "Do Not Call",
  do_not_market_to: "Do Not Market To",
  lead_type: "Lead Type",
  notes: "Notes",
  comments: "Comments",
  priority_lead: "Priority Lead",
  // Product fields
  code: "Product Code",
  product_family: "Product Family",
  default_arr: "Default ARR",
  pricing_model: "Pricing Model",
  // Price book entry fields
  price_book_sf_id: "Price Book (SF ID)",
  product_sf_id: "Product (SF ID)",
  product_code_lookup: "Product (Code Lookup)",
  unit_price: "Unit Price",
  product_name: "Product Name",
  price_book_name: "Price Book Name",
  is_default: "Is Default/Standard",
  effective_date: "Effective Date",
};

/** Human-readable label for a CRM field key. */
function fieldLabel(key: string): string {
  if (FIELD_LABEL_OVERRIDES[key]) return FIELD_LABEL_OVERRIDES[key];
  return key
    .replace(/_sf_lookup$/, " (SF Lookup)")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================
   Fuzzy matching helpers
   ================================================================ */

/** Compute similarity between two strings (Dice coefficient on bigrams). */
function stringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) ?? 0) + 1);
  }

  let intersections = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) ?? 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      intersections++;
    }
  }

  return (2 * intersections) / (s1.length + s2.length - 2);
}

/** Try to fuzzy-match a CSV header to a CRM field. */
function fuzzyMatchField(
  header: string,
  crmFields: string[]
): { field: string; confidence: MappingConfidence } | null {
  const normalized = header.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  let bestField = "";
  let bestScore = 0;

  for (const field of crmFields) {
    const fieldWords = field.replace(/_/g, " ");
    const score = stringSimilarity(normalized, fieldWords);
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  if (bestScore >= 0.6) {
    return { field: bestField, confidence: "fuzzy" };
  }
  return null;
}

/* ================================================================
   Validation helpers
   ================================================================ */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(
  _rowIndex: number,
  mapped: Record<string, string>,
  entity: EntityType
): { type: "warning" | "skip"; message: string } | null {
  // Check email format if present
  if (mapped.email && !EMAIL_REGEX.test(mapped.email)) {
    return {
      type: "warning",
      message: `Invalid email format "${mapped.email}"`,
    };
  }

  // Check required fields
  if (entity === "accounts" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
  }
  if (entity === "contacts" && (!mapped.first_name || !mapped.last_name)) {
    return { type: "skip", message: "Missing required field \"first_name\" or \"last_name\"" };
  }
  if (entity === "leads" && (!mapped.first_name || !mapped.last_name)) {
    return { type: "skip", message: "Missing required field \"first_name\" or \"last_name\"" };
  }
  if (entity === "leads" && mapped.is_converted && (mapped.is_converted === "true" || mapped.is_converted === "1")) {
    return { type: "skip", message: "Converted lead — already a contact in Salesforce" };
  }
  if (entity === "opportunities" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
  }
  if (entity === "products" && (!mapped.name || !mapped.code)) {
    return { type: "skip", message: "Missing required field \"name\" or \"code\"" };
  }
  if (entity === "price_books" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
  }
  if (entity === "price_book_entries" && !mapped.unit_price) {
    return { type: "skip", message: "Missing required field \"unit_price\"" };
  }

  return null;
}

/* ================================================================
   CSV export for error report
   ================================================================ */

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadErrorReport(failedRows: FailedRow[]) {
  if (failedRows.length === 0) return;

  const csvHeaders = Object.keys(failedRows[0].csvData);
  const header = [...csvHeaders.map(escapeCsvField), "Error"].join(",");
  const rows = failedRows.map((fr) => {
    const values = csvHeaders.map((h) => escapeCsvField(fr.csvData[h] ?? ""));
    return [...values, escapeCsvField(fr.error)].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const link = document.createElement("a");
  link.href = url;
  link.download = `import-errors-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ================================================================
   Component
   ================================================================ */

export function SalesforceImport() {
  const [entity, setEntity] = useState<EntityType>("accounts");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [currentBatch, setCurrentBatch] = useState({ batch: 0, totalBatches: 0 });
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update">(
    "skip"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);
  const importStartTimeRef = useRef<number>(0);

  // Salesforce User ID → { name, email } mapping
  // Pre-loaded from Salesforce User export. Can be overridden by uploading a new User CSV.
  const [sfUserMap, setSfUserMap] = useState<Map<string, { name: string; email: string }>>(new Map([
    ["0055w00000A9RjVAAV", { name: "Joe Gellatly", email: "joeg@medcurity.com" }],
    ["0055w00000A9RnmAAF", { name: "Chatter Expert", email: "noreply@chatter.salesforce.com" }],
    ["0055w00000A9RnnAAF", { name: "System", email: "rachelk@medcurity.com" }],
    ["0055w00000A9Rs9AAF", { name: "April Needham", email: "apriln@medcurity.com" }],
    ["0055w00000A9RsJAAV", { name: "Amanda Hepper", email: "amanda@medcurity.com" }],
    ["0055w00000A9RsOAAV", { name: "Lorraine Gary", email: "lorraineg@medcurity.com" }],
    ["0055w00000BmnpFAAR", { name: "Christian Williams", email: "christianw@medcurity.com" }],
    ["0055w00000BmnpKAAR", { name: "Brayden Frost", email: "braydenf@medcurity.com" }],
    ["0055w00000ByXXDAA3", { name: "Integration User", email: "marketing@medcurity.com" }],
    ["0055w00000ByXXEAA3", { name: "Automated Process", email: "wharley@00d5w000002rxcxeay" }],
    ["0055w00000ByXXFAA3", { name: "Salesforce Administrator", email: "wharley@00d5w000002rxcxeay" }],
    ["0055w00000ByXXIAA3", { name: "Security User", email: "insightssecurity@example.com" }],
    ["0055w00000ByXXJAA3", { name: "Platform Integration User", email: "noreply@00d5w000002rxcxeay" }],
    ["0055w00000CT0VRAA1", { name: "Rachel Kunkel", email: "rachelk@medcurity.com" }],
    ["0055w00000CwK1jAAF", { name: "Gabe Ellzey", email: "gabe.ellzey@ziplineinteractive.com" }],
    ["0055w00000CwNfdAAF", { name: "Salesforce Mobile Apps", email: "noreply@salesforce.com" }],
    ["0055w00000CwNq2AAF", { name: "Website API", email: "brandon.perdue@ziplineinteractive.com" }],
    ["0055w00000CwNsmAAF", { name: "Matt Bayley", email: "mattb@medcurity.com" }],
    ["0055w00000CwOJYAA3", { name: "Public User", email: "externalWho@00d5w000002rxcxeay.ext" }],
    ["0055w00000CwT2zAAF", { name: "Ari Van Peursem", email: "arivp@medcurity.com" }],
    ["0055w00000Cx2CmAAJ", { name: "Alexa Fouch", email: "alexaf@medcurity.com" }],
    ["0055w00000Cx9ziAAB", { name: "Grant Miller", email: "grantm@medcurity.com" }],
    ["0055w00000CyBoMAAV", { name: "Walt Maxwell", email: "walterm@medcurity.com" }],
    ["0055w00000CyFm2AAF", { name: "Meghan Andrews", email: "meghana@medcurity.com" }],
    ["0055w00000CycSrAAJ", { name: "Aaric Gomez", email: "aaricg@medcurity.com" }],
    ["0055w00000Cz7s1AAB", { name: "Wyatt Watkins", email: "wyattw@medcurity.com" }],
    ["0055w00000Cz7sGAAR", { name: "Rachel Moe", email: "rachelm@medcurity.com" }],
    ["0055w00000D0QMMAA3", { name: "Gavin Weiler", email: "gavinw@medcurity.com" }],
    ["0055w00000FNiqqAAD", { name: "Dave Westenskow", email: "davew@medcurity.com" }],
    ["0055w00000FPhNGAA1", { name: "Dennis Hake", email: "dennis.hake@outlook.com" }],
    ["0055w00000FPhNLAA1", { name: "Mel (Old) Nevala (Old)", email: "meln@medcurity.com" }],
    ["0055w00000FPjGCAA1", { name: "Bobby Seegmiller", email: "bobbys@medcurity.com" }],
    ["0055w00000FPjvUAAT", { name: "Client Admin", email: "client.admin@minlopro.com" }],
    ["0055w00000FPlKxAAL", { name: "Integrated User", email: "marketing@medcurity.com" }],
    ["0055w00000FPlYJAA1", { name: "Salesforce Connected Apps", email: "noreply@salesforce.com" }],
    ["0055w00000FPlfhAAD", { name: "HubSpot Integration", email: "noreply@salesforce.com" }],
    ["0055w00000FPnYXAA1", { name: "Abby Jones", email: "abbyj@medcurity.com" }],
    ["005RO000002CtcHYAS", { name: "Margaret Karatzas", email: "margaretl@medcurity.com" }],
    ["005RO000002DRpFYAW", { name: "Jordan Scherich", email: "jordans@medcurity.com" }],
    ["005RO000002cb8fYAA", { name: "SalesforceIQ Integration", email: "salesforceiqintegration@00d5w000002rxcxeay.ext" }],
    ["005RO000002cb8gYAA", { name: "Insights Integration", email: "insightsintegration@00d5w000002rxcxeay.ext" }],
    ["005RO000002cb8hYAA", { name: "B2BMA Integration", email: "noreply@salesforce.com" }],
    ["005RO000002cbAHYAY", { name: "b2bmaIntegration", email: "noreply@salesforce.com" }],
    ["005RO000002ccG1YAI", { name: "Sales Insights", email: "noreply@salesforce.com" }],
    ["005RO000002gHUjYAM", { name: "Pardot", email: "noreply@salesforce.com" }],
    ["005RO000002w6DZYAY", { name: "Sai Gudivada", email: "sai.gudivada@olooptech.com" }],
    ["005RO0000030yorYAA", { name: "Niharika Medavaram", email: "niharika.medavaram@olooptech.com" }],
    ["005RO000003nrpRYAQ", { name: "Summer Hume", email: "summerh@medcurity.com" }],
    ["005RO000005BrJ4YAK", { name: "Molly Miller", email: "mollym@medcurity.com" }],
    ["005RO000005BtHeYAK", { name: "Vaughn Handel", email: "vaughnh@medcurity.com" }],
    ["005RO000005C4kvYAC", { name: "Mel Nevala", email: "meln@medcurity.com" }],
  ]));
  const [userCsvLoaded, setUserCsvLoaded] = useState(true);
  const [retryEdits, setRetryEdits] = useState<Record<number, Record<string, string>>>({});
  const [retryingRows, setRetryingRows] = useState(false);

  /* ---------- SF User CSV handling ---------- */

  const handleUserFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        if (!text) return;

        const parsed = parseCSV(text);
        if (parsed.length < 2) { toast.error("User CSV is empty"); return; }
        const headers = parsed[0];
        const rows = parsed.slice(1);
        const idIdx = headers.findIndex((h: string) => h.toLowerCase() === "id");
        const firstIdx = headers.findIndex((h: string) => h.toLowerCase() === "firstname");
        const lastIdx = headers.findIndex((h: string) => h.toLowerCase() === "lastname");
        const emailIdx = headers.findIndex((h: string) => h.toLowerCase() === "email");

        if (idIdx === -1) {
          toast.error("User CSV must have an 'Id' column");
          return;
        }

        const map = new Map<string, { name: string; email: string }>();
        for (const row of rows) {
          const id = row[idIdx]?.trim();
          if (!id) continue;
          const first = firstIdx >= 0 ? row[firstIdx]?.trim() || "" : "";
          const last = lastIdx >= 0 ? row[lastIdx]?.trim() || "" : "";
          const email = emailIdx >= 0 ? row[emailIdx]?.trim() || "" : "";
          const name = `${first} ${last}`.trim();
          map.set(id, { name, email });
        }

        setSfUserMap(map);
        setUserCsvLoaded(true);
        toast.success(`Loaded ${map.size} Salesforce users for owner matching`);
      };
      reader.readAsText(file);
    },
    []
  );

  /* ---------- File handling ---------- */

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setResult(null);
      setValidation(null);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) {
          toast.error("CSV must have a header row and at least one data row.");
          return;
        }

        const headers = parsed[0];
        const dataRows = parsed.slice(1);
        setCsvHeaders(headers);
        setCsvRows(dataRows);

        // Auto-map columns with confidence tracking
        const fieldMap = getFieldMap(entity);
        const crmFields = getCRMFields(entity);
        const autoMappings: ColumnMapping[] = headers.map((h) => {
          const normalized = h.toLowerCase().trim();
          const exactMatch = fieldMap[normalized];
          if (exactMatch) {
            return { csvColumn: h, crmField: exactMatch, confidence: "exact" as MappingConfidence };
          }
          // Try without spaces/underscores/slashes (catches "Billing Zip/Postal Code" etc.)
          const stripped = normalized.replace(/[\s_/]+/g, "");
          const strippedMatch = fieldMap[stripped];
          if (strippedMatch) {
            return { csvColumn: h, crmField: strippedMatch, confidence: "exact" as MappingConfidence };
          }
          // Try with spaces instead of camelCase: "BillingPostalCode" → "billing postal code"
          const spaced = normalized.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
          const spacedMatch = fieldMap[spaced];
          if (spacedMatch) {
            return { csvColumn: h, crmField: spacedMatch, confidence: "exact" as MappingConfidence };
          }
          // Try fuzzy match
          const fuzzy = fuzzyMatchField(h, crmFields);
          if (fuzzy) {
            return { csvColumn: h, crmField: fuzzy.field, confidence: fuzzy.confidence };
          }
          return { csvColumn: h, crmField: "", confidence: "unmapped" as MappingConfidence };
        });
        setMappings(autoMappings);
        toast.success(`Loaded ${dataRows.length} rows from ${file.name}`);
      };
      reader.readAsText(file);
    },
    [entity]
  );

  const updateMapping = useCallback(
    (csvColumn: string, crmField: string) => {
      setMappings((prev) =>
        prev.map((m) =>
          m.csvColumn === csvColumn
            ? { ...m, crmField, confidence: crmField ? "exact" : "unmapped" }
            : m
        )
      );
    },
    []
  );

  /* ---------- Build mapped data for preview ---------- */

  function buildMappedRow(
    rowValues: string[],
    headers: string[],
    columnMappings: ColumnMapping[]
  ): Record<string, string> {
    const mapped: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const mapping = columnMappings.find((m) => m.csvColumn === header);
      if (mapping?.crmField) {
        const val = rowValues[idx] ?? "";
        // For owner_user_id: prefer 005 SF IDs over text names
        // (if two columns both map to owner_user_id, keep the 005 value)
        if (mapping.crmField === "owner_user_id" && mapped.owner_user_id) {
          if (val.startsWith("005") && !mapped.owner_user_id.startsWith("005")) {
            mapped.owner_user_id = val; // 005 ID replaces text name
          }
          // Otherwise keep the existing value (don't let text overwrite 005)
          return;
        }
        mapped[mapping.crmField] = val;
      }
    });
    return mapped;
  }

  function buildCsvDataRow(
    rowValues: string[],
    headers: string[]
  ): Record<string, string> {
    const data: Record<string, string> = {};
    headers.forEach((header, idx) => {
      data[header] = rowValues[idx] ?? "";
    });
    return data;
  }

  const previewRows = csvRows.slice(0, 5).map((row) =>
    buildMappedRow(row, csvHeaders, mappings)
  );

  const activeMappings = mappings.filter((m) => m.crmField !== "");

  // Mapping stats
  const autoMappedCount = mappings.filter(
    (m) => m.confidence === "exact" || m.confidence === "fuzzy"
  ).length;
  const manualNeededCount = mappings.filter(
    (m) => m.confidence === "unmapped" && m.crmField === ""
  ).length;
  const skippedCount = mappings.filter((m) => m.crmField === "").length;

  /* ---------- Validation ---------- */

  function runValidation(): ValidationSummary {
    const warnings: ValidationIssue[] = [];
    const willSkip: ValidationIssue[] = [];

    // Check for duplicate SF IDs
    const sfIdMapping = mappings.find((m) => m.crmField === "sf_id");
    const sfIdColIndex = sfIdMapping
      ? csvHeaders.indexOf(sfIdMapping.csvColumn)
      : -1;
    const seenSfIds = new Set<string>();

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const mapped = buildMappedRow(row, csvHeaders, mappings);

      // Check for duplicate SF IDs within the file
      if (sfIdColIndex >= 0) {
        const sfId = row[sfIdColIndex];
        if (sfId && seenSfIds.has(sfId)) {
          willSkip.push({
            rowNumber: i + 1,
            type: "skip",
            message: `Duplicate SF ID "${sfId}" within file`,
          });
          continue;
        }
        if (sfId) seenSfIds.add(sfId);
      }

      const issue = validateRow(i + 1, mapped, entity);
      if (issue) {
        if (issue.type === "skip") {
          willSkip.push({ rowNumber: i + 1, ...issue });
        } else {
          warnings.push({ rowNumber: i + 1, ...issue });
        }
      }
    }

    const willImport = csvRows.length - willSkip.length;
    return { willImport, warnings, willSkip };
  }

  function handleValidate() {
    const summary = runValidation();
    setValidation(summary);
  }

  /* ---------- Import ---------- */

  async function handleImport() {
    if (activeMappings.length === 0) {
      toast.error("Map at least one column before importing.");
      return;
    }

    setImporting(true);
    setResult(null);
    importStartTimeRef.current = Date.now();

    const imported: number[] = [0];
    const skippedArr: number[] = [0];
    const failedCount: number[] = [0];
    const errors: string[] = [];
    const failedRows: FailedRow[] = [];
    const importedIds: string[] = [];

    // Track unmatched SF owner IDs to warn user
    const unmatchedOwners = new Map<string, string[]>();

    try {
      // Pre-fetch lookup data — user_profiles doesn't have email,
      // so we fetch from auth.users via the admin RPC or match by name.
      // We also build a reverse map from the pre-loaded sfUserMap:
      // SF User email → CRM user full_name → CRM user id
      const { data: users } = await supabase
        .from("user_profiles")
        .select("id, full_name");

      // Build lookup maps from CRM users for owner matching
      const crmEmailLookup = new Map<string, string>();
      const crmNameLookup = new Map<string, string>();

      if (users) {
        for (const u of users) {
          if (u.full_name) crmNameLookup.set((u.full_name as string).toLowerCase(), u.id as string);
        }
        // Build email lookup by matching SF user emails to CRM user names
        // Since user_profiles has no email, we match SF user name → CRM user name
        // then register the SF user's email as pointing to that CRM user ID
        for (const [, sfUser] of sfUserMap) {
          if (sfUser.email && sfUser.name) {
            const crmId = crmNameLookup.get(sfUser.name.toLowerCase());
            if (crmId) {
              crmEmailLookup.set(sfUser.email.toLowerCase(), crmId);
            }
          }
        }
      }

      let accountSfMap: Map<string, string> | null = null;
      let contactSfMap: Map<string, string> | null = null;
      let productSfMap: Map<string, string> | null = null;
      let productCodeMap: Map<string, string> | null = null;
      let productNameMap: Map<string, string> | null = null;
      let priceBookSfMap: Map<string, string> | null = null;
      let priceBookNameMap: Map<string, string> | null = null;
      // CRM-id → { fte_range, fte_count } lookup, used to snapshot FTE data
      // onto imported opportunities so per-tier pricing works on day one.
      let accountFteByCrmId: Map<
        string,
        { fte_range: string | null; fte_count: number | null }
      > | null = null;

      // FTE-cleanup session state (see helper comment at top of file)
      const seenProductCodes = new Set<string>(); // codes already inserted this session
      const seenProductNames = new Set<string>(); // fallback dedup when code is missing
      let masterPriceBookId: string | null = null; // canonical "Medcurity Standard" id

      if (
        entity === "contacts" ||
        entity === "opportunities"
      ) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, sf_id, fte_range, fte_count")
          .not("sf_id", "is", null);
        accountSfMap = new Map(
          (accounts ?? []).map((a) => [a.sf_id as string, a.id as string])
        );
        if (entity === "opportunities") {
          accountFteByCrmId = new Map(
            (accounts ?? []).map((a) => [
              a.id as string,
              {
                fte_range: (a.fte_range as string | null) ?? null,
                fte_count: (a.fte_count as number | null) ?? null,
              },
            ])
          );
        }
      }
      if (entity === "opportunities") {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, sf_id")
          .not("sf_id", "is", null);
        contactSfMap = new Map(
          (contacts ?? []).map((c) => [c.sf_id as string, c.id as string])
        );
      }
      if (entity === "price_book_entries") {
        // Build product lookups (by sf_id, by code, and by CLEANED name)
        const { data: products } = await supabase
          .from("products")
          .select("id, sf_id, code, name");
        productSfMap = new Map(
          (products ?? []).filter((p) => p.sf_id).map((p) => [p.sf_id as string, p.id as string])
        );
        productCodeMap = new Map(
          (products ?? []).filter((p) => p.code).map((p) => [p.code as string, p.id as string])
        );
        // Name-based lookup is what makes FTE cleanup work on PBE imports:
        // a PBE row referencing SF product "51-100 SRA" no longer has a matching
        // sf_id (we collapsed it), but it DOES still carry the product name in
        // the CSV. We strip the FTE prefix and look up by the base name.
        productNameMap = new Map(
          (products ?? [])
            .filter((p) => p.name)
            .map((p) => [(p.name as string).trim().toLowerCase(), p.id as string])
        );

        // Build price book lookups (kept for backwards compat, but during
        // FTE-cleanup imports we override every row to the master book below).
        const { data: priceBooks } = await supabase
          .from("price_books")
          .select("id, sf_id, name");
        priceBookSfMap = new Map(
          (priceBooks ?? []).filter((pb) => pb.sf_id).map((pb) => [pb.sf_id as string, pb.id as string])
        );
        priceBookNameMap = new Map(
          (priceBooks ?? []).map((pb) => [(pb.name as string).toLowerCase(), pb.id as string])
        );

        // Ensure the master "Medcurity Standard" price book exists. All
        // PBE rows will be inserted under this single book regardless of
        // which tier-specific SF book they came from.
        const existingMaster = (priceBooks ?? []).find(
          (pb) => (pb.name as string) === MASTER_PRICE_BOOK_NAME
        );
        if (existingMaster) {
          masterPriceBookId = existingMaster.id as string;
        } else {
          const { data: created, error: createErr } = await supabase
            .from("price_books")
            .insert({
              name: MASTER_PRICE_BOOK_NAME,
              description:
                "Unified price book. Pricing varies by FTE range on each entry; the opportunity's FTE range drives auto-pricing in the product picker.",
              is_default: true,
              is_active: true,
            })
            .select("id")
            .single();
          if (createErr) {
            throw new Error(
              `Could not create master price book: ${createErr.message}`
            );
          }
          masterPriceBookId = created.id as string;
        }
      }

      if (entity === "products") {
        // Seed session dedup state from what's already in the DB so re-runs
        // of the products import don't try to re-insert the same canonical rows.
        const { data: existingProducts } = await supabase
          .from("products")
          .select("code, name");
        for (const p of existingProducts ?? []) {
          if (p.code) seenProductCodes.add((p.code as string).toLowerCase());
          if (p.name) seenProductNames.add((p.name as string).toLowerCase());
        }
      }

      const tableName = entity;
      const batchSize = 50;
      const total = csvRows.length;
      const totalBatches = Math.ceil(total / batchSize);
      setProgress({ current: 0, total });
      setCurrentBatch({ batch: 0, totalBatches });

      for (let i = 0; i < total; i += batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1;
        setCurrentBatch({ batch: batchNum, totalBatches });

        const batch = csvRows.slice(i, i + batchSize);
        const records: Record<string, unknown>[] = [];
        const recordRowIndices: number[] = [];

        for (let j = 0; j < batch.length; j++) {
          const rowIndex = i + j;
          const row = batch[j];
          const mapped = buildMappedRow(row, csvHeaders, mappings);
          const csvData = buildCsvDataRow(row, csvHeaders);

          const record: Record<string, unknown> = {};
          let skipRow = false;

          for (const [field, value] of Object.entries(mapped)) {
            if (!value && value !== "0") continue;

            if (field === "owner_user_id") {
              // SF CSVs often have BOTH "Account Owner" (text name) and "Owner Id" (005 ID).
              // The 005 ID is more reliable. If we already resolved from a 005 ID, skip.
              // If this is a text name and owner was already set, skip.
              if (record.owner_user_id) {
                continue;
              }

              let matched = false;
              const valueLower = value.toLowerCase().trim();

              // Salesforce User ID (starts with 005) — most reliable
              if (value.startsWith("005") && sfUserMap.size > 0) {
                const sfUser = sfUserMap.get(value);
                if (sfUser) {
                  if (sfUser.email && crmEmailLookup) {
                    const crmId = crmEmailLookup.get(sfUser.email.toLowerCase());
                    if (crmId) {
                      record.owner_user_id = crmId;
                      matched = true;
                    }
                  }
                  if (!matched && sfUser.name && crmNameLookup) {
                    const crmId = crmNameLookup.get(sfUser.name.toLowerCase());
                    if (crmId) {
                      record.owner_user_id = crmId;
                      matched = true;
                    }
                  }
                  if (!matched) {
                    const label = `${sfUser.name} (${sfUser.email})`;
                    const existing = unmatchedOwners.get(label) || [];
                    existing.push(`Row ${rowIndex + 1}`);
                    unmatchedOwners.set(label, existing);
                  }
                }
              }

              // Text name match — only if no 005 ID was available
              if (!matched && !value.startsWith("005")) {
                // Check if there's ALSO a 005 Owner Id column mapped — if so,
                // skip the text name; the 005 column will handle it more reliably
                // Check if ANY mapped owner column has a 005 value in this row
                const ownerMappings = mappings.filter((m) => m.crmField === "owner_user_id");
                const has005Column = ownerMappings.some((m) => {
                  const colIdx = csvHeaders.indexOf(m.csvColumn);
                  return colIdx >= 0 && row[colIdx]?.startsWith("005");
                });

                if (has005Column) {
                  // Skip text name — the 005 column will resolve this row
                  continue;
                }

                // No 005 column — try matching the text name directly
                const userByName = users?.find(
                  (u) => u.full_name?.toLowerCase() === valueLower
                );
                if (userByName) {
                  record.owner_user_id = userByName.id;
                  matched = true;
                }
                if (!matched && value.includes("@")) {
                  const crmId = crmEmailLookup.get(valueLower);
                  if (crmId) {
                    record.owner_user_id = crmId;
                    matched = true;
                  }
                }
                if (!matched) {
                  const existing = unmatchedOwners.get(value) || [];
                  existing.push(`Row ${rowIndex + 1}`);
                  unmatchedOwners.set(value, existing);
                }
              }

              continue;
            }

            if (field === "account_id_sf_lookup") {
              // Lookup account by SF ID
              if (accountSfMap) {
                const accountId = accountSfMap.get(value);
                if (accountId) {
                  record.account_id = accountId;
                } else {
                  const errMsg = `Account SF ID "${value}" not found in CRM`;
                  errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
                  failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
                  failedCount[0]++;
                  skipRow = true;
                }
              }
              continue;
            }

            if (field === "primary_contact_id_sf_lookup") {
              // Lookup contact by SF ID
              if (contactSfMap) {
                const contactId = contactSfMap.get(value);
                if (contactId) {
                  record.primary_contact_id = contactId;
                }
                // Don't fail — primary contact is optional
              }
              continue;
            }

            // Product SF ID lookup (for price book entries)
            // NOTE: during FTE cleanup, tier-specific SF products (e.g. "51-100 SRA")
            // no longer exist in CRM — they were collapsed into the canonical
            // "SRA". So a failed sf_id lookup is NOT fatal here; we fall through
            // to the product_name base-name lookup below.
            if (field === "product_sf_id") {
              if (productSfMap) {
                const productId = productSfMap.get(value);
                if (productId) {
                  record.product_id = productId;
                }
              }
              continue;
            }

            // Product code lookup (for price book entries)
            if (field === "product_code_lookup") {
              if (!record.product_id && productCodeMap) {
                const productId = productCodeMap.get(value);
                if (productId) {
                  record.product_id = productId;
                }
                // Don't fail — product_sf_id is the primary lookup
              }
              continue;
            }

            // Price book SF ID lookup
            if (field === "price_book_sf_id") {
              if (priceBookSfMap) {
                const pbId = priceBookSfMap.get(value);
                if (pbId) {
                  record.price_book_id = pbId;
                } else {
                  const errMsg = `Price Book SF ID "${value}" not found in CRM — import price books first`;
                  errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
                  failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
                  failedCount[0]++;
                  skipRow = true;
                }
              }
              continue;
            }

            // Price book name lookup (fallback) — ALSO preserved into a
            // temporary field so the FTE-cleanup transform below can parse
            // an fte_range out of it (e.g. "51-100 Price Book" → "51-100").
            if (field === "price_book_name") {
              if (!record.price_book_id && priceBookNameMap) {
                const pbId = priceBookNameMap.get(value.toLowerCase());
                if (pbId) {
                  record.price_book_id = pbId;
                }
              }
              record.__price_book_name_raw = value;
              continue;
            }

            // Product name — used as a FALLBACK lookup for price book entries
            // when product_sf_id didn't resolve (happens after FTE cleanup
            // collapses tier-specific SF products). We strip any FTE prefix
            // and match case-insensitively on the cleaned base name.
            if (field === "product_name") {
              if (!record.product_id && productNameMap) {
                const { base } = stripFtePrefix(value);
                const normalized = base.trim().toLowerCase();
                const productId = productNameMap.get(normalized);
                if (productId) {
                  record.product_id = productId;
                }
              }
              continue;
            }

            // Numeric fields
            if (
              [
                "annual_revenue",
                "employees",
                "amount",
                "probability",
                "fte_count",
                "locations",
                "number_of_providers",
                "lifetime_value",
                "churn_amount",
                "acv",
                "discount",
                "subtotal",
                "service_amount",
                "product_amount",
                "cycle_count",
                "contract_length_months",
                "contract_year",
                "score",
                "billing_latitude",
                "billing_longitude",
                "shipping_latitude",
                "shipping_longitude",
                "expected_revenue",
                "fiscal_year",
                "fiscal_quarter",
                "total_opportunity_quantity",
                "unit_price",
                "default_arr",
              ].includes(field)
            ) {
              const num = Number(value.replace(/[,$]/g, ""));
              if (!isNaN(num)) {
                record[field] = num;
              }
              continue;
            }

            // Boolean fields
            if (
              ["is_primary", "do_not_contact", "partner_prospect", "priority_account",
               "every_other_year", "one_time_project", "auto_renewal", "services_included",
               "follow_up", "is_converted", "is_closed", "is_won",
               "created_by_automation", "has_opportunity_line_items",
               "has_opted_out_of_email", "do_not_call", "do_not_market_to", "priority_lead",
               "is_active", "is_default"].includes(field)
            ) {
              record[field] = value.toLowerCase() === "true" || value === "1";
              continue;
            }

            // UUID reference fields — only accept valid UUIDs, skip SF IDs and null placeholders
            if (
              ["parent_account_id", "converted_account_id", "converted_contact_id",
               "converted_opportunity_id", "campaign_id"].includes(field)
            ) {
              // Only store valid UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
              const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (UUID_REGEX.test(value)) {
                record[field] = value;
              }
              // Skip anything that's not a valid UUID (SF IDs, null placeholders, etc.)
              continue;
            }

            // SF user ID fields (CreatedById, LastModifiedById) — resolve to ORIGINAL names for history
            if (["sf_created_by", "sf_last_modified_by"].includes(field)) {
              if (value.startsWith("005") && sfUserMap.size > 0) {
                // For historical fields, use the original SF name (not the remapped name)
                // e.g. James Parrish's ID is remapped to Brayden Frost for ownership,
                // but Created By / Modified By should show the original person
                const historicalNames: Record<string, string> = {
                  "0055w00000BmnpKAAR": "James Parrish",
                };
                const sfUser = sfUserMap.get(value);
                record[field] = historicalNames[value] ?? (sfUser ? sfUser.name : value);
              } else {
                record[field] = value;
              }
              continue;
            }

            // Normalize enum values: "No Auto Renew" → "no_auto_renew", etc.
            if (["renewal_type", "status", "lifecycle_status", "stage", "kind",
                 "team", "lead_source", "source", "payment_frequency", "qualification"].includes(field)) {
              // Convert human-readable to snake_case enum: lowercase, trim, replace spaces with underscores
              const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
              // Map common Salesforce values to CRM enum values
              const enumMappings: Record<string, Record<string, string>> = {
                renewal_type: {
                  "no_auto_renew": "no_auto_renew",
                  "auto_renew": "auto_renew",
                  "manual_renew": "manual_renew",
                  "full_auto_renew": "full_auto_renew",
                  "platform_only_auto_renew": "platform_only_auto_renew",
                },
                status: {
                  "active": "active",
                  "inactive": "inactive",
                  "discovery": "discovery",
                  "pending": "pending",
                  "churned": "churned",
                },
                stage: {
                  "closed_won": "closed_won",
                  "closed_lost": "closed_lost",
                  "closed/won": "closed_won",
                  "closed/lost": "closed_lost",
                  "closed won": "closed_won",
                  "closed lost": "closed_lost",
                  "won": "closed_won",
                  "lost": "closed_lost",
                  "proposal": "proposal",
                  "proposal/price_quote": "proposal",
                  "qualified": "qualified",
                  "qualification": "qualified",
                  "needs_analysis": "qualified",
                  "value_proposition": "proposal",
                  "id._decision_makers": "qualified",
                  "perception_analysis": "qualified",
                  "negotiation/review": "verbal_commit",
                  "negotiation": "verbal_commit",
                  "verbal_commit": "verbal_commit",
                  "verbal commit": "verbal_commit",
                  "prospecting": "lead",
                  "lead": "lead",
                },
                kind: {
                  "new_business": "new_business",
                  "new business": "new_business",
                  "new": "new_business",
                  "renewal": "renewal",
                  "existing_business": "renewal",
                  "existing business": "renewal",
                  "existing_business___renewal": "renewal",
                },
                lead_source: {
                  "cold_call": "cold_call",
                  "cold call": "cold_call",
                  "cold_call___smb": "cold_call",
                  "trade_show": "trade_show",
                  "trade show": "trade_show",
                  "social_media": "social_media",
                  "social media": "social_media",
                  "email_campaign": "email_campaign",
                  "email campaign": "email_campaign",
                  "web": "website",
                  "inbound": "website",
                  "advertisement": "other",
                  "employee_referral": "referral",
                  "employee referral": "referral",
                  "external_referral": "referral",
                  "external referral": "referral",
                  "purchased_list": "other",
                  "purchased list": "other",
                  "public_relations": "other",
                  "public relations": "other",
                  "seminar___internal": "webinar",
                  "seminar___partner": "partner",
                },
                source: {
                  "cold_call": "cold_call",
                  "cold call": "cold_call",
                  "trade_show": "trade_show",
                  "trade show": "trade_show",
                  "social_media": "social_media",
                  "social media": "social_media",
                  "email_campaign": "email_campaign",
                  "email campaign": "email_campaign",
                  "web": "website",
                  "inbound": "website",
                  "employee_referral": "referral",
                  "external_referral": "referral",
                  "seminar___internal": "webinar",
                },
              };
              const mapping = enumMappings[field];
              const mappedValue = mapping?.[normalized] ?? normalized;

              // Validate against known enum values — unknown values get stored as detail
              const VALID_ENUMS: Record<string, Set<string>> = {
                lead_source: new Set(["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "sql", "mql", "other"]),
                source: new Set(["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "sql", "mql", "other"]),
                stage: new Set(["lead", "qualified", "proposal", "verbal_commit", "closed_won", "closed_lost"]),
                status: new Set(["active", "inactive", "discovery", "pending", "churned", "new", "contacted", "qualified", "unqualified", "converted", "dead"]),
                lifecycle_status: new Set(["prospect", "active_client", "former_client", "partner"]),
                kind: new Set(["new_business", "renewal"]),
                team: new Set(["sales", "renewals"]),
                payment_frequency: new Set(["monthly", "quarterly", "semi_annually", "annually", "one_time"]),
                qualification: new Set(["unqualified", "mql", "sql", "opportunity"]),
                renewal_type: new Set(["auto_renew", "manual_renew", "no_auto_renew", "full_auto_renew", "platform_only_auto_renew"]),
              };
              const validSet = VALID_ENUMS[field];
              if (validSet && !validSet.has(mappedValue)) {
                // Unknown enum value — store original in lead_source_detail and set to "other"
                if (field === "lead_source" || field === "source") {
                  record[field] = "other";
                  if (!record.lead_source_detail) {
                    record.lead_source_detail = value; // preserve original SF value
                  }
                }
                // For other enum fields, just skip the unknown value (use defaults)
              } else {
                record[field] = mappedValue;
              }
              continue;
            }

            record[field] = value;
          }

          if (skipRow) {
            continue;
          }

          // -------------------------------------------------------------
          // FTE-range cleanup transform (products / price_books / PBE)
          // See helper comment near the top of this file for context.
          // -------------------------------------------------------------
          if (entity === "products") {
            // Strip FTE prefix from name + code.
            if (typeof record.name === "string") {
              record.name = stripFtePrefix(record.name).base;
            }
            if (typeof record.code === "string") {
              record.code = stripFtePrefix(record.code).base;
            }
            // In-session dedup: if another CSV row already produced this
            // canonical product (or it already exists in the DB), skip.
            const codeKey =
              typeof record.code === "string" ? record.code.toLowerCase() : "";
            const nameKey =
              typeof record.name === "string" ? record.name.toLowerCase() : "";
            if (codeKey && seenProductCodes.has(codeKey)) {
              skippedArr[0]++;
              continue;
            }
            if (!codeKey && nameKey && seenProductNames.has(nameKey)) {
              skippedArr[0]++;
              continue;
            }
            if (codeKey) seenProductCodes.add(codeKey);
            if (nameKey) seenProductNames.add(nameKey);
          }

          if (entity === "price_books") {
            // Tier-specific SF books ("51-100 Price Book", etc.) collapse
            // into the single master book — skip the row entirely.
            if (typeof record.name === "string") {
              const { fteRange } = stripFtePrefix(record.name);
              if (fteRange) {
                skippedArr[0]++;
                continue;
              }
              // SF's default "Standard Price Book" becomes our canonical master.
              if (record.name === "Standard Price Book") {
                record.name = MASTER_PRICE_BOOK_NAME;
                record.is_default = true;
              }
            }
          }

          if (entity === "price_book_entries") {
            // Pivot: every entry lives under the single master price book,
            // with fte_range carried on the entry itself (parsed from the
            // original SF pricebook name).
            if (masterPriceBookId) {
              record.price_book_id = masterPriceBookId;
            }
            const rawPbName = record.__price_book_name_raw as
              | string
              | undefined;
            if (rawPbName) {
              const { fteRange } = stripFtePrefix(rawPbName);
              if (fteRange && !record.fte_range) {
                record.fte_range = fteRange;
              }
            }
            delete record.__price_book_name_raw;
          }

          // Check for required fields
          if (entity === "accounts" && !record.name) {
            const errMsg = "Missing account name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "contacts" && (!record.first_name || !record.last_name)) {
            const errMsg = "Missing first or last name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "contacts" && !record.account_id) {
            const errMsg = "Missing account reference";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "opportunities" && (!record.name || !record.account_id)) {
            const errMsg = "Missing name or account reference";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "leads" && (!record.first_name || !record.last_name)) {
            const errMsg = "Missing first or last name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "products" && (!record.name || !record.code)) {
            const errMsg = "Missing product name or code";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "price_books" && !record.name) {
            const errMsg = "Missing price book name";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }
          if (entity === "price_book_entries" && (!record.product_id || !record.price_book_id)) {
            const errMsg = "Missing product or price book reference";
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }

          // Skip converted leads — they're already contacts in Salesforce
          if (entity === "leads" && record.is_converted === true) {
            skippedArr[0]++;
            continue;
          }

          // Email validation
          if (
            record.email &&
            typeof record.email === "string" &&
            !EMAIL_REGEX.test(record.email)
          ) {
            const errMsg = `Invalid email format "${record.email}"`;
            errors.push(`Row ${rowIndex + 1}: ${errMsg}`);
            failedRows.push({ rowNumber: rowIndex + 1, csvData, crmRecord: { ...record }, error: errMsg });
            failedCount[0]++;
            continue;
          }

          // Defaults
          if (entity === "accounts") {
            record.lifecycle_status = record.lifecycle_status ?? "prospect";
            record.status = record.status ?? "discovery";
            // Auto-calculate FTE Range from employees if not already set
            if (!record.fte_range && typeof record.employees === "number" && record.employees > 0) {
              record.fte_range = employeesToFteRange(record.employees as number);
            }
          }
          if (entity === "opportunities") {
            record.stage = record.stage ?? "lead";
            record.amount = record.amount ?? 0;
            record.team = record.team ?? "sales";
            record.kind = record.kind ?? "new_business";
            // Snapshot FTE from the linked account if the SF CSV didn't
            // already carry its own fte_range/fte_count. This is what makes
            // AddProductDialog's tier-based pricing "just work" on imported
            // opps — see migration 20260413000005_opportunity_fte_snapshot.
            if (
              accountFteByCrmId &&
              typeof record.account_id === "string" &&
              (record.fte_range == null || record.fte_count == null)
            ) {
              const acctFte = accountFteByCrmId.get(record.account_id);
              if (acctFte) {
                if (record.fte_range == null && acctFte.fte_range) {
                  record.fte_range = acctFte.fte_range;
                }
                if (record.fte_count == null && acctFte.fte_count != null) {
                  record.fte_count = acctFte.fte_count;
                }
              }
            }
          }
          if (entity === "leads") {
            record.status = record.status ?? "new";
          }
          if (entity === "products") {
            record.is_active = record.is_active ?? true;
          }
          if (entity === "price_books") {
            record.is_active = record.is_active ?? true;
            record.is_default = record.is_default ?? false;
          }
          if (entity === "price_book_entries") {
            record.unit_price = record.unit_price ?? 0;
          }

          // Sanitize UUID fields — remove any SF IDs that snuck through
          // These DB columns are uuid type and will reject non-UUID values
          const UUID_COLUMNS = new Set([
            "account_id", "primary_contact_id", "owner_user_id", "parent_account_id",
            "converted_account_id", "converted_contact_id", "converted_opportunity_id",
            "source_opportunity_id", "renewal_from_opportunity_id", "campaign_id",
            "original_lead_id", "price_book_id", "product_id",
          ]);
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          for (const key of Object.keys(record)) {
            if (UUID_COLUMNS.has(key) && typeof record[key] === "string" && !UUID_RE.test(record[key] as string)) {
              delete record[key]; // Strip non-UUID values (SF IDs, etc.)
            }
          }

          // Move non-DB fields into custom_fields JSONB
          const CONTACT_DB_COLS = new Set([
            "id", "sf_id", "account_id", "owner_user_id", "first_name", "last_name",
            "email", "title", "phone", "is_primary", "department", "linkedin_url",
            "mailing_street", "mailing_city", "mailing_state", "mailing_zip", "mailing_country",
            "do_not_contact", "lead_source", "original_lead_id", "mql_date", "sql_date",
            "custom_fields", "created_by", "updated_by", "created_at", "updated_at", "archived_at",
          ]);
          const OPP_DB_COLS = new Set([
            "id", "sf_id", "account_id", "primary_contact_id", "owner_user_id",
            "team", "kind", "name", "stage", "amount", "service_amount", "product_amount",
            "services_included", "service_description", "expected_close_date", "close_date",
            "contract_start_date", "contract_end_date", "contract_length_months", "contract_year",
            "source_opportunity_id", "renewal_from_opportunity_id", "loss_reason", "notes",
            "probability", "next_step", "lead_source", "payment_frequency", "cycle_count",
            "auto_renewal", "description", "promo_code", "discount", "subtotal", "follow_up",
            "one_time_project", "lead_source_detail", "fte_count", "fte_range",
            "created_by_automation",
            "custom_fields", "created_by", "updated_by", "created_at", "updated_at", "archived_at",
          ]);
          const LEAD_DB_COLS = new Set([
            "id", "sf_id", "owner_user_id", "first_name", "last_name", "email", "phone",
            "company", "title", "industry", "website", "status", "source", "description",
            "employees", "annual_revenue", "street", "city", "state", "zip", "country",
            "converted_at", "converted_account_id", "converted_contact_id", "converted_opportunity_id",
            "custom_fields", "qualification", "qualification_date", "mql_date", "score", "score_factors",
            "created_by", "updated_by", "created_at", "updated_at", "archived_at",
          ]);

          // Products & price book entries — strip unknown fields (no custom_fields JSONB)
          const PRODUCT_DB_COLS = new Set([
            "id", "sf_id", "code", "name", "product_family", "description",
            "is_active", "default_arr", "category", "pricing_model",
            "created_at", "updated_at",
          ]);
          const PB_DB_COLS = new Set([
            "id", "sf_id", "name", "is_default", "is_active", "description",
            "effective_date", "created_at", "updated_at",
          ]);
          const PBE_DB_COLS = new Set([
            "id", "sf_id", "price_book_id", "product_id", "fte_range",
            "unit_price", "created_at", "updated_at",
          ]);

          const dbCols = entity === "contacts" ? CONTACT_DB_COLS
            : entity === "opportunities" ? OPP_DB_COLS
            : entity === "leads" ? LEAD_DB_COLS
            : entity === "products" ? PRODUCT_DB_COLS
            : entity === "price_books" ? PB_DB_COLS
            : entity === "price_book_entries" ? PBE_DB_COLS
            : null; // accounts handled separately

          if (dbCols) {
            const hasCustomFields = entity !== "products" && entity !== "price_books" && entity !== "price_book_entries";
            const customFields: Record<string, unknown> = {};
            const sfHistoryFields = ["sf_created_by", "sf_created_date", "sf_last_modified_by", "sf_last_modified_date"];
            for (const key of Object.keys(record)) {
              if (!dbCols.has(key) && !sfHistoryFields.includes(key)) {
                if (hasCustomFields) {
                  customFields[key] = record[key];
                }
                delete record[key];
              }
            }
            // SF history fields → store in custom_fields as well (only for entities that have it)
            for (const sfKey of sfHistoryFields) {
              if (record[sfKey]) {
                if (hasCustomFields) {
                  customFields[sfKey] = record[sfKey];
                }
                delete record[sfKey];
              }
            }
            if (hasCustomFields && Object.keys(customFields).length > 0) {
              record.custom_fields = customFields;
            }
          }

          records.push(record);
          recordRowIndices.push(rowIndex);
        }

        if (records.length === 0) {
          setProgress({ current: Math.min(i + batchSize, total), total });
          // Update ETA
          updateETA(Math.min(i + batchSize, total), total);
          continue;
        }

        // Check for duplicates by sf_id
        const sfIds = records
          .map((r) => r.sf_id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        let existingSfIds = new Set<string>();
        if (sfIds.length > 0) {
          const { data: existing } = await supabase
            .from(tableName)
            .select("id, sf_id")
            .in("sf_id", sfIds);
          existingSfIds = new Set(
            (existing ?? []).map((e) => e.sf_id as string)
          );
        }

        const toInsert: Record<string, unknown>[] = [];
        const toUpdate: { id: string; data: Record<string, unknown> }[] = [];

        for (const record of records) {
          const sfId = record.sf_id as string | undefined;
          if (sfId && existingSfIds.has(sfId)) {
            if (duplicateAction === "skip") {
              skippedArr[0]++;
            } else {
              // Find existing record id
              const { data: existing } = await supabase
                .from(tableName)
                .select("id")
                .eq("sf_id", sfId)
                .limit(1)
                .single();
              if (existing) {
                const { sf_id: _removed, ...updateData } = record;
                toUpdate.push({ id: existing.id, data: updateData });
              }
            }
          } else {
            toInsert.push(record);
          }
        }

        // Insert new records — try batch first, fall back to individual on failure
        if (toInsert.length > 0) {
          const { data: insertedData, error: insertError } = await supabase
            .from(tableName)
            .insert(toInsert)
            .select("id");
          if (insertError) {
            // Batch failed — insert one at a time so good records still go through
            for (let r = 0; r < toInsert.length; r++) {
              const { data: singleData, error: singleError } = await supabase
                .from(tableName)
                .insert(toInsert[r])
                .select("id");
              if (singleError) {
                const rowNum = recordRowIndices[r] + 1;
                const name = (toInsert[r].name as string) || `Row ${rowNum}`;
                errors.push(`Row ${rowNum} (${name}): ${singleError.message}`);
                failedRows.push({
                  rowNumber: rowNum,
                  csvData: buildCsvDataRow(csvRows[recordRowIndices[r]], csvHeaders),
                  crmRecord: { ...toInsert[r] },
                  error: singleError.message,
                });
                failedCount[0]++;
              } else {
                imported[0]++;
                if (singleData?.[0]?.id) importedIds.push(singleData[0].id as string);
              }
            }
          } else {
            imported[0] += toInsert.length;
            if (insertedData) {
              for (const row of insertedData) {
                if (row.id) importedIds.push(row.id as string);
              }
            }
          }
        }

        // Update existing records
        for (const { id: recordId, data } of toUpdate) {
          const { error: updateError } = await supabase
            .from(tableName)
            .update(data)
            .eq("id", recordId);
          if (updateError) {
            errors.push(
              `Update sf_id ${data.sf_id ?? recordId}: ${updateError.message}`
            );
          } else {
            imported[0]++;
          }
        }

        setProgress({ current: Math.min(i + batchSize, total), total });
        updateETA(Math.min(i + batchSize, total), total);
      }
    } catch (err) {
      errors.push(`Unexpected error: ${(err as Error).message}`);
    }

    // Warn about unmatched owners (only if records were actually imported/updated, not just skipped)
    if (unmatchedOwners.size > 0 && (imported[0] > 0 || failedCount[0] > 0)) {
      const ownerWarnings = Array.from(unmatchedOwners.entries()).map(
        ([owner, rows]) => `Owner "${owner}" not found in CRM — records imported without owner (${rows.length} rows: ${rows.slice(0, 3).join(", ")}${rows.length > 3 ? "..." : ""})`
      );
      errors.push(...ownerWarnings);
    }

    setImporting(false);
    setEstimatedTimeRemaining(null);
    setResult({
      imported: imported[0],
      skipped: skippedArr[0],
      failed: failedCount[0],
      errors,
      failedRows,
      importedIds,
      entity,
      timestamp: new Date().toISOString(),
    });

    if (unmatchedOwners.size > 0) {
      toast.warning(
        `⚠️ ${unmatchedOwners.size} Salesforce user(s) not found in CRM — those records imported without an owner. See details below.`
      );
    } else if (errors.length === 0) {
      toast.success(
        `Import complete: ${imported[0]} records imported, ${skippedArr[0]} skipped.`
      );
    } else {
      toast.warning(
        `Import finished with ${errors.length} issue(s). See details below.`
      );
    }
  }

  function updateETA(processed: number, total: number) {
    if (processed === 0) {
      setEstimatedTimeRemaining(null);
      return;
    }
    const elapsed = Date.now() - importStartTimeRef.current;
    const rate = processed / elapsed; // rows per ms
    const remaining = total - processed;
    const etaMs = remaining / rate;

    if (etaMs < 1000) {
      setEstimatedTimeRemaining("< 1 second");
    } else if (etaMs < 60000) {
      setEstimatedTimeRemaining(`~${Math.ceil(etaMs / 1000)} seconds`);
    } else {
      const mins = Math.ceil(etaMs / 60000);
      setEstimatedTimeRemaining(`~${mins} minute${mins > 1 ? "s" : ""}`);
    }
  }

  /* ---------- Reset ---------- */

  function handleReset() {
    setCsvHeaders([]);
    setCsvRows([]);
    setMappings([]);
    setResult(null);
    setValidation(null);
    setProgress({ current: 0, total: 0 });
    setCurrentBatch({ batch: 0, totalBatches: 0 });
    setEstimatedTimeRemaining(null);
    setRetryEdits({});
    setRetryingRows(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /* ---------- Retry Failed Rows ---------- */

  function initRetryEdits() {
    if (!result) return;
    const edits: Record<number, Record<string, string>> = {};
    result.failedRows.forEach((fr, idx) => {
      // Build editable fields from the CRM record
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(fr.crmRecord)) {
        fields[key] = val == null ? "" : String(val);
      }
      edits[idx] = fields;
    });
    setRetryEdits(edits);
  }

  function updateRetryField(rowIdx: number, field: string, value: string) {
    setRetryEdits((prev) => ({
      ...prev,
      [rowIdx]: { ...prev[rowIdx], [field]: value },
    }));
  }

  function removeRetryRow(rowIdx: number) {
    if (!result) return;
    const newFailedRows = result.failedRows.filter((_, i) => i !== rowIdx);
    setResult({ ...result, failedRows: newFailedRows, failed: newFailedRows.length });
    setRetryEdits((prev) => {
      const next: Record<number, Record<string, string>> = {};
      // Re-index remaining edits
      let newIdx = 0;
      for (let i = 0; i < result.failedRows.length; i++) {
        if (i !== rowIdx) {
          next[newIdx] = prev[i] ?? {};
          newIdx++;
        }
      }
      return next;
    });
  }

  async function handleRetryFailed() {
    if (!result || result.failedRows.length === 0) return;
    setRetryingRows(true);

    const tableName = entity;
    const stillFailed: FailedRow[] = [];
    let retrySuccess = 0;

    for (let i = 0; i < result.failedRows.length; i++) {
      const fr = result.failedRows[i];
      const edits = retryEdits[i];
      if (!edits) continue;

      // Build the record from edited fields
      const record: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(edits)) {
        if (val === "") continue;
        // Handle booleans
        if (["do_not_contact", "partner_prospect", "priority_account",
             "every_other_year", "one_time_project", "auto_renewal"].includes(key)) {
          record[key] = val === "true" || val === "1" || val.toLowerCase() === "yes";
          continue;
        }
        // Handle numbers
        if (["employees", "locations", "fte_count", "annual_revenue", "acv",
             "lifetime_value", "churn_amount", "number_of_providers", "amount",
             "subtotal", "discount", "score", "billing_latitude", "billing_longitude",
             "shipping_latitude", "shipping_longitude"].includes(key)) {
          const num = Number(val);
          if (!isNaN(num)) { record[key] = num; continue; }
        }
        record[key] = val;
      }

      const { error } = await supabase.from(tableName).insert(record);
      if (error) {
        stillFailed.push({ ...fr, crmRecord: record, error: error.message });
      } else {
        retrySuccess++;
      }
    }

    setResult({
      ...result,
      imported: result.imported + retrySuccess,
      failed: stillFailed.length,
      failedRows: stillFailed,
      errors: stillFailed.map((fr) => `Row ${fr.rowNumber}: ${fr.error}`),
    });
    setRetryEdits({});
    setRetryingRows(false);

    if (stillFailed.length === 0) {
      toast.success(`All ${retrySuccess} previously failed rows imported successfully!`);
    } else {
      toast.warning(`${retrySuccess} rows fixed, ${stillFailed.length} still failing.`);
      // Re-init edits for still-failed rows
      const edits: Record<number, Record<string, string>> = {};
      stillFailed.forEach((fr, idx) => {
        const fields: Record<string, string> = {};
        for (const [key, val] of Object.entries(fr.crmRecord)) {
          fields[key] = val == null ? "" : String(val);
        }
        edits[idx] = fields;
      });
      setRetryEdits(edits);
    }
  }

  /** Return dropdown options for enum fields, or null for free-text fields */
  function getEnumOptions(field: string): string[] | null {
    const enums: Record<string, string[]> = {
      renewal_type: ["auto_renew", "manual_renew", "no_auto_renew", "full_auto_renew", "platform_only_auto_renew"],
      status: ["discovery", "pending", "active", "inactive", "churned"],
      lifecycle_status: ["prospect", "customer", "former_customer"],
      stage: ["lead", "qualified", "proposal", "verbal_commit", "closed_won", "closed_lost"],
      kind: ["new_business", "renewal"],
      team: ["sales", "renewals"],
      lead_source: ["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "sql", "mql", "other"],
      payment_frequency: ["monthly", "quarterly", "semi_annually", "annually"],
      qualification: ["unqualified", "mql", "sql", "sal"],
    };
    return enums[field] ?? null;
  }

  /** Get the fields that are most likely problematic based on the error message */
  function getErrorHighlightField(error: string): string | null {
    const enumMatch = error.match(/enum (\w+)/);
    if (enumMatch) return enumMatch[1];
    const colMatch = error.match(/column "(\w+)"/);
    if (colMatch) return colMatch[1];
    return null;
  }

  /* ---------- Render ---------- */

  const crmFields = getCRMFields(entity);
  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  async function handleUndoImport() {
    if (!result || result.importedIds.length === 0) return;
    if (!confirm(`Delete ${result.importedIds.length} records from this import? This cannot be undone.`)) return;

    setUndoing(true);
    try {
      const ids = result.importedIds;
      const table = result.entity;
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from(table).delete().in("id", batch);
        if (error) throw error;
      }
      toast.success(`Undo complete — ${ids.length} records deleted from ${table}.`);
      setResult(null);
    } catch (err) {
      toast.error(`Undo failed: ${(err as Error).message}`);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            How to Import from Salesforce
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>
              Export your data from Salesforce using Data Loader or Reports (CSV
              format).
            </li>
            <li>Select the entity type you want to import below.</li>
            <li>Upload your CSV file.</li>
            <li>
              Review the column mapping -- common Salesforce field names are
              auto-detected.
            </li>
            <li>Preview your data, validate, and click Import.</li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 1: Entity Type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Step 1: Select Entity Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="entity-type">Entity</Label>
            <Select
              value={entity}
              onValueChange={(v) => {
                setEntity(v as EntityType);
                handleReset();
              }}
            >
              <SelectTrigger id="entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounts">Accounts</SelectItem>
                <SelectItem value="contacts">Contacts</SelectItem>
                <SelectItem value="opportunities">Opportunities</SelectItem>
                <SelectItem value="leads">Leads</SelectItem>
                <SelectItem value="products">Products</SelectItem>
                <SelectItem value="price_books">Price Books</SelectItem>
                <SelectItem value="price_book_entries">Price Book Entries</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(entity === "products" ||
            entity === "price_books" ||
            entity === "price_book_entries") && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <div className="flex gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">FTE-range cleanup is ON for this entity</p>
                  {entity === "products" && (
                    <p>
                      FTE prefixes like "51-100 " or "1-20 " will be stripped
                      from product names and codes, and duplicates will be
                      collapsed into a single canonical row. Expect your
                      ~157 Salesforce products to consolidate down to ~16.
                    </p>
                  )}
                  {entity === "price_books" && (
                    <p>
                      Tier-specific price books ("1-20 Price Book",
                      "21-50 Price Book", etc.) will be skipped — all entries
                      live under a single master book named{" "}
                      <strong>Medcurity Standard</strong>. Salesforce's
                      "Standard Price Book" is auto-renamed to the master.
                    </p>
                  )}
                  {entity === "price_book_entries" && (
                    <p>
                      Every entry is inserted under the{" "}
                      <strong>Medcurity Standard</strong> master book, with
                      the <code>fte_range</code> column populated by parsing
                      the source Salesforce pricebook name (e.g. "51-100
                      Price Book" → fte_range "51-100"). The master book is
                      auto-created if it doesn't exist yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2a: Upload SF User CSV (for owner mapping) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 2: Load Salesforce Users (for Owner Mapping)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Upload your <strong>User.csv</strong> or <strong>User TEST.csv</strong> from the Salesforce export.
            This maps Salesforce Owner IDs to CRM users by matching email addresses.
            {!userCsvLoaded && " Without this, owner fields won't be assigned."}
          </p>
          <div className="flex items-center gap-4">
            <Input
              ref={userFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleUserFileChange}
              className="max-w-sm"
            />
            {userCsvLoaded && (
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                ✅ {sfUserMap.size} Salesforce users loaded
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 2b: Upload Entity CSV */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 3: Upload CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="max-w-sm"
            />
            {csvRows.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                {csvRows.length} rows, {csvHeaders.length} columns
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Column Mapping */}
      {csvHeaders.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Step 3: Column Mapping</span>
              <div className="flex items-center gap-3 text-xs font-normal">
                <span className="inline-flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {autoMappedCount} auto-mapped
                </span>
                {manualNeededCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-yellow-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {manualNeededCount} unmapped
                  </span>
                )}
                {skippedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {skippedCount} skipped
                  </span>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Match</TableHead>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>CRM Field</TableHead>
                    <TableHead>Sample Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m, idx) => (
                    <TableRow key={m.csvColumn}>
                      <TableCell>
                        {m.crmField ? (
                          m.confidence === "exact" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : m.confidence === "fuzzy" ? (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground/40" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {m.csvColumn}
                        {m.confidence === "fuzzy" && m.crmField && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-yellow-600 border-yellow-300">
                            fuzzy
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.crmField || "__skip__"}
                          onValueChange={(v) =>
                            updateMapping(
                              m.csvColumn,
                              v === "__skip__" ? "" : v
                            )
                          }
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              -- Skip this column --
                            </SelectItem>
                            {crmFields.map((f) => (
                              <SelectItem key={f} value={f}>
                                {fieldLabel(f)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {csvRows[0]?.[idx] ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Preview */}
      {previewRows.length > 0 && activeMappings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 4: Preview (first {previewRows.length} rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {activeMappings.map((m) => (
                      <TableHead key={m.crmField}>
                        {fieldLabel(m.crmField)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow key={idx}>
                      {activeMappings.map((m) => (
                        <TableCell
                          key={m.crmField}
                          className="truncate max-w-[200px]"
                        >
                          {row[m.crmField] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation Preview */}
      {csvRows.length > 0 && activeMappings.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step 5: Validate & Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Validate button */}
            {!validation && (
              <Button variant="outline" onClick={handleValidate}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Validate Before Import
              </Button>
            )}

            {/* Validation summary */}
            {validation && (
              <div className="rounded-md border p-4 space-y-3">
                <h4 className="text-sm font-medium">Validation Summary</h4>
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {validation.willImport} rows will be imported
                  </span>
                  {validation.warnings.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-yellow-600">
                      <AlertTriangle className="h-4 w-4" />
                      {validation.warnings.length} rows have warnings
                    </span>
                  )}
                  {validation.willSkip.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <XCircle className="h-4 w-4" />
                      {validation.willSkip.length} rows will be skipped
                    </span>
                  )}
                </div>

                {/* Warning details */}
                {validation.warnings.length > 0 && (
                  <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                    <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                      Warnings:
                    </p>
                    <ul className="text-xs text-yellow-600 dark:text-yellow-500 space-y-0.5 max-h-32 overflow-y-auto">
                      {validation.warnings.map((w, idx) => (
                        <li key={idx}>
                          Row {w.rowNumber}: {w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Skip details */}
                {validation.willSkip.length > 0 && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3">
                    <p className="text-xs font-medium text-destructive mb-1">
                      Will be skipped:
                    </p>
                    <ul className="text-xs text-destructive space-y-0.5 max-h-32 overflow-y-auto">
                      {validation.willSkip.map((s, idx) => (
                        <li key={idx}>
                          Row {s.rowNumber}: {s.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Import controls */}
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <Label>Duplicate Handling (by SF ID)</Label>
                <Select
                  value={duplicateAction}
                  onValueChange={(v) =>
                    setDuplicateAction(v as "skip" | "update")
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip Duplicates</SelectItem>
                    <SelectItem value="update">
                      Update Existing
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pt-5">
                <Button
                  onClick={handleImport}
                  disabled={importing}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {importing
                    ? `Importing...`
                    : `Import ${csvRows.length} rows`}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={importing}
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            {importing && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Importing row {progress.current} of {progress.total}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" />
                    Batch {currentBatch.batch} of {currentBatch.totalBatches}
                  </span>
                  {estimatedTimeRemaining && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {estimatedTimeRemaining} remaining
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import Results Summary */}
      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {result.failed === 0 && result.errors.length === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {result.imported} records imported successfully
              </div>
              {result.importedIds.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleUndoImport}
                  disabled={undoing}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {undoing ? "Undoing..." : `Undo Import (${result.importedIds.length} records)`}
                </Button>
              )}
              {result.skipped > 0 && (
                <div className="flex items-center gap-2 text-sm text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  {result.skipped} records skipped (duplicate SF ID)
                </div>
              )}
              {result.failed > 0 && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {result.failed} records failed (details below)
                </div>
              )}
            </div>

            {/* Non-row-specific errors (owner warnings etc.) */}
            {result.errors.length > 0 && result.errors.some((e) => !result.failedRows.some((fr) => e.includes(`Row ${fr.rowNumber}`))) && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 max-h-48 overflow-y-auto">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
                  Warnings:
                </p>
                <ul className="text-xs text-amber-600 dark:text-amber-500 space-y-0.5">
                  {result.errors
                    .filter((e) => !result.failedRows.some((fr) => e.startsWith(`Row ${fr.rowNumber}:`)))
                    .map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                </ul>
              </div>
            )}

            {/* Failed rows — editable retry UI */}
            {result.failedRows.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-destructive flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" />
                    {result.failedRows.length} Failed Row{result.failedRows.length !== 1 ? "s" : ""}
                  </h4>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadErrorReport(result.failedRows)}
                    >
                      <Download className="h-4 w-4 mr-1.5" />
                      Download CSV
                    </Button>
                    {Object.keys(retryEdits).length === 0 ? (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={initRetryEdits}
                      >
                        <Pencil className="h-4 w-4 mr-1.5" />
                        Edit & Retry Failed Rows
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleRetryFailed}
                        disabled={retryingRows}
                      >
                        <RotateCcw className="h-4 w-4 mr-1.5" />
                        {retryingRows ? "Retrying..." : `Retry ${result.failedRows.length} Row${result.failedRows.length !== 1 ? "s" : ""}`}
                      </Button>
                    )}
                  </div>
                </div>

                {/* If NOT in edit mode, show error summary */}
                {Object.keys(retryEdits).length === 0 && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-md p-3">
                    <ul className="text-xs text-destructive space-y-1">
                      {result.failedRows.map((fr, idx) => {
                        const recordName = (fr.crmRecord.name as string) || `Row ${fr.rowNumber}`;
                        return (
                          <li key={idx}>
                            <span className="font-medium">{recordName} (Row {fr.rowNumber}):</span>{" "}
                            {fr.error}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Editable retry cards */}
                {Object.keys(retryEdits).length > 0 && (
                  <div className="space-y-3">
                    {result.failedRows.map((fr, idx) => {
                      const edits = retryEdits[idx];
                      if (!edits) return null;
                      const errorField = getErrorHighlightField(fr.error);
                      const recordName = (edits.name) || `Row ${fr.rowNumber}`;

                      // Get important fields first, then the rest
                      const fieldEntries = Object.entries(edits);
                      const importantFields = errorField
                        ? fieldEntries.filter(([k]) => k === errorField)
                        : [];
                      const otherFields = errorField
                        ? fieldEntries.filter(([k]) => k !== errorField)
                        : fieldEntries;

                      return (
                        <div key={idx} className="border rounded-md overflow-hidden">
                          {/* Row header */}
                          <div className="bg-destructive/5 px-4 py-2 flex items-center justify-between border-b">
                            <div>
                              <span className="text-sm font-medium">{recordName}</span>
                              <span className="text-xs text-muted-foreground ml-2">(CSV Row {fr.rowNumber})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="destructive" className="text-[10px]">
                                {fr.error}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeRetryRow(idx)}
                                title="Remove this row (skip it)"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          {/* Error field highlighted at top */}
                          {importantFields.length > 0 && (
                            <div className="px-4 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800">
                              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-2 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Fix this field:
                              </p>
                              {importantFields.map(([field, val]) => (
                                <div key={field} className="flex items-center gap-2">
                                  <Label className="text-xs font-medium w-40 text-red-700 dark:text-red-400">{fieldLabel(field)}</Label>
                                  {getEnumOptions(field) ? (
                                    <Select
                                      value={val || "__empty__"}
                                      onValueChange={(v) => updateRetryField(idx, field, v === "__empty__" ? "" : v)}
                                    >
                                      <SelectTrigger className="h-8 text-xs border-red-300 dark:border-red-700 w-[200px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__empty__">-- Clear --</SelectItem>
                                        {getEnumOptions(field)!.map((opt) => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      value={val}
                                      onChange={(e) => updateRetryField(idx, field, e.target.value)}
                                      className="h-8 text-xs border-red-300 dark:border-red-700 max-w-xs"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Other fields in a compact grid */}
                          <div className="px-4 py-3">
                            <details className="group">
                              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                {otherFields.length} other fields (click to expand)
                              </summary>
                              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {otherFields.map(([field, val]) => (
                                  <div key={field} className="flex items-center gap-1.5">
                                    <Label className="text-[11px] font-medium text-muted-foreground w-32 shrink-0 truncate" title={field}>
                                      {fieldLabel(field)}
                                    </Label>
                                    {getEnumOptions(field) ? (
                                      <Select
                                        value={val || "__empty__"}
                                        onValueChange={(v) => updateRetryField(idx, field, v === "__empty__" ? "" : v)}
                                      >
                                        <SelectTrigger className="h-7 text-[11px] flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__empty__">-- Clear --</SelectItem>
                                          {getEnumOptions(field)!.map((opt) => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <Input
                                        value={val}
                                        onChange={(e) => updateRetryField(idx, field, e.target.value)}
                                        className="h-7 text-[11px] flex-1"
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleReset}
              >
                Start New Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
