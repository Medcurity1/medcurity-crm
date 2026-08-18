import { describe, expect, it } from "vitest";
import { readableTaskPreview } from "../src/features/playbook/SequenceTimeline";

describe("campaign task previews", () => {
  it("uses the selected recipient and sender when the wizard has them", () => {
    expect(readableTaskPreview(
      "Hi {{first_name}}, this is {{sender_name}} with Medcurity. How does {{company}} handle this? Call me at {{phone}}.",
      {
        firstName: "Nathan",
        organization: "Design I.T. Solutions",
        senderName: "Summer Hume",
        phone: "509.867.3646",
      },
    )).toBe(
      "Hi Nathan, this is Summer Hume with Medcurity. How does Design I.T. Solutions handle this? Call me at 509.867.3646.",
    );
  });

  it("shows natural fallback prose instead of raw or awkward merge tokens", () => {
    const preview = readableTaskPreview(
      "Hi [[First name]], this is [[Signature]] with Medcurity. I have a question about [[Organization]]. My number is [[Work phone]].",
    );
    expect(preview).toBe(
      "Hi there, this is the assigned rep with Medcurity. I have a question about your organization. My number is the rep's saved work phone.",
    );
    expect(preview).not.toMatch(/\{\{|\[\[|the contact|this is you/);
  });

  it("matches spawned-task identity fallback when a selected contact has no first name", () => {
    expect(readableTaskPreview("Call {{first_name}}", { recipientEmail: "office@example.com" }))
      .toBe("Call office@example.com");
  });
});
