import { supabase } from "./supabase";

/**
 * Best-effort telemetry sink for client-side mutation failures. Fires
 * from the global MutationCache onError handler so any TanStack mutation
 * that throws — including ones whose local caller forgot to handle the
 * error — leaves a server-side trail.
 *
 * Intentionally never throws and never awaits in user code. If the
 * insert fails (offline, RLS, etc.) we drop the report on the floor; the
 * goal here is to *increase* visibility into silent failures, not to add
 * a new failure mode.
 */

interface SupabaseLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: number;
  name?: string;
  stack?: string;
}

function extractErrorBits(err: unknown): {
  message: string;
  code: string | null;
  details: Record<string, unknown> | null;
} {
  if (!err) {
    return { message: "Unknown error", code: null, details: null };
  }
  if (typeof err === "string") {
    return { message: err, code: null, details: null };
  }
  const e = err as SupabaseLikeError;
  const message = e.message || (err as Error).toString() || "Unknown error";
  const code = e.code ?? (e.status ? String(e.status) : null);
  const details: Record<string, unknown> = {};
  if (e.details) details.details = e.details;
  if (e.hint) details.hint = e.hint;
  if (e.status) details.status = e.status;
  if (e.statusCode) details.statusCode = e.statusCode;
  if (e.name) details.name = e.name;
  // Stack trace: cap to first 2000 chars to keep the JSONB small
  if (e.stack) details.stack = e.stack.slice(0, 2000);
  return {
    message,
    code,
    details: Object.keys(details).length > 0 ? details : null,
  };
}

/**
 * Summarize the variables a mutation received so admins can recognize
 * "ah, this was a failed call insert against the JAMHI account". We
 * deliberately don't ship full payloads — they may contain rich-text
 * notes the rep would rather not have in a telemetry table.
 */
function summarizePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  // Keep only short scalar fields and known FK columns
  const KEEP = [
    "id",
    "account_id",
    "contact_id",
    "opportunity_id",
    "lead_id",
    "activity_type",
    "subject",
    "stage",
    "owner_user_id",
    "due_at",
    "status",
    "name",
  ];
  for (const k of KEEP) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      summary[k] = v.length > 200 ? v.slice(0, 200) + "…" : v;
    } else if (
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      summary[k] = v;
    }
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

let appVersion: string | null = null;
export function setClientErrorAppVersion(v: string) {
  appVersion = v;
}

export function logClientError(args: {
  mutationKey?: readonly unknown[];
  error: unknown;
  payload?: unknown;
  route?: string;
}): void {
  try {
    const bits = extractErrorBits(args.error);
    const keyLabel = Array.isArray(args.mutationKey)
      ? args.mutationKey.join(":")
      : null;
    const route =
      args.route ?? (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null);
    const ua =
      typeof navigator !== "undefined" ? navigator.userAgent : null;

    // Fire-and-forget. We don't await, and we swallow any failure so the
    // logger never breaks the user's session.
    void supabase
      .rpc("log_client_error", {
        p_mutation_key: keyLabel,
        p_error_message: bits.message,
        p_error_code: bits.code,
        p_error_details: bits.details,
        p_payload_summary: summarizePayload(args.payload),
        p_route: route,
        p_user_agent: ua,
        p_app_version: appVersion,
      })
      .then(({ error }) => {
        if (error) {
          // Last resort: don't toast, just console. We don't want a
          // telemetry failure to spam the user with red toasts.
          // eslint-disable-next-line no-console
          console.warn("[clientErrorLogger] telemetry write failed", error);
        }
      });
  } catch (loggerErr) {
    // eslint-disable-next-line no-console
    console.warn("[clientErrorLogger] threw while logging", loggerErr);
  }
}
