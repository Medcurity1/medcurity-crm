// Meddy dashboard types — mirrors the meddy_* schema from
// supabase/migrations/20260612000002_meddy_foundation.sql.

export type MeddyConversation = {
  id: string;
  visitor_id: string;
  status: "active" | "closed";
  assigned_to: string | null;
  is_human_takeover: boolean;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  visitor_company: string | null;
  crm_contact_id: string | null;
  is_human_requested: boolean;
  human_requested_at: string | null;
  buying_intent_alerted: boolean;
  pricing_discussed: boolean;
  page_url: string | null;
  source_site: string;
  hidden_from_leads: boolean;
  created_at: string;
  updated_at: string;
  // Embedded via PostgREST aliases (see CONV_SELECT in api.ts).
  assigned?: { full_name: string | null } | null;
  last?: MeddyMessagePreview[];
  msg_count?: { count: number }[];
};

export type MeddyMessagePreview = {
  content: string;
  role: string;
  created_at: string;
  is_internal: boolean;
};

export type MeddyMessage = {
  id: number;
  conversation_id: string;
  role: "visitor" | "assistant" | "human";
  content: string;
  is_internal: boolean;
  sender_name: string | null;
  sender_type: string | null;
  created_at: string;
};

export type MeddyUrlEntry = {
  id: number;
  conversation_id: string;
  page_url: string;
  created_at: string;
};

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: string;
  available: boolean;
  last_seen: string | null;
};

export type QuickReply = {
  id: string;
  title: string;
  content: string;
  category: string;
};

export type ConversationLists = {
  active: MeddyConversation[];
  recent: MeddyConversation[];
  saved: MeddyConversation[];
  savedIds: Set<string>;
};

/** Last non-empty message preview attached by the list query. */
export function lastMessage(c: MeddyConversation): MeddyMessagePreview | null {
  return c.last?.[0] ?? null;
}

export function messageCount(c: MeddyConversation): number {
  return c.msg_count?.[0]?.count ?? 0;
}

/** Site badge label from source_site (widget data-site attr). */
export function siteLabel(c: MeddyConversation): string {
  if (c.source_site === "app") return "App";
  if (c.source_site === "test") return "Test";
  return "Main Site";
}

/** Urgent = human waiting with nobody assigned (Nexus urgent-pulse rule). */
export function isUrgent(c: MeddyConversation): boolean {
  return (c.is_human_requested || c.is_human_takeover) && !c.assigned_to;
}

/** Short page label from the latest URL (Nexus meddySidebarPageLabel). */
export function pageLabel(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return "Home";
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  } catch {
    return null;
  }
}
