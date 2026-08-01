// The Daily Deal — weekday word-game engine (Nathan, 2026-07-31).
//
// ALL game state lives server-side: the answer word is never sent to the
// client until the player's board is complete (win or 6th miss), so neither
// view-source nor the network tab spoils it. Tables are service-role-only
// (RLS with no authenticated policies, like campaign_events); every client
// interaction flows through here.
//
// Actions:
//   state  {}            → today's board (weekday) or the week recap (weekend)
//   guess  {word}        → evaluate one guess, return marks (+ reveal on done)
//   recap  {weekOf?}     → a week's recap panel (defaults to current week)
//
// Dictionary note: the client validates guesses against its bundled word
// list before submitting (instant shake, no round-trip). The server checks
// SHAPE only (5 lowercase letters) — someone bypassing the client to submit
// "zzzzz" only wastes their own guesses, and skipping an 8.5k-word bundle
// here keeps the function lean.
//
// Deploy: supabase functions deploy daily-deal   (CI deploys it like the rest)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_GUESSES,
  evaluateGuess,
  totalPoints,
  isWeekday,
  prevWeekday,
  weekDates,
  weekMonday,
  ptTodayISO,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface GuessEntry {
  word: string;
  marks: string;
  at: string;
}

interface ResultRow {
  user_id: string;
  puzzle_date: string;
  guesses: GuessEntry[];
  started_at: string;
  completed_at: string | null;
  won: boolean | null;
  ms_elapsed: number | null;
  points: number | null;
  streak_after: number | null;
}

/** Names for the boards. One roster fetch per request that needs it. */
async function nameMap(): Promise<Map<string, string>> {
  const { data } = await svc.from("user_profiles").select("id, full_name");
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; full_name: string | null }[]) {
    m.set(r.id, r.full_name || "Someone");
  }
  return m;
}

/** Completed results for one puzzle date — the "today's solvers" board.
 *  Guess WORDS are never included (only counts), so nothing here spoils. */
async function todayBoard(puzzleDate: string, names: Map<string, string>) {
  const { data } = await svc
    .from("daily_deal_results")
    .select("user_id, won, guesses, ms_elapsed, points, streak_after")
    .eq("puzzle_date", puzzleDate)
    .not("completed_at", "is", null)
    .order("points", { ascending: false });
  return ((data ?? []) as ResultRow[]).map((r) => ({
    name: names.get(r.user_id) ?? "Someone",
    won: r.won,
    guessCount: (r.guesses ?? []).length,
    msElapsed: r.ms_elapsed,
    points: r.points,
    streak: r.streak_after,
  }));
}

/** Weekly standings + per-day recap for the week containing `iso`.
 *  Unburned words (zero-play days) stay hidden — Nathan's recycling rule. */
async function weekRecap(iso: string, names: Map<string, string>, revealWords: boolean) {
  const dates = weekDates(iso);
  const { data: puzzles } = await svc
    .from("daily_deal_puzzles")
    .select("puzzle_date, word_id, daily_deal_words(word, used_on)")
    .in("puzzle_date", dates);
  const { data: results } = await svc
    .from("daily_deal_results")
    .select("user_id, puzzle_date, won, guesses, ms_elapsed, points, streak_after, completed_at")
    .in("puzzle_date", dates)
    .not("completed_at", "is", null);

  const rows = (results ?? []) as ResultRow[];
  const byUser = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const standings = [...byUser.entries()]
    .map(([uid, list]) => {
      const wins = list.filter((r) => r.won).length;
      const bestMs = Math.min(...list.filter((r) => r.won).map((r) => r.ms_elapsed ?? Infinity));
      const latest = list.sort((a, b) => a.puzzle_date.localeCompare(b.puzzle_date)).at(-1);
      return {
        name: names.get(uid) ?? "Someone",
        points: list.reduce((s, r) => s + (r.points ?? 0), 0),
        played: list.length,
        wins,
        avgGuesses: list.length
          ? Math.round((list.reduce((s, r) => s + (r.guesses ?? []).length, 0) / list.length) * 10) / 10
          : null,
        bestMs: Number.isFinite(bestMs) ? bestMs : null,
        streak: latest?.streak_after ?? 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  // deno-lint-ignore no-explicit-any
  const days = dates.map((d) => {
    const p = (puzzles ?? []).find((x: any) => x.puzzle_date === d) as any;
    const dayResults = rows.filter((r) => r.puzzle_date === d);
    const burned = p ? p.daily_deal_words?.used_on !== null : false;
    return {
      date: d,
      // Reveal only burned words, and only on recap surfaces (weekend, or a
      // finished week) — never today's live word.
      word: revealWords && p && burned ? p.daily_deal_words?.word : null,
      played: dayResults.length,
      solved: dayResults.filter((r) => r.won).length,
    };
  });

  return { weekOf: weekMonday(iso), days, standings };
}

/** Streak: consecutive weekdays COMPLETED (win or loss both count — the
 *  streak rewards showing up; points reward winning). */
async function computeStreak(userId: string, puzzleDate: string): Promise<number> {
  const prev = prevWeekday(puzzleDate);
  const { data } = await svc
    .from("daily_deal_results")
    .select("streak_after, completed_at")
    .eq("user_id", userId)
    .eq("puzzle_date", prev)
    .maybeSingle();
  return data?.completed_at ? (data.streak_after ?? 0) + 1 : 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const { data: profile } = await svc
    .from("user_profiles")
    .select("id, is_active")
    .eq("id", caller.id)
    .single();
  if (!profile?.is_active) return json({ error: "Not authorized" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "");
  const today = ptTodayISO(new Date());

  try {
    if (action === "state") {
      const names = await nameMap();
      if (!isWeekday(today)) {
        return json({ mode: "weekend", today, recap: await weekRecap(today, names, true) });
      }
      // Ensure today's puzzle exists (advisory-locked pick, server-side only).
      const { error: pickErr } = await svc.rpc("daily_deal_ensure_puzzle", { p_date: today });
      if (pickErr) throw new Error("Couldn't set up today's puzzle: " + pickErr.message);

      // My board — created on first VIEW so the clock starts when the player
      // actually sees tiles (speed bonus measures solving, not discovering).
      let { data: mine } = await svc
        .from("daily_deal_results")
        .select("*")
        .eq("user_id", caller.id)
        .eq("puzzle_date", today)
        .maybeSingle();
      if (!mine) {
        const { data: inserted, error: insErr } = await svc
          .from("daily_deal_results")
          .insert({ user_id: caller.id, puzzle_date: today })
          .select("*")
          .single();
        if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
        mine = inserted ?? (await svc
          .from("daily_deal_results")
          .select("*")
          .eq("user_id", caller.id)
          .eq("puzzle_date", today)
          .single()).data;
      }
      const row = mine as ResultRow;
      const done = !!row.completed_at;
      let answer: string | null = null;
      if (done) {
        const { data: p } = await svc
          .from("daily_deal_puzzles")
          .select("daily_deal_words(word)")
          .eq("puzzle_date", today)
          .single();
        // deno-lint-ignore no-explicit-any
        answer = (p as any)?.daily_deal_words?.word ?? null;
      }
      return json({
        mode: "play",
        today,
        guesses: (row.guesses ?? []).map((g) => ({ word: g.word, marks: g.marks })),
        completed: done,
        won: row.won,
        msElapsed: row.ms_elapsed,
        points: row.points,
        streak: row.streak_after,
        answer,
        board: done ? await todayBoard(today, names) : null,
        week: done ? await weekRecap(today, names, false) : null,
      });
    }

    if (action === "guess") {
      if (!isWeekday(today)) return json({ error: "No puzzle on weekends — see you Monday!" }, 400);
      const word = String(body.word ?? "").toLowerCase();
      if (!/^[a-z]{5}$/.test(word)) return json({ error: "Guesses are 5 letters." }, 400);

      const { data: answerWord, error: pickErr } = await svc.rpc("daily_deal_ensure_puzzle", {
        p_date: today,
      });
      if (pickErr || typeof answerWord !== "string") {
        throw new Error("Couldn't load today's puzzle: " + (pickErr?.message ?? "no word"));
      }

      let { data: mine } = await svc
        .from("daily_deal_results")
        .select("*")
        .eq("user_id", caller.id)
        .eq("puzzle_date", today)
        .maybeSingle();
      if (!mine) {
        const { data: inserted } = await svc
          .from("daily_deal_results")
          .insert({ user_id: caller.id, puzzle_date: today })
          .select("*")
          .single();
        mine = inserted;
      }
      const row = mine as ResultRow;
      if (row.completed_at) return json({ error: "Today's board is already finished." }, 400);
      const priorCount = (row.guesses ?? []).length;
      if (priorCount >= MAX_GUESSES) return json({ error: "No guesses left." }, 400);

      const marks = evaluateGuess(answerWord, word);
      const won = marks === "ggggg";
      const done = won || priorCount + 1 >= MAX_GUESSES;
      const nowIso = new Date().toISOString();
      const nextGuesses = [...(row.guesses ?? []), { word, marks, at: nowIso }];

      const update: Record<string, unknown> = { guesses: nextGuesses };
      let points: number | null = null;
      let streak: number | null = null;
      let msElapsed: number | null = null;
      if (done) {
        streak = await computeStreak(caller.id, today);
        msElapsed = Math.min(
          Math.max(Date.now() - new Date(row.started_at).getTime(), 0),
          24 * 60 * 60 * 1000,
        );
        points = totalPoints({ guessesUsed: priorCount + 1, won, msElapsed, streakAfter: streak });
        update.completed_at = nowIso;
        update.won = won;
        update.ms_elapsed = msElapsed;
        update.points = points;
        update.streak_after = streak;
      }

      // Optimistic concurrency: only append if the row still has the guess
      // count we read (double-Enter or two tabs can't double-append).
      const { data: updated } = await svc
        .from("daily_deal_results")
        .update(update)
        .eq("user_id", caller.id)
        .eq("puzzle_date", today)
        .is("completed_at", null)
        // jsonb equality on the exact prior guesses — a double-Enter or a
        // second tab appending concurrently matches 0 rows instead of
        // double-writing (jsonb `=` is semantic, arrays keep order).
        .filter("guesses", "eq", JSON.stringify(row.guesses ?? []))
        .select("*");
      if (!updated || updated.length === 0) {
        return json({ error: "That guess raced another one — reopen the board." }, 409);
      }

      // Burn the word: someone played today, so it's used for good (the
      // zero-play recycling rule in daily_deal_ensure_puzzle never sees it).
      await svc
        .from("daily_deal_words")
        .update({ used_on: today })
        .eq("word", answerWord)
        .is("used_on", null);

      const names = done ? await nameMap() : null;
      return json({
        marks,
        won,
        completed: done,
        answer: done ? answerWord : null,
        points,
        streak,
        msElapsed,
        board: done && names ? await todayBoard(today, names) : null,
        week: done && names ? await weekRecap(today, names, false) : null,
      });
    }

    if (action === "recap") {
      const weekOf = typeof body.weekOf === "string" ? body.weekOf : today;
      const names = await nameMap();
      // Words reveal on recap only for weeks strictly before the current one,
      // or on weekends for the week that just ended.
      const currentWeek = weekMonday(today);
      const reveal = weekMonday(weekOf) < currentWeek || !isWeekday(today);
      return json({ recap: await weekRecap(weekOf, names, reveal) });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[daily-deal]", action, err);
    return json({ error: (err as Error).message }, 500);
  }
});
