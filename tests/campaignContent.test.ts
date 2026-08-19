import { describe, expect, it } from "vitest";
import {
  AUTHOR_TOKENS,
  authorTextToTemplateHtml,
  campaignPreviewHtml,
  hasUnsupportedRichEmailHtml,
  protectCampaignPersonalization,
  templateToAuthorText,
} from "../src/features/playbook/campaign-content";

describe("campaign copy authoring", () => {
  it("shows legacy provider fields as friendly editor tokens", () => {
    expect(templateToAuthorText("<p>Hi {{first_name}},</p><p>At {{company}}.</p><p>{{sender_name}}</p>"))
      .toBe(`Hi ${AUTHOR_TOKENS.firstName},\n\nAt ${AUTHOR_TOKENS.organization}.\n\n${AUTHOR_TOKENS.signature}`);
  });

  it("turns plain paragraphs into safe email HTML", () => {
    expect(authorTextToTemplateHtml("Hello <team>\nline two\n\nThanks"))
      .toBe("<p>Hello &lt;team&gt;<br>line two</p><p>Thanks</p>");
  });

  it("round-trips internal and trailing spaces while typing", () => {
    for (const sample of ["Hello  world", "Hello ", "  Hello", "Hello \nworld "]) {
      expect(templateToAuthorText(authorTextToTemplateHtml(sample))).toBe(sample);
    }
  });

  it("round-trips line breaks and blank lines while typing", () => {
    expect(authorTextToTemplateHtml("Hello\n")).toBe("<p>Hello<br></p>");
    expect(templateToAuthorText(authorTextToTemplateHtml("Hello\n"))).toBe("Hello\n");
    expect(templateToAuthorText(authorTextToTemplateHtml("Hello\nworld"))).toBe("Hello\nworld");
    expect(templateToAuthorText(authorTextToTemplateHtml("Hello\n\nThanks"))).toBe("Hello\n\nThanks");
    expect(templateToAuthorText(authorTextToTemplateHtml("Hello\n\n"))).toBe("Hello\n\n");
  });

  it("treats whitespace-only copy as empty", () => {
    expect(authorTextToTemplateHtml("   ")).toBe("");
    expect(authorTextToTemplateHtml("\n\n")).toBe("");
    expect(authorTextToTemplateHtml(" \n ")).toBe("");
  });

  it("does not trim live author text on every conversion", () => {
    expect(authorTextToTemplateHtml("Hello ")).toBe("<p>Hello </p>");
    expect(authorTextToTemplateHtml("Hello\n")).toBe("<p>Hello<br></p>");
    expect(templateToAuthorText("<p>Hello </p>")).toBe("Hello ");
    expect(templateToAuthorText("<p>Hello<br></p>")).toBe("Hello\n");
  });

  it("adds missing-name and missing-company fallbacks automatically", () => {
    const protectedCopy = protectCampaignPersonalization(
      "Hi {{first_name}}, welcome to {{company}}. {{sender_name}}",
    );
    expect(protectedCopy).toContain("{{#if first_name}}{{first_name}}{{else}}there{{/if}}");
    expect(protectedCopy).toContain("{{#if company_name}}{{company_name}}{{else}}your organization{{/if}}");
    expect(protectedCopy).toContain("%signature%");
    expect(protectedCopy).not.toMatch(/\{\{\s*(company|sender_name)\s*\}\}/i);
  });

  it("does not wrap an existing safe Liquid fallback twice", () => {
    const safe = "Hi {{#if first_name}}{{first_name}}{{else}}there{{/if}},";
    expect(protectCampaignPersonalization(safe)).toBe(safe);
  });

  it("does not double-wrap friendly editor chips", () => {
    const protectedCopy = protectCampaignPersonalization(
      `Hi ${AUTHOR_TOKENS.firstName}, welcome to ${AUTHOR_TOKENS.organization}.`,
    );
    expect(protectedCopy).toBe(
      "Hi {{#if first_name}}{{first_name}}{{else}}there{{/if}}, welcome to " +
      "{{#if company_name}}{{company_name}}{{else}}your organization{{/if}}.",
    );
    expect(protectedCopy.match(/\{\{#if/g)).toHaveLength(2);
  });

  it("preserves user copy that resembles an internal block marker", () => {
    const copy = `Keep __PULSE_LIQUID_BLOCK_0__ literal, then say hi to ${AUTHOR_TOKENS.firstName}.`;
    const protectedCopy = protectCampaignPersonalization(copy);
    expect(protectedCopy).toContain("__PULSE_LIQUID_BLOCK_0__ literal");
    expect(protectedCopy.match(/\{\{#if first_name\}\}/g)).toHaveLength(1);
  });

  it("preserves custom Liquid blocks without rewriting their internals", () => {
    const custom = "{{#if first_name}}Hello {{first_name}}{{else}}Good morning{{/if}}";
    expect(protectCampaignPersonalization(custom)).toBe(custom);
  });

  it("round-trips common rich links and flags unsupported structures", () => {
    const author = templateToAuthorText('<p>Read <a href="https://medcurity.com/info"><strong>the guide</strong></a>.</p>');
    expect(author).toBe("Read [the guide](https://medcurity.com/info).");
    expect(authorTextToTemplateHtml(author)).toContain('<a href="https://medcurity.com/info">the guide</a>');
    expect(hasUnsupportedRichEmailHtml('<p>Fine <a href="https://example.com">link</a></p>')).toBe(false);
    expect(hasUnsupportedRichEmailHtml('<p style="color:red">Styled</p>')).toBe(true);
    expect(hasUnsupportedRichEmailHtml('<a href="https://example.com" target="_blank">Link</a>')).toBe(true);
    expect(hasUnsupportedRichEmailHtml("<ul><li>Item</li></ul>")).toBe(true);
    expect(hasUnsupportedRichEmailHtml("<table><tr><td>Layout</td></tr></table>")).toBe(true);
  });

  it("previews the real sample values and readable fallbacks", () => {
    expect(campaignPreviewHtml("<p>Hi {{first_name}} at {{company}}</p><p>{{sender_name}}</p>", {
      firstName: "Nathan",
      organization: "Medcurity",
    })).toBe("<p>Hi Nathan at Medcurity</p><p>Sender's saved signature appears here</p>");
    expect(campaignPreviewHtml("Hi {{first_name}} at {{company}}"))
      .toBe("<p>Hi there at your organization</p>");
  });
});
