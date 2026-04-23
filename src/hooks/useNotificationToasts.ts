import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/**
 * Surfaces new in-app notifications as top-right toast banners wherever
 * the user is in the CRM. Polls every 30 seconds (cheap single-row
 * count query) and fetches details only when the count grows.
 *
 * Why polling vs Supabase Realtime: Realtime needs a channel subscription
 * per user and works unevenly when the tab backgrounds. A 30-second poll
 * is plenty for reminder toasts and costs 1 indexed query per tick.
 *
 * First run primes `lastSeenCount` to the current count, so we don't
 * flood the user with toasts for every historical unread on login.
 */
interface NotificationRow {
  id: string;
  title: string;
  message: string | null;
  link: string | null;
  created_at: string;
}

export function useNotificationToasts() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const primed = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function prime() {
      // Pull the most recent 50 unread ids and record them as "already seen"
      // so only notifications created AFTER this moment fire toasts.
      const { data } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(50);
      for (const r of data ?? []) seenIds.current.add(r.id);
      primed.current = true;
    }

    async function tick() {
      if (!primed.current) return;
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, link, created_at")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error || cancelled) return;
      for (const n of ((data ?? []) as NotificationRow[]).reverse()) {
        if (seenIds.current.has(n.id)) continue;
        seenIds.current.add(n.id);
        toast(n.title, {
          description: n.message ?? undefined,
          action: n.link
            ? {
                label: "Open",
                onClick: () => {
                  window.location.href = n.link!;
                },
              }
            : undefined,
          duration: 8000,
        });
      }
      // Refresh any listener (bell count, etc).
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }

    void prime();
    const interval = window.setInterval(tick, 30_000);
    // Also check immediately a few seconds after prime so the first real
    // notification doesn't have to wait 30s.
    const initial = window.setTimeout(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(initial);
    };
  }, [user?.id, qc]);
}
