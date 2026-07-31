-- Meddy stale-agent sweep: widen the staleness threshold 2 min -> 3 min.
--
-- Part of the 2026-07-31 availability fix (Margaret's report). The client
-- heartbeat is 60s and now comes from a Web Worker so it keeps firing in
-- backgrounded tabs (see src/lib/backgroundTicker.ts + useMeddyPresence.ts —
-- the 2026-07-21 visible-only guard that starved this sweep is reverted).
-- Browser throttling can still stretch a single beat, so the sweep now
-- tolerates two missed/stretched beats (3 min) instead of one before marking
-- an agent unavailable. Genuinely-gone sessions are still caught fast: a
-- closed tab drops off the realtime presence channel and peers mark it away
-- in ~12s (peer_offline); this sweep is the fallback, where an extra minute
-- of grace costs nothing.
--
-- Keep in lockstep with the same 3-min cutoff in meddy-sweep/index.ts
-- (edge-fn twin of this sweep) and meddy-chat/index.ts (anyAvailable probe).

create or replace function public.meddy_sweep_stale_agents()
returns void
language sql
security definer
set search_path = public
as $$
  update public.meddy_agent_status
     set available = false,
         updated_at = now()
   where available = true
     and last_seen < now() - interval '3 minutes';
$$;
