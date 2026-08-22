// Behavioral tests for the shared audience-draft content validator.
// These call validateAudienceDraft directly with crafted payloads.

import { describe, it, expect } from "vitest";
import { validateAudienceDraft, type AudienceDraftPayload } from "../supabase/functions/_shared/audience-spec";

/** Build a valid 3-email payload for mutation tests. */
function validPayload(): AudienceDraftPayload {
  return {
    campaign_name: "Test Campaign",
    target_audience: "Rural hospitals in MN",
    sequence: [
      {
        seq_number: 1, delay_days: 0,
        subject: "HIPAA compliance for your organization",
        body_html: "<p>Hi [[First name]],</p><p>We help healthcare organizations like [[Organization]] stay compliant.</p><p>[[Signature]]</p>",
      },
      {
        seq_number: 2, delay_days: 3,
        subject: "A quick follow-up",
        body_html: "<p>Hi [[First name]],</p><p>Just checking in about your compliance needs.</p><p>[[Signature]]</p>",
      },
      {
        seq_number: 3, delay_days: 4,
        subject: "One more thought",
        body_html: "<p>Hi [[First name]],</p><p>We would love to help. Visit medcurity.com to learn more.</p><p>[[Signature]]</p>",
      },
    ],
  };
}

function mutate(overrides: { emailIdx?: number; fields?: Record<string, unknown>; topFields?: Record<string, unknown> }): AudienceDraftPayload {
  const p = validPayload();
  if (overrides.topFields) Object.assign(p, overrides.topFields);
  if (overrides.emailIdx !== undefined && overrides.fields) {
    Object.assign((p.sequence as Record<string, unknown>[])[overrides.emailIdx], overrides.fields);
  }
  return p;
}

describe("validateAudienceDraft: valid baseline", () => {
  it("returns empty array for a valid payload", () => {
    expect(validateAudienceDraft(validPayload())).toEqual([]);
  });
});

describe("validateAudienceDraft: top-level fields", () => {
  it("rejects empty campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "" } }));
    expect(e.some((s) => s.includes("campaign_name"))).toBe(true);
  });
  it("rejects overlong campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "x".repeat(201) } }));
    expect(e.some((s) => s.includes("200"))).toBe(true);
  });
  it("rejects wrong sequence length", () => {
    const p = validPayload(); (p.sequence as unknown[]).pop();
    expect(validateAudienceDraft(p).some((s) => s.includes("exactly 3"))).toBe(true);
  });
});

describe("validateAudienceDraft: timing", () => {
  it("rejects first email with nonzero delay", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { delay_days: 1 } }));
    expect(e.some((s) => s.includes("first email delay_days must be 0"))).toBe(true);
  });
  it("rejects follow-up delay outside 3-4 range", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 1, fields: { delay_days: 7 } }));
    expect(e.some((s) => s.includes("follow-up delay_days must be 3-4"))).toBe(true);
  });
  it("accepts follow-up delay of exactly 3", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 1, fields: { delay_days: 3 } }))).toEqual([]);
  });
  it("accepts follow-up delay of exactly 4", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 2, fields: { delay_days: 4 } }))).toEqual([]);
  });
});

describe("validateAudienceDraft: subject validation", () => {
  it("rejects subject over 60 characters", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "x".repeat(61) } }));
    expect(e.some((s) => s.includes("exceeds 60"))).toBe(true);
  });
  it("rejects HTML in subject", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Hello <b>world</b>" } }));
    expect(e.some((s) => s.includes("HTML markup"))).toBe(true);
  });
  it("rejects [[Signature]] in subject", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Hi [[Signature]]" } }));
    expect(e.some((s) => s.includes("subject must not contain [[Signature]]"))).toBe(true);
  });
  it("accepts plain text subject under 60 chars", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Quick question about HIPAA" } }))).toEqual([]);
  });
});

describe("validateAudienceDraft: template syntax rejection", () => {
  it("rejects Handlebars {{#if}}", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>{{#if first_name}}Hi {{first_name}},{{else}}Hi there,{{/if}}</p><p>Text.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("{{...}} template"))).toBe(true);
  });
  it("rejects {{variable}} syntax", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>At {{company_name}}</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("{{...}} template"))).toBe(true);
  });
  it("rejects {%...%} syntax", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>{% if x %}y{% endif %}</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("{%...%}"))).toBe(true);
  });
  it("rejects %signature%", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Text</p><p>%signature%</p>',
    } }));
    expect(e.some((s) => s.includes("Smartlead %signature%"))).toBe(true);
  });
  it("rejects ${...} interpolation", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Value: ${name}</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("${...}"))).toBe(true);
  });
  it("rejects unknown [[...]] token", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>At [[Company size]]</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("unknown token [[Company size]]"))).toBe(true);
  });
});

describe("validateAudienceDraft: Markdown rejection", () => {
  it("rejects Markdown link [text](url)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>[Learn more](https://medcurity.com)</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown link"))).toBe(true);
  });
  it("rejects Markdown heading", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p># Heading</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown heading"))).toBe(true);
  });
  it("rejects Markdown code block", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>```code```</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown code block"))).toBe(true);
  });
});

describe("validateAudienceDraft: HTML structure", () => {
  it("rejects <a> tags (v1 no generated links)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p><a href="https://medcurity.com">Click</a></p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("v1 does not allow generated <a> links"))).toBe(true);
  });
  it("rejects <div> tags", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<div>Hi [[First name]],</div><p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("unsupported HTML tag <div>"))).toBe(true);
  });
  it("rejects attributes on <p>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p style="color:red">Hi [[First name]],</p><p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("<p> must not have attributes"))).toBe(true);
  });
  it("rejects attributes on <strong>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p><strong class="x">Bold</strong></p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("<strong> must not have attributes"))).toBe(true);
  });
  it("rejects <script>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><script>alert(1)</script><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("<script>"))).toBe(true);
  });
  it("rejects event-handler attributes", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p onmouseover="alert(1)">Hi [[First name]],</p><p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("event-handler") || s.includes("must not have attributes"))).toBe(true);
  });
  it("rejects javascript: URL", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>javascript:alert(1)</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("javascript:"))).toBe(true);
  });
  it("accepts clean <p>, <strong>, <em>, <br> without attributes", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>We offer <strong>great</strong> <em>compliance</em> help.<br>Visit medcurity.com.</p><p>[[Signature]]</p>',
    } }))).toEqual([]);
  });
});

describe("validateAudienceDraft: signature", () => {
  it("rejects missing [[Signature]]", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Text</p>',
    } }));
    expect(e.some((s) => s.includes("missing [[Signature]]"))).toBe(true);
  });
  it("rejects duplicate [[Signature]]", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>[[Signature]]</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("exactly one required"))).toBe(true);
  });
  it("rejects [[Signature]] not in exact final <p>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Text [[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("exact final <p>[[Signature]]</p>"))).toBe(true);
  });
  it("accepts [[Signature]] in exact final <p>[[Signature]]</p>", () => {
    expect(validateAudienceDraft(validPayload())).toEqual([]);
  });
});

describe("validateAudienceDraft: greeting", () => {
  it("rejects first email without [[First name]] greeting", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hello there,</p><p>Text.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("[[First name]] greeting"))).toBe(true);
  });
  it("accepts first email with [[First name]] in opening paragraph", () => {
    expect(validateAudienceDraft(validPayload())).toEqual([]);
  });
});

describe("validateAudienceDraft: word count", () => {
  it("rejects first email over 150 words", () => {
    const longBody = '<p>Hi [[First name]],</p><p>' + "word ".repeat(151) + '</p><p>[[Signature]]</p>';
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { body_html: longBody } }));
    expect(e.some((s) => s.includes("limit is 150"))).toBe(true);
  });
  it("rejects follow-up over 100 words", () => {
    const longBody = '<p>Hi [[First name]],</p><p>' + "word ".repeat(101) + '</p><p>[[Signature]]</p>';
    const e = validateAudienceDraft(mutate({ emailIdx: 1, fields: { body_html: longBody } }));
    expect(e.some((s) => s.includes("limit is 100"))).toBe(true);
  });
});

describe("validateAudienceDraft: factual integrity claims", () => {
  it("rejects '1,000+ healthcare organizations'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>We work with 1,000+ healthcare organizations.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("quantitative social-proof"))).toBe(true);
  });
  it("rejects 'serving 500 customers'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Serving 500 customers nationwide.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("quantitative social-proof"))).toBe(true);
  });
  it("rejects '25% improvement'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Achieve 25% improvement in compliance.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("percentage claim"))).toBe(true);
  });
  it("rejects 'guaranteed results'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>We guarantee results.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("guarantee/certification"))).toBe(true);
  });
  it("rejects 'ensures compliance'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Our SRA ensures compliance with HIPAA.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("guarantee/certification"))).toBe(true);
  });
  it("rejects 'proven track record'", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Proven track record in healthcare.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("guarantee/certification"))).toBe(true);
  });
  it("rejects 'act now' urgency", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Act now before the deadline.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("urgency/deadline"))).toBe(true);
  });
  it("allows 'healthcare organizations like yours' (no number)", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>We help healthcare organizations like yours.</p><p>[[Signature]]</p>',
    } }))).toEqual([]);
  });
});

describe("validateAudienceDraft: UI provenance", () => {
  it("AiAudienceFlow shows 'Interpreted by Pulse AI', not raw model id", () => {
    const flow = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "src/features/playbook/AiAudienceFlow.tsx"), "utf8",
    );
    expect(flow).toContain("Interpreted by Pulse AI");
    expect(flow).not.toContain("interpretation.model_id");
    expect(flow).not.toContain("claude-sonnet");
  });

  it("model_id is still stored in audit data (interpretation record)", () => {
    const migration = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "supabase/migrations/20260822020000_campaign_audience_provenance.sql"), "utf8",
    );
    expect(migration).toContain("model_id");
    expect(migration).toContain("p_model_id");
  });
});

describe("validateAudienceDraft: returns all errors, not just first", () => {
  it("multiple violations produce multiple error strings", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      subject: "x".repeat(61),
      body_html: '<p>Hello,</p><p>We serve 1,000+ organizations. Act now!</p>',
    } }));
    expect(e.length).toBeGreaterThan(2);
  });
});
