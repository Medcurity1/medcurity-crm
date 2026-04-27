import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { formatPhone } from "@/components/PhoneInput";
import {
  formatDate,
  formatDateTime,
  formatCurrency,
  industryCategoryLabel,
  lifecycleLabel,
  statusLabel,
  renewalTypeLabel,
  leadSourceLabel,
  paymentFrequencyLabel,
  stageLabel,
  kindLabel,
  teamLabel,
  qualificationLabel,
  leadStatusLabel,
  activityLabel,
  projectSegmentLabel,
} from "@/lib/formatters";
import { usePicklistOptions } from "@/features/picklists/api";

/**
 * Map column name → human label. Used as the default when a layout
 * field has no `label_override`.
 */
export function humanizeFieldKey(key: string): string {
  return key
    .replace(/^__/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render a value for display on a Detail page. Handles type-specific
 * formatting (currency, dates, booleans), picklist label lookups, and
 * FK-to-link resolution for common references.
 *
 * For now this is a centralized switch. As we onboard each entity,
 * we can extend the rules here without touching the layout component.
 */
export function DisplayValue({
  fieldKey,
  value,
  entity,
  record,
}: {
  fieldKey: string;
  value: unknown;
  entity: string;
  record: Record<string, unknown>;
}) {
  // Null / undefined / empty string → em dash
  if (value == null || value === "") {
    return <span className="text-sm font-medium">—</span>;
  }

  // Booleans
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-green-600" />
    ) : (
      <X className="h-4 w-4 text-muted-foreground" />
    );
  }

  // Discount on opportunities is a PERCENT (0-100), not currency.
  // Render with % suffix to match the form input + DB trigger.
  if (fieldKey === "discount" && entity === "opportunities") {
    const n = Number(value);
    return (
      <span className="text-sm font-medium">
        {Number.isFinite(n) ? `${n}%` : "—"}
      </span>
    );
  }

  // Currency by name convention (any column ending in _amount, _value, acv,
  // amount, subtotal, discount when on opportunities)
  if (isCurrencyField(fieldKey)) {
    const n = Number(value);
    return <span className="text-sm font-medium">{formatCurrency(Number.isFinite(n) ? n : 0)}</span>;
  }

  // Dates by name convention
  if (isDateField(fieldKey)) {
    return <span className="text-sm font-medium">{formatDate(String(value))}</span>;
  }

  // Datetimes by name convention
  if (isDateTimeField(fieldKey)) {
    return <span className="text-sm font-medium">{formatDateTime(String(value))}</span>;
  }

  // Phone
  if (fieldKey === "phone" || fieldKey === "mobile_phone") {
    return <span className="text-sm font-medium">{formatPhone(String(value))}</span>;
  }

  // URLs
  if (fieldKey === "website" || fieldKey === "linkedin_url" || fieldKey === "pardot_url") {
    const url = String(value);
    const href = url.startsWith("http") ? url : `https://${url}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-primary hover:underline truncate block"
      >
        {url}
      </a>
    );
  }

  // Email
  if (fieldKey === "email") {
    return (
      <a
        href={`mailto:${value}`}
        className="text-sm font-medium text-primary hover:underline truncate block"
      >
        {String(value)}
      </a>
    );
  }

  // Known enum labels by entity + field
  const enumLabel = resolveEnumLabel(entity, fieldKey, value);
  if (enumLabel != null) {
    return <span className="text-sm font-medium">{enumLabel}</span>;
  }

  // FK resolved via embed (account_id → record.account?.name, etc.)
  const fkLabel = resolveFkLabel(fieldKey, record);
  if (fkLabel != null) {
    return <span className="text-sm font-medium">{fkLabel}</span>;
  }

  // Fallback: stringify
  return <span className="text-sm font-medium">{String(value)}</span>;
}

/**
 * Wrapper that resolves picklist values via the picklist_options table.
 * Renders the human label if the column is picklist-backed; falls back
 * to DisplayValue otherwise.
 */
export function PicklistAwareDisplay({
  fieldKey,
  entity,
  value,
  record,
}: {
  fieldKey: string;
  entity: string;
  value: unknown;
  record: Record<string, unknown>;
}) {
  const { data: picklists } = usePicklistOptions();
  const dotKey = `${entity}.${fieldKey}`;
  const opts = picklists?.get(dotKey);

  if (opts && value != null && value !== "") {
    const opt = opts.find((o) => o.value === String(value));
    if (opt) {
      return <span className="text-sm font-medium">{opt.label}</span>;
    }
    // Stored value not in active picklist → show with (legacy) hint
    return (
      <span className="text-sm font-medium">
        {String(value)}{" "}
        <span className="text-xs text-muted-foreground italic">(legacy)</span>
      </span>
    );
  }

  return <DisplayValue fieldKey={fieldKey} value={value} entity={entity} record={record} />;
}

// ---------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------

const CURRENCY_FIELDS = new Set([
  "amount",
  "subtotal",
  // discount is a percent on opportunities — handled separately above
  "service_amount",
  "product_amount",
  "acv",
  "lifetime_value",
  "churn_amount",
  "annual_revenue",
  "default_arr",
]);

function isCurrencyField(key: string): boolean {
  return CURRENCY_FIELDS.has(key);
}

const DATE_FIELDS = new Set([
  "active_since",
  "churn_date",
  "current_contract_start_date",
  "current_contract_end_date",
  "expected_close_date",
  "close_date",
  "contract_start_date",
  "contract_end_date",
  "contract_signed_date",
  "due_at",
  "mql_date",
  "sql_date",
  "first_activity_date",
  "pardot_last_activity_date",
  "conversion_date",
  "verified_at",
]);

function isDateField(key: string): boolean {
  if (DATE_FIELDS.has(key)) return true;
  return key.endsWith("_date");
}

const DATETIME_FIELDS = new Set([
  "created_at",
  "updated_at",
  "archived_at",
  "completed_at",
  "converted_at",
  "imported_at",
  "sf_created_date",
  "sf_last_modified_date",
  "reminder_at",
  "outlook_synced_at",
  "last_reminder_sent_at",
]);

function isDateTimeField(key: string): boolean {
  return DATETIME_FIELDS.has(key);
}

function resolveEnumLabel(entity: string, key: string, value: unknown): string | null {
  if (value == null) return null;
  const v = String(value);
  try {
    if (entity === "accounts") {
      if (key === "lifecycle_status") return lifecycleLabel(v as never);
      if (key === "status") return statusLabel(v as never);
      if (key === "renewal_type") return renewalTypeLabel(v as never);
      if (key === "industry_category") return industryCategoryLabel(v as never);
      if (key === "lead_source") return leadSourceLabel(v as never);
    }
    if (entity === "leads") {
      if (key === "industry_category") return industryCategoryLabel(v as never);
      if (key === "status") return leadStatusLabel(v as never);
      if (key === "qualification") return qualificationLabel(v as never);
      if (key === "source") return leadSourceLabel(v as never);
      if (key === "project_segment") return projectSegmentLabel(v as never);
    }
    if (entity === "opportunities") {
      if (key === "stage") return stageLabel(v as never);
      if (key === "kind") return kindLabel(v as never);
      if (key === "team") return teamLabel(v as never);
      if (key === "lead_source") return leadSourceLabel(v as never);
      if (key === "payment_frequency") return paymentFrequencyLabel(v as never);
    }
    if (entity === "activities") {
      if (key === "activity_type") return activityLabel(v as never);
    }
  } catch {
    // Unknown enum value — fall back to plain string
  }
  return null;
}

/**
 * If a field key references a related record AND the parent record
 * has the embed loaded (e.g. record.owner = { full_name: ... }), render
 * the human-friendly label instead of a UUID.
 */
function resolveFkLabel(key: string, record: Record<string, unknown>): string | null {
  const ownerLike = ["owner_user_id", "created_by", "updated_by", "archived_by", "verified_by", "assigned_assessor_id", "original_sales_rep_id"];
  if (ownerLike.includes(key)) {
    // Try common embed field names
    if (key === "owner_user_id" && record.owner && typeof record.owner === "object") {
      const o = record.owner as { full_name?: string | null };
      return o.full_name ?? null;
    }
    if (key === "created_by" && record.creator && typeof record.creator === "object") {
      const o = record.creator as { full_name?: string | null };
      return o.full_name ?? null;
    }
    if (key === "updated_by" && record.updater && typeof record.updater === "object") {
      const o = record.updater as { full_name?: string | null };
      return o.full_name ?? null;
    }
    return null;
  }

  if (key === "account_id" && record.account && typeof record.account === "object") {
    const a = record.account as { id?: string; name?: string | null };
    if (a.id && a.name) {
      return null; // signals caller to use the link helper below
    }
    if (a.name) return a.name;
  }

  return null;
}

/**
 * Render a clickable account/contact/etc link if the embed is loaded.
 */
export function FkLink({
  fieldKey,
  record,
}: {
  fieldKey: string;
  record: Record<string, unknown>;
}) {
  if (fieldKey === "account_id" && record.account && typeof record.account === "object") {
    const a = record.account as { id?: string; name?: string | null };
    if (a.id && a.name) {
      return (
        <Link to={`/accounts/${a.id}`} className="text-sm font-medium text-primary hover:underline">
          {a.name}
        </Link>
      );
    }
  }
  if (fieldKey === "primary_contact_id" && record.primary_contact && typeof record.primary_contact === "object") {
    const c = record.primary_contact as { id?: string; first_name?: string; last_name?: string };
    if (c.id) {
      return (
        <Link to={`/contacts/${c.id}`} className="text-sm font-medium text-primary hover:underline">
          {[c.first_name, c.last_name].filter(Boolean).join(" ")}
        </Link>
      );
    }
  }
  if (fieldKey === "parent_account_id" && record.parent_account && typeof record.parent_account === "object") {
    const a = record.parent_account as { id?: string; name?: string | null };
    if (a.id && a.name) {
      return (
        <Link to={`/accounts/${a.id}`} className="text-sm font-medium text-primary hover:underline">
          {a.name}
        </Link>
      );
    }
  }
  return null;
}
