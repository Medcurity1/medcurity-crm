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
