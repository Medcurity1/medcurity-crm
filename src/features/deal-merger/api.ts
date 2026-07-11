import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface MergerScore {
  id: number;
  user_id: string;
  player_name: string;
  score: number;
  /** dollar value of the biggest deal tile reached that run (e.g. 1024000) */
  best_tile: number;
  created_at: string;
}

/** Public all-time top 5 runs (a single player can hold multiple slots). */
export function useTopScores(enabled = true) {
  return useQuery({
    queryKey: ["deal-merger", "top5"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_merger_scores")
        .select("id, user_id, player_name, score, best_tile, created_at")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as MergerScore[];
    },
    staleTime: 15_000,
  });
}

/** The signed-in user's own best run — for their private "personal best". */
export function useMyBest(userId: string | undefined) {
  return useQuery({
    queryKey: ["deal-merger", "mybest", userId ?? "anon"],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_merger_scores")
        .select("score")
        .eq("user_id", userId!)
        .order("score", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data && data.length ? (data[0].score as number) : 0;
    },
    staleTime: 15_000,
  });
}

export function useSubmitScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      userId: string;
      playerName: string;
      score: number;
      bestTile: number;
    }) => {
      const { error } = await supabase.from("deal_merger_scores").insert({
        user_id: v.userId,
        player_name: v.playerName,
        // int4-safe clamp; a $8M-tile god-run scores past 100M, so the cap is
        // higher here than the other two games.
        score: Math.max(0, Math.min(2_000_000_000, Math.round(v.score))),
        best_tile: Math.max(0, Math.min(2_000_000_000, Math.round(v.bestTile))),
      });
      if (error) throw error;
    },
    // Refresh both the public board and the player's personal best.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deal-merger"] }),
  });
}
