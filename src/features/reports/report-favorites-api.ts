import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

// Per-user report favorites, DB-backed so they sync across devices and cover
// BOTH standard reports ('standard:<slug>') and saved reports ('saved:<uuid>').
// Replaces the old localStorage-only, standard-slug-only favorites.

export type ReportRef = string; // 'standard:<slug>' | 'saved:<uuid>'

const favKey = (userId?: string) => ["report_favorites", userId];

export function useReportFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: favKey(user?.id),
    queryFn: async (): Promise<Set<ReportRef>> => {
      const { data, error } = await supabase
        .from("report_favorites")
        .select("report_ref")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.report_ref as string));
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ ref, on }: { ref: ReportRef; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from("report_favorites")
          .insert({ user_id: user!.id, report_ref: ref });
        // 23505 = already favorited (PK conflict) — treat as success.
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("report_favorites")
          .delete()
          .eq("user_id", user!.id)
          .eq("report_ref", ref);
        if (error) throw error;
      }
    },
    onMutate: async ({ ref, on }) => {
      const key = favKey(user?.id);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Set<ReportRef>>(key);
      const next = new Set(prev ?? []);
      if (on) next.add(ref);
      else next.delete(ref);
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(favKey(user?.id), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: favKey(user?.id) }),
  });
}

// One-time migration of the legacy localStorage favorites (slug array under
// "report_favorites") into the DB as 'standard:<slug>' rows, then clear the key
// so it never runs again. Safe to call on every mount — it no-ops if the key
// is absent. Call once from the Reports landing.
const LEGACY_KEY = "report_favorites";
export function useMigrateLegacyFavorites() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let slugs: string[] = [];
    try {
      slugs = JSON.parse(raw) as string[];
    } catch {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    if (!Array.isArray(slugs) || slugs.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    const rows = slugs
      .filter((s) => typeof s === "string" && s)
      .map((s) => ({ user_id: user.id, report_ref: `standard:${s}` }));
    supabase
      .from("report_favorites")
      .upsert(rows, { onConflict: "user_id,report_ref", ignoreDuplicates: true })
      .then(({ error }) => {
        // Only clear the legacy key once the rows are safely persisted, so a
        // failed migration can retry next mount rather than silently losing favs.
        if (!error) {
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            /* ignore */
          }
          qc.invalidateQueries({ queryKey: favKey(user.id) });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}
