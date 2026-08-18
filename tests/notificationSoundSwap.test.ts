import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  KEPT_SOUNDS,
  SOUND_ALIASES,
  canonicalSound,
  resolveNotifSound,
  NOTIF_TYPE_FALLBACK_SOUNDS,
} from "@/lib/notification-sound-choice";
import {
  MEDDY_NOTIF_TYPES,
  SUPPORT_NOTIF_TYPES,
  CRM_NOTIF_TYPES,
} from "@/features/notifications/prefs-api";

// The 2026-08-18 sound refresh (Nathan) replaced all seven pickable sounds
// with six new ones. The whole point of the swap was that NOBODY'S SAVED
// SETTING BREAKS: a pref saved as "glass" months ago must keep working and
// simply play the sound that replaced it. These tests pin that promise down,
// because the failure mode is silent — a notification that makes no noise is
// not something anyone reports as a bug, they just stop trusting the bell.

const ALL_TYPES = [...MEDDY_NOTIF_TYPES, ...SUPPORT_NOTIF_TYPES, ...CRM_NOTIF_TYPES];

/** Every sound name the engine has ever offered in the picker. */
const EVERY_HISTORICAL_SOUND = [
  // the seven retired by this swap (2026-08-18)
  "marimba",
  "bubble",
  "drop",
  "horn",
  "doorbell",
  "glass",
  "knock",
  // retired at the 2026-06-12 audition
  "chime",
  "bell",
  "urgent",
  "soft",
  "melody",
  "pulse",
  "ringbell",
  "ding",
  "twinkle",
  "echo",
];

describe("the six current sounds", () => {
  it("is exactly Nathan's picks", () => {
    expect([...KEPT_SOUNDS].sort()).toEqual(
      ["beacon", "bloom", "felt", "lantern", "musicbox", "quill"].sort(),
    );
  });

  it("leaves a current sound untouched", () => {
    for (const s of KEPT_SOUNDS) expect(canonicalSound(s)).toBe(s);
  });
});

describe("no saved preference breaks", () => {
  it.each(EVERY_HISTORICAL_SOUND)("%s resolves to a sound that exists", (old) => {
    expect(KEPT_SOUNDS.has(canonicalSound(old))).toBe(true);
  });

  it("honours the exact swaps Nathan chose", () => {
    expect(canonicalSound("marimba")).toBe("lantern");
    expect(canonicalSound("bubble")).toBe("bloom");
    expect(canonicalSound("drop")).toBe("quill");
    expect(canonicalSound("horn")).toBe("felt");
    expect(canonicalSound("doorbell")).toBe("beacon");
    expect(canonicalSound("glass")).toBe("musicbox");
  });

  it("sends the retired Knock somewhere real instead of nowhere", () => {
    // Knock lost its slot (six new sounds, seven old). Anyone who picked it
    // deliberately wanted the quiet one, so it lands on the quietest new one.
    expect(canonicalSound("knock")).toBe("felt");
  });

  it("resolves a sound that was auditioned but never shipped", () => {
    // Nathan auditioned Rise and cut it; it never reached the picker, but a
    // hand-edited or half-migrated pref naming it must still make a noise.
    expect(KEPT_SOUNDS.has(canonicalSound("rise"))).toBe(true);
  });

  it("never returns an unplayable name for junk input", () => {
    for (const junk of ["", "   ", "not-a-sound", "GLASS", "felt ", "null"]) {
      expect(KEPT_SOUNDS.has(canonicalSound(junk))).toBe(true);
    }
    expect(KEPT_SOUNDS.has(canonicalSound(undefined))).toBe(true);
    expect(KEPT_SOUNDS.has(canonicalSound(null))).toBe(true);
  });

  it("maps every alias onto a sound that exists", () => {
    for (const [from, to] of Object.entries(SOUND_ALIASES)) {
      expect(KEPT_SOUNDS.has(to), `${from} → ${to} is not a real sound`).toBe(true);
      expect(KEPT_SOUNDS.has(from), `${from} is both current and aliased`).toBe(false);
    }
  });
});

describe("resolveNotifSound — what actually plays", () => {
  it("plays the replacement when the user picked a now-retired sound", () => {
    // A rep who set task reminders to Glass hears Music Box, NOT the
    // task_due default — their choice survives the rename.
    expect(resolveNotifSound("task_due", "glass")).toBe("musicbox");
    expect(resolveNotifSound("task_due", "glass")).not.toBe(
      NOTIF_TYPE_FALLBACK_SOUNDS.task_due,
    );
  });

  it("keeps a current pick as-is", () => {
    expect(resolveNotifSound("task_due", "beacon")).toBe("beacon");
  });

  it("falls back to the type default when nothing is saved", () => {
    for (const def of ALL_TYPES) {
      expect(resolveNotifSound(def.key, undefined)).toBe(def.defSound);
    }
  });

  it("falls back to a real sound for an unknown type with nothing saved", () => {
    expect(KEPT_SOUNDS.has(resolveNotifSound("some_future_type", undefined))).toBe(true);
  });

  it("never goes silent for any type × any historical saved value", () => {
    for (const def of ALL_TYPES) {
      for (const saved of [...EVERY_HISTORICAL_SOUND, ...KEPT_SOUNDS, "junk", ""]) {
        const played = resolveNotifSound(def.key, saved);
        expect(KEPT_SOUNDS.has(played), `${def.key} + ${saved} → ${played}`).toBe(true);
      }
    }
  });
});

describe("per-type defaults", () => {
  it("uses a real sound for every notification type", () => {
    for (const def of ALL_TYPES) {
      expect(KEPT_SOUNDS.has(def.defSound), `${def.key} → ${def.defSound}`).toBe(true);
    }
  });

  it("keeps the settings panel and the delivery engine in agreement", () => {
    // Two separate tables carry the per-type default. If they drift, the
    // dropdown shows one sound and a different one comes out of the speakers.
    for (const def of ALL_TYPES) {
      expect(NOTIF_TYPE_FALLBACK_SOUNDS[def.key], `${def.key} missing from the engine`).toBe(
        def.defSound,
      );
    }
  });

  it("keeps a task someone hands you distinct from your own task coming due", () => {
    // Deliberate split from the 2026-08-17 assignment work — preserved
    // through the swap, and the reason task_assigned is not lantern.
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.task_assigned).not.toBe(
      NOTIF_TYPE_FALLBACK_SOUNDS.task_due,
    );
  });

  it("keeps a handed-over task distinct from a handed-over record", () => {
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.task_assigned).not.toBe(
      NOTIF_TYPE_FALLBACK_SOUNDS.record_assigned,
    );
  });

  it("plays Pulse audio in a hidden tab and silences the OS ding", () => {
    const root = path.resolve(__dirname, "..");
    const toasts = readFileSync(path.join(root, "src/hooks/useNotificationToasts.ts"), "utf8");
    const engine = readFileSync(path.join(root, "src/lib/notification-sounds.ts"), "utf8");
    expect(toasts).toMatch(/if \(soundOn\) \{\s*playScheduled/);
    expect(toasts).toMatch(/silent = true/);
    expect(toasts).toMatch(/urgent, true/);
    expect(engine).toContain("notifAudio.volume = 0");
    expect(engine).toContain("stopActiveSound();");
    expect(engine).toContain("htmlAudio.adoptClone(sound, started)");
  });

  it("includes follow-up due in the type tables so the picker can name it", () => {
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.follow_up_due).toBe("lantern");
    expect(ALL_TYPES.some((t) => t.key === "follow_up_due")).toBe(true);
  });

  it("gives both 'someone needs a human' alerts the carrying sound", () => {
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.meddy_human_requested).toBe("beacon");
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.support_human_requested).toBe("beacon");
    // A visitor left waiting five minutes is an escalation too.
    expect(NOTIF_TYPE_FALLBACK_SOUNDS.meddy_missed_chat).toBe("beacon");
  });
});
