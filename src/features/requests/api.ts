import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  CrmRequest,
  RequestType,
  RequestStatus,
  RequestPriority,
  RequestAttachment,
} from "@/types/crm";

// ── Shared option lists / labels ─────────────────────────────────────
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  collateral: "Collateral",
  product: "Product",
  crm: "CRM",
};

/**
 * Type → color language (Nathan 8/12, restyled same day to his spec): as
 * requests pile up, the LISTING itself should say what's what at a glance —
 * product is orange, CRM is green, collateral is purple. The color sits
 * BEHIND the whole card: a low-opacity gradient end to end (slightly
 * stronger at the edges, lighter through the middle, so it reads glossy),
 * a matching tinted border, and a hover that deepens both. No accent bar.
 * One shared map so every surface that lists requests (Nexus widget, inbox
 * popup, widget-builder panel) speaks the same color. `chip` is the filled
 * type badge; `dot` is the small legend swatch.
 */
export const REQUEST_TYPE_TINT: Record<
  RequestType,
  { row: string; chip: string; dot: string }
> = {
  product: {
    row: "border-orange-500/30 bg-gradient-to-r from-orange-500/[0.16] via-orange-500/[0.06] to-orange-500/[0.13] hover:border-orange-500/60 hover:from-orange-500/[0.22] hover:to-orange-500/[0.18] dark:border-orange-400/25 dark:from-orange-400/[0.14] dark:via-orange-400/[0.05] dark:to-orange-400/[0.11] dark:hover:border-orange-400/50",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  crm: {
    row: "border-emerald-500/30 bg-gradient-to-r from-emerald-500/[0.16] via-emerald-500/[0.06] to-emerald-500/[0.13] hover:border-emerald-500/60 hover:from-emerald-500/[0.22] hover:to-emerald-500/[0.18] dark:border-emerald-400/25 dark:from-emerald-400/[0.14] dark:via-emerald-400/[0.05] dark:to-emerald-400/[0.11] dark:hover:border-emerald-400/50",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  collateral: {
    row: "border-violet-500/30 bg-gradient-to-r from-violet-500/[0.16] via-violet-500/[0.06] to-violet-500/[0.13] hover:border-violet-500/60 hover:from-violet-500/[0.22] hover:to-violet-500/[0.18] dark:border-violet-400/25 dark:from-violet-400/[0.14] dark:via-violet-400/[0.05] dark:to-violet-400/[0.11] dark:hover:border-violet-400/50",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
    dot: "bg-violet-500",
  },
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

export const PRIORITY_OPTIONS: { value: RequestPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const COLLATERAL_AUDIENCES = [
  "Small Practice",
  "FQHC",
  "Rural Hospital",
  "Partner",
  "General",
];

export const COLLATERAL_FORMATS = [
  "PDF",
  "Word (.docx)",
  "PowerPoint (.pptx)",
  "PNG",
  "JPEG",
  "Excel (.xlsx)",
  "Canva",
  "Other",
];

export const CRM_CHANGE_TYPES = [
  "Update",
  "Edit",
  "Addition",
  "Removal",
  "Bug fix",
];

// Product requests split into two workflows (Rachel, Jul 2026): an
// Enhancement is reviewed + approved before it's filed to Jira; a Bug
// files straight to Jira on submit with no approval step.
export const PRODUCT_CATEGORIES = [
  { value: "enhancement", label: "Enhancement" },
  { value: "bug", label: "Bug" },
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  enhancement: "Enhancement",
  bug: "Bug",
};

// ── Queries ──────────────────────────────────────────────────────────
interface RequestFilters {
  type?: RequestType | RequestType[];
  status?: RequestStatus | RequestStatus[];
  /** Only created within the last N days (inbox defaults to 60). */
  sinceDays?: number;
  /** Convenience: status = 'pending'. */
  pendingOnly?: boolean;
  /** Only requests SUBMITTED by this user (Nexus Requests widget). */
  requesterId?: string;
}

export function useRequests(filters?: RequestFilters) {
  return useQuery({
    queryKey: ["requests", filters],
    queryFn: async () => {
      let q = supabase
        .from("requests")
        .select("*, requester:user_profiles!requester_user_id(id, full_name)")
        .order("created_at", { ascending: false });

      if (filters?.type) {
        const types = Array.isArray(filters.type) ? filters.type : [filters.type];
        if (types.length) q = q.in("type", types);
      }
      if (filters?.pendingOnly) {
        q = q.eq("status", "pending");
      } else if (filters?.status) {
        const st = Array.isArray(filters.status) ? filters.status : [filters.status];
        if (st.length) q = q.in("status", st);
      }
      if (filters?.sinceDays) {
        const since = new Date(Date.now() - filters.sinceDays * 86_400_000).toISOString();
        q = q.gte("created_at", since);
      }
      if (filters?.requesterId) {
        q = q.eq("requester_user_id", filters.requesterId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as CrmRequest[];
    },
  });
}

/** The request types the current user is a routed recipient for. */
export function useMyRequestTypes() {
  return useQuery({
    queryKey: ["request-routing", "mine"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return [] as RequestType[];
      const { data, error } = await supabase
        .from("request_routing")
        .select("type")
        .eq("user_id", uid);
      if (error) throw error;
      return (data ?? []).map((r) => r.type as RequestType);
    },
  });
}

export interface RoutingRow {
  type: RequestType;
  user_id: string;
  user?: { id: string; full_name: string | null } | null;
}

/** All routing rows (admin editor). */
export function useRequestRouting() {
  return useQuery({
    queryKey: ["request-routing", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_routing")
        .select("type, user_id, user:user_profiles!user_id(id, full_name)");
      if (error) throw error;
      return data as unknown as RoutingRow[];
    },
  });
}

export function useAddRouting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, userId }: { type: RequestType; userId: string }) => {
      const { error } = await supabase
        .from("request_routing")
        .insert({ type, user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["request-routing"] }),
  });
}

export function useRemoveRouting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, userId }: { type: RequestType; userId: string }) => {
      const { error } = await supabase
        .from("request_routing")
        .delete()
        .eq("type", type)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["request-routing"] }),
  });
}

// ── Attachments ──────────────────────────────────────────────────────
const ATTACHMENTS_BUCKET = "request-attachments";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
}

/**
 * Upload the submitted files to storage + record metadata rows.
 * Best-effort per file: returns the names that failed so the form can
 * warn without failing the whole request.
 */
async function uploadRequestAttachments(
  requestId: string,
  files: File[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    const path = `${requestId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFilename(f.name)}`;
    const { error: upErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (upErr) {
      failed.push(f.name);
      continue;
    }
    const { error: rowErr } = await supabase.from("request_attachments").insert({
      request_id: requestId,
      original_filename: f.name,
      storage_path: path,
      mimetype: f.type || null,
      size_bytes: f.size,
    });
    if (rowErr) {
      // Metadata insert failed after the object uploaded — remove the orphan so
      // the bucket doesn't accumulate undownloadable files.
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      failed.push(f.name);
    }
  }
  return failed;
}

export function useRequestAttachments(requestId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["request-attachments", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_attachments")
        .select("*")
        .eq("request_id", requestId!)
        .order("created_at");
      if (error) throw error;
      return data as RequestAttachment[];
    },
    enabled: !!requestId && enabled,
  });
}

/** Open a short-lived signed download URL for an attachment. */
export async function downloadAttachment(att: RequestAttachment) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(att.storage_path, 3600, {
      download: att.original_filename,
    });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create download link");
  }
  window.open(data.signedUrl, "_blank", "noopener");
}

// ── Mutations ────────────────────────────────────────────────────────
interface CreateRequestInput {
  type: RequestType;
  title: string;
  description?: string | null;
  priority: RequestPriority;
  details?: Record<string, unknown>;
  requesterName?: string | null;
  files?: File[];
  /**
   * Product bugs only (MSD-957). The confirmed client-impact call — Helm's
   * classifier proposes it on the form and the submitter can flip it. Passed
   * through to Helm on filing, where it overrides the automatic verdict.
   */
  clientFacing?: boolean;
  /** The classifier output behind that call, so it can be stored on the row. */
  classification?: BugClassification;
}

/**
 * The client-impact verdict for a draft bug report (MSD-957). Produced by
 * Helm's repo-grounded classifier, which reads the live Medcurity codebase to
 * decide whether the reported defect is reachable by a paying customer.
 *
 * `degraded` means the classifier could not run. In that case `clientFacing`
 * is always true and confidence is 0: the fail-safe direction is deliberate,
 * because a missed client incident costs far more than an extra review.
 */
export interface BugClassification {
  clientFacing: boolean;
  /**
   * MSD-999: false when the classifier read the report as a request or
   * enhancement rather than a defect. Picking "Yes — a client is affected"
   * on a false here triggers the are-you-sure warning (only time-sensitive
   * client-facing BUGS should skip review). Optional because older Helm
   * responses may omit it; treat missing as true (no warning).
   */
  looksLikeBug?: boolean;
  confidence: number;
  reasoning: string;
  affectedAreas?: string[];
  degraded?: boolean;
  /**
   * We gave up waiting (15s). `clientFacing` is NOT an answer in this case —
   * the form must ask the submitter and require them to choose, because they
   * know and we don't.
   */
  timedOut?: boolean;
}

/** The verdict-shaped value used when no real verdict could be obtained. */
const CLASSIFY_UNAVAILABLE: BugClassification = {
  clientFacing: true,
  // No verdict, no warning — the not-a-bug nudge only fires on a real read.
  looksLikeBug: true,
  confidence: 0,
  reasoning: "We couldn't check this automatically — please tell us.",
  affectedAreas: [],
  degraded: true,
  // Treated the same as a timeout by the form: ask, don't assume.
  timedOut: true,
};

/** Gap before the single retry. Short on purpose — someone is watching a
 * spinner, and the failures this catches are gateway blips that clear in
 * under a second. */
const CLASSIFY_RETRY_DELAY_MS = 1_200;

/**
 * Only retry if the first attempt failed FAST. Retrying is worth roughly a
 * second when the call dies on a gateway blip (the 8/12 failure took ~11s);
 * it is not worth it when the call is grinding, because the second attempt
 * can cost another 16s on top and the submit button is disabled the whole
 * time. Past this, we stop and ask the submitter — which is a fine outcome,
 * just not the first one to reach for.
 *
 * Worst case with this cap: 12s (slow first attempt, no retry) or
 * ~12 + 1.2 + 16 ≈ 29s (fast fail, then a retry that grinds). The edge
 * function deliberately does NOT retry as well — two retrying layers multiply
 * into a minute-plus spinner.
 */
const CLASSIFY_RETRY_BUDGET_MS = 12_000;

/**
 * Ask Helm (via the edge function, so the API key stays server-side) whether a
 * draft bug report affects clients. Read-only: files nothing, creates nothing.
 * Never rejects — a failure resolves to the fail-safe client-facing verdict.
 *
 * TRIES TWICE. On 2026-08-12 a single transient failure from Helm mid-submission
 * produced no verdict at all, the form fell back to asking the submitter, and a
 * bug that was blocking a named client was recorded as not client-facing. One
 * attempt was never enough for a call this consequential: a retry costs about a
 * second and turns most blips back into a real answer.
 *
 * A `timedOut` verdict is NOT retried — Helm already spent its full 15s budget,
 * and a second wait that long is worse for the submitter than asking them.
 */
export async function classifyDraftBug(draft: {
  title: string;
  description: string;
  priority: RequestPriority;
}): Promise<BugClassification> {
  let last: BugClassification | null = null;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = (await invokeRequestAction({
        action: "classify_bug",
        draftTitle: draft.title,
        draftDescription: draft.description,
        draftPriority: draft.priority,
      })) as { classification?: BugClassification };
      const c = data?.classification;
      if (c) {
        last = c;
        // A real verdict (or an honest "we ran out of time") is final.
        // `degraded` means nothing actually ran — that one is worth another go.
        if (!c.degraded) return c;
      }
    } catch {
      /* transport failure — retry, then fall through to the fail-safe */
    }
    if (attempt === 0) {
      if (Date.now() - startedAt > CLASSIFY_RETRY_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, CLASSIFY_RETRY_DELAY_MS));
    }
  }

  return last ?? { ...CLASSIFY_UNAVAILABLE };
}

export interface ClarifyQuestion {
  id: string;
  question: string;
}

/**
 * Ask for 2-3 follow-up questions on a draft request.
 *
 * Deliberately un-retried, unlike classifyDraftBug. That one is retried because
 * a missing verdict can send a client-blocking bug to the wrong queue; this one
 * only costs a slightly thinner ticket. It sits between a person and the submit
 * button, so a second 12s attempt would buy a marginal improvement at the price
 * of a spinner long enough to feel broken.
 *
 * Never throws — an empty list means "just submit", and every caller treats it
 * that way.
 */
export async function askClarifyingQuestions(draft: {
  title: string;
  description: string;
  category: string;
}): Promise<ClarifyQuestion[]> {
  try {
    const data = (await invokeRequestAction({
      action: "clarify",
      draftTitle: draft.title,
      draftDescription: draft.description,
      draftCategory: draft.category,
    })) as { questions?: ClarifyQuestion[] };
    return (data?.questions ?? []).filter((q) => q?.id && q?.question);
  } catch {
    return [];
  }
}

export interface CreateRequestResult {
  request: CrmRequest;
  /** Names of any files that failed to upload (request itself succeeded). */
  failedUploads: string[];
  /**
   * Set when a product BUG was auto-filed to Jira on submit. Null for
   * enhancements, and for bugs that fell back to the manual review flow
   * (Jira unconfigured or filing failed — the request stays pending).
   */
  bugFiled: {
    jiraKey: string | null;
    jiraUrl: string | null;
    /**
     * MSD-957. True when the bug was judged to affect clients: the ticket is
     * filed either way, but the Pulse request stays PENDING so it surfaces in
     * the routed reviewer's Requests widget instead of auto-completing. Null
     * when Helm wasn't reachable and the pre-MSD-957 direct-file path ran.
     */
    clientFacing: boolean | null;
  } | null;
  /**
   * True when a bug was judged NOT client-facing and is therefore waiting for
   * the product manager to triage it. No Jira ticket exists yet.
   */
  held: boolean;
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<CreateRequestResult> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const { data, error } = await supabase
        .from("requests")
        .insert({
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          // The confirmed client-impact call rides in details alongside
          // category (MSD-957). The insert-sanitize trigger strips the
          // classifier's own provenance fields — those are server-written.
          details:
            typeof input.clientFacing === "boolean"
              ? { ...(input.details ?? {}), client_facing: input.clientFacing }
              : (input.details ?? {}),
          requester_user_id: uid,
          requester_name: input.requesterName ?? null,
        })
        .select()
        .single();
      if (error) throw error;

      // Attachments go up BEFORE the email notice so reviewers never get
      // a notification for a request whose files are still missing.
      const failedUploads = input.files?.length
        ? await uploadRequestAttachments(data.id, input.files)
        : [];

      // The client-impact gate (MSD-957). A bug judged CLIENT-FACING goes
      // straight to the dev team — server-side via Helm, which stamps the
      // determination onto the Jira ticket — and the request completes. Those
      // are the urgent ones; nothing about them waits on a person.
      //
      // A bug judged NOT client-facing files nothing. It stays pending so the
      // product manager triages it first, exactly like an enhancement, and her
      // Approve is what files it. Either way she gets an email.
      let bugFiled: CreateRequestResult["bugFiled"] = null;
      let held = false;
      if (input.type === "product" && input.details?.category === "bug") {
        // Did an automatic verdict actually happen? `degraded` (nothing ran)
        // and `timedOut` (gave up waiting) both mean no — and in that case the
        // answer on the row came from a person, whatever value they picked.
        // Attributing it to "ai" because it happened to match the fail-safe
        // default would put a confident-looking verdict in the audit trail
        // that no classifier ever produced.
        const cls = input.classification;
        const noVerdict = !cls || cls.degraded === true || cls.timedOut === true;
        try {
          const res = (await invokeRequestAction({
            action: "file_bug",
            requestId: data.id,
            clientFacing: input.clientFacing,
            clientFacingReasoning: cls?.reasoning,
            clientFacingConfidence: cls?.confidence,
            clientFacingDegraded: noVerdict,
            clientFacingSource:
              typeof input.clientFacing === "boolean" &&
              (noVerdict || (cls && input.clientFacing !== cls.clientFacing))
                ? "submitter"
                : "ai",
          })) as {
            filed: boolean;
            held?: boolean;
            jiraKey: string | null;
            jiraUrl: string | null;
            clientFacing?: boolean | null;
          };
          held = !!res.held;
          if (res.filed) {
            bugFiled = {
              jiraKey: res.jiraKey,
              jiraUrl: res.jiraUrl,
              clientFacing: res.clientFacing ?? null,
            };
          }
        } catch {
          bugFiled = null;
        }
      }

      // Fire the email notice (one email from marketing@ to all routed
      // recipients). Best-effort: the in-app bell is the reliable channel,
      // so an email failure must never fail the submission. The function
      // is idempotent server-side (email_notified_at CAS), so repeats are
      // harmless. It picks the template itself: a review email for
      // enhancements/collateral/crm, or an informational "filed to Jira"
      // email for an auto-filed bug (the routed team still gets notified,
      // even though there's nothing to approve).
      void supabase.functions
        .invoke("request-email-notify", { body: { requestId: data.id } })
        .catch(() => {});

      return { request: data as CrmRequest, failedUploads, bugFiled, held };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

async function setOutcome(id: string, patch: Partial<CrmRequest>) {
  const { data: u } = await supabase.auth.getUser();
  // Compare-and-swap on status='pending' so we can't complete/deny a
  // request that was already handled (e.g. acting on a stale list).
  const { data, error } = await supabase
    .from("requests")
    .update({
      ...patch,
      completed_by: u.user?.id ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("This request was already handled.");
  }
  return data[0] as CrmRequest;
}

/**
 * Working notes (Nathan + Rachel 7/24): a shared scratchpad the request
 * managers keep on a request while it's in flight ("Molly is gathering
 * info for this one"). Writes are admin-only via RLS; unlike setOutcome
 * there's no status CAS — notes stay editable after a request resolves.
 */
export function useSaveRequestNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      notes,
      authorName,
    }: {
      id: string;
      notes: string;
      authorName: string | null;
    }) => {
      const trimmed = notes.trim();
      const { data, error } = await supabase
        .from("requests")
        .update({
          working_notes: trimmed || null,
          working_notes_updated_at: trimmed ? new Date().toISOString() : null,
          working_notes_updated_by_name: trimmed ? authorName : null,
        })
        .eq("id", id)
        .select();
      if (error) throw error;
      // RLS silently matches zero rows for non-admins — surface it.
      if (!data || data.length === 0) {
        throw new Error("You don't have permission to edit request notes.");
      }
      return data[0] as CrmRequest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

/** Collateral / CRM requests: check off as done. */
export function useCompleteRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => setOutcome(id, { status: "completed" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

/**
 * Calls the product-request-action edge function and surfaces the
 * function's own error message (supabase-js otherwise hides it behind a
 * generic "non-2xx" string).
 */
async function invokeRequestAction(payload: {
  action: "approve" | "summarize" | "design_prompt" | "file_bug" | "classify_bug" | "clarify";
  /** Required for every action except classify_bug and clarify, both of which
   *  run on a draft, before the row exists. */
  requestId?: string;
  note?: string | null;
  regenerate?: boolean;
  /** file_bug: the submitter's client-impact call, overriding the classifier. */
  clientFacing?: boolean;
  /** file_bug: the classifier's output, echoed back so the edge function can
   * persist it under the service role (the insert trigger strips it). */
  clientFacingReasoning?: string;
  clientFacingConfidence?: number;
  clientFacingSource?: string;
  /** file_bug: true when no automatic verdict was produced (the check failed
   * or timed out) and the answer on the row is a human's unaided guess. The
   * reviewer UI and the notification email key off this — a failed check must
   * not read like a confident "no". */
  clientFacingDegraded?: boolean;
  /** classify_bug: draft form fields, since there is no row to read them from. */
  draftTitle?: string;
  draftDescription?: string;
  draftPriority?: string;
  /** clarify: 'bug' | 'enhancement'. Only steers the question style. */
  draftCategory?: string;
}) {
  const { data, error } = await supabase.functions.invoke("product-request-action", {
    body: payload,
  });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch {
      /* keep generic message */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Product request — approve. Runs server-side: files the Jira ticket
 * (when Jira is configured) and marks the request approved. If the Jira
 * call fails, the request stays pending so it can be retried.
 */
export function useApproveProductRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      invokeRequestAction({ action: "approve", requestId: id, note: note ?? null }) as Promise<{
        request: CrmRequest;
        jiraConfigured: boolean;
        jiraKey: string | null;
        jiraUrl: string | null;
      }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

/**
 * Generate the Claude-design collateral prompt for a collateral request
 * (ported from OG Nexus). Cached on the request; pass regenerate to
 * produce a fresh one. Returns the prompt plus any files that should be
 * uploaded to Claude Design alongside it.
 */
export function useGenerateDesignPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, regenerate }: { id: string; regenerate?: boolean }) => {
      const data = await invokeRequestAction({
        action: "design_prompt",
        requestId: id,
        regenerate: regenerate ?? false,
      });
      return data as { prompt: string; uploadFiles: string[]; cached?: boolean };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

/** Generate (and cache) the AI one-liner for a product request. */
export function useSummarizeProductRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await invokeRequestAction({ action: "summarize", requestId: id });
      return (data?.summary ?? null) as string | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

/** Product request — deny. */
export function useDenyProductRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      setOutcome(id, { status: "denied", decision_note: note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}
