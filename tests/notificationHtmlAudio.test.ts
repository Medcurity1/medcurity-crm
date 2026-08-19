import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtmlAudioSession } from "@/lib/notification-html-audio";
import { readFileSync } from "fs";
import path from "path";

describe("background WAV session cancellation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stop pauses live clones and never fires pending repeats", () => {
    vi.useFakeTimers();
    const session = createHtmlAudioSession();
    const paused: string[] = [];
    const gen = session.beginPlay();
    expect(session.adoptClone({ pause: () => paused.push("first"), currentTime: 0.4 }, gen)).toBe(true);

    let repeats = 0;
    session.schedule(() => {
      repeats += 1;
    }, 1400);
    session.schedule(() => {
      repeats += 1;
    }, 2800);

    expect(session.snapshot()).toEqual({ generation: 0, clones: 1, timers: 2, queued: 0 });
    session.stop();
    expect(paused).toEqual(["first"]);
    expect(session.snapshot()).toEqual({ generation: 1, clones: 0, timers: 0, queued: 0 });

    vi.advanceTimersByTime(10_000);
    expect(repeats).toBe(0);
  });

  it("a replacement alert invalidates the previous generation", () => {
    vi.useFakeTimers();
    const session = createHtmlAudioSession();
    const first = session.beginPlay();
    let firstRepeats = 0;
    session.schedule(() => {
      firstRepeats += 1;
    }, 1400);

    session.stop();
    const second = session.beginPlay();
    const paused: string[] = [];
    expect(session.adoptClone({ pause: () => paused.push("stale") }, first)).toBe(false);
    expect(paused).toEqual(["stale"]);

    let secondRepeats = 0;
    session.schedule(() => {
      secondRepeats += 1;
    }, 1400);

    vi.advanceTimersByTime(1400);
    expect(firstRepeats).toBe(0);
    expect(secondRepeats).toBe(1);
    expect(session.isCurrent(first)).toBe(false);
    expect(session.isCurrent(second)).toBe(true);
  });

  it("stop drops autoplay-failed alerts so they cannot replay on visibility", () => {
    const session = createHtmlAudioSession();
    const gen = session.beginPlay();
    expect(session.enqueue({ soundType: "beacon", durationType: "long" }, gen)).toBe(true);
    expect(session.hasQueued()).toBe(true);
    expect(session.snapshot().queued).toBe(1);

    session.stop();
    expect(session.hasQueued()).toBe(false);
    expect(session.takeQueue()).toEqual([]);
    expect(session.enqueue({ soundType: "beacon", durationType: "long" }, gen)).toBe(false);
    expect(session.hasQueued()).toBe(false);

    const next = session.beginPlay();
    expect(session.enqueue({ soundType: "felt", durationType: "short" }, next)).toBe(true);
    expect(session.takeQueue()).toEqual([{ soundType: "felt", durationType: "short" }]);
    expect(session.hasQueued()).toBe(false);
  });

  it("wires stopActiveSound and background repeats through the session", () => {
    const engine = readFileSync(path.resolve(__dirname, "..", "src/lib/notification-sounds.ts"), "utf8");
    expect(engine).toContain("htmlAudio.stop()");
    expect(engine).toContain("htmlAudio.adoptClone(sound, started)");
    expect(engine).toContain("htmlAudio.schedule(() => { void _playNotifAudio(); }, elapsed)");
    expect(engine).toContain("htmlAudio.enqueue({ soundType, durationType }, started)");
    expect(engine).toContain("htmlAudio.takeQueue()");
    expect(engine).not.toMatch(/_soundQueue/);
    expect(engine).not.toMatch(/setTimeout\(\(\) => \{ void _playNotifAudio\(\); \}, elapsed\)/);
  });
});
