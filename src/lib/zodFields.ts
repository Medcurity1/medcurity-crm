import { z } from "zod";

/**
 * Numeric form field that treats a BLANK input as "no value" (null)
 * instead of 0.
 *
 * Form inputs deliver numbers as strings, so numeric fields need
 * z.coerce.number() — but bare coercion turns an empty input ("") into
 * 0. That made two things wrong at once:
 *
 *   1. Admin-required numeric fields (required_field_config) were
 *      unenforceable on create: the missing-fields gate in
 *      src/lib/requiredFields.ts runs on post-zod values, and 0 is a
 *      legitimate non-empty value, so a field the user never filled in
 *      sailed through.
 *   2. Every save silently backfilled 0 into nullable columns the user
 *      left blank (e.g. accounts.employees), destroying the
 *      "unknown" (NULL) vs "actually zero" distinction.
 *
 * The preprocess step maps "" / null / undefined to null BEFORE
 * coercion, and ZodNullable short-circuits null past the coercer. The
 * forms' emptyToNull payload mapping then writes NULL to the DB. A
 * user who types an explicit 0 still gets 0 — required checks and
 * saves treat it as a real value.
 *
 * Pass the inner schema with whatever constraints the field needs,
 * e.g. blankableNumber(z.coerce.number().int().nonnegative()).
 */
export function blankableNumber<T extends z.ZodType<number>>(inner: T) {
  return z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    inner.nullable(),
  );
}
