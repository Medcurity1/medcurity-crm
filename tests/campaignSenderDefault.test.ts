import { describe, expect, it } from "vitest";
import { defaultSenderForUser, senderDisplayLabel } from "../src/features/playbook/sender-default";

const accounts = [
  { id: 20367956, from_name: "Medcurity News", from_email: "news@accessmedcurity.com" },
  { id: 11216496, from_name: "Summer Hume", from_email: "summerh@medcurityco.com" },
  { id: 2955119, from_name: "Summer Hume", from_email: "summerh@medcurity.com" },
  { id: 7145804, from_name: "Molly Miller", from_email: "mollym@medcurity.com" },
  { id: 3657983, from_name: "Joe Gellatly", from_email: "joeg@medcurity.com" },
];

describe("Campaign sender defaults", () => {
  it.each([
    ["joeg@medcurity.com", 3657983],
    ["mollym@medcurity.com", 7145804],
    ["summerh@medcurity.com", 2955119],
    ["nathang@medcurity.com", 20367956],
    ["jordanm@medcurity.com", 20367956],
  ])("maps %s to the approved account", (email, id) => {
    expect(defaultSenderForUser(email, accounts)?.id).toBe(id);
  });

  it("fails closed for an unmatched user", () => {
    expect(defaultSenderForUser("someone@medcurity.com", accounts)).toBeNull();
  });

  it("fails closed when the pinned account email no longer matches", () => {
    expect(defaultSenderForUser("summerh@medcurity.com", [
      { id: 2955119, from_email: "unexpected@medcurity.com" },
    ])).toBeNull();
  });

  it("labels the shared account transparently", () => {
    expect(senderDisplayLabel(accounts[0])).toBe(
      "Medcurity News (shared) · news@accessmedcurity.com",
    );
  });
});
