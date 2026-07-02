// Meddy Support (platform Coach escalations) — types + pure helpers.
// Mirrors supabase/migrations/20260701000001_meddy_support_foundation.sql.
// COMPLETELY separate stream from the website Meddy (src/features/meddy).

export interface SupportMessage {
  id: number;
  conversation_id: string;
  role: "customer" | "assistant" | "agent" | "system";
  content: string;
  is_internal: boolean;
  sender_name: string | null;
  client_msg_id: string | null;
  created_at: string;
}

export interface SupportConversation {
  id: string;
  platform_session_id: string;
  platform_user_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  status: "active" | "closed";
  assigned_to: string | null;
  is_human_takeover: boolean;
  is_human_requested: boolean;
  human_requested_at: string | null;
  taken_over_at: string | null;
  handed_back_at: string | null;
  closed_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  // PostgREST embeds
  assigned?: { id: string; full_name: string | null } | null;
  last?: { content: string; role: string; created_at: string }[] | null;
}

/** Waiting on a human and nobody has claimed it yet — the urgent state. */
export function isWaiting(c: SupportConversation): boolean {
  return c.status === "active" && c.is_human_requested && !c.assigned_to;
}

export function displayName(c: SupportConversation): string {
  return c.customer_name || c.customer_email || "Platform customer";
}

export function lastPreview(c: SupportConversation): string {
  const m = c.last?.[0];
  if (!m) return "No messages yet";
  const text = m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
  return m.role === "agent" ? `You: ${text}` : text;
}

/** Friendly rendering for system control rows. */
export function systemLabel(m: SupportMessage): string {
  switch (m.content) {
    case "agent_joined":
      return `${m.sender_name ?? "An agent"} took over the chat`;
    case "handed_back":
      return `${m.sender_name ?? "The agent"} handed the chat back to Meddy`;
    case "closed":
      return "Chat ended";
    case "human_requested":
      return "Customer asked for a human";
    default:
      return m.content;
  }
}
