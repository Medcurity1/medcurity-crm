import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailProvider = "gmail" | "outlook";

export interface EmailSyncConfigJson {
  log_sent: boolean;
  log_received: boolean;
  primary_only: boolean;
  auto_link_opps: boolean;
}

export interface EmailSyncConnection {
  id: string;
  user_id: string;
  provider: EmailProvider;
  email_address: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  is_active: boolean;
  config: EmailSyncConfigJson;
  created_at: string;
  updated_at: string;
}

export interface EmailSyncRun {
  id: number;
  connection_id: string | null;
  started_at: string;
  finished_at: string | null;
  activities_created: number;
  emails_fetched: number;
  error_message: string | null;
}

export const defaultSyncConfig: EmailSyncConfigJson = {
  log_sent: true,
  log_received: true,
  primary_only: false,
  auto_link_opps: true,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Load the current user's email sync connections. */
export function useMyEmailConnections() {
  return useQuery({
    queryKey: ["email_sync_connections", "me"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sync_connections")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailSyncConnection[];
    },
  });
}

/** Update the config jsonb + is_active for a single connection. */
export function useUpdateEmailConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: {
      id: string;
      config?: EmailSyncConfigJson;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("email_sync_connections")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as EmailSyncConnection;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email_sync_connections", "me"] });
    },
  });
}

/** Delete (disconnect) an email sync connection. */
export function useDisconnectEmailConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_sync_connections")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email_sync_connections", "me"] });
    },
  });
}

/** Recent sync runs for the current user's connections. */
export function useMyEmailSyncRuns(limit = 10) {
  return useQuery({
    queryKey: ["email_sync_runs", "me", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as EmailSyncRun[];
    },
  });
}

/**
 * Kick off the Outlook OAuth flow.
 *
 * Calls the outlook-oauth/start edge function with the user's JWT, then
 * navigates the browser to the returned Microsoft authorize URL.
 */
export async function startOutlookConnect(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/outlook-oauth/start`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to start Outlook OAuth: ${body}`);
  }
  const { authorize_url } = (await res.json()) as { authorize_url: string };
  if (!authorize_url) throw new Error("Missing authorize_url in response");
  window.location.href = authorize_url;
}
