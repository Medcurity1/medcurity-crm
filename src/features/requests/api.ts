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

// ── Queries ──────────────────────────────────────────────────────────
interface RequestFilters {
  type?: RequestType | RequestType[];
  status?: RequestStatus | RequestStatus[];
  /** Only created within the last N days (inbox defaults to 60). */
  sinceDays?: number;
  /** Convenience: status = 'pending'. */
  pendingOnly?: boolean;
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
    if (rowErr) failed.push(f.name);
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
}

export interface CreateRequestResult {
  request: CrmRequest;
  /** Names of any files that failed to upload (request itself succeeded). */
  failedUploads: string[];
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
          details: input.details ?? {},
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

      // Fire the email notice (one email from marketing@ to all routed
      // recipients). Best-effort: the in-app bell is the reliable channel,
      // so an email failure must never fail the submission. The function
      // is idempotent server-side (email_notified_at CAS), so repeats are
      // harmless.
      void supabase.functions
        .invoke("request-email-notify", { body: { requestId: data.id } })
        .catch(() => {});

      return { request: data as CrmRequest, failedUploads };
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
  action: "approve" | "summarize";
  requestId: string;
  note?: string | null;
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
