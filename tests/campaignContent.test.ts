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
