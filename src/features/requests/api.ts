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
  confidence: number;
  reasoning: string;
  affectedAreas?: string[];
  degraded?: boolean;
}

/**
 * Ask Helm (via the edge function, so the API key stays server-side) whether a
 * draft bug report affects clients. Read-only: files nothing, creates nothing.
 * Never rejects — a failure resolves to the fail-safe client-facing verdict.
 */
export async function classifyDraftBug(draft: {
  title: string;
  description: string;
  priority: RequestPriority;
}): Promise<BugClassification> {
  try {
    const data = (await invokeRequestAction({
      action: "classify_bug",
      draftTitle: draft.title,
      draftDescription: draft.description,
      draftPriority: draft.priority,
    })) as { classification?: BugClassification };
    if (data?.classification) return data.classification;
  } catch {
    /* fall through to the fail-safe below */
  }
  return {
    clientFacing: true,
    confidence: 0,
    reasoning:
      "We couldn't check this automatically, so we're assuming clients are affected. Change it below if you know otherwise.",
    affectedAreas: [],
    degraded: true,
  };
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

      // Product BUGS are filed to Jira immediately (server-side — needs
      // secrets), routed through Helm so the client-impact call is made and
      // recorded. Attachments are already up, so they ride along onto the
      // ticket. Filing happens whatever the verdict — a bug that reaches a
      // client is the last thing you'd want to sit on — but a client-facing
      // bug leaves the Pulse request PENDING so it stays visible in the
      // reviewer's widget. If filing fails or Helm/Jira isn't configured, the
      // request stays pending with no ticket and falls through to the normal
      // reviewer email below, so a human still picks it up.
      let bugFiled: CreateRequestResult["bugFiled"] = null;
      if (input.type === "product" && input.details?.category === "bug") {
        try {
          const res = (await invokeRequestAction({
            action: "file_bug",
            requestId: data.id,
            clientFacing: input.clientFacing,
          })) as {
            filed: boolean;
            jiraKey: string | null;
            jiraUrl: string | null;
            clientFacing?: boolean | null;
          };
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

      return { request: data as CrmRequest, failedUploads, bugFiled };
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
  action: "approve" | "summarize" | "design_prompt" | "file_bug" | "classify_bug";
  /** Required for every action except classify_bug, which runs before the row exists. */
  requestId?: string;
  note?: string | null;
  regenerate?: boolean;
  /** file_bug: the submitter's client-impact call, overriding the classifier. */
  clientFacing?: boolean;
  /** classify_bug: draft form fields, since there is no row to read them from. */
  draftTitle?: string;
  draftDescription?: string;
  draftPriority?: string;
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
