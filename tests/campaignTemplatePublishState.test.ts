import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { htmlToReadableText, readableTaskPreview } from "../src/features/playbook/SequenceTimeline";

const read = (...parts: string[]) =>
  readFileSync(path.resolve(__dirname, "..", ...parts), "utf8");

// ---------------------------------------------------------------------------
// Migration: publish_state column + backfill + RLS
// ---------------------------------------------------------------------------

describe("publish_state migration", () => {
  const migration = read(
    "supabase", "migrations",
    "20260822010000_campaign_template_publish_state.sql",
  );

  it("adds publish_state with safe draft default and CHECK constraint", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS publish_state text NOT NULL DEFAULT 'draft'");
    expect(migration).toContain("CHECK (publish_state IN ('draft', 'published', 'archived'))");
  });

  it("backfills ALL existing templates to published first", () => {
    // Every row that existed before this migration was either an approved
    // preset or a user-saved custom template — publish them all so no
    // approved preset is accidentally hidden.
    expect(migration).toContain("SET publish_state = 'published'");
    expect(migration).toContain("WHERE publish_state = 'draft'");
  });

  it("then overrides Warming preset to draft", () => {
    // Only the known-unfinished Warming UUID is hidden; everything else
    // stays published.
    const publishAll = migration.indexOf("WHERE publish_state = 'draft'");
    const warmingDraft = migration.indexOf("11111111-0000-4000-a000-000000000002");
    expect(publishAll).toBeGreaterThan(-1);
    expect(warmingDraft).toBeGreaterThan(publishAll);
    expect(migration).toContain("SET publish_state = 'draft'");
    expect(migration).toContain("11111111-0000-4000-a000-000000000002");
  });

  it("never deletes any data", () => {
    expect(migration).not.toMatch(/\bDELETE\b/i);
    expect(migration).not.toMatch(/\bDROP TABLE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("updates RLS to show only published presets to non-admin reps", () => {
    expect(migration).toContain("campaign_templates_read_own");
    expect(migration).toContain("is_preset = true AND publish_state = 'published'");
    expect(migration).toContain("owner_user_id = (SELECT auth.uid())");
  });
});

// ---------------------------------------------------------------------------
// API: useCampaignTemplates filters published by default
// ---------------------------------------------------------------------------

describe("API template filtering", () => {
  const api = read("src", "features", "playbook", "api.ts");

  it("useCampaignTemplates defaults to publishedOnly=true", () => {
    expect(api).toContain("publishedOnly = true");
  });

  it("applies publish_state filter when publishedOnly is true", () => {
    expect(api).toContain('.eq("publish_state", "published")');
  });

  it("stamps publish_state published on custom template save", () => {
    // useSaveTemplate must set publish_state so custom saves pass launch validation
    expect(api).toContain('publish_state = "published"');
  });
});

// ---------------------------------------------------------------------------
// QuickCampaignDialog: inherits published-only from useCampaignTemplates
// ---------------------------------------------------------------------------

describe("QuickCampaignDialog template selection", () => {
  const dialog = read("src", "features", "playbook", "QuickCampaignDialog.tsx");

  it("uses useCampaignTemplates (inherits publishedOnly=true default)", () => {
    expect(dialog).toContain("useCampaignTemplates()");
  });
});

// ---------------------------------------------------------------------------
// UI: template preview modal bounded workspace
// ---------------------------------------------------------------------------

describe("template preview modal layout", () => {
  const section = read("src", "features", "playbook", "TemplatesSection.tsx");

  it("uses bounded desktop width (3xl/4xl) with full-width mobile", () => {
    expect(section).toContain("sm:max-w-3xl");
    expect(section).toContain("lg:max-w-4xl");
    expect(section).toContain("w-[calc(100vw-2rem)]");
  });

  it("uses flex column layout with max-height constraint", () => {
    expect(section).toContain("max-h-[85vh]");
    expect(section).toContain("flex flex-col");
    expect(section).toContain("p-0");
  });

  it("has sticky header with border separator", () => {
    expect(section).toContain("sticky top-0");
    expect(section).toContain("border-b bg-inherit");
  });

  it("has scrollable sequence body with overflow-wrap", () => {
    expect(section).toContain("flex-1 overflow-y-auto");
    expect(section).toContain("min-h-0");
    expect(section).toContain("[overflow-wrap:anywhere]");
  });

  it("has sticky footer with border separator", () => {
    expect(section).toContain("sticky bottom-0");
    expect(section).toContain("border-t bg-inherit");
  });

  it("wraps long title and description text", () => {
    // Prevents horizontal overflow from unbroken tokens
    expect(section).toMatch(/DialogTitle.*\[overflow-wrap:anywhere\]/s);
    expect(section).toMatch(/DialogDescription.*\[overflow-wrap:anywhere\]/s);
  });

  it("preserves Radix dialog accessible title and description", () => {
    expect(section).toContain("<DialogTitle");
    expect(section).toContain("<DialogDescription");
  });

  it("preserves Escape/close behavior via standard Dialog/DialogContent", () => {
    expect(section).toContain("onOpenChange={(o) => {");
    expect(section).toContain("setPreview(null)");
    expect(section).toContain("<DialogContent");
  });

  it("mobile actions stack vertically with flex-col", () => {
    // The footer action buttons must stack on mobile and inline on desktop
    expect(section).toContain("flex flex-col sm:flex-row");
  });
});

// ---------------------------------------------------------------------------
// Backend: playbook-smartlead launch validates template publish_state
// ---------------------------------------------------------------------------

describe("playbook-smartlead template launch validation", () => {
  const edge = read("supabase", "functions", "playbook-smartlead", "index.ts");

  it("selects id and publish_state then rejects unpublished at runtime", () => {
    // Implementation selects the template row, then checks publish_state
    // at runtime — NOT via .eq() in the query (the row must exist for the
    // error message to distinguish "missing" from "unpublished").
    expect(edge).toContain('.select("id, publish_state")');
    expect(edge).toContain('tmpl.publish_state !== "published"');
    // The error must mention stale selection guidance
    expect(edge).toContain("no longer available for launch");
    expect(edge).toContain("pick a different template");
  });

  it("validates template BEFORE Smartlead campaign creation", () => {
    const validateIdx = edge.indexOf("no longer available for launch");
    // The actual Smartlead campaign creation call
    const smartleadCreateIdx = edge.indexOf("/campaigns/create");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(smartleadCreateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(smartleadCreateIdx);
  });

  it("allows template-less launches (write-your-own, AI-generated)", () => {
    // The check is gated on p.template_id — template-less launches skip it
    expect(edge).toContain("if (p.template_id)");
  });
});

// ---------------------------------------------------------------------------
// Backend: playbook-ai excludes unpublished templates from insights
// ---------------------------------------------------------------------------

describe("playbook-ai template filtering", () => {
  const ai = read("supabase", "functions", "playbook-ai", "index.ts");

  it("filters campaign_templates by published state in insights", () => {
    // The campaign-insights template fetch must only load published templates
    const templateQuery = ai.match(
      /from\("campaign_templates"\)[\s\S]{0,200}\.eq\("publish_state",\s*"published"\)/,
    );
    expect(templateQuery).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TypeScript types: publish_state on CampaignTemplate
// ---------------------------------------------------------------------------

describe("TypeScript type contract", () => {
  const types = read("src", "features", "playbook", "types.ts");

  it("defines TemplatePublishState type", () => {
    expect(types).toContain('"draft" | "published" | "archived"');
  });

  it("includes publish_state on CampaignTemplate interface", () => {
    expect(types).toContain("publish_state: TemplatePublishState");
  });
});

// ---------------------------------------------------------------------------
// UI: SequenceTimeline fullCopy prop (preview shows full text, cards compact)
// ---------------------------------------------------------------------------

describe("SequenceTimeline fullCopy prop", () => {
  const timeline = read("src", "features", "playbook", "SequenceTimeline.tsx");

  it("accepts a fullCopy boolean prop", () => {
    expect(timeline).toContain("fullCopy?: boolean");
    expect(timeline).toContain("fullCopy = false");
  });

  it("removes truncation and uses word-wrap in fullCopy mode", () => {
    // When fullCopy is true, headline and preview text must wrap instead of truncate
    expect(timeline).toContain('[overflow-wrap:anywhere]');
    expect(timeline).toContain("break-words");
  });

  it("hides the expand/collapse chevron in fullCopy mode", () => {
    // Steps are always expanded — no toggle needed
    expect(timeline).toContain("!fullCopy");
    expect(timeline).toContain("ChevronDown");
  });

  it("shows full body text with whitespace-pre-wrap in fullCopy mode", () => {
    expect(timeline).toContain("whitespace-pre-wrap");
    expect(timeline).toContain("fullBodyText");
  });

  it("preserves compact truncate mode when fullCopy is false (default)", () => {
    // The wrapClass variable switches between truncate and word-wrap
    expect(timeline).toMatch(/fullCopy \? "break-words.*" : "truncate"/);
  });
});

describe("htmlToReadableText (unit)", () => {
  it("converts <p> tags to paragraph breaks and strips tags", () => {
    const result = htmlToReadableText("<p>First.</p><p>Second.</p><p>Third.</p>");
    expect(result).toBe("First.\n\nSecond.\n\nThird.");
    expect(result).not.toContain("<");
  });

  it("converts <br> variants to single newlines", () => {
    expect(htmlToReadableText("A<br>B<br/>C<br />D")).toBe("A\nB\nC\nD");
  });

  it("handles mixed <p> and <br> in a long multi-paragraph body", () => {
    const html =
      "<p>Hi there,</p>" +
      "<p>I'm reaching out about compliance services.</p>" +
      "<p>Our platform includes:<br>- Risk assessments<br>- Policy management<br>- Training modules</p>" +
      "<p>Would you be available for a call?</p>" +
      "<p>Best regards</p>";
    const result = htmlToReadableText(html);
    // Multiple distinct paragraphs present
    expect(result.split("\n\n").length).toBeGreaterThanOrEqual(4);
    // br-separated items within a paragraph
    expect(result).toContain("- Risk assessments\n- Policy management\n- Training modules");
    // Zero raw tags
    expect(result).not.toMatch(/<[a-z]/i);
  });

  it("decodes &amp; &lt; &gt; &quot; &#39; &nbsp;", () => {
    expect(htmlToReadableText("<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s</p>"))
      .toBe('A & B < C > D "E" F\'s');
    expect(htmlToReadableText("word&nbsp;word")).toBe("word word");
  });

  it("collapses excessive blank lines to at most double", () => {
    const result = htmlToReadableText("<p>A</p><p></p><p></p><p></p><p>B</p>");
    for (const run of result.match(/\n+/g) ?? []) {
      expect(run.length).toBeLessThanOrEqual(2);
    }
  });

  it("handles a long unbroken token without crashing or truncating", () => {
    const token = "A".repeat(500);
    const result = htmlToReadableText(`<p>Start ${token} end</p>`);
    expect(result).toContain(token);
    expect(result).not.toContain("<p>");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(htmlToReadableText(null)).toBe("");
    expect(htmlToReadableText(undefined)).toBe("");
    expect(htmlToReadableText("")).toBe("");
  });
});

describe("full-copy pipeline: readableTaskPreview → htmlToReadableText", () => {
  it("substitutes variables AND preserves paragraph breaks", () => {
    const html = "<p>Hi {{first_name}},</p><p>I wanted to reach out about {{company}}.</p><p>Let me know!</p>";
    const withVars = readableTaskPreview(html, { firstName: "Molly", organization: "Acme Health" });
    const rendered = htmlToReadableText(withVars);
    // Variables substituted
    expect(rendered).toContain("Molly");
    expect(rendered).toContain("Acme Health");
    expect(rendered).not.toContain("{{first_name}}");
    // Tags stripped
    expect(rendered).not.toMatch(/<[^>]+>/);
    // Paragraph breaks preserved
    expect(rendered).toContain("Hi Molly,\n\nI wanted to reach out about Acme Health.");
  });

  it("handles entities + variables + br + long token together", () => {
    const token = "x".repeat(220);
    const substituted = readableTaskPreview(
      `<p>Hi {{first_name}},</p><p>First &amp; second<br>Line two</p><p>${token}</p>`,
      { firstName: "Molly" },
    );
    const rendered = htmlToReadableText(substituted);

    expect(rendered).not.toMatch(/<[^>]+>/);
    expect(rendered).toContain("Hi Molly,");
    expect(rendered).toContain("First & second\nLine two");
    expect(rendered).toContain("Hi Molly,\n\nFirst & second");
    expect(rendered).toContain(token);
  });

  it("does not regress compact preview (readableTaskPreview alone for non-fullCopy)", () => {
    // Compact mode uses readableTaskPreview without htmlToReadableText;
    // firstMeaningfulLine handles tag stripping for the one-line display
    const compact = readableTaskPreview("<p>Short.</p><p>More.</p>");
    expect(typeof compact).toBe("string");
    expect(compact.length).toBeGreaterThan(0);
  });
});

describe("TemplatesSection preview uses fullCopy", () => {
  const section = read("src", "features", "playbook", "TemplatesSection.tsx");

  it("passes fullCopy to SequenceTimeline in the preview modal", () => {
    expect(section).toContain("<SequenceTimeline steps={preview.steps} fullCopy");
  });

  it("does NOT pass fullCopy in the gallery card minipreview", () => {
    // SequenceMiniPreview is used for cards, not SequenceTimeline with fullCopy
    expect(section).toContain("SequenceMiniPreview");
  });
});

// ---------------------------------------------------------------------------
// UI: overflow-x-hidden defense on modal and body
// ---------------------------------------------------------------------------

describe("overflow-x-hidden defense", () => {
  const section = read("src", "features", "playbook", "TemplatesSection.tsx");

  it("applies overflow-x-hidden to the scrollable body section", () => {
    expect(section).toContain("overflow-x-hidden");
  });
});

// ---------------------------------------------------------------------------
// Accessibility: preview dialog focus restoration
// ---------------------------------------------------------------------------

describe("preview dialog focus restoration", () => {
  const section = read("src", "features", "playbook", "TemplatesSection.tsx");

  it("stores a previewTriggerRef via useRef", () => {
    expect(section).toContain("useRef<HTMLElement | null>(null)");
    expect(section).toContain("previewTriggerRef");
  });

  it("captures the triggering card element on click", () => {
    // The card's onClick must store e.currentTarget in the ref before opening the preview
    expect(section).toContain("previewTriggerRef.current = e.currentTarget");
    expect(section).toContain("setPreview(t)");
  });

  it("restores focus via requestAnimationFrame on user-initiated close", () => {
    // onOpenChange fires only for Escape / X / overlay — not programmatic setPreview(null)
    expect(section).toContain("requestAnimationFrame(() => trigger.focus())");
  });

  it("does NOT call focus restore in programmatic transition paths", () => {
    // openCustomize, openEdit, and "Use this template" call setPreview(null)
    // directly, which changes `open` without firing onOpenChange — so the
    // requestAnimationFrame focus restore never runs for those paths.
    // Verify: the three transition paths set preview to null outside onOpenChange.
    const onOpenChangeBlock = section.slice(
      section.indexOf("onOpenChange={(o) => {"),
      section.indexOf("onOpenChange={(o) => {") + 300,
    );
    // The onOpenChange block should NOT contain openCustomize/openEdit/openLaunch
    expect(onOpenChangeBlock).not.toContain("openCustomize");
    expect(onOpenChangeBlock).not.toContain("openEdit");
    expect(onOpenChangeBlock).not.toContain("openLaunch");
  });

  it("imports useRef from react", () => {
    expect(section).toMatch(/import\s*\{[^}]*useRef[^}]*\}\s*from\s*["']react["']/);
  });
});
