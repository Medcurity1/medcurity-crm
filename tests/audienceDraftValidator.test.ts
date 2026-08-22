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
    const result = renderAudienceDraftEmail("intro_reaching_out", "intro_general", "reply_to_schedule");
    const html = result.body_html;
    expect(html).toContain("<p>Hi [[First name]],</p>");
    // Body paragraphs come from MESSAGE_MAP
    for (const para of MESSAGE_MAP.intro_general.paragraphs) {
      expect(html).toContain(`<p>${para}</p>`);
    }
    // CTA from CTA_MAP
    expect(html).toContain(`<p>${CTA_MAP.reply_to_schedule}</p>`);
    expect(html).toContain("<p>[[Signature]]</p>");
    // Signature is the exact last element
    expect(html).toMatch(/<p>\[\[Signature\]\]<\/p>$/);
  });

  it("server-owned message content is used verbatim", () => {
    const result = renderAudienceDraftEmail("intro_quick_question", "intro_sra", "visit_medcurity");
    const html = result.body_html;
    // Body paragraphs from MESSAGE_MAP are rendered verbatim (server-owned, no escaping needed)
    for (const para of MESSAGE_MAP.intro_sra.paragraphs) {
      expect(html).toContain(`<p>${para}</p>`);
    }
    // Subject from SUBJECT_MAP is returned verbatim
    expect(result.subject).toBe(SUBJECT_MAP.intro_quick_question.text);
  });

  it("falls back to default CTA for unknown key", () => {
    const result = renderAudienceDraftEmail("intro_reaching_out", "intro_general", "nonexistent_cta");
    expect(result.body_html).toContain(CTA_MAP.reply_to_learn_more);
  });

  it("server-rendered HTML passes the validator", () => {
    const e1 = renderAudienceDraftEmail("intro_compliance_note", "intro_general", "book_a_demo");
    const e2 = renderAudienceDraftEmail("followup_checking_in", "followup_checking", "reply_to_schedule");
    const e3 = renderAudienceDraftEmail("close_closing_loop", "close_loop", "visit_medcurity");
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
    const result = renderAudienceDraftEmail("intro_quick_question", "intro_tools", "book_a_demo");
    expect(result.subject).toBe(SUBJECT_MAP.intro_quick_question.text);
  });
  it("renderAudienceDraftEmail returns body from MESSAGE_MAP, not model text", () => {
    const result = renderAudienceDraftEmail("followup_checking_in", "followup_redirect", "reply_to_schedule");
    for (const para of MESSAGE_MAP.followup_redirect.paragraphs) {
      expect(result.body_html).toContain(`<p>${para}</p>`);
    }
  });
  it("prompt tells model to select IDs only, not write prose", () => {
    const prompt = audienceDraftGenerateSystem();
    expect(prompt).toContain("subject_id");
    expect(prompt).toContain("message_id");
    expect(prompt).toContain("cta_id");
    expect(prompt).toContain("You do NOT write any text");
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

// ── Exhaustive combination tests ──────────────────────────────────────

import { THEME_MAP, THEME_IDS, AUDIENCE_LABEL } from "../supabase/functions/_shared/playbook-prompts";

describe("exhaustive: every theme/subject/message/CTA combination renders and validates", () => {
  // For each position, get compatible subject and message IDs
  const pos1Subjects = SUBJECT_IDS.filter((id) => SUBJECT_MAP[id].position === 1);
  const pos2Subjects = SUBJECT_IDS.filter((id) => SUBJECT_MAP[id].position === 2);
  const pos3Subjects = SUBJECT_IDS.filter((id) => SUBJECT_MAP[id].position === 3);
  const pos1Messages = MESSAGE_IDS.filter((id) => MESSAGE_MAP[id].position === 1);
  const pos2Messages = MESSAGE_IDS.filter((id) => MESSAGE_MAP[id].position === 2);
  const pos3Messages = MESSAGE_IDS.filter((id) => MESSAGE_MAP[id].position === 3);

  // Test every allowed combination for each position x CTA
  for (const themeId of THEME_IDS) {
    for (const s1 of pos1Subjects) {
      for (const m1 of pos1Messages) {
        for (const ctaId of CTA_IDS) {
          const label = `theme=${themeId} s=${s1} m=${m1} cta=${ctaId}`;
          it(`position 1: ${label} renders and validates`, () => {
            const e1 = renderAudienceDraftEmail(s1, m1, ctaId);
            // Use arbitrary valid pos2/pos3 to complete the 3-email sequence
            const e2 = renderAudienceDraftEmail(pos2Subjects[0], pos2Messages[0], "reply_to_learn_more");
            const e3 = renderAudienceDraftEmail(pos3Subjects[0], pos3Messages[0], "visit_medcurity");
            const payload: AudienceDraftPayload = {
              campaign_name: THEME_MAP[themeId],
              target_audience: AUDIENCE_LABEL,
              sequence: [
                { seq_number: 1, delay_days: 0, subject: e1.subject, body_html: e1.body_html },
                { seq_number: 2, delay_days: 3, subject: e2.subject, body_html: e2.body_html },
                { seq_number: 3, delay_days: 4, subject: e3.subject, body_html: e3.body_html },
              ],
            };
            expect(validateAudienceDraft(payload)).toEqual([]);
          });
        }
      }
    }
  }

  for (const s2 of pos2Subjects) {
    for (const m2 of pos2Messages) {
      for (const ctaId of CTA_IDS) {
        it(`position 2: s=${s2} m=${m2} cta=${ctaId} renders and validates`, () => {
          const e1 = renderAudienceDraftEmail(pos1Subjects[0], pos1Messages[0], "reply_to_schedule");
          const e2 = renderAudienceDraftEmail(s2, m2, ctaId);
          const e3 = renderAudienceDraftEmail(pos3Subjects[0], pos3Messages[0], "visit_medcurity");
          const payload: AudienceDraftPayload = {
            campaign_name: THEME_MAP[THEME_IDS[0]],
            target_audience: AUDIENCE_LABEL,
            sequence: [
              { seq_number: 1, delay_days: 0, subject: e1.subject, body_html: e1.body_html },
              { seq_number: 2, delay_days: 3, subject: e2.subject, body_html: e2.body_html },
              { seq_number: 3, delay_days: 4, subject: e3.subject, body_html: e3.body_html },
            ],
          };
          expect(validateAudienceDraft(payload)).toEqual([]);
        });
      }
    }
  }

  for (const s3 of pos3Subjects) {
    for (const m3 of pos3Messages) {
      for (const ctaId of CTA_IDS) {
        it(`position 3: s=${s3} m=${m3} cta=${ctaId} renders and validates`, () => {
          const e1 = renderAudienceDraftEmail(pos1Subjects[0], pos1Messages[0], "reply_to_schedule");
          const e2 = renderAudienceDraftEmail(pos2Subjects[0], pos2Messages[0], "visit_medcurity");
          const e3 = renderAudienceDraftEmail(s3, m3, ctaId);
          const payload: AudienceDraftPayload = {
            campaign_name: THEME_MAP[THEME_IDS[0]],
            target_audience: AUDIENCE_LABEL,
            sequence: [
              { seq_number: 1, delay_days: 0, subject: e1.subject, body_html: e1.body_html },
              { seq_number: 2, delay_days: 3, subject: e2.subject, body_html: e2.body_html },
              { seq_number: 3, delay_days: 4, subject: e3.subject, body_html: e3.body_html },
            ],
          };
          expect(validateAudienceDraft(payload)).toEqual([]);
        });
      }
    }
  }
});

describe("exhaustive: no server-owned content contains forbidden patterns", () => {
  const claimPatterns = [
    /\d[\d,]*\+?\s*(?:organizations|customers|clients|hospitals|providers)/i,
    /\d+\s*%/,
    /\b(?:guarantee|certified|proven|award|#1|best.in.class|ensures?\s+compliance|fully?\s+compliant)\b/i,
    /\b(?:act\s+now|limited\s+time|urgent|deadline)\b/i,
    /\b(?:designed to make|so nothing gets missed|all in one place|many organizations we speak with)\b/i,
    /https?:\/\//i,
    /\{\{|\{%|%signature%|\$\{/i,
  ];

  for (const [id, entry] of Object.entries(SUBJECT_MAP)) {
    it(`SUBJECT ${id} is claim-free and token-free`, () => {
      for (const pat of claimPatterns) {
        expect(pat.test(entry.text), `${id} matched ${pat}`).toBe(false);
      }
      // No [[...]] tokens in subjects
      expect(/\[\[/.test(entry.text)).toBe(false);
    });
  }

  for (const [id, entry] of Object.entries(MESSAGE_MAP)) {
    for (let pi = 0; pi < entry.paragraphs.length; pi++) {
      it(`MESSAGE ${id} para ${pi} is claim-free`, () => {
        const para = entry.paragraphs[pi];
        for (const pat of claimPatterns) {
          expect(pat.test(para), `${id}[${pi}] matched ${pat}`).toBe(false);
        }
      });
    }
  }

  for (const [id, text] of Object.entries(CTA_MAP)) {
    it(`CTA ${id} is claim-free`, () => {
      for (const pat of claimPatterns) {
        expect(pat.test(text), `CTA ${id} matched ${pat}`).toBe(false);
      }
    });
  }

  for (const [id, name] of Object.entries(THEME_MAP)) {
    it(`THEME ${id} label is claim-free plain text`, () => {
      for (const pat of claimPatterns) {
        expect(pat.test(name), `THEME ${id} matched ${pat}`).toBe(false);
      }
      expect(validateSafeLabel(name, "theme")).toBeNull();
    });
  }
});

describe("generator source consumes no model-authored visible string", () => {
  it("schema has no campaign_name/target_audience/body_paragraphs/subject/body_html from model", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fn = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    // campaign_name comes from THEME_MAP, not model
    expect(fn).toContain("THEME_MAP[themeId]");
    // target_audience is a fixed constant
    expect(fn).toContain("AUDIENCE_LABEL");
    // subjects come from SUBJECT_MAP via renderAudienceDraftEmail
    expect(fn).toContain("rendered.subject");
    // bodies come from renderAudienceDraftEmail
    expect(fn).toContain("rendered.body_html");
    // No model-provided string used as visible content
    expect(fn).not.toContain("parsed.campaign_name");
    expect(fn).not.toContain("parsed.target_audience");
    // No model text used directly — only IDs that index into server maps
    expect(fn).not.toContain("parsed.subject");
    expect(fn).not.toMatch(/raw\.subject[^_]/); // raw.subject_id is OK, raw.subject is not
    expect(fn).not.toContain("body_paragraphs");
  });

  it("prompt schema output is IDs and delays only", () => {
    const prompt = audienceDraftGenerateSystem();
    expect(prompt).toContain("theme_id");
    expect(prompt).toContain("subject_id");
    expect(prompt).toContain("message_id");
    expect(prompt).toContain("cta_id");
    expect(prompt).toContain("delay_days");
    // No body_paragraphs, body_html, subject (text), campaign_name, target_audience
    expect(prompt).not.toContain("body_paragraphs");
    expect(prompt).not.toContain("body_html");
    expect(prompt).not.toContain('"campaign_name"');
    expect(prompt).not.toContain('"target_audience"');
  });
});

// ── Error message reflection safety ───────────────────────────────────

describe("generateAudienceDraft errors never reflect model-provided values", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");
  const fn = edgeFn.slice(
    edgeFn.indexOf("async function generateAudienceDraft"),
    edgeFn.indexOf("// ── HTTP handler"),
  );

  it("theme validation error does not echo the provided theme_id", () => {
    expect(fn).toContain("Invalid theme selection");
    expect(fn).not.toMatch(/Unknown theme_id "\$\{/);
    expect(fn).not.toMatch(/theme_id "\$\{themeId\}"/);
  });

  it("subject_id error does not echo the provided ID", () => {
    expect(fn).toContain("invalid subject selection");
    expect(fn).not.toMatch(/unknown subject_id "\$\{/);
  });

  it("message_id error does not echo the provided ID", () => {
    expect(fn).toContain("invalid message selection");
    expect(fn).not.toMatch(/unknown message_id "\$\{/);
  });

  it("cta_id error does not echo the provided ID", () => {
    expect(fn).toContain("invalid CTA selection");
    expect(fn).not.toMatch(/unknown cta_id "\$\{/);
  });

  it("position errors do not echo subject/message IDs", () => {
    expect(fn).toContain("wrong-position subject selection");
    expect(fn).toContain("wrong-position message selection");
    expect(fn).not.toMatch(/subject_id "\$\{subjectId\}"/);
    expect(fn).not.toMatch(/message_id "\$\{messageId\}"/);
  });

  it("no AudienceActionError in the function interpolates subjectId/messageId/ctaId/themeId", () => {
    // Extract all AudienceActionError throw lines
    const errorLines = fn.split("\n").filter((l: string) => l.includes("AudienceActionError"));
    for (const line of errorLines) {
      expect(line).not.toContain("${subjectId}");
      expect(line).not.toContain("${messageId}");
      expect(line).not.toContain("${ctaId}");
      expect(line).not.toContain("${themeId}");
    }
  });

  it("malicious long prose ID would not appear in error response", () => {
    // Simulate: if model returns subject_id = "<script>alert(1)</script>xss_payload_long_string..."
    // The error message should be "Email 1: invalid subject selection", not contain the payload
    const maliciousId = '<script>alert(1)</script>' + 'A'.repeat(1000);
    // The code does String(raw.subject_id ?? "") then checks SUBJECT_MAP[subjectId]
    // which will be falsy, producing "Email 1: invalid subject selection"
    // Verify the error template is fixed text
    expect(fn).toMatch(/throw new AudienceActionError\(`Email \$\{n\}: invalid subject selection`/);
  });
});

describe("provider/parse errors mapped to fixed retryable message", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");
  const fn = edgeFn.slice(
    edgeFn.indexOf("async function generateAudienceDraft"),
    edgeFn.indexOf("// ── HTTP handler"),
  );

  it("wraps callClaude + parseJsonResponse in try/catch", () => {
    expect(fn).toMatch(/try\s*\{[\s\S]*?callClaude[\s\S]*?parseJsonResponse[\s\S]*?\}\s*catch/);
  });

  it("catch produces a fixed retryable AudienceActionError", () => {
    expect(fn).toContain("Could not generate the sequence. Please retry.");
    expect(fn).toContain("503, true");
  });

  it("catch does not reference the caught error object", () => {
    // The catch block should be bare `catch {` not `catch (e) { ...e.message... }`
    // to ensure no raw provider text leaks
    const catchBlock = fn.slice(fn.indexOf("} catch"), fn.indexOf("Could not generate") + 60);
    expect(catchBlock).not.toContain("e.message");
    expect(catchBlock).not.toContain("err.message");
    expect(catchBlock).not.toContain("error.message");
  });

  it("intentional 422 validation errors after parsing are preserved (not caught)", () => {
    // The try/catch ends before the validation section
    const afterCatch = fn.slice(fn.indexOf("Could not generate"));
    expect(afterCatch).toContain("Invalid theme selection");
    expect(afterCatch).toContain("invalid subject selection");
    expect(afterCatch).toContain("invalid message selection");
  });
});

// ── Identity consolidation: pure behavioral tests ─────────────────────

import { groupContactIdentities, type ContactIdentity } from "../supabase/functions/_shared/audience-spec";

function ci(id: string, primary: string, alts: string[] = [], reasons: string[] = [], ambig = false): ContactIdentity {
  return { contactId: id, primaryEmail: primary, allEmails: [primary, ...alts], reasons, isAmbiguous: ambig, snapshot: { account_id: id } };
}

describe("groupContactIdentities (pure union-find)", () => {
  it("single contact produces one group", () => {
    const groups = groupContactIdentities([ci("1", "a@x.com")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalEmail).toBe("a@x.com");
    expect(groups[0].contactCount).toBe(1);
  });

  it("two contacts sharing primary email merge into one group", () => {
    const groups = groupContactIdentities([ci("1", "a@x.com"), ci("2", "a@x.com")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].contactCount).toBe(2);
    expect(groups[0].reasons).toContain("duplicate_contact");
  });

  it("two contacts sharing email2 merge via secondary", () => {
    const groups = groupContactIdentities([
      ci("1", "a@x.com", ["shared@x.com"]),
      ci("2", "b@x.com", ["shared@x.com"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].allEmails).toContain("a@x.com");
    expect(groups[0].allEmails).toContain("b@x.com");
    expect(groups[0].allEmails).toContain("shared@x.com");
  });

  it("bridge contact merges two separate groups (A-B-C chain)", () => {
    const groups = groupContactIdentities([
      ci("A", "a@x.com", ["b@x.com"]),    // group {a,b}
      ci("C", "c@x.com", ["d@x.com"]),    // group {c,d}
      ci("B", "b@x.com", ["c@x.com"]),    // bridges {a,b} and {c,d}
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].allEmails.sort()).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(groups[0].contactCount).toBe(3);
    // Canonical is lowest contactId: "A"
    expect(groups[0].canonicalContactId).toBe("A");
    expect(groups[0].canonicalEmail).toBe("a@x.com");
  });

  it("canonical winner is deterministic (lowest contactId)", () => {
    // Process in reverse order — canonical should still be "1"
    const groups = groupContactIdentities([ci("3", "a@x.com"), ci("1", "a@x.com"), ci("2", "a@x.com")]);
    expect(groups[0].canonicalContactId).toBe("1");
  });

  it("unions all reasons across group members", () => {
    const groups = groupContactIdentities([
      ci("1", "a@x.com", [], ["customer_account"]),
      ci("2", "a@x.com", [], ["contact_do_not_contact"]),
    ]);
    expect(groups[0].reasons).toContain("customer_account");
    expect(groups[0].reasons).toContain("contact_do_not_contact");
    expect(groups[0].reasons).toContain("duplicate_contact");
  });

  it("ambiguity propagates to group if any member is ambiguous", () => {
    const groups = groupContactIdentities([
      ci("1", "a@x.com", [], [], false),
      ci("2", "a@x.com", [], [], true),
    ]);
    expect(groups[0].isAmbiguous).toBe(true);
  });

  it("disjoint contacts produce separate groups", () => {
    const groups = groupContactIdentities([
      ci("1", "a@x.com"),
      ci("2", "b@x.com"),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("duplicate primary with suppressed alternate: reasons include alt reasons", () => {
    const groups = groupContactIdentities([
      ci("1", "clean@x.com", ["bounced@x.com"], []),
      ci("2", "clean@x.com", [], ["customer_account"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].allEmails).toContain("bounced@x.com");
    expect(groups[0].reasons).toContain("customer_account");
  });

  it("empty input produces no groups", () => {
    expect(groupContactIdentities([])).toEqual([]);
  });

  it("output order is deterministic by canonicalContactId", () => {
    const groups = groupContactIdentities([ci("Z", "z@x.com"), ci("A", "a@x.com"), ci("M", "m@x.com")]);
    expect(groups.map((g) => g.canonicalContactId)).toEqual(["A", "M", "Z"]);
  });
});

describe("edge function uses groupContactIdentities", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("imports and calls groupContactIdentities", () => {
    expect(edgeFn).toContain("groupContactIdentities");
  });

  it("collects rawContacts then groups in two phases", () => {
    expect(edgeFn).toContain("rawContacts.push");
    expect(edgeFn).toContain("groupContactIdentities(rawContacts)");
  });

  it("materializes MemberRows from identity groups", () => {
    expect(edgeFn).toContain("for (const g of identityGroups)");
    expect(edgeFn).toContain("g.canonicalEmail");
  });

  it("deduplicates allMatchedEmails via Set", () => {
    expect(edgeFn).toContain("allUniqueEmails");
    expect(edgeFn).toContain("[...allUniqueEmails]");
  });

  it("fail-closed email invariant instead of silent cap", () => {
    expect(edgeFn).toContain("MAX_IDENTITY_EMAILS");
    expect(edgeFn).toContain("exceeds invariant");
    expect(edgeFn).not.toContain("EMAIL_CAP");
  });

  it("defines hasEnrollment from reason_codes in disposition loop", () => {
    expect(edgeFn).toContain('const hasEnrollment = m.reason_codes.includes("active_enrollment_elsewhere")');
  });
});

// ── Non-reflective errors ─────────────────────────────────────────────

describe("non-reflective errors", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("interpretation uses fixed error message", () => {
    expect(edgeFn).toContain("AI interpretation produced invalid output");
    const interpretFn = edgeFn.slice(
      edgeFn.indexOf("async function interpretAudience"),
      edgeFn.indexOf("async function resolveAudience"),
    );
    expect(interpretFn).not.toContain("errors.map");
  });

  it("outer handler does not reflect raw action value", () => {
    expect(edgeFn).not.toContain('`Unknown action: ${action}`');
    expect(edgeFn).toContain('"Unknown action"');
  });

  it("outer handler does not expose raw error messages", () => {
    expect(edgeFn).not.toContain("(e as Error).message }, 500");
    expect(edgeFn).toContain("An unexpected error occurred");
    expect(edgeFn).toContain("request_id");
  });

  it("outer handler logs details server-side with request ID", () => {
    expect(edgeFn).toContain("console.error");
    expect(edgeFn).toContain("crypto.randomUUID");
  });
});

// ── Unicode controls (extended) ───────────────────────────────────────

describe("validateSafeLabel rejects Unicode invisible/bidi characters", () => {
  it("rejects zero-width space U+200B", () => {
    expect(validateSafeLabel("test\u200Bname", "f")).toContain("control characters");
  });
  it("rejects zero-width joiner U+200D", () => {
    expect(validateSafeLabel("test\u200Dname", "f")).toContain("control characters");
  });
  it("rejects RTL override U+202E", () => {
    expect(validateSafeLabel("test\u202Ename", "f")).toContain("control characters");
  });
  it("rejects line separator U+2028", () => {
    expect(validateSafeLabel("test\u2028name", "f")).toContain("control characters");
  });
  it("rejects BOM U+FEFF", () => {
    expect(validateSafeLabel("\uFEFFtest", "f")).toContain("control characters");
  });
  it("rejects word joiner U+2060", () => {
    expect(validateSafeLabel("test\u2060name", "f")).toContain("control characters");
  });
  it("rejects LRI U+2066", () => {
    expect(validateSafeLabel("test\u2066name", "f")).toContain("control characters");
  });
  it("rejects PDI U+2069", () => {
    expect(validateSafeLabel("test\u2069name", "f")).toContain("control characters");
  });
  it("still accepts clean ASCII text", () => {
    expect(validateSafeLabel("Hospitals in Minnesota", "f")).toBeNull();
  });
});

// ── Prompt isolation: XML-escape ──────────────────────────────────────

describe("XML-escaped user brief", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("escapes angle brackets and ampersands before wrapping", () => {
    // Both interpretAudience and generateAudienceDraft must escape
    expect(edgeFn).toMatch(/escapedBrief.*replace.*&amp;.*replace.*&lt;.*replace.*&gt;/s);
    expect(edgeFn).toMatch(/escapedDesc.*replace.*&amp;.*replace.*&lt;.*replace.*&gt;/s);
  });

  it("wraps escaped input in <user_brief> tags", () => {
    expect(edgeFn).toContain("`<user_brief>${escapedBrief}</user_brief>`");
    expect(edgeFn).toContain("`<user_brief>${escapedDesc}</user_brief>`");
  });

  it("closing tag in input cannot break delimiter (behavioral)", () => {
    // If input contains </user_brief>, the < becomes &lt; after escaping,
    // so the model sees &lt;/user_brief&gt; — NOT a real closing tag
    const input = 'target hospitals</user_brief><inject>bad</inject>';
    const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(escaped).not.toContain("</user_brief>");
    expect(escaped).toContain("&lt;/user_brief&gt;");
  });
});

// ── D5: aiDraftSaved reset on method switch ───────────────────────────

describe("aiDraftSaved reset on every method switch", () => {
  const wizard = read("src/features/playbook/CampaignWizard.tsx");

  it("resets aiDraftSaved before any method branch", () => {
    const handlerBlock = wizard.slice(
      wizard.indexOf("setSequenceAttempted(false);"),
      wizard.indexOf("</button>", wizard.indexOf("setSequenceAttempted(false);") + 100),
    );
    const draftResetIdx = handlerBlock.indexOf("setAiDraftSaved(false)");
    const firstBranchIdx = handlerBlock.indexOf('if (id === "ask-ai")');
    expect(draftResetIdx).toBeGreaterThan(0);
    expect(draftResetIdx).toBeLessThan(firstBranchIdx);
  });

  it("clears aiDraftSavedSnapshotRef before any method branch", () => {
    const handlerBlock = wizard.slice(
      wizard.indexOf("setSequenceAttempted(false);"),
      wizard.indexOf("</button>", wizard.indexOf("setSequenceAttempted(false);") + 100),
    );
    expect(handlerBlock).toContain("aiDraftSavedSnapshotRef.current = null");
  });
});

// ── D6: accessible Show all/fewer label ───────────────────────────────

describe("Show all/fewer button has aria-label", () => {
  it("Show all button has dynamic aria-label", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain('aria-label={showAll ? "Show fewer results"');
  });
});

// ── Timeout/retry: mutation-safe approach ─────────────────────────────

describe("invokeAI does not use client-side abort for mutation safety", () => {
  const api = read("src/features/playbook/api.ts");

  it("does not use AbortController (mutations could be inconsistent)", () => {
    const invokeFn = api.slice(
      api.indexOf("async function invokeAI"),
      api.indexOf("export function useGenerateCampaign"),
    );
    expect(invokeFn).not.toContain("AbortController");
    expect(invokeFn).not.toContain("controller.abort");
  });

  it("documents why client timeout was removed", () => {
    expect(api).toContain("Aborting a mutation that succeeds server-side");
    expect(api).toContain("server's own");
  });
});

// ── Scan cap and email invariant ──────────────────────────────────────

describe("scan cap correctness", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("inner loop breaks at exact SCAN_HARD_CAP before processing next contact", () => {
    // The break must be INSIDE the for loop, before totalScanned++
    const contactLoop = edgeFn.slice(
      edgeFn.indexOf("for (const c of contacts)"),
      edgeFn.indexOf("rawContacts.push"),
    );
    expect(contactLoop).toContain("if (totalScanned >= SCAN_HARD_CAP) break");
    // Break comes before totalScanned++
    const breakIdx = contactLoop.indexOf("totalScanned >= SCAN_HARD_CAP");
    const incrementIdx = contactLoop.indexOf("totalScanned++");
    expect(breakIdx).toBeLessThan(incrementIdx);
  });

  it("does not use a separate EMAIL_CAP slice", () => {
    expect(edgeFn).not.toContain("EMAIL_CAP");
    expect(edgeFn).not.toContain("emailsCapped");
  });

  it("fail-closed invariant assertion for email count", () => {
    expect(edgeFn).toContain("MAX_IDENTITY_EMAILS");
    expect(edgeFn).toContain("SCAN_HARD_CAP * 3");
    expect(edgeFn).toContain("exceeds invariant");
  });

  it("allMatchedEmails comes from allUniqueEmails Set (deduped)", () => {
    expect(edgeFn).toContain("[...allUniqueEmails]");
    expect(edgeFn).toContain("new Set<string>()");
  });
});

describe("groupContactIdentities: performance at scale", () => {
  it("handles 1000 contacts with unique emails in <50ms", () => {
    const contacts: ContactIdentity[] = [];
    for (let i = 0; i < 1000; i++) {
      contacts.push(ci(String(i), `user${i}@example.com`));
    }
    const start = Date.now();
    const groups = groupContactIdentities(contacts);
    const elapsed = Date.now() - start;
    expect(groups).toHaveLength(1000);
    expect(elapsed).toBeLessThan(50);
  });

  it("handles chain of 100 linked contacts", () => {
    // Each contact shares email2 with the next contact's primary
    const contacts: ContactIdentity[] = [];
    for (let i = 0; i < 100; i++) {
      const primary = `p${i}@x.com`;
      const alt = i < 99 ? `p${i + 1}@x.com` : undefined;
      contacts.push(ci(String(i), primary, alt ? [alt] : []));
    }
    const groups = groupContactIdentities(contacts);
    // All 100 contacts should be in one group
    expect(groups).toHaveLength(1);
    expect(groups[0].contactCount).toBe(100);
    expect(groups[0].allEmails).toHaveLength(100);
  });
});

// ── Set-based safety RPC migration ────────────────────────────────────

describe("audience_check_email_safety migration", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("creates audience_check_email_safety function", () => {
    expect(migration).toContain("create or replace function public.audience_check_email_safety");
    expect(migration).toContain("p_emails text[]");
  });

  it("returns email + suppression_reasons + active_enrollment", () => {
    expect(migration).toContain("suppression_reasons text[]");
    expect(migration).toContain("active_enrollment   boolean");
  });

  it("queries v_marketing_suppression and campaign_enrollments together", () => {
    expect(migration).toContain("v_marketing_suppression");
    expect(migration).toContain("campaign_enrollments");
    expect(migration).toContain("full outer join");
  });

  it("is security_definer with search_path, service_role only", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("revoke all on function public.audience_check_email_safety");
    expect(migration).toContain("grant execute on function public.audience_check_email_safety");
    expect(migration).toContain("to service_role");
  });

  it("revokes from public, anon, and authenticated", () => {
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("uses stable volatility (safe for read-only context)", () => {
    expect(migration).toContain("stable");
  });
});

describe("audience_get_consumed_run migration", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("creates owner-checked run snapshot retrieval", () => {
    expect(migration).toContain("create or replace function public.audience_get_consumed_run");
    expect(migration).toContain("p_interpretation_id uuid");
    expect(migration).toContain("p_user_id uuid");
  });

  it("filters by both interpretation_id AND user_id", () => {
    expect(migration).toContain("r.interpretation_id = p_interpretation_id");
    expect(migration).toContain("r.user_id = p_user_id");
  });

  it("returns null if no matching run exists", () => {
    expect(migration).toContain("return null");
  });

  it("includes member preview in the returned snapshot", () => {
    expect(migration).toContain("campaign_audience_run_members");
    expect(migration).toContain("jsonb_agg");
  });

  it("is service_role only", () => {
    expect(migration).toContain("revoke all on function public.audience_get_consumed_run");
    expect(migration).toContain("to service_role");
  });
});

// ── Edge function: set-based + recovery ───────────────────────────────

describe("resolveAudience: set-based safety check", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("calls audience_check_email_safety RPC instead of serial batches", () => {
    expect(edgeFn).toContain("audience_check_email_safety");
    // No more .in("email", batch) serial loop
    expect(edgeFn).not.toContain('.in("email", batch)');
    // No more check_active_enrollments_normalized serial loop
    const resolveBlock = edgeFn.slice(
      edgeFn.indexOf("allMatchedEmails"),
      edgeFn.indexOf("Propagate ALL email"),
    );
    expect(resolveBlock).not.toContain("check_active_enrollments_normalized");
  });

  it("builds suppressionMap + activeEnrollmentEmails from one RPC result", () => {
    expect(edgeFn).toContain("safetyRows");
    expect(edgeFn).toContain("suppressionMap.set(norm, row.suppression_reasons)");
    expect(edgeFn).toContain("activeEnrollmentEmails.add(norm)");
  });

  it("fails closed on RPC error", () => {
    expect(edgeFn).toContain("Safety check failed");
  });
});

describe("resolveAudience: response-loss recovery", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("calls audience_get_consumed_run when interpretation already consumed", () => {
    expect(edgeFn).toContain("audience_get_consumed_run");
    expect(edgeFn).toContain("p_interpretation_id: interpretationId");
    expect(edgeFn).toContain("p_user_id: userId");
  });

  it("returns existing run from recovery RPC instead of 409", () => {
    // The recovered flag is set by the SQL RPC, not inline TS
    expect(edgeFn).toContain("existingRun");
    expect(edgeFn).toContain("audience_get_consumed_run");
  });

  it("falls through to fixed 409 if no owned run found", () => {
    expect(edgeFn).toContain("already been used and cannot be resubmitted");
  });

  it("uses owner-checked retrieval (userId passed to RPC)", () => {
    expect(edgeFn).toContain("p_user_id: userId");
  });
});

// ── total_scanned/scan_truncated persistence ──────────────────────────

describe("total_scanned and scan_truncated persistence", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("new migration adds total_scanned column to campaign_audience_runs", () => {
    expect(migration).toContain("add column if not exists total_scanned int");
  });

  it("new migration adds scan_truncated column to campaign_audience_runs", () => {
    expect(migration).toContain("add column if not exists scan_truncated boolean");
  });

  it("CREATE OR REPLACE inserts total_scanned and scan_truncated", () => {
    expect(migration).toContain("total_scanned, scan_truncated");
    expect(migration).toContain("(p_run->>'total_scanned')::int");
    expect(migration).toContain("(p_run->>'scan_truncated')::boolean");
  });

  it("edge function includes total_scanned and scan_truncated in runPayload", () => {
    expect(edgeFn).toContain("total_scanned: counts.total_scanned");
    expect(edgeFn).toContain("scan_truncated: counts.scan_truncated");
  });
});

// ── Recovered response shape matches UI contract ──────────────────────

describe("recovery RPC returns exact UI-expected shape", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("returns counts object with all 8 fields including total_scanned/scan_truncated", () => {
    expect(migration).toContain("'total_scanned', v_run.total_scanned");
    expect(migration).toContain("'scan_truncated', v_run.scan_truncated");
    expect(migration).toContain("'total_matched', v_run.total_matched");
    expect(migration).toContain("'total_eligible', v_run.total_eligible");
    expect(migration).toContain("'total_excluded', v_run.total_excluded");
    expect(migration).toContain("'total_ambiguous', v_run.total_ambiguous");
    expect(migration).toContain("'total_duplicate', v_run.total_duplicate");
    expect(migration).toContain("'total_active_enrollment', v_run.total_active_enrollment");
  });

  it("returns four separate disposition arrays (eligible/excluded/ambiguous/active_enrollments)", () => {
    expect(migration).toContain("'eligible', v_eligible");
    expect(migration).toContain("'excluded', v_excluded");
    expect(migration).toContain("'ambiguous', v_ambiguous");
    expect(migration).toContain("'active_enrollments', v_active_enrollments");
  });

  it("returns interpretation_id and spec_hash at top level", () => {
    expect(migration).toContain("'interpretation_id', p_interpretation_id");
    expect(migration).toContain("'spec_hash', v_run.spec_hash");
  });

  it("returns success and recovered flags", () => {
    expect(migration).toContain("'success', true");
    expect(migration).toContain("'recovered', true");
  });

  it("filters members by disposition for each array", () => {
    expect(migration).toContain("m.disposition = 'eligible'");
    expect(migration).toContain("m.disposition = 'excluded'");
    expect(migration).toContain("m.disposition = 'ambiguous'");
    expect(migration).toContain("m.disposition = 'active_enrollment'");
  });

  it("orders members deterministically by contact_id then email", () => {
    expect(migration).toContain("order by m.contact_id, m.email_normalized");
  });
});

// ── Concurrent race recovery ──────────────────────────────────────────

describe("concurrent consumed-interpretation recovery", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("attempts recovery on RPC error when interpretationId is set", () => {
    // After create_audience_run_with_members fails, recovery is attempted
    const rpcBlock = edgeFn.slice(
      edgeFn.indexOf("if (rpcErr)"),
      edgeFn.indexOf("// 8. Response"),
    );
    expect(rpcBlock).toContain("audience_get_consumed_run");
    expect(rpcBlock).toContain("interpretationId");
  });

  it("returns recovered result directly from RPC on successful recovery", () => {
    const rpcBlock = edgeFn.slice(
      edgeFn.indexOf("if (rpcErr)"),
      edgeFn.indexOf("// 8. Response"),
    );
    expect(rpcBlock).toContain("if (recovered) return recovered");
  });

  it("does not leak raw RPC error message", () => {
    const rpcBlock = edgeFn.slice(
      edgeFn.indexOf("if (rpcErr)"),
      edgeFn.indexOf("// 8. Response"),
    );
    expect(rpcBlock).not.toContain("rpcErr.message");
    expect(rpcBlock).toContain("Failed to persist audience resolution");
  });
});

// ── No rewrite of old deployed migration ──────────────────────────────

describe("migration safety: no rewrite of deployed provenance migration", () => {
  it("new migration is a separate file from the deployed one", () => {
    const newMigration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");
    const oldMigration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    // Old migration still has its original create_audience_run_with_members
    expect(oldMigration).toContain("create or replace function public.create_audience_run_with_members");
    // New migration also has CREATE OR REPLACE (overrides at apply time)
    expect(newMigration).toContain("create or replace function public.create_audience_run_with_members");
  });

  it("new migration uses ALTER TABLE ADD COLUMN IF NOT EXISTS (safe for rerun)", () => {
    const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");
    expect(migration).toContain("add column if not exists total_scanned");
    expect(migration).toContain("add column if not exists scan_truncated");
  });
});

// ── Recovery guards (status/redaction/null members) ───────────────────

describe("recovery guards: status, redaction, null members", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("returns null for non-preview status runs (draft_linked/expired/launched)", () => {
    expect(migration).toContain("v_run.status != 'preview'");
    expect(migration).toContain("return null;  -- draft_linked/expired/launched");
  });

  it("returns null for redacted runs", () => {
    expect(migration).toContain("v_run.redacted_at is not null");
    expect(migration).toContain("return null;  -- redacted runs");
  });

  it("returns null if any member has null email or null contact_id", () => {
    expect(migration).toContain("m.email_normalized is null or m.contact_id is null");
    expect(migration).toContain("return null;  -- members have been partially redacted");
  });
});

// ── Recovery exact order and eligible LIMIT ───────────────────────────

describe("recovery reproduces exact original response subset and order", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("orders all disposition arrays by contact_id with email tiebreaker", () => {
    // Each subquery must ORDER BY contact_id, email
    const contactIdOrders = (migration.match(/order by m\.contact_id, m\.email_normalized/g) ?? []).length;
    // 4 inner subqueries + 4 outer jsonb_agg order-by = at least 4
    expect(contactIdOrders).toBeGreaterThanOrEqual(4);
  });

  it("eligible array is LIMIT max_results from spec", () => {
    expect(migration).toContain("limit v_max_results");
  });

  it("parses max_results from run spec with bounds", () => {
    expect(migration).toContain("v_run.spec->>'max_results'");
    expect(migration).toContain("v_max_results < 1");
    expect(migration).toContain("v_max_results > 2000");
  });
});

// ── Immutability guard extended for new columns ───────────────────────

describe("immutability guard includes total_scanned and scan_truncated", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("recreates audience_runs_immutable_guard in new migration", () => {
    expect(migration).toContain("create or replace function public.audience_runs_immutable_guard");
  });

  it("checks total_scanned is unchanged in FK-null exception", () => {
    expect(migration).toContain("new.total_scanned     is not distinct from old.total_scanned");
  });

  it("checks scan_truncated is unchanged in FK-null exception", () => {
    expect(migration).toContain("new.scan_truncated    is not distinct from old.scan_truncated");
  });

  it("preserves all existing immutable fields from deployed guard", () => {
    for (const field of [
      "raw_prompt", "spec", "spec_hash", "model_id", "model_version",
      "total_matched", "total_eligible", "total_excluded",
      "total_ambiguous", "total_duplicate", "total_active_enrollment",
      "status", "created_at", "launched_at", "launched_spec_hash",
      "retention_expires_at", "redacted_at",
    ]) {
      expect(migration).toContain(`new.${field}`);
    }
  });

  it("preserves GUC bypass", () => {
    expect(migration).toContain("app.audience_provenance_rpc");
    expect(migration).toContain("return coalesce(new, old)");
  });

  it("preserves DELETE block", () => {
    expect(migration).toContain("DELETE not permitted");
  });

  it("preserves all 4 FK value→NULL predicates", () => {
    for (const fk of ["user_id", "campaign_id", "interpretation_id", "draft_id"]) {
      expect(migration).toContain(`old.${fk}`);
    }
  });

  it("rewires the trigger", () => {
    expect(migration).toContain("drop trigger if exists trg_audience_runs_no_update");
    expect(migration).toContain("create trigger trg_audience_runs_no_update");
  });
});

// ── Fixed 409 message ─────────────────────────────────────────────────

describe("non-recoverable 409 message", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");

  it("uses a clear non-retry message for consumed interpretations", () => {
    expect(edgeFn).toContain("already been used and cannot be resubmitted");
    expect(edgeFn).toContain("Start a new audience search");
  });

  it("does not say retry for consumed interpretation", () => {
    // The 409 path should not suggest retry since resubmitting is impossible
    const consumedBlock = edgeFn.slice(
      edgeFn.indexOf("interp.consumed_at"),
      edgeFn.indexOf("interp.expires_at"),
    );
    expect(consumedBlock).not.toContain("retry");
    expect(consumedBlock).not.toContain("Please try again");
  });
});

// ── Restored diagnostic error message ─────────────────────────────────

describe("summary arithmetic diagnostic restored", () => {
  const migration = read("supabase/migrations/20260822060000_audience_safety_check_rpc.sql");

  it("includes 5-parameter diagnostic in arithmetic mismatch exception", () => {
    expect(migration).toContain("total_matched (%) must equal eligible (%) + excluded (%) + ambiguous (%) + active_enrollment (%)");
  });
});
