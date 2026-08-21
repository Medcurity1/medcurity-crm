// Which sound plays for which notification — the pure decision layer.
//
// Deliberately free of browser APIs (no Audio, no AudioContext, no
// document) so it can be unit-tested in node and imported anywhere.
// The synthesis engine that turns these names into noise lives in
// notification-sounds.ts, which re-exports everything here.

/** The six sounds a user can pick (2026-08-18 refresh, Nathan's picks).
 * Every one replaced a specific older sound — see SOUND_ALIASES. */
export const KEPT_SOUNDS = new Set(["felt", "quill", "lantern", "musicbox", "bloom", "beacon"]);

/** Old sound name → the new sound that took over its slot.
 *
 * Nothing is ever silently dropped: every name the engine has ever
 * shipped (the 2026-06-12 seven, the four Nexus originals, and the
 * names retired before them) maps onto one of the six current sounds,
 * so a preference saved months ago keeps working and simply plays the
 * better sound that replaced it. Never delete an entry from this map —
 * a user's saved value can outlive any release.
 *
 * The six straight swaps (Nathan, 2026-08-18):
 *   marimba → lantern, bubble → bloom, drop → quill,
 *   horn → felt, doorbell → beacon, glass → musicbox
 * `knock` was retired outright (six new sounds for seven old ones); it
 * lands on felt, the quietest of the new set, which is what people who
 * chose Knock were after. */
export const SOUND_ALIASES: Record<string, string> = {
  // The seven that were in the picker until 2026-08-18.
  marimba: "lantern",
  bubble: "bloom",
  drop: "quill",
  horn: "felt",
  doorbell: "beacon",
  glass: "musicbox",
  knock: "felt",
  // Retired at the 2026-06-12 audition; saved prefs can still name them.
  chime: "musicbox",
  bell: "beacon",
  urgent: "beacon",
  soft: "felt",
  melody: "bloom",
  pulse: "quill",
  ringbell: "lantern",
  ding: "musicbox",
  twinkle: "musicbox",
  echo: "quill",
  // Auditioned 2026-08-18 but never shipped — mapped so that even a
  // hand-edited or half-migrated preference resolves to a real sound.
  rise: "bloom",
  halo: "felt",
  hush: "felt",
  kalimba: "lantern",
  ripple: "quill",
  pebble: "quill",
  sonar: "beacon",
  tide: "felt",
  clave: "beacon",
  bounce: "bloom",
};

/** Used when no sound is named at all: an unknown notification type, a
 * bare preview call, or an unrecognised saved value. Lantern is the
 * gentlest of the six that still reads as a deliberate alert. */
export const DEFAULT_SOUND = "lantern";

/** Resolve any sound name — current, retired, or unknown — to one of
 * the six the engine can actually play. */
export function canonicalSound(soundType: string | undefined | null): string {
  if (!soundType) return DEFAULT_SOUND;
  if (KEPT_SOUNDS.has(soundType)) return soundType;
  return SOUND_ALIASES[soundType] || DEFAULT_SOUND;
}

/** Runtime fallback sound per type when the user never chose one.
 * Mirrors `defSound` on each type in features/notifications/prefs-api.ts
 * — keep the two in sync. */
export const NOTIF_TYPE_FALLBACK_SOUNDS: Record<string, string> = {
  meddy_new_chat: "bloom",
  meddy_human_requested: "beacon",
  meddy_buying_intent: "musicbox",
  // Nobody answered a waiting visitor — an escalation, so it gets the
  // carrying sound rather than the discreet one Knock used to give it.
  meddy_missed_chat: "beacon",
  meddy_contact_received: "quill",
  task_due: "lantern",
  renewal_upcoming: "felt",
  // Platform (Meddy Support) escalations — same urgency as website.
  support_human_requested: "beacon",
  support_new_chat: "bloom",
  // A teammate high-fived your closed deal — happy little sparkle.
  deal_high_five: "musicbox",
  // Hand-offs (survey T5). These stay deliberately DIFFERENT from each
  // other, and task_assigned stays different from task_due, so a task
  // someone gave you never sounds like your own task coming due.
  record_assigned: "quill",
  task_assigned: "felt",
  follow_up_due: "lantern",
  // A task nag, so it sounds like the task family.
  assessor_needed: "lantern",
};

/** Saved seconds value → repeat-duration bucket (Nexus index.html:12239). */
export function durationTypeFromSeconds(durVal: number): string {
  return durVal >= 30 ? "persistent" : durVal >= 10 ? "long" : durVal >= 5 ? "medium" : "short";
}

/** What to actually play for a notification type, given whatever the
 * user has saved. A saved name that no longer exists resolves through
 * SOUND_ALIASES to the sound that replaced it; anything unrecognised
 * falls back to the type's default rather than going silent. */
export function resolveNotifSound(typeKey: string, savedSound: string | undefined): string {
  if (savedSound) {
    if (KEPT_SOUNDS.has(savedSound)) return savedSound;
    const alias = SOUND_ALIASES[savedSound];
    if (alias) return alias;
  }
  return NOTIF_TYPE_FALLBACK_SOUNDS[typeKey] || DEFAULT_SOUND;
}
