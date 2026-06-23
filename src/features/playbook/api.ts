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
