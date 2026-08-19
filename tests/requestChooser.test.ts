import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

describe("Submit Request chooser", () => {
  it("opens the generic action on a chooser instead of a preselected form", () => {
    const provider = read("src", "features", "requests", "RequestDialogProvider.tsx");
    expect(provider).toContain("tab: RequestTab | null");
    expect(provider).toContain("tab: null");
    expect(provider).toContain("tab: tab ?? null");
    expect(provider).not.toContain('tab: "collateral"');
  });

  it("orders the chooser Product, CRM, Collateral and preserves explicit tabs", () => {
    const dialog = read("src", "features", "requests", "RequestDialog.tsx");
    const product = dialog.indexOf('{ value: "product"');
    const crm = dialog.indexOf('{ value: "crm"');
    const collateral = dialog.indexOf('{ value: "collateral"');
    expect(product).toBeGreaterThan(-1);
    expect(product).toBeLessThan(crm);
    expect(crm).toBeLessThan(collateral);
    expect(dialog).toContain('tab === "product"');
    expect(dialog).toContain('tab === "crm"');
    expect(dialog).toContain('tab === "collateral"');
  });

  it("returns to the chooser through the existing discard guard", () => {
    const dialog = read("src", "features", "requests", "RequestDialog.tsx");
    expect(dialog).toContain('aria-label="Back to request types"');
    expect(dialog).toContain("onClick={() => attemptSwitch(null)}");
    expect(dialog).toContain('kind: "switch"; tab: RequestTab | null');
    expect(dialog).toContain("if (dirtyRef.current) setPending");
  });

  it("uses the available dialog height and keeps priority prominent responsively", () => {
    const dialog = read("src", "features", "requests", "RequestDialog.tsx");
    const forms = read("src", "features", "requests", "RequestForms.tsx");
    expect(dialog).toContain("max-h-[min(72vh,680px)]");
    expect(forms).toContain(
      "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem] sm:items-end",
    );
    expect(forms).toContain("sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end");
    expect(forms).toContain('<PrioritySelect className="max-w-none"');
  });
});
