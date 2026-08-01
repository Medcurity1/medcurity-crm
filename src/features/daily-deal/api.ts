import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// All Daily Deal state lives server-side (the daily-deal edge fn) — the
// answer word never reaches the client until the board is complete.

export interface DDGuess {
  word: string;
  marks: string; // 5 chars of g/y/x
}

export interface DDBoardRow {
  name: string;
  won: boolean | null;
  guessCount: number;
  msElapsed: number | null;
  points: number | null;
  streak: number | null;
}

export interface DDWeekDay {
  date: string;
  word: string | null; // null = hidden (unburned / current week)
  played: number;
  solved: number;
}

export interface DDWeek {
  weekOf: string;
  days: DDWeekDay[];
  standings: Array<{
    name: string;
    points: number;
    played: number;
    wins: number;
    avgGuesses: number | null;
    bestMs: number | null;
    streak: number;
  }>;
}

export interface DDState {
  mode: "play" | "weekend";
  today: string;
  guesses?: DDGuess[];
  completed?: boolean;
  won?: boolean | null;
  msElapsed?: number | null;
  points?: number | null;
  streak?: number | null;
  answer?: string | null;
  board?: DDBoardRow[] | null;
  week?: DDWeek | null;
  recap?: DDWeek;
  error?: string;
}

export interface DDGuessResponse {
  marks?: string;
  won?: boolean;
  completed?: boolean;
  answer?: string | null;
  points?: number | null;
  streak?: number | null;
  msElapsed?: number | null;
  board?: DDBoardRow[] | null;
  week?: DDWeek | null;
  error?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("daily-deal", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export function useDailyDealState(open: boolean) {
  return useQuery({
    queryKey: ["daily-deal", "state"],
    queryFn: () => invoke<DDState>({ action: "state" }),
    enabled: open,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useDailyDealGuess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (word: string) => invoke<DDGuessResponse>({ action: "guess", word }),
    onSuccess: (res, word) => {
      // Fold the response into the cached state so reopening is instant and
      // a completed board immediately has its panels.
      qc.setQueryData<DDState>(["daily-deal", "state"], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          guesses: [...(prev.guesses ?? []), { word, marks: res.marks ?? "" }],
          completed: res.completed ?? prev.completed,
          won: res.won ?? prev.won,
          points: res.points ?? prev.points,
          streak: res.streak ?? prev.streak,
          msElapsed: res.msElapsed ?? prev.msElapsed,
          answer: res.answer ?? prev.answer,
          board: res.board ?? prev.board,
          week: res.week ?? prev.week,
        };
      });
    },
  });
}
