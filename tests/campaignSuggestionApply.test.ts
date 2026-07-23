import { describe, it, expect } from "vitest";
import {
  applySuggestionToTemplate,
  parseTimingSuggestion,
  suggestionApplyDisabledReason,
} from "@/features/playbook/suggestion-apply";
import type { CampaignSuggestion, CampaignTemplate, SequenceStep } from "@/features/playbook/types";

// ---------------------------------------------------------------------------
// Campaigns overhaul Phase 4 — the AI learning loop's suggestion -> template
// mapping. Pure logic pinned here so InsightsPanel.tsx's Apply button and
// the edge function's dedupe assumptions can be checked without a live DB.
// ---------------------------------------------------------------------------

const STEPS: SequenceStep[] = [
  { order: 1, day_offset: 1, channel: "EMAIL_AUTO", automation: "AUTO", subject_template: "Old subject", body_template: "Old body" },
  { order: 2, day_offset: 5, channel: "EMAIL_AUTO", automation: "AUTO", subject_template: "Follow up", body_template: "Follow up body" },
  { order: 3, day_offset: 8, channel: "CALL", automation: "MANUAL" },
];

const TEMPLATE: CampaignTemplate = {
  id: "tmpl-1",
  name: "Test Template",
  description: "desc",
  category: "custom",
  is_preset: false,
  owner_user_id: null,
  duration_days: 8,
  step_count: 3,
  steps: STEPS,
  domain_rules: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function suggestion(overrides: Partial<CampaignSuggestion>): CampaignSuggestion {
  return {
    id: "sugg-1",
    campaign_id: "camp-1",
    template_id: "tmpl-1",
    step_order: 1,
    kind: "subject",
    current_value: "Old subject",
    suggested_value: "New subject",
    rationale: "Open rate on step 1 was low.",
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    decided_at: null,
    decided_by: null,
    campaign: null,
    ...overrides,
  };
}

describe("parseTimingSuggestion", () => {
  it("parses a bare integer as day_offset", () => {
    expect(parseTimingSuggestion("5")).toEqual({ day_offset: 5 });
  });

  it("parses 'day_offset: N' phrasing", () => {
    expect(parseTimingSuggestion("day_offset: 7")).toEqual({ day_offset: 7 });
  });

  it("parses a send window range", () => {
    expect(parseTimingSuggestion("10:00-11:00")).toEqual({
      send_window_start: "10:00",
      send_window_end: "11:00",
    });
  });

  it("parses 'to' as a range separator", () => {
    expect(parseTimingSuggestion("9:00 to 10:30")).toEqual({
      send_window_start: "9:00",
      send_window_end: "10:30",
    });
  });

  it("parses both a day_offset and a window together", () => {
    expect(parseTimingSuggestion("day_offset: 3, window 10:00-11:00")).toEqual({
      day_offset: 3,
      send_window_start: "10:00",
      send_window_end: "11:00",
    });
  });

  it("returns null for unparseable free text", () => {
    expect(parseTimingSuggestion("send it earlier in the week")).toBeNull();
  });

  it("returns null for empty/null input", () => {
    expect(parseTimingSuggestion(null)).toBeNull();
    expect(parseTimingSuggestion("")).toBeNull();
  });
});

describe("applySuggestionToTemplate", () => {
  it("applies a subject suggestion to the matching step only", () => {
    const result = applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "subject", step_order: 1, suggested_value: "New subject" }));
    expect(result).not.toBeNull();
    expect(result!.steps[0].subject_template).toBe("New subject");
    // untouched steps are unaffected
    expect(result!.steps[1].subject_template).toBe("Follow up");
    expect(result!.steps[2]).toEqual(STEPS[2]);
  });

  it("applies a body suggestion to the matching step only", () => {
    const result = applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "body", step_order: 2, suggested_value: "New body" }));
    expect(result!.steps[1].body_template).toBe("New body");
    expect(result!.steps[0].body_template).toBe("Old body");
  });

  it("does not mutate the input template", () => {
    const before = JSON.stringify(TEMPLATE);
    applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "subject", step_order: 1, suggested_value: "New subject" }));
    expect(JSON.stringify(TEMPLATE)).toBe(before);
  });

  it("returns null when the target step_order doesn't exist on the template", () => {
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ step_order: 99 }))).toBeNull();
  });

  it("returns null when suggested_value is empty for subject/body", () => {
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ suggested_value: null }))).toBeNull();
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ suggested_value: "   " }))).toBeNull();
  });

  it("applies a clean timing suggestion", () => {
    const result = applySuggestionToTemplate(
      TEMPLATE,
      suggestion({ kind: "timing", step_order: 3, suggested_value: "day_offset: 10" }),
    );
    expect(result!.steps[2].day_offset).toBe(10);
  });

  it("returns null for an unparseable timing suggestion", () => {
    expect(
      applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "timing", step_order: 3, suggested_value: "send it sooner" })),
    ).toBeNull();
  });

  it("always returns null for audience/general kinds (no structured field)", () => {
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "audience", step_order: null }))).toBeNull();
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ kind: "general", step_order: null }))).toBeNull();
  });

  it("returns null when the suggestion targets a different template", () => {
    expect(applySuggestionToTemplate(TEMPLATE, suggestion({ template_id: "some-other-template" }))).toBeNull();
  });
});

describe("suggestionApplyDisabledReason", () => {
  it("is null (enabled) for a valid, applicable suggestion", () => {
    expect(suggestionApplyDisabledReason(TEMPLATE, suggestion({}))).toBeNull();
  });

  it("gives a reason when the template is missing", () => {
    expect(suggestionApplyDisabledReason(undefined, suggestion({}))).toMatch(/no longer exists/);
  });

  it("gives a reason for audience/general kinds", () => {
    expect(suggestionApplyDisabledReason(TEMPLATE, suggestion({ kind: "general", step_order: null }))).toMatch(/no single field/);
  });

  it("gives a reason for an unparseable timing suggestion", () => {
    expect(
      suggestionApplyDisabledReason(TEMPLATE, suggestion({ kind: "timing", step_order: 3, suggested_value: "soon" })),
    ).toMatch(/manual edit/);
  });
});
