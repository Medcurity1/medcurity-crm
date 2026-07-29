// Nexus hero look presets. Two things worth pinning: every preset ships
// both a light and a dark gradient (a preset that only styled one theme
// would be unreadable in the other), and an unknown or missing stored
// value falls back to Evergreen rather than to nothing.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_HERO_THEME,
  HERO_THEMES,
  HERO_THEME_IDS,
  getHeroTheme,
} from "../src/features/nexus/hero-themes";

describe("hero themes", () => {
  it("ships all four presets", () => {
    expect(HERO_THEMES.map((t) => t.id)).toEqual([...HERO_THEME_IDS]);
    expect(HERO_THEMES).toHaveLength(4);
  });

  it("gives every preset a light and a dark gradient", () => {
    for (const theme of HERO_THEMES) {
      expect(theme.light).toMatch(/^linear-gradient\(/);
      expect(theme.dark).toMatch(/^linear-gradient\(/);
      expect(theme.light).not.toEqual(theme.dark);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });

  it("defaults to Evergreen, including for junk values", () => {
    expect(DEFAULT_HERO_THEME).toBe("evergreen");
    expect(getHeroTheme(null).id).toBe("evergreen");
    expect(getHeroTheme(undefined).id).toBe("evergreen");
    // Deliberately not a HeroThemeId: a stale localStorage value.
    expect(getHeroTheme("neon" as never).id).toBe("evergreen");
  });

  it("keeps the approved Evergreen dark gradient", () => {
    expect(getHeroTheme("evergreen").dark).toContain("#12233d");
    expect(getHeroTheme("evergreen").dark).toContain("#0f2c33");
    expect(getHeroTheme("evergreen").dark).toContain("#103528");
  });
});
