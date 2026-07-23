// Suggestion -> template edit mapping (Campaigns overhaul Phase 4 — the AI
// learning loop). Pure, framework-free logic so it can be unit-tested
// directly (tests/campaignSuggestionApply.test.ts), same convention as
// suppression.ts.
//
// Applying a suggestion always edits the TEMPLATE, never a running
// campaign (a launched campaign's `steps` are a frozen deep-copy — see
// campaigns_foundation's doc comment) — InsightsPanel.tsx says so in its
// header caption, and this module has no code path that could touch a
// campaigns row at all.

import type { CampaignTemplate, CampaignSuggestion, SequenceStep } from "./types";

export interface ParsedTiming {
  day_offset?: number;
  send_window_start?: string;
  send_window_end?: string;
}

/** Parse a timing suggestion's free-text `suggested_value` into structured
 *  step fields, or null if it doesn't parse cleanly. Recognized forms:
 *    - a bare integer ("5", "12") -> day_offset
 *    - "day_offset: 5" / "day offset = 5" -> day_offset
 *    - a time range ("10:00-11:00", "10:00 to 11:00") -> send window
 *  Both a day_offset AND a send window may be present in the same string
 *  (checked independently); returns null only when NEITHER was found, so
 *  the caller can tell "nothing to apply" from "no window but a valid
 *  day_offset". Deliberately conservative — an unrecognized shape must
 *  disable Apply, not guess. */
export function parseTimingSuggestion(suggestedValue: string | null): ParsedTiming | null {
  if (!suggestedValue) return null;
  const out: ParsedTiming = {};

  const bareInt = suggestedValue.trim().match(/^(\d{1,3})$/);
  const labeled = suggestedValue.match(/day[_ ]?offset\s*[:=]\s*(\d{1,3})/i);
  const dayMatch = labeled ?? bareInt;
  if (dayMatch) {
    const n = parseInt(dayMatch[1], 10);
    if (!isNaN(n) && n >= 0) out.day_offset = n;
  }

  const windowMatch = suggestedValue.match(/(\d{1,2}:\d{2})\s*(?:-|to|–)\s*(\d{1,2}:\d{2})/i);
  if (windowMatch) {
    out.send_window_start = windowMatch[1];
    out.send_window_end = windowMatch[2];
  }

  return out.day_offset !== undefined || out.send_window_start ? out : null;
}

export interface SuggestionApplyResult {
  /** The template's steps with this suggestion's edit folded in. */
  steps: SequenceStep[];
}

/**
 * Maps one suggestion onto its target template's steps. Returns null when
 * the suggestion isn't programmatically applicable — the caller (Apply
 * button) disables itself and shows "needs a manual edit" in that case:
 *
 *   - subject/body: the target step (matched by step_order) must exist on
 *     the template AND suggested_value must be non-empty.
 *   - timing: suggested_value must parse via parseTimingSuggestion.
 *   - audience/general: no structured per-step field to edit — always null.
 *
 * Never mutates the input template.
 */
export function applySuggestionToTemplate(
  template: CampaignTemplate,
  suggestion: CampaignSuggestion,
): SuggestionApplyResult | null {
  if (suggestion.template_id !== template.id) return null;

  if (suggestion.kind === "audience" || suggestion.kind === "general") return null;

  const stepIndex = template.steps.findIndex((s) => s.order === suggestion.step_order);
  if (stepIndex === -1) return null;

  if (suggestion.kind === "subject" || suggestion.kind === "body") {
    const value = suggestion.suggested_value?.trim();
    if (!value) return null;
    const field = suggestion.kind === "subject" ? "subject_template" : "body_template";
    const steps = template.steps.map((s, i) => (i === stepIndex ? { ...s, [field]: value } : s));
    return { steps };
  }

  if (suggestion.kind === "timing") {
    const parsed = parseTimingSuggestion(suggestion.suggested_value);
    if (!parsed) return null;
    const steps = template.steps.map((s, i) => {
      if (i !== stepIndex) return s;
      const next = { ...s };
      if (parsed.day_offset !== undefined) next.day_offset = parsed.day_offset;
      if (parsed.send_window_start) next.send_window_start = parsed.send_window_start;
      if (parsed.send_window_end) next.send_window_end = parsed.send_window_end;
      return next;
    });
    return { steps };
  }

  return null;
}

/** Plain-English reason Apply is disabled, for the button's tooltip.
 *  Returns null when the suggestion IS applicable (button stays enabled). */
export function suggestionApplyDisabledReason(
  template: CampaignTemplate | undefined,
  suggestion: CampaignSuggestion,
): string | null {
  if (!template) return "The template this was suggested for no longer exists.";
  if (suggestion.kind === "audience" || suggestion.kind === "general") {
    return "This kind of suggestion has no single field to apply automatically — edit the template manually.";
  }
  if (!applySuggestionToTemplate(template, suggestion)) {
    return "This suggestion needs a manual edit — it doesn't map cleanly onto a template field.";
  }
  return null;
}
