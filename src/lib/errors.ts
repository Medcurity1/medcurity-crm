/**
 * Extract a human-readable message from an unknown error value.
 *
 * Handles:
 *   - Error instances (returns .message)
 *   - Supabase / PostgREST errors which are plain objects shaped like
 *     { message, details, hint, code } — these DON'T extend Error, so
 *     without this helper `String(err)` produces "[object Object]".
 *   - Plain strings
 *   - Anything else → JSON.stringify fallback
 */
export function errorMessage(err: unknown): string {
  if (err === null || err === undefined) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;

  if (typeof err === "object") {
    const e = err as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error_description?: unknown;
      error?: unknown;
    };
    if (typeof e.message === "string" && e.message) return e.message;
    if (typeof e.error_description === "string" && e.error_description)
      return e.error_description;
    if (typeof e.details === "string" && e.details) return e.details;
    if (typeof e.hint === "string" && e.hint) return e.hint;
    if (typeof e.error === "string" && e.error) return e.error;
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }

  return String(err);
}
