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

type EntityType = "accounts" | "contacts" | "opportunities" | "leads";

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
   Field mappings per entity
   ================================================================ */

const ACCOUNT_FIELDS: Record<string, string> = {
  "account name": "name",
  "account id": "sf_id",
  industry: "industry",
  website: "website",
  phone: "phone",
  description: "description",
  "billing street": "billing_street",
  "billing city": "billing_city",
  "billing state/province": "billing_state",
  "billing state": "billing_state",
  "billing zip/postal code": "billing_zip",
  "billing zip": "billing_zip",
  "billing postal code": "billing_zip",
  "billing postalcode": "billing_zip",
  "billing country": "billing_country",
  "billing latitude": "billing_latitude",
  "billing longitude": "billing_longitude",
  "shipping street": "shipping_street",
  "shipping city": "shipping_city",
  "shipping state/province": "shipping_state",
  "shipping state": "shipping_state",
  "shipping zip/postal code": "shipping_zip",
  "shipping zip": "shipping_zip",
  "shipping postal code": "shipping_zip",
  "shipping postalcode": "shipping_zip",
  "shipping country": "shipping_country",
  "shipping latitude": "shipping_latitude",
  "shipping longitude": "shipping_longitude",
  "account owner": "owner_user_id",
  "owner id": "owner_user_id",
  type: "account_type",
  "annual revenue": "annual_revenue",
  employees: "employees",
  "number of employees": "employees",
  fax: "fax",
  sic: "sic",
  "sic desc": "sic_description",
  rating: "rating",
  site: "site",
  "ticker symbol": "ticker_symbol",
  ownership: "ownership",
  "last activity date": "last_activity_date",
  "do not contact": "do_not_contact",
  "lead source": "lead_source",
  "lead source detail": "lead_source_detail",
  "partner account": "partner_account",
  "referring partner": "partner_account",
  "partner prospect": "partner_prospect",
  "partner source": "lead_source_detail",
  "account source": "lead_source",
  locations: "locations",
  status: "status",
  "active since": "active_since",
  ftes: "fte_count",
  "fte range": "fte_range",
  "lifetime value": "lifetime_value",
  "time zone": "timezone",
  "renewal type": "renewal_type",
  "account number": "account_number",
  "created date": "sf_created_date",
  "created by id": "sf_created_by",
  "last modified date": "sf_last_modified_date",
  "last modified by id": "sf_last_modified_by",
  "parent id": "parent_account_id",
  "number of providers": "number_of_providers",
  project: "project",
  "churn amount": "churn_amount",
  "churn date": "churn_date",
  contracts: "contracts",
  "next steps": "next_steps",
  "priority account": "priority_account",
  "every other year": "every_other_year",
};

const CONTACT_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  title: "title",
  phone: "phone",
  "account id": "account_id_sf_lookup",
  "contact id": "sf_id",
  "owner id": "owner_user_id",
  department: "department",
  "do not call": "do_not_contact",
  "has opted out of email": "do_not_contact",
  "lead source": "lead_source",
  "mailing street": "mailing_street",
  "mailing city": "mailing_city",
  "mailing state/province": "mailing_state",
  "mailing state": "mailing_state",
  "mailing zip/postal code": "mailing_zip",
  "mailing zip": "mailing_zip",
  "mailing country": "mailing_country",
};

const OPPORTUNITY_FIELDS: Record<string, string> = {
  "opportunity name": "name",
  "account id": "account_id_sf_lookup",
  stage: "stage",
  amount: "amount",
  "close date": "close_date",
  "opportunity id": "sf_id",
  type: "kind",
  "one time project": "one_time_project",
  "lead source": "lead_source",
  "lead source detail": "lead_source_detail",
  "payment frequency": "payment_frequency",
  "contract length": "contract_length_months",
  "contract year": "contract_year",
  discount: "discount",
  subtotal: "subtotal",
  "promo code": "promo_code",
  "follow up": "follow_up",
  "auto renewal": "auto_renewal",
  "cycle count": "cycle_count",
  description: "description",
  "next step": "next_step",
  probability: "probability",
  "created date": "created_at",
  "owner id": "owner_user_id",
  ownerid: "owner_user_id",
  "opportunity owner": "owner_user_id",
  team: "team",
  "primary contact id": "primary_contact_id_sf_lookup",
  "contract start date": "contract_start_date",
  "contract end date": "contract_end_date",
  "current contract start date": "contract_start_date",
  "current contract end date": "contract_end_date",
  notes: "notes",
};

const LEAD_FIELDS: Record<string, string> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  company: "company",
  status: "status",
  "lead source": "source",
  "lead id": "sf_id",
  phone: "phone",
  title: "title",
  industry: "industry",
  website: "website",
  employees: "employees",
  "annual revenue": "annual_revenue",
  street: "street",
  city: "city",
  state: "state",
  "zip/postal code": "zip",
  zip: "zip",
  country: "country",
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
        "first_name",
        "last_name",
        "email",
        "title",
        "phone",
        "sf_id",
        "account_id_sf_lookup",
        "owner_user_id",
        "is_primary",
        "department",
        "linkedin_url",
        "do_not_contact",
        "lead_source",
        "lead_source_detail",
        "mailing_street",
        "mailing_city",
        "mailing_state",
        "mailing_zip",
        "mailing_country",
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
        // Contract
        "contract_start_date",
        "contract_end_date",
        "contract_length_months",
        "contract_year",
        // Financial
        "discount",
        "subtotal",
        "service_amount",
        "product_amount",
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
        // Details
        "description",
        "notes",
        "next_step",
        "follow_up",
        "loss_reason",
        "created_at",
      ];
    case "leads":
      return [
        "first_name",
        "last_name",
        "email",
        "company",
        "status",
        "source",
        "sf_id",
        "owner_user_id",
        "phone",
        "title",
        "industry",
        "website",
        "employees",
        "annual_revenue",
        "street",
        "city",
        "state",
        "zip",
        "country",
        "description",
        "lead_source_detail",
        "qualification",
        "score",
        "converted_account_id",
        "converted_contact_id",
        "converted_opportunity_id",
        "converted_at",
      ];
  }
}

/** Human-readable label overrides for specific CRM field keys. */
const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  owner_user_id: "Account Owner",
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
  if (entity === "opportunities" && !mapped.name) {
    return { type: "skip", message: "Missing required field \"name\"" };
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
        mapped[mapping.crmField] = rowValues[idx] ?? "";
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
      if (
        entity === "contacts" ||
        entity === "opportunities"
      ) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, sf_id")
          .not("sf_id", "is", null);
        accountSfMap = new Map(
          (accounts ?? []).map((a) => [a.sf_id as string, a.id as string])
        );
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
                const hasOwnerIdColumn = mappings.some(
                  (m) => m.crmField === "owner_user_id" && m.csvColumn !== csvHeaders[csvHeaders.indexOf(
                    mappings.find((mm) => mm.crmField === "owner_user_id" && csvRows[0]?.[csvHeaders.indexOf(mm.csvColumn)]?.startsWith?.("005") === false)?.csvColumn ?? ""
                  )]
                );
                // Simpler: just check if ANY mapped owner column has a 005 value in this row
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
               "every_other_year", "one_time_project", "auto_renewal"].includes(field)
            ) {
              record[field] = value.toLowerCase() === "true" || value === "1";
              continue;
            }

            // UUID reference fields — skip Salesforce null placeholders like "000000000000000AAA"
            if (
              ["parent_account_id", "converted_account_id", "converted_contact_id",
               "converted_opportunity_id"].includes(field)
            ) {
              // Valid UUIDs are 36 chars with hyphens; SF IDs are 18-char alphanumeric
              // Skip null placeholders (all zeros or all same char)
              if (/^0+[A-Z]*$/.test(value) || value === "000000000000000AAA") {
                continue; // skip — it's a Salesforce null placeholder
              }
              record[field] = value;
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
                 "team", "lead_source", "payment_frequency", "qualification"].includes(field)) {
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
                  "proposal": "proposal",
                  "qualified": "qualified",
                  "verbal_commit": "verbal_commit",
                  "lead": "lead",
                },
                kind: {
                  "new_business": "new_business",
                  "new business": "new_business",
                  "renewal": "renewal",
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
                },
              };
              const mapping = enumMappings[field];
              record[field] = mapping?.[normalized] ?? normalized;
              continue;
            }

            record[field] = value;
          }

          if (skipRow) {
            continue;
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
          }
          if (entity === "leads") {
            record.status = record.status ?? "new";
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
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(toInsert);
          if (insertError) {
            // Batch failed — insert one at a time so good records still go through
            for (let r = 0; r < toInsert.length; r++) {
              const { error: singleError } = await supabase
                .from(tableName)
                .insert(toInsert[r]);
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
              }
            }
          } else {
            imported[0] += toInsert.length;
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
              </SelectContent>
            </Select>
          </div>
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
