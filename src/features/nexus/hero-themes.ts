// Hero look presets for the briefing (Customize mode, docket C2 round 4).
//
// Four curated gradients, picked from swatches inside Customize and kept
// per user in localStorage. There is no server column for this on purpose:
// it is pure decoration, it should feel instant, and a per-browser choice
// is fine for a preference nobody else can see.
//
// Every preset ships two gradients. The dark one runs under the app's dark
// theme (light text on a deep field); the light one is the same hue family
// dialed down to a pale wash so the normal foreground colors stay readable.
// Which one shows is decided in CSS by the `dark` class, not in JS, so a
// theme switch never needs a re-render.
//
// Evergreen is the default and is the richer teal-navy from the approved
// demo (docs/nexus/nexus-transition-guide.html).

import { useCallback, useEffect, useState } from "react";

export const HERO_THEME_IDS = ["evergreen", "ocean", "sunset", "slate"] as const;
export type HeroThemeId = (typeof HERO_THEME_IDS)[number];

export const DEFAULT_HERO_THEME: HeroThemeId = "evergreen";

export interface HeroTheme {
  id: HeroThemeId;
  label: string;
  /** CSS background-image for the dark theme. */
  dark: string;
  /** CSS background-image for the light theme. */
  light: string;
}

export const HERO_THEMES: HeroTheme[] = [
  {
    id: "evergreen",
    label: "Evergreen",
    dark: "linear-gradient(120deg, #12233d 0%, #0f2c33 60%, #103528 100%)",
    light: "linear-gradient(120deg, #e9f0fa 0%, #e4f2ef 58%, #e7f4e9 100%)",
  },
  {
    id: "ocean",
    label: "Ocean",
    dark: "linear-gradient(120deg, #0c1b30 0%, #102a4a 58%, #0e3b56 100%)",
    light: "linear-gradient(120deg, #e8f0fb 0%, #e2ecfa 58%, #e3f2fa 100%)",
  },
  {
    id: "sunset",
    label: "Sunset",
    dark: "linear-gradient(120deg, #2b1830 0%, #3f2027 58%, #4a2c1b 100%)",
    light: "linear-gradient(120deg, #fbeef3 0%, #fbe9e7 58%, #fbf0e2 100%)",
  },
  {
    id: "slate",
    label: "Slate",
    dark: "linear-gradient(120deg, #191e29 0%, #202634 58%, #232d3c 100%)",
    light: "linear-gradient(120deg, #f0f2f6 0%, #eaeef4 58%, #edf1f6 100%)",
  },
];

export function getHeroTheme(id: HeroThemeId | null | undefined): HeroTheme {
  return (
    HERO_THEMES.find((t) => t.id === id) ??
    HERO_THEMES.find((t) => t.id === DEFAULT_HERO_THEME)!
  );
}

export function heroThemeKey(userId: string): string {
  return `nexus_hero_theme:${userId}`;
}

function isHeroThemeId(value: unknown): value is HeroThemeId {
  return HERO_THEME_IDS.includes(value as HeroThemeId);
}

export function readHeroTheme(userId: string | undefined): HeroThemeId {
  if (!userId || typeof window === "undefined") return DEFAULT_HERO_THEME;
  try {
    const raw = window.localStorage.getItem(heroThemeKey(userId));
    return isHeroThemeId(raw) ? raw : DEFAULT_HERO_THEME;
  } catch {
    return DEFAULT_HERO_THEME;
  }
}

// The picker and the hero are different branches of the tree, so a change
// has to reach both. One module-level subscriber set is enough for that
// and keeps this out of react-query, which has nothing to fetch here.
const listeners = new Set<() => void>();

export function writeHeroTheme(
  userId: string | undefined,
  id: HeroThemeId,
): void {
  if (userId && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(heroThemeKey(userId), id);
    } catch {
      // Storage blocked. The choice still applies for this page view.
    }
  }
  for (const fn of listeners) fn();
}

/** The signed-in user's hero preset, plus a setter that fans out. */
export function useHeroTheme(
  userId: string | undefined,
): [HeroThemeId, (id: HeroThemeId) => void] {
  const [id, setId] = useState<HeroThemeId>(() => readHeroTheme(userId));

  useEffect(() => {
    setId(readHeroTheme(userId));
    const onChange = () => setId(readHeroTheme(userId));
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [userId]);

  const set = useCallback(
    (next: HeroThemeId) => {
      writeHeroTheme(userId, next);
    },
    [userId],
  );

  return [id, set];
}
