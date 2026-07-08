/**
 * Shared "required field" enforcement for the admin-configurable
 * `required_field_config` system (see src/hooks/useRequiredFields.ts).
 *
 * THE GRANDFATHER RULE — why this exists:
 *
 * Required-ness used to be enforced identically on create AND edit: if a
 * field was marked required in required_field_config, ANY save with that
 * field empty was blocked — including edits to records that already had
 * the field empty before the edit started. That's fine for brand-new
 * records, but this CRM inherited thousands of imported accounts (and
 * contacts/leads/opportunities) with null owner/status/employees/etc.
 * Once a field was later marked "required" by an admin, every one of
 * those pre-existing records became permanently un-editable — you
 * couldn't even fix an unrelated typo without also backfilling a field
 * you may not have data for.
 *
 * The fix: required-ness should ratchet forward, not retroactively lock
 * old data. Concretely:
 *
 *   - CREATE (no `original` record): every required field must be
 *     non-empty. Unchanged behavior — new records are held to the full
 *     standard.
 *   - EDIT (with an `original` record): a required field only blocks the
 *     save if it HAD a value before this edit and the submitted value
 *     would CLEAR it. If it was already empty on the original record,
 *     leaving it empty (or filling it in) never blocks — the record is
 *     "grandfathered" on that field until someone deliberately clears a
 *     value that used to be there.
 *
 * "Empty" is intentionally narrow: null, undefined, or "" (empty
 * string). Numeric 0 and boolean false are real values, not empty — this
 * matches the semantics of the original per-form checks this module
 * replaces.
 *
 * COROLLARY FOR NUMERIC FIELDS: because 0 counts as a real value, the
 * zod form schemas must never coerce a BLANK input to 0 before this
 * check runs (bare z.coerce.number() does exactly that). Numeric form
 * fields go through blankableNumber() in src/lib/zodFields.ts, which
 * keeps blank as null so create-mode enforcement actually fires.
 */

function isEmptyValue(val: unknown): boolean {
  return val === null || val === undefined || val === "";
}

/**
 * Returns the subset of `requiredKeys` that should block a save.
 *
 * - `original` omitted/null/undefined => create-mode semantics: any
 *   required key whose submitted value is empty is returned.
 * - `original` provided => edit-mode semantics: a required key is only
 *   returned when the original record had a non-empty value for it AND
 *   the submitted value is now empty. A key that doesn't exist at all on
 *   `original` is treated as previously-empty (grandfathered), not as an
 *   error.
 */
export function getMissingRequiredFields(
  requiredKeys: string[],
  values: Record<string, unknown>,
  original?: Record<string, unknown> | null,
): string[] {
  if (!Array.isArray(requiredKeys) || requiredKeys.length === 0) return [];

  return requiredKeys.filter((key) => {
    const submitted = values?.[key];
    const submittedEmpty = isEmptyValue(submitted);

    if (!original) {
      // Create mode: full enforcement.
      return submittedEmpty;
    }

    // Edit mode: only block when we're clearing a field that used to
    // have a value. If it was already empty (or absent) on the original
    // record, it's grandfathered regardless of the submitted value.
    if (!submittedEmpty) return false;
    const originalWasEmpty = !(key in original) || isEmptyValue(original[key]);
    return !originalWasEmpty;
  });
}

/**
 * Turns a required-field DB key into a short, human-readable label for
 * error toasts (e.g. "owner_user_id" -> "owner"). Deliberately dumb and
 * total — this only feeds a toast string, so it should never throw, no
 * matter what junk key gets passed in.
 */
export function formatFieldLabel(key: string): string {
  if (typeof key !== "string" || key.length === 0) return "";
  if (key === "owner_user_id") return "owner";
  return key.replace(/_id$/, "").replace(/_/g, " ");
}
