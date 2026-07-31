import { describe, it, expect } from "vitest";
import { startBackgroundTicker } from "../src/lib/backgroundTicker";

// ---------------------------------------------------------------------------
// The background-proof tick source behind the Meddy availability heartbeat
// (2026-07-31 fix for Margaret's report). The Worker path can't run in
// vitest's node env, so deps are injectable: these tests pin the contract —
// worker preferred, onmessage wired to the callback, clean teardown, and a
// silent fall-back to setInterval when Workers are unavailable.
// ---------------------------------------------------------------------------

interface FakeWorker {
  onmessage: ((e: unknown) => void) | null;
  terminated: boolean;
  terminate(): void;
}

function fakeWorkerFactory() {
  const workers: FakeWorker[] = [];
  const createWorker = () => {
    const w: FakeWorker = {
      onmessage: null,
      terminated: false,
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(w);
    return w;
  };
  return { workers, createWorker };
}

describe("startBackgroundTicker — worker path", () => {
  it("creates a worker and forwards its messages as ticks", () => {
    const { workers, createWorker } = fakeWorkerFactory();
    let ticks = 0;
    startBackgroundTicker(60_000, () => ticks++, { createWorker });
    expect(workers).toHaveLength(1);
    workers[0].onmessage?.(0);
    workers[0].onmessage?.(0);
    expect(ticks).toBe(2);
  });

  it("stop() terminates the worker and detaches the handler", () => {
    const { workers, createWorker } = fakeWorkerFactory();
    let ticks = 0;
    const stop = startBackgroundTicker(60_000, () => ticks++, { createWorker });
    stop();
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].onmessage).toBeNull();
    // a message from an already-terminated worker (queued in flight) is inert
    expect(ticks).toBe(0);
  });

  it("never uses setInterval when the worker path works", () => {
    const { createWorker } = fakeWorkerFactory();
    let intervalCalls = 0;
    startBackgroundTicker(60_000, () => {}, {
      createWorker,
      setIntervalFn: () => {
        intervalCalls++;
        return 1;
      },
      clearIntervalFn: () => {},
    });
    expect(intervalCalls).toBe(0);
  });
});

describe("startBackgroundTicker — setInterval fallback", () => {
  it("falls back when Worker creation throws, with the same interval", () => {
    let intervalMs = 0;
    let tickFn: (() => void) | null = null;
    startBackgroundTicker(
      60_000,
      () => {},
      {
        createWorker: () => {
          throw new Error("no Worker in this environment");
        },
        setIntervalFn: (fn, ms) => {
          tickFn = fn;
          intervalMs = ms;
          return 42;
        },
        clearIntervalFn: () => {},
      },
    );
    expect(intervalMs).toBe(60_000);
    expect(tickFn).not.toBeNull();
  });

  it("stop() clears the fallback interval by its id", () => {
    let clearedId: number | null = null;
    const stop = startBackgroundTicker(
      60_000,
      () => {},
      {
        createWorker: () => {
          throw new Error("no Worker");
        },
        setIntervalFn: () => 42,
        clearIntervalFn: (id) => {
          clearedId = id;
        },
      },
    );
    stop();
    expect(clearedId).toBe(42);
  });

  it("fallback ticks reach the callback", () => {
    let ticks = 0;
    let tickFn: (() => void) | null = null;
    startBackgroundTicker(
      60_000,
      () => ticks++,
      {
        createWorker: () => {
          throw new Error("no Worker");
        },
        setIntervalFn: (fn) => {
          tickFn = fn;
          return 1;
        },
        clearIntervalFn: () => {},
      },
    );
    tickFn!();
    tickFn!();
    tickFn!();
    expect(ticks).toBe(3);
  });
});
