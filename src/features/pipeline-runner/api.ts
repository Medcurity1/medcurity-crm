import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface RunnerScore {
  id: number;
  user_id: string;
  player_name: string;
  score: number;
  created_at: string;
}

/** Public all-time top 5 runs (a single player can hold multiple slots). */
export function useTopScores(enabled = true) {
  return useQuery({
    queryKey: ["pipeline-runner", "top5"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_runner_scores")
        .select("id, user_id, player_name, score, created_at")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as RunnerScore[];
    },
    staleTime: 15_000,
  });
}

export function useSubmitScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { userId: string; playerName: string; score: number }) => {
      const { error } = await supabase.from("pipeline_runner_scores").insert({
        user_id: v.userId,
        player_name: v.playerName,
        score: Math.max(0, Math.min(100_000_000, Math.round(v.score))),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-runner", "top5"] }),
  });
}
