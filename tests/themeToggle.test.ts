// The top-bar theme toggle (Nathan 8/19): flips light/dark in place from
// the account menu, no page change, no Settings detour.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (relative: string) =>
  readFileSync(path.resolve(__dirname, "..", relative), "utf8");

describe("top-bar theme toggle", () => {
  it("lives in the account menu beside the name, as a real switch", () => {
    const menu = read("src/components/layout/UserMenu.tsx");
    expect(menu).toMatch(/useTheme/);
    expect(menu).toMatch(/role="switch"/);
    expect(menu).toMatch(/aria-checked=\{isDark\}/);
    // The flip is always an EXPLICIT light or dark — never back to
    // "system" (that three-way choice stays in My Settings).
    expect(menu).toMatch(/isDark \? "light" : "dark"/);
    expect(menu).not.toMatch(/setMode\("system"\)/);
  });

  it("animates via a guarded view transition (no crash without support)", () => {
    const menu = read("src/components/layout/UserMenu.tsx");
    expect(menu).toMatch(/typeof doc\.startViewTransition === "function"/);
    expect(menu).toMatch(/flushSync/);
    // Fallback path still flips the theme.
    expect(menu).toMatch(/else \{\s*setMode\(next\);/);
  });
});
