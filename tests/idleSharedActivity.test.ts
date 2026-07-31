import { describe, it, expect } from "vitest";
import {
  markSharedActivity,
  lastSharedActivityMs,
  idleDeferralMs,
  SHARED_ACTIVITY_KEY,
} from "../src/lib/sharedActivity";

// ---------------------------------------------------------------------------
// Margaret's 2026-07-31 bug: a forgotten background tab's 12h idle timer
// signed out the ENTIRE browser while she was actively working in another
// tab. The fix shares a last-activity stamp across tabs; these tests pin the
// stamp's write/read behavior and the deferral decision useIdleLogout makes
// at both of its checkpoints (before warning, and again before sign-out).
//
// markSharedActivity keeps module-level throttle state, so the write tests
// run as ONE ordered sequence with strictly increasing timestamps.
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const IDLE = 12 * HOUR; // AppLayout's production setting

/** Minimal injectable Storage double (vitest runs in node — no localStorage). */
function fakeStore(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage & { map: Map<string, string> };
}

function throwingStore(): Storage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("idleDeferralMs — the two-checkpoint decision", () => {
  it("proceeds (null) when there is no cross-tab signal at all", () => {
    expect(idleDeferralMs(Date.parse("2026-07-31T20:00:00Z"), 0, IDLE)).toBeNull();
  });

  it("proceeds when the last activity anywhere is outside the idle window (abandoned machine still logs out)", () => {
    const now = 100 * HOUR;
    expect(idleDeferralMs(now, now - IDLE, IDLE)).toBeNull();
    expect(idleDeferralMs(now, now - IDLE - 1, IDLE)).toBeNull();
  });

  it("defers by the remaining window when another tab was active (Margaret's case)", () => {
    // Her active tab stamped 1 hour ago; the forgotten tab's 12h timer fires.
    const now = 100 * HOUR;
    expect(idleDeferralMs(now, now - 1 * HOUR, IDLE)).toBe(11 * HOUR);
  });

  it("floors the deferral at 60s so a just-crossing stamp can't schedule a tight re-fire loop", () => {
    const now = 100 * HOUR;
    expect(idleDeferralMs(now, now - IDLE + 5_000, IDLE)).toBe(60_000);
  });

  it("treats a future-dated stamp (clock weirdness) as a full-window deferral, never negative", () => {
    const now = 100 * HOUR;
    expect(idleDeferralMs(now, now + HOUR, IDLE)).toBe(IDLE);
  });
});

describe("markSharedActivity / lastSharedActivityMs — ordered sequence (shared throttle state)", () => {
  const store = fakeStore();

  it("round-trips a stamp through the store", () => {
    markSharedActivity({ nowMs: 1_000_000, store });
    expect(lastSharedActivityMs(store)).toBe(1_000_000);
    expect(store.map.get(SHARED_ACTIVITY_KEY)).toBe("1000000");
  });

  it("throttles a second write inside 30s (mousemove storms stay cheap)", () => {
    markSharedActivity({ nowMs: 1_010_000, store }); // +10s — swallowed
    expect(lastSharedActivityMs(store)).toBe(1_000_000);
  });

  it("force bypasses the throttle (the 'Stay signed in' click must always land)", () => {
    markSharedActivity({ nowMs: 1_012_000, store, force: true });
    expect(lastSharedActivityMs(store)).toBe(1_012_000);
  });

  it("writes again once the throttle window has passed", () => {
    markSharedActivity({ nowMs: 1_050_000, store }); // +38s since last write
    expect(lastSharedActivityMs(store)).toBe(1_050_000);
  });

  it("reads junk or a missing stamp as 0 (callers fall back to per-tab timers)", () => {
    const s = fakeStore();
    expect(lastSharedActivityMs(s)).toBe(0);
    s.map.set(SHARED_ACTIVITY_KEY, "not-a-number");
    expect(lastSharedActivityMs(s)).toBe(0);
    s.map.set(SHARED_ACTIVITY_KEY, "-5");
    expect(lastSharedActivityMs(s)).toBe(0);
  });

  it("degrades silently when storage is blocked (Safari Lockdown) — no throw, no signal", () => {
    const s = throwingStore();
    expect(() => markSharedActivity({ nowMs: 9_999_999, store: s, force: true })).not.toThrow();
    expect(lastSharedActivityMs(s)).toBe(0);
  });

  it("no-ops without a store (SSR/blocked) instead of crashing", () => {
    expect(() => markSharedActivity({ nowMs: 9_999_999, store: null, force: true })).not.toThrow();
    expect(lastSharedActivityMs(null)).toBe(0);
  });
});
