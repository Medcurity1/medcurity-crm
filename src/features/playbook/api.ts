import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type {
  PlaybookTrainingNote,
  PlaybookIdea,
  Campaign,
  CampaignMetrics,
  Newsletter,
  NewsletterType,
  CampaignTemplate,
  SequenceStep,
  CampaignSuggestion,
  SuggestionStatus,
} from "./types";
import { normalizeEmail, type SuppressionEntry } from "./suppression";
import { isPositiveReplyCategory } from "./reply-extract";

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
    // Don't fire until a real week is known — avoids an unfiltered all-weeks
    // fetch on first paint while the week list is still loading.
    enabled: !!weekDate,
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

/** Sequence templates (presets + any custom), newest preset categories first. */
export function useCampaignTemplates() {
  return useQuery({
    queryKey: ["playbook", "campaign-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_templates")
        .select("*")
        .order("is_preset", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampaignTemplate[];
    },
  });
}

/** Create or update a campaign template (the sequence editor saves through here).
 *  No id => insert (new custom template, or a customized copy of a preset).
 *  With id => update (an existing custom template). step_count + duration_days
 *  are derived from the steps so they never drift. */
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: {
      id?: string;
      name: string;
      description?: string | null;
      category?: CampaignTemplate["category"];
      steps: SequenceStep[];
      domain_rules?: Record<string, unknown>;
    }) => {
      const steps = t.steps.map((s, i) => ({ ...s, order: i + 1 }));
      const payload: Record<string, unknown> = {
        name: t.name.trim() || "Untitled sequence",
        description: t.description ?? null,
        category: t.category ?? "custom",
        steps,
        step_count: steps.length,
        duration_days: steps.reduce((m, s) => Math.max(m, s.day_offset || 0), 0),
        updated_at: new Date().toISOString(),
      };
      if (t.domain_rules) payload.domain_rules = t.domain_rules;
      if (t.id) {
        const { data, error } = await supabase
          .from("campaign_templates")
          .update(payload)
          .eq("id", t.id)
          .select()
          .single();
        if (error) throw error;
        return data as CampaignTemplate;
      }
      const { data, error } = await supabase
        .from("campaign_templates")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as CampaignTemplate;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["playbook", "campaign-templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campaign_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["playbook", "campaign-templates"] }),
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: ["playbook", "campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select(
          "*, owner:user_profiles!owner_user_id(id, full_name), template:campaign_templates(name)",
        )
        // Newest first, id as the tiebreaker (stable ordering within the
        // same created_at, e.g. a bulk-import batch inserted in one pass).
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw error;
      return data as (Campaign & {
        owner?: { id: string; full_name: string | null } | null;
        template?: { name: string } | null;
      })[];
    },
  });
}

export type CampaignStatusAction = "start" | "pause" | "resume" | "stop";

/** Start / pause / resume / stop a campaign from the tracker — mirrors the
 *  Smartlead status on the linked campaign (when there is one) and, for
 *  start-on-a-draft and stop, does the local bookkeeping (first_send_at
 *  backfill + task spawn on start; enrollment/task cancellation on stop).
 *  See the `set-campaign-status` action in playbook-smartlead/index.ts (S4). */
export function useSetCampaignStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; action: CampaignStatusAction }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "set-campaign-status", id: p.id, status_action: p.action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        success: boolean;
        id: string;
        status: string;
        tasks_created?: number;
        tasks_cancelled?: number;
        warning?: string;
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] }),
    onError: (e) => toast.error("Couldn't update campaign: " + (e as Error).message),
  });
}

export interface CampaignEnrollmentStats {
  total: number;
  finished: number;
  replied: number;
}

/** One grouped fetch of enrollment progress for every visible campaign card
 *  — totals + finished (completed/stopped/bounced) + replied per
 *  campaign_id. Single .in() query selecting just campaign_id + status,
 *  aggregated client-side; fine at tracker-list scale (not a full-database
 *  scan). */
export function useCampaignEnrollmentStats(campaignIds: string[]) {
  const key = [...campaignIds].sort().join(",");
  return useQuery({
    queryKey: ["playbook", "campaign-enrollment-stats", key],
    enabled: campaignIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_enrollments")
        .select("campaign_id, status")
        .in("campaign_id", campaignIds);
      if (error) throw error;
      const out: Record<string, CampaignEnrollmentStats> = {};
      for (const row of (data ?? []) as { campaign_id: string; status: string }[]) {
        const s = (out[row.campaign_id] ??= { total: 0, finished: 0, replied: 0 });
        s.total++;
        if (row.status === "replied") s.replied++;
        else if (row.status === "completed" || row.status === "stopped" || row.status === "bounced") s.finished++;
      }
      return out;
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

/** One sending inbox's warmup health + how much daily volume it's already
 *  carrying — the `inbox-health` edge action's per-inbox shape (Campaigns
 *  overhaul Phase 5). `warmup` is null when Smartlead's warmup-stats read
 *  failed or came back empty (unverified endpoint — see the edge function's
 *  fetchInboxWarmup doc comment); `daily_limit` is null when no plausible
 *  limit field was found on the account row. Both "unknown, not zero" —
 *  the UI must say so honestly rather than implying a real 0. */
export interface InboxHealthEntry {
  id: number;
  from_email: string | null;
  from_name: string | null;
  daily_limit: number | null;
  warmup: {
    sent_7d: number | null;
    inbox_rate: number | null;
    spam_rate: number | null;
    status: string | null;
  } | null;
  campaigns: Array<{ id: string; name: string; leads_per_day: number; status: string }>;
  total_leads_per_day: number;
}

/** Lazy — only fires while `enabled` (the Sending Inboxes dialog is open, or
 *  the launch wizard has reached its cadence/inbox step): each call makes a
 *  live Smartlead warmup-stats round trip per inbox (capped at 10 server-
 *  side), so this shouldn't run on every Campaigns tab render. */
export function useInboxHealth(enabled: boolean) {
  return useQuery({
    queryKey: ["playbook", "inbox-health"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "inbox-health" },
      });
      if (error) throw error;
      return (data?.inboxes ?? []) as InboxHealthEntry[];
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useLaunchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      campaign_name: string;
      target_audience?: string;
      // AI-wizard path. Omit when `steps` is present (mixed-channel path) —
      // the server ignores `sequence` entirely once `steps` is set.
      sequence?: CampaignSequenceEmail[];
      // Mixed-channel path (Campaigns overhaul S3): the template gallery /
      // SequenceEditor "Launch this sequence" flow sends the full frozen
      // step array here instead (email edits already folded in). The server
      // derives the Smartlead email sequence from the EMAIL_AUTO steps and
      // spawns CALL/LINKEDIN/EMAIL_HYBRID steps as tasks off it.
      steps?: SequenceStep[];
      template_id?: string;
      // ISO "YYYY-MM-DD" — defaults to today server-side if omitted.
      anchor_date?: string;
      recipients: Recipient[];
      email_account_id?: number;
      source_idea_id?: string;
      autoStart?: boolean;
      adaptiveEnabled?: boolean;
      owner_id?: string;
      schedule?: Record<string, unknown>;
      // Normalized emails the user deliberately chose to include despite
      // being on the Do-Not-Email list (per-person "Include anyway" — see
      // CampaignRecipients.tsx). The server re-checks suppression itself and
      // only honors an override that's actually listed here.
      suppression_overrides?: string[];
      // Normalized emails the user deliberately chose to double-enroll
      // despite already being actively enrolled in another campaign
      // (per-person "Enroll anyway" — see CampaignRecipients.tsx, S3). The
      // server re-checks this itself too.
      enrollment_overrides?: string[];
    }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "launch", ...p },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        smartlead_campaign_id: number;
        auto_started: boolean;
        leads_added: number;
        leads_failed: number;
        suppression_dropped?: number;
        // S3 — always present on a successful launch, but optional here so
        // older cached edge-function responses (mid-deploy) don't crash a
        // strict read.
        already_enrolled_dropped?: number;
        enrolled?: number;
        tasks_created?: number;
      };
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

// ---------------------------------------------------------------------------
// Newsletters (Mailchimp) — Phase G
// ---------------------------------------------------------------------------

async function invokeMailchimp<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("playbook-mailchimp", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useMailchimpStatus() {
  return useQuery({
    queryKey: ["playbook", "mailchimp-status"],
    queryFn: () => invokeMailchimp<{ configured: boolean }>({ action: "status" }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useNewsletters(type?: NewsletterType | "all") {
  return useQuery({
    queryKey: ["playbook", "newsletters", type ?? "all"],
    queryFn: async () => {
      const body: Record<string, unknown> = { action: "list" };
      if (type && type !== "all") body.type = type;
      const data = await invokeMailchimp<{ newsletters: Newsletter[] }>(body);
      return data.newsletters ?? [];
    },
  });
}

/** Fetch a single newsletter incl. html_content (on demand for the editor). */
export function useNewsletter(id: string | null) {
  return useQuery({
    queryKey: ["playbook", "newsletter", id],
    enabled: !!id,
    queryFn: async () => {
      const data = await invokeMailchimp<{ newsletter: Newsletter }>({ action: "get", id });
      return data.newsletter;
    },
  });
}

function useMailchimpRead(action: "ingest" | "sync") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invokeMailchimp<Record<string, number | boolean>>({ action }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] });
      if (action === "ingest") {
        const more = r.more_remaining
          ? " More remain — click Ingest again to continue."
          : "";
        toast.success(`Ingested ${r.ingested ?? 0} new, skipped ${r.skipped ?? 0}.${more}`);
      } else toast.success(`Synced ${r.synced ?? 0} newsletters.`);
    },
    onError: (e) => toast.error(`Mailchimp ${action} failed: ` + (e as Error).message),
  });
}
export const useIngestNewsletters = () => useMailchimpRead("ingest");
export const useSyncNewsletters = () => useMailchimpRead("sync");

export function useGenerateStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: NewsletterType) =>
      invokeMailchimp<{ type: string; source_count: number; length: number }>({ action: "generate-style", type }),
    onSuccess: (r, type) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter-style", type] });
      toast.success(`Style guide ready (from ${r.source_count} past issues).`);
    },
    onError: (e) => toast.error("Style guide failed: " + (e as Error).message),
  });
}

export function useGenerateNewsletterDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { type: NewsletterType; user_notes?: string }) =>
      invokeMailchimp<{ draft_id: string; subject: string; preview_text: string; html: string }>({
        action: "draft",
        ...p,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] }),
    onError: (e) => toast.error("Draft failed: " + (e as Error).message),
  });
}

export function useReviseNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; instruction: string }) =>
      invokeMailchimp<{ id: string; subject: string; preview_text: string; html: string }>({
        action: "revise",
        ...p,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter", r.id] });
      qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] });
    },
    onError: (e) => toast.error("Revise failed: " + (e as Error).message),
  });
}

export function useSaveNewsletterHtml() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; html?: string; subject?: string; preview_text?: string }) =>
      invokeMailchimp<{ success: boolean }>({ action: "save-html", ...p }),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter", p.id] });
      qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] });
      toast.success("Saved.");
    },
    onError: (e) => toast.error("Save failed: " + (e as Error).message),
  });
}

export function usePushNewsletterToMailchimp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      invokeMailchimp<{
        success: boolean;
        campaign_id: string;
        url: string;
        recipient_count: number | null;
        audience_empty?: boolean;
        audience_label: string;
        recommended_send: { date_iso: string; label: string; time_label: string } | null;
        segment_warning?: boolean;
        error?: string;
      }>({ action: "push-to-mailchimp", id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] }),
    onError: (e) => toast.error("Push to Mailchimp failed: " + (e as Error).message),
  });
}

export function useDeleteNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invokeMailchimp<{ success: boolean }>({ action: "delete", id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletters"] });
      toast.success("Draft deleted.");
    },
    onError: (e) => toast.error("Delete failed: " + (e as Error).message),
  });
}

/** View the AI-learned style guide for a newsletter type (for the editor). */
export function useNewsletterStyle(type: NewsletterType | null) {
  return useQuery({
    queryKey: ["playbook", "newsletter-style", type],
    enabled: !!type,
    queryFn: async () => {
      const d = await invokeMailchimp<{ style: { style_guide: string; updated_at: string } | null }>({
        action: "get-style",
        type,
      });
      return d.style;
    },
  });
}

export function useUpdateNewsletterStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { type: NewsletterType; style_guide: string }) =>
      invokeMailchimp<{ success: boolean }>({ action: "update-style", ...p }),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter-style", p.type] });
      toast.success("Style guide saved.");
    },
    onError: (e) => toast.error("Couldn't save style guide: " + (e as Error).message),
  });
}

/** Add a newsletter-type-scoped training note (feeds future drafts of that type). */
export function useAddNewsletterTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { type: NewsletterType; note: string }) => {
      const { error } = await supabase
        .from("playbook_training")
        .insert({ note: p.note.trim(), source: `newsletter:${p.type}` });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "training"] });
      toast.success("Saved — the AI will use this on future newsletters.");
    },
    onError: (e) => toast.error("Couldn't save note: " + (e as Error).message),
  });
}

/** Read a File as base64 (no data: prefix) for image upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve(res.includes(",") ? res.split(",")[1] : res);
    };
    reader.onerror = () => reject(new Error("Couldn't read the image file"));
    reader.readAsDataURL(file);
  });
}

export function useRewriteField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; field: "subject" | "preview" }) =>
      invokeMailchimp<{ field: string; value: string }>({ action: "rewrite-field", ...p }),
    onSuccess: (_r, p) => qc.invalidateQueries({ queryKey: ["playbook", "newsletter", p.id] }),
    onError: (e) => toast.error("Rewrite failed: " + (e as Error).message),
  });
}

export function useReplacePlaceholder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; index: number; name: string; file_data: string; alt: string }) =>
      invokeMailchimp<{ success: boolean; image_url: string; html: string }>({ action: "replace-placeholder", ...p }),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter", p.id] });
    },
    onError: (e) => toast.error("Image upload failed: " + (e as Error).message),
  });
}

export function useInsertImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; name: string; file_data: string; alt: string }) =>
      invokeMailchimp<{ success: boolean; image_url: string; html: string }>({ action: "insert-image", ...p }),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["playbook", "newsletter", p.id] });
    },
    onError: (e) => toast.error("Image upload failed: " + (e as Error).message),
  });
}

/** Recipients = the (non-archived) contacts carrying a tag, with an email on
 *  file. Do-Not-Contact / No-Longer-Employed / customer / partner / etc.
 *  suppression is deliberately NOT filtered here — every recipient source
 *  (tag, CSV, paste) is expected to run through fetchSuppressionForEmails
 *  in CampaignRecipients.tsx so the same Do-Not-Email rule applies
 *  everywhere, not just to contacts pulled by tag (2026-07-22: this used to
 *  hard-filter do_not_contact/no_longer_employed here, silently, which left
 *  CSV/paste recipients completely unchecked).
 *  Paginates so a large tag (>1 page) returns EVERY member — a campaign must
 *  never silently mail a truncated list. Hard-stops at 50k as a sanity cap. */
export async function fetchRecipientsByTag(tagId: string): Promise<Recipient[]> {
  const PAGE = 1000;
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, account_id, account:accounts!account_id(name), contact_tags!inner(tag_id)")
      .eq("contact_tags.tag_id", tagId)
      .is("archived_at", null)
      // Pending pen imports are not campaign-able people yet (pen cutover,
      // 2026-07-20) — same filter as every other contact read surface.
      .is("import_status", null)
      .not("email", "is", null)
      .order("id", { ascending: true }) // stable order so range paging can't skip/dupe
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all
    .filter((c: Record<string, unknown>) => typeof c.email === "string" && c.email.trim())
    .map((c: Record<string, unknown>) => ({
      email: c.email as string,
      first_name: (c.first_name as string) ?? "",
      last_name: (c.last_name as string) ?? "",
      company_name: ((c.account as { name?: string } | null)?.name) ?? "",
      contact_id: c.id as string,
      account_id: (c.account_id as string) ?? undefined,
    }));
}

/** Batched Do-Not-Email check: which of these emails are on
 *  v_marketing_suppression, and why. Matches on normalized
 *  (lowercased/trimmed) email — every email we send is normalized before
 *  querying. 500 emails per `.in()` batch (matches the server-side mirror in
 *  playbook-smartlead/index.ts). Every recipient source is expected to run
 *  through this after its list is built — see CampaignRecipients.tsx. */
export async function fetchSuppressionForEmails(emails: string[]): Promise<SuppressionEntry[]> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  if (!normalized.length) return [];
  const BATCH = 500;
  const out: SuppressionEntry[] = [];
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("v_marketing_suppression")
      .select("email, reason")
      .in("email", batch);
    if (error) throw error;
    for (const row of (data ?? []) as { email: string; reason: string }[]) {
      out.push({ email: row.email, reason: row.reason });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reply feed (Campaigns overhaul S7)
// ---------------------------------------------------------------------------

const REPLIES_LOOKBACK_DAYS = 30;
const REPLIES_LIMIT = 50;

// Raw campaign_events.event_type values that represent a reply — the
// webhook path stores Smartlead's RAW event name (verified live 2026-07-22
// as EMAIL_REPLY, not the canonical EMAIL_REPLIED — see
// supabase/functions/playbook-smartlead/index.ts's SMARTLEAD_WEBHOOK_EVENT_TYPES
// comment), while the daily sweep's own event logging (S9,
// _shared/campaign-enrollment-actions.ts) inserts the same raw name for
// consistency. Older/future rows might still carry the canonical name, so
// this checks both — kept in sync manually with
// _shared/campaign-enrollment-actions.ts's REPLY_EVENT_TYPES (a browser
// bundle can't import that Deno-side file).
const REPLY_EVENT_TYPES = ["EMAIL_REPLIED", "EMAIL_REPLY"];

export interface CampaignReplyRow {
  id: string;
  campaign_id: string | null;
  enrollment_id: string | null;
  email: string | null;
  payload: Record<string, unknown>;
  occurred_at: string | null;
  created_at: string;
  campaign: { id: string; name: string } | null;
  enrollment: { first_name: string | null; last_name: string | null; contact_id: string | null; reply_category: string | null } | null;
}

/** Recent reply campaign_events, newest first, last 30 days, capped at 50 —
 *  the Replies section in CampaignsTab.tsx. One query (campaign + enrollment
 *  embedded) — campaign_events is admin-only RLS, same as everything else
 *  this admin-only tab reads. Matches BOTH the raw and canonical event-type
 *  spelling (REPLY_EVENT_TYPES above) so rows logged by either the real-time
 *  webhook or the daily sweep (S9) show up here. */
export function useCampaignReplies() {
  return useQuery({
    queryKey: ["playbook", "campaign-replies"],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - REPLIES_LOOKBACK_DAYS);
      const { data, error } = await supabase
        .from("campaign_events")
        .select(
          "id, campaign_id, enrollment_id, email, payload, occurred_at, created_at, " +
            "campaign:campaigns(id, name), enrollment:campaign_enrollments(first_name, last_name, contact_id, reply_category)",
        )
        .in("event_type", REPLY_EVENT_TYPES)
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: false })
        .limit(REPLIES_LIMIT);
      if (error) throw error;
      // Same to-one-embed cast as fetchActiveEnrollmentsForEmails below —
      // PostgREST returns a single object for both campaign_id -> campaigns
      // and enrollment_id -> campaign_enrollments, but the query-builder's
      // type inference (no generated Database types in this project) sees
      // them as arrays.
      return (data ?? []) as unknown as CampaignReplyRow[];
    },
  });
}

/** Mark a reply as handled (Campaigns overhaul Phase 3, S9) — stamps
 *  payload.handled on the campaign_events row via the playbook-smartlead
 *  edge function (campaign_events is service-role-write-only; a client can't
 *  update it directly — see the `mark-reply-handled` action's doc comment).
 *  The Replies feed dims/groups a handled row rather than removing it. */
export function useMarkReplyHandled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "mark-reply-handled", event_id: eventId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook", "campaign-replies"] }),
    onError: (e) => toast.error("Couldn't mark handled: " + (e as Error).message),
  });
}

// ---------------------------------------------------------------------------
// Campaigns tab "This month" stats strip (Campaigns overhaul Phase 3, S9)
// ---------------------------------------------------------------------------

const MONTH_STATS_WINDOW_DAYS = 30;

export interface CampaignMonthStats {
  campaignsLaunched: number;
  peopleEnrolled: number;
  replies: number;
  positiveReplies: number;
}

/** "This month" strip above Ongoing campaigns in CampaignsTab.tsx — plain
 *  counts over the last 30 days: campaigns launched (left draft in that
 *  window), people enrolled, replies received, and replies that read as
 *  positive (isPositiveReplyCategory — see reply-extract.ts's client twin of
 *  _shared/reply-category.ts). Two queries (campaigns don't live on the
 *  enrollments table), but each is a single grouped fetch, not one query per
 *  number. */
export function useCampaignsMonthStats() {
  return useQuery({
    queryKey: ["playbook", "campaign-month-stats"],
    queryFn: async (): Promise<CampaignMonthStats> => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - MONTH_STATS_WINDOW_DAYS);
      const cutoffIso = cutoff.toISOString();

      const [launchedRes, enrollRes] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id", { count: "exact", head: true })
          .neq("status", "draft")
          .gte("created_at", cutoffIso),
        supabase
          .from("campaign_enrollments")
          .select("enrolled_at, replied_at, reply_category")
          .or(`enrolled_at.gte.${cutoffIso},replied_at.gte.${cutoffIso}`),
      ]);
      if (launchedRes.error) throw launchedRes.error;
      if (enrollRes.error) throw enrollRes.error;

      let peopleEnrolled = 0;
      let replies = 0;
      let positiveReplies = 0;
      for (const row of (enrollRes.data ?? []) as { enrolled_at: string | null; replied_at: string | null; reply_category: string | null }[]) {
        if (row.enrolled_at && row.enrolled_at >= cutoffIso) peopleEnrolled++;
        if (row.replied_at && row.replied_at >= cutoffIso) {
          replies++;
          if (isPositiveReplyCategory(row.reply_category)) positiveReplies++;
        }
      }

      return {
        campaignsLaunched: launchedRes.count ?? 0,
        peopleEnrolled,
        replies,
        positiveReplies,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Template scoreboard (Campaigns overhaul Phase 3, S9)
// ---------------------------------------------------------------------------

export interface TemplateScoreboardEntry {
  campaigns: number;
  replies: number;
}

/** Lifetime "N campaigns · X replies" per template, for the small stat line
 *  on each preset card in TemplatesSection.tsx. One query grouping every
 *  campaign by template_id client-side (cheap at this scale — same
 *  aggregate-in-app pattern as useCampaignEnrollmentStats). Templates with
 *  zero linked campaigns simply have no entry — callers hide the line
 *  entirely rather than showing "0 campaigns". */
export function useTemplateScoreboard() {
  return useQuery({
    queryKey: ["playbook", "template-scoreboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("template_id, metrics")
        .not("template_id", "is", null);
      if (error) throw error;
      const out: Record<string, TemplateScoreboardEntry> = {};
      for (const row of (data ?? []) as { template_id: string; metrics: CampaignMetrics | null }[]) {
        const entry = (out[row.template_id] ??= { campaigns: 0, replies: 0 });
        entry.campaigns++;
        const replies = Number(row.metrics?.replies);
        if (Number.isFinite(replies)) entry.replies += replies;
      }
      return out;
    },
  });
}

// ---------------------------------------------------------------------------
// Enrollment engine (Campaigns overhaul S3)
// ---------------------------------------------------------------------------

export interface ActiveEnrollmentEntry {
  email: string;
  campaign_id: string;
  /** Falls back to a generic label if the joined campaign row is somehow
   *  missing (e.g. RLS edge case) — should not normally happen. */
  campaign_name: string;
}

/** Batched check: which of these emails are ALREADY actively enrolled in
 *  ANY campaign (not just the one being built)? CampaignRecipients.tsx's
 *  "already enrolled elsewhere" soft-alert rail — same shape/batching as
 *  fetchSuppressionForEmails, reading campaign_enrollments instead of
 *  v_marketing_suppression. Server re-checks this independently before
 *  enrolling anyone (playbook-smartlead/index.ts's `launch` action). */
export async function fetchActiveEnrollmentsForEmails(emails: string[]): Promise<ActiveEnrollmentEntry[]> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  if (!normalized.length) return [];
  const BATCH = 500;
  const out: ActiveEnrollmentEntry[] = [];
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("campaign_enrollments")
      .select("email, campaign_id, campaign:campaigns(name)")
      .eq("status", "active")
      .in("email", batch);
    if (error) throw error;
    // Supabase's query-builder type inference doesn't know campaign_id ->
    // campaigns.id is many-to-one (no generated Database types in this
    // project), so it infers `campaign` as an array; PostgREST actually
    // returns a single embedded object for a to-one relationship at
    // runtime — cast via `unknown` and read it as the object it really is.
    for (const row of (data ?? []) as unknown as {
      email: string | null;
      campaign_id: string;
      campaign: { name: string } | null;
    }[]) {
      if (!row.email) continue;
      out.push({
        email: row.email,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign?.name ?? "another campaign",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Campaign detail sheet (Campaigns overhaul S8) — the full person-by-person
// view of one campaign, with per-person Pause/Resume/Stop.
// ---------------------------------------------------------------------------

export interface CampaignEnrollmentRow {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  account_id: string | null;
  enroll_position: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  status: string;
  paused_reason: string | null;
  current_step: number;
  first_send_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  unsubscribed_at: string | null;
  last_event_at: string | null;
  enrolled_at: string;
  reply_category: string | null;
}

/** Every enrollment for one campaign, in enroll_position order — the detail
 *  sheet's People table. Lazy: only enabled while a campaignId is actually
 *  supplied (i.e. the sheet is open), so a closed sheet never fires this. */
export function useCampaignEnrollments(campaignId: string | null) {
  return useQuery({
    queryKey: ["playbook", "campaign-enrollments", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_enrollments")
        .select("id, campaign_id, contact_id, account_id, enroll_position, email, first_name, last_name, company, status, paused_reason, current_step, first_send_at, replied_at, bounced_at, unsubscribed_at, last_event_at, enrolled_at, reply_category")
        .eq("campaign_id", campaignId as string)
        .order("enroll_position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CampaignEnrollmentRow[];
    },
  });
}

export interface CampaignEventRow {
  id: string;
  event_type: string;
  email: string | null;
  occurred_at: string | null;
  created_at: string;
}

const CAMPAIGN_DETAIL_EVENTS_LIMIT = 20;

/** Last 20 campaign_events for one campaign, newest first — the detail
 *  sheet's Recent activity section. Same lazy-enable pattern as
 *  useCampaignEnrollments. */
export function useCampaignEvents(campaignId: string | null) {
  return useQuery({
    queryKey: ["playbook", "campaign-events", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_events")
        .select("id, event_type, email, occurred_at, created_at")
        .eq("campaign_id", campaignId as string)
        .order("created_at", { ascending: false })
        .limit(CAMPAIGN_DETAIL_EVENTS_LIMIT);
      if (error) throw error;
      return (data ?? []) as CampaignEventRow[];
    },
  });
}

export interface CampaignEventStats {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

/** Which of the four funnel buckets an event_type string belongs to, or null
 *  if it's none of them (e.g. a bounce/unsubscribe/category-update row).
 *  event_type may be the raw Smartlead name (EMAIL_REPLY) or the canonical
 *  one (EMAIL_REPLIED) — see REPLY_EVENT_TYPES above — so this matches on
 *  substring the same defensive way _shared/webhook-normalize.ts's
 *  mapEventType does, rather than an exact-string lookup table. */
function eventTypeBucket(eventType: string): keyof CampaignEventStats | null {
  const t = eventType.toLowerCase();
  if (t.includes("repl")) return "replied";
  if (t.includes("click")) return "clicked";
  if (t.includes("open")) return "opened";
  if (t.includes("sent") || t.includes("send")) return "sent";
  return null;
}

/** Total sent/opened/clicked/replied counts across EVERY campaign_events row
 *  for one campaign (not just the last-20 useCampaignEvents shows) — the
 *  CampaignDetailSheet's compact "Events seen" funnel row. Deliberately
 *  honest about what this is: a raw tally of our own event log, not a
 *  per-step breakdown (Smartlead's sequence-step field isn't reliably
 *  present — see extractStepNumber's doc comment in playbook-smartlead/
 *  index.ts) and not the same numbers as campaigns.metrics (Smartlead's own
 *  server-computed rates, shown separately in the header). Lazy, same
 *  enable-while-open pattern as the other detail-sheet queries. */
export function useCampaignEventStats(campaignId: string | null) {
  return useQuery({
    queryKey: ["playbook", "campaign-event-stats", campaignId],
    enabled: !!campaignId,
    queryFn: async (): Promise<CampaignEventStats> => {
      const { data, error } = await supabase
        .from("campaign_events")
        .select("event_type")
        .eq("campaign_id", campaignId as string);
      if (error) throw error;
      const out: CampaignEventStats = { sent: 0, opened: 0, clicked: 0, replied: 0 };
      for (const row of (data ?? []) as { event_type: string }[]) {
        const bucket = eventTypeBucket(row.event_type);
        if (bucket) out[bucket]++;
      }
      return out;
    },
  });
}

export type EnrollmentStatusAction = "pause" | "resume" | "stop";

/** Pause / resume / stop ONE person's enrollment — see the `set-enrollment-status`
 *  action in playbook-smartlead/index.ts (S8). `warning` (best-effort Smartlead
 *  sync failed, or their Smartlead lead couldn't be found) is returned rather
 *  than thrown so the caller can toast.warning it instead of toast.error — the
 *  Pulse-side change still succeeded. */
export function useSetEnrollmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { enrollment_id: string; action: EnrollmentStatusAction; campaign_id: string }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "set-enrollment-status", enrollment_id: p.enrollment_id, status_action: p.action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; status: string; warning?: string };
    },
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaign-enrollments", p.campaign_id] });
      // Prefix match — invalidates every campaign's enrollment-stats entry,
      // not just this one, since the stats key also carries a sorted-ids
      // suffix this mutation has no cheap way to reconstruct.
      qc.invalidateQueries({ queryKey: ["playbook", "campaign-enrollment-stats"] });
      qc.invalidateQueries({ queryKey: ["playbook", "campaigns"] });
    },
    onError: (e) => toast.error("Couldn't update this person: " + (e as Error).message),
  });
}

// ---------------------------------------------------------------------------
// Campaign suggestions (Campaigns overhaul Phase 4 — the AI learning loop)
// ---------------------------------------------------------------------------

/** Every suggestion (pending + decided), newest first — InsightsPanel groups
 *  pending ones by template client-side and shows decided ones collapsed
 *  underneath. One query covers both; the panel's badge count on the
 *  Insights button reuses this same cached list (react-query dedupes the
 *  fetch) rather than firing a second one. */
export function useCampaignSuggestions() {
  return useQuery({
    queryKey: ["playbook", "campaign-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_suggestions")
        .select("*, campaign:campaigns(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CampaignSuggestion[];
    },
  });
}

/** Count of pending suggestions only — the same query the badge would need,
 *  kept separate so a page that only wants the count (the Insights button
 *  before the panel is ever opened) doesn't pull rationale/current/suggested
 *  text for every row. Cheap head-count query. */
export function usePendingSuggestionCount() {
  return useQuery({
    queryKey: ["playbook", "campaign-suggestions", "pending-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("campaign_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Apply or dismiss a suggestion — see the `decide-suggestion` action in
 *  playbook-smartlead/index.ts. campaign_suggestions is admin-read-only via
 *  RLS, so the status transition (and, on 'applied', the training-note log)
 *  has to go through the edge function rather than a direct table update —
 *  same shape as useMarkReplyHandled/useSetEnrollmentStatus above.
 *
 *  IMPORTANT: this does NOT edit the template. When decision is 'applied',
 *  the caller must have already written the template edit itself (via
 *  useSaveTemplate + applySuggestionToTemplate from suggestion-apply.ts,
 *  see InsightsPanel.tsx's handleApply) BEFORE calling this — this hook only
 *  stamps the suggestion decided and logs the training note. */
export function useDecideSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; decision: Extract<SuggestionStatus, "applied" | "dismissed"> }) => {
      const { data, error } = await supabase.functions.invoke("playbook-smartlead", {
        body: { action: "decide-suggestion", id: p.id, decision: p.decision },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; status: string; already_decided?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook", "campaign-suggestions"] });
      qc.invalidateQueries({ queryKey: ["playbook", "training"] });
    },
    onError: (e) => toast.error("Couldn't save that decision: " + (e as Error).message),
  });
}
