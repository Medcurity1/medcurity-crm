import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const banner = readFileSync(
  path.resolve(__dirname, "..", "src/components/AnnouncementBanner.tsx"),
  "utf8",
);

describe("announcement banner mobile layout", () => {
  it("stacks copy above the action on small screens and keeps the desktop row", () => {
    expect(banner).toContain("flex flex-col gap-3 sm:flex-row sm:items-center");
    expect(banner).toContain("w-full");
    expect(banner).toContain("sm:w-auto sm:shrink-0");
    expect(banner).toContain("sm:truncate sm:text-sm");
  });

  it("keeps dismiss out of the mobile text column", () => {
    expect(banner).toContain('aria-label="Dismiss"');
    expect(banner).toContain("absolute right-2 top-2");
    expect(banner).toContain("sm:static sm:shrink-0");
    expect(banner).toContain("pr-10");
    expect(banner).toContain("sm:pr-4");
  });

  it("has no user-visible em dashes in the launch copy or chrome", () => {
    const runtime = banner
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(runtime).not.toMatch(/—/);
    expect(banner).toContain('title: "Campaigns is now open to everyone"');
    expect(banner).toContain('ctaLabel: "Open Campaigns"');
  });
});
