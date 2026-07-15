import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Close-readiness gate (Rachel's request).
 *
 * An opportunity may only move to Closed Won once its ACCOUNT carries
 * complete client information:
 *   1. a phone number,
 *   2. a billing address (street + city + state + zip),
 *   3. an FTE range, and
 *   4. at least one non-archived contact with an email.
 *
 * This is deliberately STRICTER than — and independent of — the
 * admin-configurable "required fields" grandfather rule in
 * src/lib/requiredFields.ts. That rule intentionally lets you keep
 * editing imported records that were always missing a field; this gate
 * says the opposite for one specific action: finalizing a deal demands
 * the account data regardless of when the record was imported.
 *
 * Enforced CLIENT-SIDE only, on the transition INTO closed_won. There is
 * intentionally NO database trigger, so bulk imports and the renewal
 * automation (which legitimately create or carry closed_won rows) are
 * never blocked.
 *
 * Which of the four checks actually run is config-driven: the
 * `required_field_config` table (entity 'opportunity_close') can turn any
 * of them off without a code change. When that config is absent (e.g. the
 * seed migration hasn't deployed yet) or the query fails, all four are
 * enforced — the gate is never silently disabled.
 */

/** The keys, in the order their messages should read. */
export const CLOSE_READINESS_KEYS = [
  "account_phone",
  "account_billing_address",
  "account_fte_range",
  "contact_email",
  // Rachel (2026-07-15): a deal that INCLUDES SERVICES needs an Assigned
  // Assessor before it can close — someone has to deliver the SRA/NVA.
  // Deals without services are exempt (the condition lives in the
  // evaluator, not the config).
  "assigned_assessor",
] as const;

export type CloseReadinessKey = (typeof CLOSE_READINESS_KEYS)[number];

const LABELS: Record<CloseReadinessKey, string> = {
  account_phone: "Account phone number",
  account_billing_address: "Billing address",
  account_fte_range: "FTE range",
  contact_email: "A contact email address",
  assigned_assessor: "An assigned assessor (this deal includes services)",
};

export interface CloseReadinessResult {
  ready: boolean;
  missing: string[];
}

/** Minimal shapes so the pure evaluator is trivially unit-testable. */
export interface CloseReadinessAccount {
  phone?: unknown;
  fte_range?: unknown;
  billing_street?: unknown;
  billing_city?: unknown;
  billing_state?: unknown;
  billing_zip?: unknown;
}

export interface CloseReadinessContact {
  is_primary?: boolean | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: unknown;
  email2?: unknown;
  email3?: unknown;
}

/**
 * Opportunity-level inputs for the assigned-assessor rule. Callers supply
 * whichever they have: the form passes its in-flight values (the deal may
 * not exist yet, or the save may be about to change them); the inline
 * surfaces pass the opp id and checkCloseReadiness fetches these fields.
 */
export interface CloseReadinessOpportunity {
  services_included?: boolean | null;
  service_amount?: number | string | null;
  assigned_assessor_id?: string | null;
  /** Any attached line item with products.product_family ILIKE 'service%' —
   *  the same signal recalc_opportunity_amount splits totals on. */
  has_service_line_items?: boolean;
}

/**
 * A deal "includes services" when ANY signal says so: the Services
 * Included flag, a service dollar amount, or a service-family line item.
 * OR-ing keeps the rule safe against the historical drift between these
 * three (see the 20260513 services_included backfills).
 */
export function opportunityHasServices(opp: CloseReadinessOpportunity): boolean {
  if (opp.services_included === true) return true;
  const amt = Number(opp.service_amount ?? 0);
  if (Number.isFinite(amt) && amt > 0) return true;
  return opp.has_service_line_items === true;
}

/**
 * "Empty" is narrow but trims: null, undefined, or a whitespace-only
 * string counts as missing. Non-string values (a number, etc.) are
 * present. This matches the intent of "complete client information" —
 * a field of spaces isn't a real phone number or address line.
 */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function contactHasEmail(c: CloseReadinessContact): boolean {
  return !isBlank(c.email) || !isBlank(c.email2) || !isBlank(c.email3);
}

/**
 * Pure decision logic — no network. Given the enforced keys, the account
 * row, and its (already non-archived) contacts, returns the list of
 * human-readable missing items. `checkCloseReadiness` below wires this to
 * Supabase; tests exercise this directly with mock rows.
 */
export function evaluateCloseReadiness(
  keys: CloseReadinessKey[],
  account: CloseReadinessAccount | null,
  contacts: CloseReadinessContact[],
  // Omitted/null => the assessor rule is skipped: the caller had no
  // opportunity context to judge. Every UI surface passes it (form: its
  // in-flight values; inline stage changes: fetched by opp id).
  opportunity?: CloseReadinessOpportunity | null,
): string[] {
  // Can't verify the account at all — block rather than let an
  // unverifiable deal close.
  if (!account) return ["Account information could not be loaded"];

  const want = (k: CloseReadinessKey) => keys.includes(k);
  const missing: string[] = [];

  if (want("account_phone") && isBlank(account.phone)) {
    missing.push(LABELS.account_phone);
  }

  if (want("account_billing_address")) {
    // Complete = street + city + state + zip. A finalized client needs a
    // mailable address; zip is a first-class, separately-validated field
    // in this CRM (src/lib/us-zip.ts), so we hold the address to it too.
    const addressComplete =
      !isBlank(account.billing_street) &&
      !isBlank(account.billing_city) &&
      !isBlank(account.billing_state) &&
      !isBlank(account.billing_zip);
    if (!addressComplete) missing.push(LABELS.account_billing_address);
  }

  if (want("account_fte_range") && isBlank(account.fte_range)) {
    missing.push(LABELS.account_fte_range);
  }

  if (want("contact_email")) {
    // ANY non-archived contact's email (email / email2 / email3) satisfies
    // the rule. Only when none has one do we surface it — naming the
    // primary contact if there is one, since that's who a user would fix.
    if (!contacts.some(contactHasEmail)) {
      const primary = contacts.find((c) => c.is_primary);
      const primaryName = primary
        ? `${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()
        : "";
      missing.push(
        primary && primaryName
          ? `A contact email address (primary contact ${primaryName} has none)`
          : LABELS.contact_email,
      );
    }
  }

  if (
    want("assigned_assessor") &&
    opportunity &&
    opportunityHasServices(opportunity) &&
    isBlank(opportunity.assigned_assessor_id)
  ) {
    missing.push(LABELS.assigned_assessor);
  }

  return missing;
}

/**
 * Reads `required_field_config` (entity 'opportunity_close') and returns
 * the subset of the four known keys to enforce. Falls back to ALL FOUR
 * when the query errors OR returns no rows, so the gate is never silently
 * disabled (the seed migration may not be deployed on every env yet).
 */
export async function getEnforcedCloseKeys(
  supabase: SupabaseClient,
): Promise<CloseReadinessKey[]> {
  const all = (): CloseReadinessKey[] => [...CLOSE_READINESS_KEYS];
  try {
    const { data, error } = await supabase
      .from("required_field_config")
      .select("field_key, is_required")
      .eq("entity", "opportunity_close")
      .eq("is_required", true);
    if (error || !data || data.length === 0) return all();
    const known = new Set<string>(CLOSE_READINESS_KEYS);
    const configured = (data as { field_key: string }[])
      .map((r) => r.field_key)
      .filter((k): k is CloseReadinessKey => known.has(k));
    return configured.length > 0 ? configured : all();
  } catch {
    return all();
  }
}

/**
 * Full check used by the UI surfaces. Reads the enforced keys, the
 * account row, and (only if the email rule is enforced) its non-archived
 * contacts, then returns { ready, missing }. Small id-scoped queries;
 * only ever called at the moment a user tries to close a deal.
 *
 * `opportunity` feeds the assigned-assessor rule (Rachel): pass the opp
 * id (inline surfaces — the fields are fetched) or an already-known data
 * object (the form — its in-flight values are what's about to be saved).
 * Omitting it skips that one rule.
 */
export async function checkCloseReadiness(
  supabase: SupabaseClient,
  accountId: string | null | undefined,
  opportunity?: string | CloseReadinessOpportunity | null,
): Promise<CloseReadinessResult> {
  if (!accountId) {
    return { ready: false, missing: ["Account information could not be loaded"] };
  }

  const keys = await getEnforcedCloseKeys(supabase);

  // Resolve opportunity-level inputs for the assessor rule (only when
  // that rule is enforced — mirrors the conditional contacts fetch).
  let opp: CloseReadinessOpportunity | null = null;
  if (keys.includes("assigned_assessor") && opportunity != null) {
    if (typeof opportunity === "string") {
      const { data: oppRow, error: oppErr } = await supabase
        .from("opportunities")
        .select("services_included, service_amount, assigned_assessor_id")
        .eq("id", opportunity)
        .maybeSingle();
      if (oppErr || !oppRow) {
        return { ready: false, missing: ["Opportunity information could not be loaded"] };
      }
      const { data: lines, error: linesErr } = await supabase
        .from("opportunity_products")
        .select("product:products!product_id(product_family)")
        .eq("opportunity_id", opportunity);
      if (linesErr) {
        return { ready: false, missing: ["Opportunity information could not be loaded"] };
      }
      const hasServiceLine = (lines ?? []).some((l) => {
        const fam =
          (l as { product?: { product_family?: string | null } | null }).product
            ?.product_family ?? "";
        return fam.toLowerCase().startsWith("service");
      });
      opp = { ...oppRow, has_service_line_items: hasServiceLine };
    } else {
      opp = opportunity;
    }
  }

  const { data: account, error: acctErr } = await supabase
    .from("accounts")
    .select("phone, fte_range, billing_street, billing_city, billing_state, billing_zip")
    .eq("id", accountId)
    .maybeSingle();

  if (acctErr) {
    return { ready: false, missing: ["Account information could not be loaded"] };
  }

  let contacts: CloseReadinessContact[] = [];
  if (keys.includes("contact_email")) {
    const { data, error } = await supabase
      .from("contacts")
      .select("is_primary, first_name, last_name, email, email2, email3")
      .eq("account_id", accountId)
      .is("archived_at", null);
    // On a contacts-query failure, leave contacts empty so the email rule
    // blocks (conservative — we can't confirm an email exists).
    contacts = error ? [] : ((data as CloseReadinessContact[] | null) ?? []);
  }

  const missing = evaluateCloseReadiness(keys, (account as CloseReadinessAccount) ?? null, contacts, opp);
  return { ready: missing.length === 0, missing };
}

/** Friendly, toast-ready message. Items are self-descriptive (account
 *  fields name the account; the assessor item names the deal). */
export function formatCloseReadinessMessage(missing: string[]): string {
  if (missing.length === 0) return "";
  return (
    `Can't mark this deal Closed Won yet — still needed: ${missing.join(", ")}. ` +
    `Fill these in, then try again.`
  );
}
