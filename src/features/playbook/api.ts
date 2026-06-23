import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type {
  PlaybookTrainingNote,
  PlaybookIdea,
  PlaybookCampaign,
} from "./types";

// ---------------------------------------------------------------------------
// Training notes (the feedback loop) — Phase A
// ---------------------------------------------------------------------------

export function useTrainingNotes() {
  return useQuery({
    queryKey: ["playbook", "training"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playbook_training")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PlaybookTrainingNote[];
    },
  });
}

export function useAddTrainingNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ note, source = "manual" }: { note: string; source?: string }) => {
      const { data, error } = await supabase
        .from("playbook_training")
        .insert({ note: note.trim(), source })
        .select()
        .single();
      if (error) throw error;
      return data as PlaybookTrainingNote;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "training"] }),
    onError: (e) => toast.error("Couldn't add note: " + (e as Error).message),
  });
}

export function useDeleteTrainingNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("playbook_training").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "training"] }),
    onError: (e) => toast.error("Couldn't delete note: " + (e as Error).message),
  });
}

// ---------------------------------------------------------------------------
// Ideas (read) — populated by the AI brain in Phase B
// ---------------------------------------------------------------------------

export function useIdeas(weekDate?: string) {
  return useQuery({
    queryKey: ["playbook", "ideas", weekDate ?? "latest"],
    queryFn: async () => {
      let q = supabase
        .from("playbook_ideas")
        .select("*")
        .order("created_at", { ascending: true });
      if (weekDate) q = q.eq("week_date", weekDate);
      const { data, error } = await q;
      if (error) throw error;
      return data as PlaybookIdea[];
    },
  });
}

/** Distinct week_dates that have ideas, newest first (for the week navigator). */
export function useIdeaWeeks() {
  return useQuery({
    queryKey: ["playbook", "idea-weeks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playbook_ideas")
        .select("week_date")
        .order("week_date", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      const weeks: string[] = [];
      for (const r of data ?? []) {
        const w = (r as { week_date: string }).week_date;
        if (!seen.has(w)) {
          seen.add(w);
          weeks.push(w);
        }
      }
      return weeks;
    },
  });
}

/** Generate (or regenerate) this week's ideas via the playbook-ai edge fn. */
export function useGenerateIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ force = false }: { force?: boolean } = {}) => {
      const { data, error } = await supabase.functions.invoke("playbook-ai", {
        body: { action: "generate-ideas", force },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ideas: PlaybookIdea[]; week_date: string; cached?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "ideas"] });
      qc.invalidateQueries({ queryKey: ["playbook", "idea-weeks"] });
    },
    onError: (e) => toast.error("Idea generation failed: " + (e as Error).message),
  });
}

/**
 * Record feedback on an idea: thumbs up (good), thumbs down (bad) +
 * optional "what was wrong" note, book, or mark executed. A thumbs-down
 * note also becomes a training note so the AI learns from it.
 */
export function useIdeaFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      feedbackNote,
    }: {
      id: string;
      status: PlaybookIdea["status"];
      feedbackNote?: string;
    }) => {
      const { error } = await supabase
        .from("playbook_ideas")
        .update({ status, feedback_note: feedbackNote ?? null })
        .eq("id", id);
      if (error) throw error;
      if (status === "bad" && feedbackNote && feedbackNote.trim()) {
        await supabase
          .from("playbook_training")
          .insert({ note: feedbackNote.trim(), source: "thumbs_down", related_idea_id: id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "ideas"] });
      qc.invalidateQueries({ queryKey: ["playbook", "training"] });
    },
    onError: (e) => toast.error("Couldn't save feedback: " + (e as Error).message),
  });
}

// ---------------------------------------------------------------------------
// Campaigns (read) — populated by the Smartlead sync in Phase C
// ---------------------------------------------------------------------------

export function useCampaigns() {
  return useQuery({
    queryKey: ["playbook", "campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playbook_campaigns")
        .select("*, owner:user_profiles!owner_id(id, full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (PlaybookCampaign & { owner?: { id: string; full_name: string | null } | null })[];
    },
  });
}

/** Whether the Smartlead integration is configured (API key present). */
export function useSmartleadStatus() {
  return useQuery({
    queryKey: ["playbook", "smartlead-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "status" },
      });
      if (error) throw error;
      return { configured: !!data?.configured };
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useSmartleadAction(action: "import" | "sync") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { created?: number; updated?: number; total?: number; synced?: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] });
      if (action === "import") {
        toast.success(`Imported ${r.created ?? 0} new, refreshed ${r.updated ?? 0}.`);
      } else {
        toast.success(`Synced ${r.synced ?? 0} campaigns.`);
      }
    },
    onError: (e) => toast.error(`Smartlead ${action} failed: ` + (e as Error).message),
  });
}

export const useImportCampaigns = () => useSmartleadAction("import");
export const useSyncCampaigns = () => useSmartleadAction("sync");

/** Delete a campaign (Smartlead + Pulse). Used to discard a draft. */
export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: { id: string; smartlead_campaign_id: number | null }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "delete-campaign", id: c.id, smartlead_campaign_id: c.smartlead_campaign_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] });
      toast.success("Campaign deleted.");
    },
    onError: (e) => toast.error("Delete failed: " + (e as Error).message),
  });
}

/** Deep link to a campaign in the Smartlead app. */
export function smartleadUrl(id: number | null): string | null {
  return id ? `https://app.smartlead.ai/app/email-campaign/${id}/analytics` : null;
}

// ---------------------------------------------------------------------------
// Campaign wizard — AI authoring + launch (Phase D)
// ---------------------------------------------------------------------------

export interface CampaignSequenceEmail {
  seq_number: number;
  delay_days: number;
  subject: string;
  body_html: string;
  body_preview?: string;
}
export interface GeneratedCampaign {
  campaign_name: string;
  target_audience: string;
  sequence: CampaignSequenceEmail[];
}
export interface Recipient {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  contact_id?: string;
  account_id?: string;
}

async function invokeAI<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("playbook-ai", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useGenerateCampaign() {
  return useMutation({
    mutationFn: (description: string) =>
      invokeAI<{ campaign: GeneratedCampaign }>({ action: "generate-campaign", description }),
    onError: (e) => toast.error("Generation failed: " + (e as Error).message),
  });
}

export function useSuggestCampaign() {
  return useMutation({
    mutationFn: (campaign: GeneratedCampaign) =>
      invokeAI<{ suggestions: string }>({ action: "suggest-campaign", campaign }),
    onError: (e) => toast.error("Suggestions failed: " + (e as Error).message),
  });
}

export function useRegenerateEmail() {
  return useMutation({
    mutationFn: (p: { description?: string; campaign: GeneratedCampaign; seq_number: number; feedback?: string }) =>
      invokeAI<{ email: { subject: string; body_html: string; body_preview?: string } }>({
        action: "regenerate-email",
        ...p,
      }),
    onError: (e) => toast.error("Rewrite failed: " + (e as Error).message),
  });
}

export function useEmailAccounts() {
  return useQuery({
    queryKey: ["playbook", "email-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "email-accounts" },
      });
      if (error) throw error;
      return (data?.accounts ?? []) as Array<{ id: number; from_email?: string; from_name?: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useLaunchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      campaign_name: string;
      target_audience?: string;
      sequence: CampaignSequenceEmail[];
      recipients: Recipient[];
      email_account_id?: number;
      source_idea_id?: string;
      autoStart?: boolean;
      adaptiveEnabled?: boolean;
      owner_id?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "launch", ...p },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { smartlead_campaign_id: number; auto_started: boolean; leads_added: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] });
      qc.invalidateQueries({ queryKey: ["playbook", "ideas"] });
    },
    onError: (e) => toast.error("Launch failed: " + (e as Error).message),
  });
}

/** Analyze a completed campaign (AI insights + auto-training). */
export function useAnalyzeCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      invokeAI<{ analysis: Record<string, unknown>; training_added?: number; already_analyzed?: boolean }>({
        action: "analyze-campaign",
        campaignId,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] });
      qc.invalidateQueries({ queryKey: ["playbook", "training"] });
      if (!r.already_analyzed) {
        toast.success(`Analyzed.${r.training_added ? ` Added ${r.training_added} training note(s).` : ""}`);
      }
    },
    onError: (e) => toast.error("Analysis failed: " + (e as Error).message),
  });
}

/** Recipients = the (non-archived, contactable) contacts carrying a tag. */
export async function fetchRecipientsByTag(tagId: string): Promise<Recipient[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, email, account_id, do_not_contact, no_longer_employed, account:accounts!account_id(name), contact_tags!inner(tag_id)")
    .eq("contact_tags.tag_id", tagId)
    .is("archived_at", null)
    .not("email", "is", null)
    .limit(5000);
  if (error) throw error;
  return (data ?? [])
    .filter((c: Record<string, unknown>) => !c.do_not_contact && !c.no_longer_employed && c.email)
    .map((c: Record<string, unknown>) => ({
      email: c.email as string,
      first_name: (c.first_name as string) ?? "",
      last_name: (c.last_name as string) ?? "",
      company_name: ((c.account as { name?: string } | null)?.name) ?? "",
      contact_id: c.id as string,
      account_id: (c.account_id as string) ?? undefined,
    }));
}
