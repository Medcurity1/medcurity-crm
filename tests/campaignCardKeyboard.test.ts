import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { shouldActivateCardKey } from "../src/features/playbook/campaign-card-keyboard";

function node(matchesSelector: (selector: string) => boolean) {
  const self = {
    closest(selector: string) {
      return matchesSelector(selector) ? self : null;
    },
  };
  return self;
}

describe("campaign card keyboard isolation", () => {
  it("activates the card itself on Enter and Space", () => {
    const card = node(() => false);
    expect(shouldActivateCardKey({ key: "Enter", target: card as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(true);
    expect(shouldActivateCardKey({ key: " ", target: card as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(true);
  });

  it("ignores Space and Enter originating from subject/body editors", () => {
    const card = node(() => false);
    const subject = node((sel) => sel.includes("input"));
    const body = node((sel) => sel.includes("textarea"));
    expect(shouldActivateCardKey({ key: " ", target: subject as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
    expect(shouldActivateCardKey({ key: "Enter", target: subject as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
    expect(shouldActivateCardKey({ key: " ", target: body as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
  });

  it("ignores keys from nested buttons, links, and contenteditable fields", () => {
    const card = node(() => false);
    const button = node((sel) => sel.includes("button"));
    const link = node((sel) => /(^|,)a(,|$)/.test(sel.replace(/\s/g, "")));
    const editor = node((sel) => sel.includes("[contenteditable]"));
    expect(shouldActivateCardKey({ key: " ", target: button as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
    expect(shouldActivateCardKey({ key: "Enter", target: link as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
    expect(shouldActivateCardKey({ key: " ", target: editor as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
  });

  it("does not treat unrelated keys as activation", () => {
    const card = node(() => false);
    expect(shouldActivateCardKey({ key: "a", target: card as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
    expect(shouldActivateCardKey({ key: "Escape", target: card as unknown as EventTarget, currentTarget: card as unknown as EventTarget })).toBe(false);
  });

  it("wires the helper into CampaignCard so descendant spaces are not cancelled", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/features/playbook/CampaignCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/shouldActivateCardKey/);
    expect(source).toMatch(/if \(!shouldActivateCardKey\(e\)\) return;/);
  });
});
