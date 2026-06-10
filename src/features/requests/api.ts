import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  CrmRequest,
  RequestType,
  RequestStatus,
  RequestPriority,
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

// ── Mutations ────────────────────────────────────────────────────────
interface CreateRequestInput {
  type: RequestType;
  title: string;
  description?: string | null;
  priority: RequestPriority;
  details?: Record<string, unknown>;
  requesterName?: string | null;
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRequestInput) => {
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
      return data as CrmRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

async function setOutcome(id: string, patch: Partial<CrmRequest>) {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("requests")
    .update({
      ...patch,
      completed_by: u.user?.id ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as CrmRequest;
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
 * Product request — approve. For now this records the approval in the CRM.
 * Filing the Jira ticket is wired in a later step once the Jira API keys
 * are configured (see the Requests build plan, step 5).
 */
export function useApproveProductRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      setOutcome(id, { status: "approved", decision_note: note ?? null }),
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
