import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KPI_REGISTRY } from "@/features/dashboard/kpi-registry";

// ---------------------------------------------------------------------------
// Every KPI query must SURFACE Supabase errors (throw/reject) instead of
// swallowing them and returning 0 / $0. A rejected query leaves React Query's
// `data` undefined and KpiCard renders "—", so a transient network drop or
// RLS denial can't masquerade as a real zero on the Home dashboard.
// (Regression guard for the pattern fixed in 81b5e31, extended to all KPIs.)
// ---------------------------------------------------------------------------

interface StubResult {
  data: unknown;
  count: number | null;
  error: Error | null;
}

// Minimal PostgREST query-builder stub: every filter/select method chains,
// and awaiting it resolves to the canned result (Supabase builders are
// thenables — errors come back as `{ error }`, they are NOT thrown).
function makeBuilder(result: StubResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  for (const m of ["select", "eq", "not", "is", "gte", "lt", "lte", "range", "or"]) {
    b[m] = () => b;
  }
  b.then = (
    onFulfilled?: (v: StubResult) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

function makeClient(result: StubResult): SupabaseClient {
  return { from: () => makeBuilder(result) } as unknown as SupabaseClient;
}

const USER_ID = "00000000-0000-0000-0000-000000000000";

describe("KPI_REGISTRY error surfacing", () => {
  // NOTE: the error cases run before the success cases on purpose — the three
  // renewal KPIs share a 45s memoized renewal_queue fetch, and a FAILED fetch
  // drops out of that cache (so these sequential tests each get a fresh call)
  // while a successful one is retained for the TTL.
  const boom = new Error("PostgREST 500 / RLS denial / network drop");

  for (const kpi of KPI_REGISTRY) {
    it(`${kpi.id} rejects when the query errors (no silent 0)`, async () => {
      const client = makeClient({ data: null, count: null, error: boom });
      await expect(kpi.query(client, USER_ID)).rejects.toThrow(boom.message);
    });
  }

  for (const kpi of KPI_REGISTRY) {
    it(`${kpi.id} still resolves to 0 on a successful empty result`, async () => {
      const client = makeClient({ data: [], count: 0, error: null });
      await expect(kpi.query(client, USER_ID)).resolves.toBe(0);
    });
  }
});
