// Behavioral tests for the shared audience-draft content validator.
// These call validateAudienceDraft directly with crafted payloads.

import { describe, it, expect } from "vitest";
import { validateAudienceDraft, type AudienceDraftPayload } from "../supabase/functions/_shared/audience-spec";
import { renderAudienceDraftEmail, CTA_MAP, SUBJECT_MAP, MESSAGE_MAP, SUBJECT_IDS, MESSAGE_IDS, CTA_IDS } from "../supabase/functions/_shared/playbook-prompts";
import { readFileSync } from "fs";
import path from "path";
const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

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
    expect(e.some((s) => s.includes("contains HTML"))).toBe(true);
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
    expect(e.some((s) => s.includes("contains %signature%"))).toBe(true);
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
  it("rejects Markdown code (inline backtick or fenced)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>```code```</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown code"))).toBe(true);
  });
});

describe("validateAudienceDraft: HTML structure", () => {
  it("rejects <a> tags (v1 no generated links)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p><a href="https://medcurity.com">Click</a></p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("v1 does not allow <a> links"))).toBe(true);
  });
  it("rejects <div> tags", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<div>Hi [[First name]],</div><p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("unsupported tag <div>"))).toBe(true);
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

// ── Release-blocker hardening tests ───────────────────────────────────

describe("validateAudienceDraft: null/primitive sequence entries", () => {
  it("handles null entry without TypeError", () => {
    const p = validPayload();
    (p.sequence as unknown[])[1] = null;
    const e = validateAudienceDraft(p);
    expect(e.some((s) => s.includes("null or not an object"))).toBe(true);
  });
  it("handles number entry without TypeError", () => {
    const p = validPayload();
    (p.sequence as unknown[])[0] = 42;
    const e = validateAudienceDraft(p);
    expect(e.some((s) => s.includes("null or not an object"))).toBe(true);
  });
  it("handles string entry without TypeError", () => {
    const p = validPayload();
    (p.sequence as unknown[])[2] = "bad";
    const e = validateAudienceDraft(p);
    expect(e.some((s) => s.includes("null or not an object"))).toBe(true);
  });
});

describe("validateAudienceDraft: subject control characters", () => {
  it("rejects CR in subject", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Hello\rworld" } }));
    expect(e.some((s) => s.includes("control characters"))).toBe(true);
  });
  it("rejects LF in subject", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Hello\nworld" } }));
    expect(e.some((s) => s.includes("control characters"))).toBe(true);
  });
  it("rejects tab in subject", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: { subject: "Hello\tworld" } }));
    expect(e.some((s) => s.includes("control characters"))).toBe(true);
  });
});

describe("validateAudienceDraft: campaign_name/target_audience safety", () => {
  it("rejects control characters in campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "Bad\x00name" } }));
    expect(e.some((s) => s.includes("control characters"))).toBe(true);
  });
  it("rejects HTML in target_audience", () => {
    const e = validateAudienceDraft(mutate({ topFields: { target_audience: "<script>x</script>" } }));
    expect(e.some((s) => s.includes("contains HTML"))).toBe(true);
  });
});

describe("validateAudienceDraft: HTML structural balance", () => {
  it("rejects unclosed <p>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],<p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("unclosed <p>") || s.includes("unmatched"))).toBe(true);
  });
  it("rejects unmatched </strong>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Text</strong></p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("unmatched </strong>"))).toBe(true);
  });
});

describe("validateAudienceDraft: URL rejection", () => {
  it("rejects https:// URLs in body", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Visit https://example.com</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("contains http(s):// URL"))).toBe(true);
  });
  it("allows plain 'medcurity.com' without scheme", () => {
    expect(validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Visit medcurity.com to learn more.</p><p>[[Signature]]</p>',
    } }))).toEqual([]);
  });
});

describe("validateAudienceDraft: expanded claim coverage", () => {
  it("rejects spelled-out social proof (thousands of organizations)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Trusted by thousands of healthcare organizations.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("spelled-out social-proof"))).toBe(true);
  });
  it("rejects award claims (award-winning)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Our award-winning platform.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("award/ranking"))).toBe(true);
  });
  it("rejects '#1' ranking claim", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>The #1 HIPAA compliance tool.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("award/ranking"))).toBe(true);
  });
  it("rejects any percentage in content", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Save up to 50% on compliance costs.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("percentage claim"))).toBe(true);
  });
  it("rejects capability claims (eliminates breaches)", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Our tool eliminates all breaches.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("capability/outcome"))).toBe(true);
  });
  it("rejects risk-free claim", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Try it risk-free today.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("guarantee/certification"))).toBe(true);
  });
});

describe("validateAudienceDraft: Markdown expanded", () => {
  it("rejects numbered list", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>\n1. First\n2. Second</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown numbered list"))).toBe(true);
  });
  it("rejects blockquote", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>\n> Quote here</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown blockquote"))).toBe(true);
  });
  it("rejects inline backtick code", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Use the `command` here.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown code"))).toBe(true);
  });
  it("rejects Markdown bold **...**", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>This is **important**.</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("Markdown bold"))).toBe(true);
  });
});

describe("SECURITY: generate-audience-draft does not read admin training notes", () => {
  it("prompt function takes no trainingNotesStr parameter", () => {
    const prompts = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "supabase/functions/_shared/playbook-prompts.ts"), "utf8",
    );
    // audienceDraftGenerateSystem() has no parameter
    expect(prompts).toMatch(/export function audienceDraftGenerateSystem\(\):\s*string/);
  });
  it("edge function does not call allTrainingNotes in generate-audience-draft", () => {
    const edgeFn = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "supabase/functions/playbook-ai/index.ts"), "utf8",
    );
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).not.toContain("allTrainingNotes");
    expect(fnBlock).not.toContain("formatTrainingNotes");
  });
});

describe("UX: generation error/retry in CampaignWizard", () => {
  it("shows error state with retry and edit-audience options", () => {
    const wizard = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "src/features/playbook/CampaignWizard.tsx"), "utf8",
    );
    expect(wizard).toContain("genAudienceDraft.isError");
    expect(wizard).toContain("Retry generation");
    expect(wizard).toContain("Edit audience");
    expect(wizard).toContain("audience is still resolved");
  });
});

// ── Structured schema: server rendering ───────────────────────────────

describe("renderAudienceDraftEmail (server rendering)", () => {
  it("produces greeting + body paragraphs + CTA + signature", () => {
    const result = renderAudienceDraftEmail("intro_hipaa_help", "intro_general_hipaa", "reply_to_schedule");
    const html = result.body_html;
    expect(html).toContain("<p>Hi [[First name]],</p>");
    // Body paragraphs come from MESSAGE_MAP
    for (const para of MESSAGE_MAP.intro_general_hipaa.paragraphs) {
      expect(html).toContain(`<p>${para}</p>`);
    }
    // CTA from CTA_MAP
    expect(html).toContain(`<p>${CTA_MAP.reply_to_schedule}</p>`);
    expect(html).toContain("<p>[[Signature]]</p>");
    // Signature is the exact last element
    expect(html).toMatch(/<p>\[\[Signature\]\]<\/p>$/);
  });

  it("server-owned message content is used verbatim", () => {
    const result = renderAudienceDraftEmail("intro_sra_overview", "intro_sra_focused", "visit_medcurity");
    const html = result.body_html;
    // Body paragraphs from MESSAGE_MAP are rendered verbatim (server-owned, no escaping needed)
    for (const para of MESSAGE_MAP.intro_sra_focused.paragraphs) {
      expect(html).toContain(`<p>${para}</p>`);
    }
    // Subject from SUBJECT_MAP is returned verbatim
    expect(result.subject).toBe(SUBJECT_MAP.intro_sra_overview.text);
  });

  it("falls back to default CTA for unknown key", () => {
    const result = renderAudienceDraftEmail("intro_hipaa_help", "intro_general_hipaa", "nonexistent_cta");
    expect(result.body_html).toContain(CTA_MAP.reply_to_learn_more);
  });

  it("server-rendered HTML passes the validator", () => {
    const e1 = renderAudienceDraftEmail("intro_compliance_support", "intro_general_hipaa", "book_a_demo");
    const e2 = renderAudienceDraftEmail("followup_checking_in", "followup_value_add", "reply_to_schedule");
    const e3 = renderAudienceDraftEmail("close_final_thought", "close_soft_ask", "visit_medcurity");
    const payload: AudienceDraftPayload = {
      campaign_name: "HIPAA Outreach",
      target_audience: "Hospitals in MN",
      sequence: [
        { seq_number: 1, delay_days: 0, subject: e1.subject, body_html: e1.body_html },
        { seq_number: 2, delay_days: 3, subject: e2.subject, body_html: e2.body_html },
        { seq_number: 3, delay_days: 4, subject: e3.subject, body_html: e3.body_html },
      ],
    };
    expect(validateAudienceDraft(payload)).toEqual([]);
  });

  it("server-owned paragraphs contain no claims", () => {
    // Since body paragraphs are now server-owned constants, verify none contain
    // quantitative social-proof claims, percentage claims, or guarantee language.
    const claimPatterns = [
      /\d[\d,]*\+?\s*(healthcare|organizations|customers|clients)/i,
      /\d+%/,
      /\bguarantee[sd]?\b/i,
      /\bensures?\b/i,
      /\bproven\b/i,
    ];
    for (const [id, entry] of Object.entries(MESSAGE_MAP)) {
      for (const para of entry.paragraphs) {
        for (const pattern of claimPatterns) {
          expect(pattern.test(para), `MESSAGE_MAP.${id} paragraph "${para}" matches claim pattern ${pattern}`).toBe(false);
        }
      }
    }
  });
});

// ── Root null/primitive ───────────────────────────────────────────────

describe("validateAudienceDraft: root null/primitive", () => {
  it("handles null payload without TypeError", () => {
    expect(validateAudienceDraft(null as unknown as AudienceDraftPayload)).toEqual(["payload is null or not an object"]);
  });
  it("handles undefined payload", () => {
    expect(validateAudienceDraft(undefined as unknown as AudienceDraftPayload)).toEqual(["payload is null or not an object"]);
  });
  it("handles number payload", () => {
    expect(validateAudienceDraft(42 as unknown as AudienceDraftPayload)).toEqual(["payload is null or not an object"]);
  });
  it("handles string payload", () => {
    expect(validateAudienceDraft("bad" as unknown as AudienceDraftPayload)).toEqual(["payload is null or not an object"]);
  });
});

// ── Top-level field safety ────────────────────────────────────────────

describe("validateAudienceDraft: top-level single-line plain text", () => {
  it("rejects URLs in campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "Visit https://evil.com" } }));
    expect(e.some((s) => s.includes("URL/protocol"))).toBe(true);
  });
  it("rejects template tokens in campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "Test {{var}}" } }));
    expect(e.some((s) => s.includes("template syntax"))).toBe(true);
  });
  it("rejects Markdown in target_audience", () => {
    const e = validateAudienceDraft(mutate({ topFields: { target_audience: "## Heading" } }));
    expect(e.some((s) => s.includes("Markdown"))).toBe(true);
  });
  it("rejects newlines in campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "Line1\nLine2" } }));
    expect(e.some((s) => s.includes("single-line"))).toBe(true);
  });
  it("rejects claims in campaign_name", () => {
    const e = validateAudienceDraft(mutate({ topFields: { campaign_name: "Serving 500 hospitals" } }));
    expect(e.some((s) => s.includes("unsupported claim"))).toBe(true);
  });
});

// ── Nested <p> and malformed HTML ─────────────────────────────────────

describe("validateAudienceDraft: strict HTML grammar", () => {
  it("rejects nested <p> tags", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],<p>Nested</p></p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("nested <p>"))).toBe(true);
  });
  it("rejects spaced tag delimiters like < /p>", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],< /p><p>Text</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("malformed spaced tag") || s.includes("unclosed"))).toBe(true);
  });
});

// ── External reference syntax ─────────────────────────────────────────

describe("validateAudienceDraft: external reference rejection", () => {
  it("rejects www. URLs", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Visit www.example.com</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("www."))).toBe(true);
  });
  it("rejects mailto: URLs", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Email mailto:test@example.com</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("mailto:"))).toBe(true);
  });
  it("rejects ftp: URLs", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 0, fields: {
      body_html: '<p>Hi [[First name]],</p><p>Download ftp://files.example.com</p><p>[[Signature]]</p>',
    } }));
    expect(e.some((s) => s.includes("ftp:"))).toBe(true);
  });
});

// ── Continue validating after seq/delay errors ────────────────────────

describe("validateAudienceDraft: continues after structural errors", () => {
  it("reports subject error even when delay_days is wrong", () => {
    const e = validateAudienceDraft(mutate({ emailIdx: 1, fields: { delay_days: 10, subject: "x".repeat(61) } }));
    expect(e.some((s) => s.includes("delay_days"))).toBe(true);
    expect(e.some((s) => s.includes("exceeds 60"))).toBe(true);
  });
});

// ── CTA allowlist ─────────────────────────────────────────────────────

describe("CTA_MAP", () => {
  it("has exactly 4 server-owned CTA options", () => {
    expect(Object.keys(CTA_MAP)).toHaveLength(4);
    expect(CTA_MAP.reply_to_schedule).toBeTruthy();
    expect(CTA_MAP.visit_medcurity).toBeTruthy();
    expect(CTA_MAP.reply_to_learn_more).toBeTruthy();
    expect(CTA_MAP.book_a_demo).toBeTruthy();
  });
});

// ── Edit audience remount ─────────────────────────────────────────────

describe("Edit audience resets AiAudienceFlow to brief entry", () => {
  it("AiAudienceFlow has a key prop driven by nonce for remount", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("key={aiFlowNonce}");
    expect(wizard).toContain("aiFlowNonce");
  });
  it("Edit audience button bumps nonce", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("setAiFlowNonce((n) => n + 1)");
  });
});

// ── Retention fail-closed ─────────────────────────────────────────────

describe("retention migration fail-closed", () => {
  const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
  it("requires pg_cron (raises exception if missing)", () => {
    expect(migration).toContain("raise exception 'pg_cron extension is required");
  });
  it("unschedules idempotently via cron.job lookup, not exception swallowing", () => {
    expect(migration).toContain("select jobname from cron.job");
    expect(migration).not.toMatch(/exception when others then null/);
  });
  it("asserts both jobs exist after scheduling", () => {
    expect(migration).toContain("Failed to schedule audience-provenance-redact-daily");
    expect(migration).toContain("Failed to schedule audience-interpretations-cleanup-daily");
  });
});

// ── Training-note isolation recheck ───────────────────────────────────

describe("training-note isolation", () => {
  it("audienceDraftGenerateSystem takes no parameters (no training notes)", () => {
    const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
    expect(prompts).toMatch(/export function audienceDraftGenerateSystem\(\):\s*string/);
  });
  it("generateAudienceDraft does not reference allTrainingNotes or formatTrainingNotes", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).not.toContain("allTrainingNotes");
    expect(fnBlock).not.toContain("formatTrainingNotes");
  });
  it("admin generate-campaign still uses training notes", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const adminBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateCampaign"),
      edgeFn.indexOf("async function suggestCampaign"),
    );
    expect(adminBlock).toContain("allTrainingNotes");
    expect(adminBlock).toContain("formatTrainingNotes");
  });
});

// ── Structured schema: edge function renders HTML server-side ─────────

describe("generate-audience-draft: structured schema + server rendering", () => {
  it("edge function imports and calls renderAudienceDraftEmail", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("renderAudienceDraftEmail");
    expect(edgeFn).toContain("SUBJECT_MAP");
    expect(edgeFn).toContain("MESSAGE_MAP");
    expect(edgeFn).toContain("CTA_MAP");
  });
  it("edge function validates structured intent fields before rendering", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).toContain("subject_id");
    expect(fnBlock).toContain("message_id");
    expect(fnBlock).toContain("cta_id");
    // Validates the rendered output too
    expect(fnBlock).toContain("validateAudienceDraft");
  });
  it("returns bounded actionable error list (up to 5)", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("validationErrors.slice(0, 5)");
  });
});

// ── ID-only schema: no model prose ────────────────────────────────────

import { validateSafeLabel } from "../supabase/functions/_shared/audience-spec";

describe("ID-only schema: no model prose in output", () => {
  it("all SUBJECT_MAP entries have position 1, 2, or 3", () => {
    for (const [id, entry] of Object.entries(SUBJECT_MAP)) {
      expect([1, 2, 3]).toContain(entry.position);
      expect(entry.text.length).toBeGreaterThan(0);
      expect(entry.text.length).toBeLessThanOrEqual(80);
    }
  });
  it("all MESSAGE_MAP entries have position 1, 2, or 3 with nonempty paragraphs", () => {
    for (const [id, entry] of Object.entries(MESSAGE_MAP)) {
      expect([1, 2, 3]).toContain(entry.position);
      expect(entry.paragraphs.length).toBeGreaterThan(0);
      for (const p of entry.paragraphs) {
        expect(p.length).toBeGreaterThan(0);
      }
    }
  });
  it("each position has at least 3 subject IDs and 3 message IDs", () => {
    for (const pos of [1, 2, 3]) {
      const subjects = SUBJECT_IDS.filter((id) => SUBJECT_MAP[id].position === pos);
      const messages = MESSAGE_IDS.filter((id) => MESSAGE_MAP[id].position === pos);
      expect(subjects.length).toBeGreaterThanOrEqual(3);
      expect(messages.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("server-owned subjects contain no claims or URLs", () => {
    for (const [id, entry] of Object.entries(SUBJECT_MAP)) {
      expect(/\d[\d,]*\+?\s*(?:organizations|customers)/i.test(entry.text)).toBe(false);
      expect(/https?:/i.test(entry.text)).toBe(false);
    }
  });
  it("renderAudienceDraftEmail returns subject from SUBJECT_MAP, not model text", () => {
    const result = renderAudienceDraftEmail("intro_quick_question", "intro_compliance_tools", "book_a_demo");
    expect(result.subject).toBe(SUBJECT_MAP.intro_quick_question.text);
  });
  it("renderAudienceDraftEmail returns body from MESSAGE_MAP, not model text", () => {
    const result = renderAudienceDraftEmail("followup_checking_in", "followup_gentle_reminder", "reply_to_schedule");
    for (const para of MESSAGE_MAP.followup_gentle_reminder.paragraphs) {
      expect(result.body_html).toContain(`<p>${para}</p>`);
    }
  });
  it("prompt tells model to select IDs only, not write prose", () => {
    const prompt = audienceDraftGenerateSystem();
    expect(prompt).toContain("subject_id");
    expect(prompt).toContain("message_id");
    expect(prompt).toContain("cta_id");
    expect(prompt).toContain("You do NOT write any copy");
    expect(prompt).not.toContain("body_paragraphs");
    expect(prompt).not.toContain("body_html");
  });
});

import { audienceDraftGenerateSystem } from "../supabase/functions/_shared/playbook-prompts";

describe("generator root guard", () => {
  it("edge function guards against non-object parse result", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fn = edgeFn.slice(edgeFn.indexOf("const parsed = parseJsonResponse"), edgeFn.indexOf("// ── Validate model-provided labels"));
    expect(fn).toContain("Array.isArray(parsed)");
    expect(fn).toContain("non-object response");
  });
});

describe("validateSafeLabel (behavioral)", () => {
  it("accepts clean short label", () => {
    expect(validateSafeLabel("Hospitals in Minnesota", "test")).toBeNull();
  });
  it("rejects empty", () => {
    expect(validateSafeLabel("", "test")).toContain("empty");
  });
  it("rejects overlong", () => {
    expect(validateSafeLabel("x".repeat(81), "test")).toContain("80");
  });
  it("rejects control chars including newlines", () => {
    expect(validateSafeLabel("line1\nline2", "test")).toContain("control characters");
  });
  it("rejects HTML", () => {
    expect(validateSafeLabel("text <b>bold</b>", "test")).toContain("HTML");
  });
  it("rejects URLs", () => {
    expect(validateSafeLabel("see https://evil.com", "test")).toContain("URL");
  });
  it("rejects bare domains (non-medcurity)", () => {
    expect(validateSafeLabel("visit evil.com/path", "test")).toContain("domain");
  });
  it("rejects email addresses (caught as domain)", () => {
    const result = validateSafeLabel("contact user@example.com", "test");
    expect(result).toBeTruthy();
    // May be caught as domain or email address depending on check order
    expect(result!.includes("domain") || result!.includes("email")).toBe(true);
  });
  it("rejects template syntax", () => {
    expect(validateSafeLabel("Hello {{name}}", "test")).toContain("template");
  });
  it("rejects Markdown syntax", () => {
    expect(validateSafeLabel("this is **bold**", "test")).toContain("Markdown");
  });
  it("rejects stray delimiters", () => {
    expect(validateSafeLabel("test [[ stuff", "test")).toContain("template");
  });
});
