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

/** The four keys, in the order their messages should read. */
export const CLOSE_READINESS_KEYS = [
  "account_phone",
  "account_billing_address",
  "account_fte_range",
  "contact_email",
] as const;

export type CloseReadinessKey = (typeof CLOSE_READINESS_KEYS)[number];

const LABELS: Record<CloseReadinessKey, string> = {
  account_phone: "Account phone number",
  account_billing_address: "Billing address",
  account_fte_range: "FTE range",
  contact_email: "A contact email address",
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
 * contacts, then returns { ready, missing }. Two small id-scoped queries;
 * only ever called at the moment a user tries to close a deal.
 *
 * Signature per spec: checkCloseReadiness(supabase, accountId).
 */
export async function checkCloseReadiness(
  supabase: SupabaseClient,
  accountId: string | null | undefined,
): Promise<CloseReadinessResult> {
  if (!accountId) {
    return { ready: false, missing: ["Account information could not be loaded"] };
  }

  const keys = await getEnforcedCloseKeys(supabase);

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

  const missing = evaluateCloseReadiness(keys, (account as CloseReadinessAccount) ?? null, contacts);
  return { ready: missing.length === 0, missing };
}

/** Friendly, toast-ready message pointing the user at the account. */
export function formatCloseReadinessMessage(missing: string[]): string {
  if (missing.length === 0) return "";
  return (
    `Can't mark this deal Closed Won yet — the account is missing complete ` +
    `client info: ${missing.join(", ")}. Open the account to fill it in, then try again.`
  );
}
