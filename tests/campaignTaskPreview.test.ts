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

  it("renders Smartlead fallback blocks as readable preview text", () => {
    expect(readableTaskPreview(
      "Where the SRA lives at {{#if company_name}}{{company_name}}{{else}}your organization{{/if}}",
    )).toBe("Where the SRA lives at your organization");
    expect(readableTaskPreview(
      "Thanks for connecting, {{#if first_name}}{{first_name}}{{else}}there{{/if}}. Happy to help.",
    )).toBe("Thanks for connecting. Happy to help.");
  });

  it("preserves the prose in custom Smartlead conditional branches", () => {
    const greeting = "{{#if first_name}}Hi {{first_name}},{{else}}Hi there,{{/if}} welcome.";
    expect(readableTaskPreview(greeting)).toBe("Hi there, welcome.");
    expect(readableTaskPreview(greeting, { firstName: "Nathan" })).toBe("Hi Nathan, welcome.");

    const organization = "{{#if company_name}}At {{company_name}}{{else}}For your organization{{/if}}, this helps.";
    expect(readableTaskPreview(organization)).toBe("For your organization, this helps.");
    expect(readableTaskPreview(organization, { organization: "Medcurity" })).toBe("At Medcurity, this helps.");
  });
});
