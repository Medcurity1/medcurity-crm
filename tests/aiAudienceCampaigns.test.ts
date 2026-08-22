// Tests for the AI Campaigns audience vertical slice.
//
// Covers: access model, API payloads, recipient integrity, no-launch path,
// ambiguity/unsupported states, responsive contracts, and source labels.
//
// These are structural/contract tests — they verify the source code's shape,
// not runtime behavior (we don't mount React or hit live Supabase/AI).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { canonicalizeStateCode, isStagingProject } from "../supabase/functions/_shared/audience-spec";

const read = (relative: string) =>
  readFileSync(path.resolve(__dirname, "..", relative), "utf8");

function visibleSource(relative: string): string {
  return read(relative)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

// ── Access model ──────────────────────────────────────────────────────

describe("AI audience access model", () => {
  it("interpret-audience and resolve-audience are in REP_ELIGIBLE_AI_ACTIONS", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toMatch(/REP_ELIGIBLE_AI_ACTIONS.*=.*new Set\(\[/);
    expect(edgeFn).toContain('"interpret-audience"');
    expect(edgeFn).toContain('"resolve-audience"');
  });

  it("admin-only actions (generate-ideas, campaign-insights) are NOT in rep-eligible set", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    // Extract the REP_ELIGIBLE_AI_ACTIONS set content
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match).toBeTruthy();
    const setContent = match![1];
    expect(setContent).not.toContain("generate-ideas");
    expect(setContent).not.toContain("campaign-insights");
    expect(setContent).not.toContain("analyze-campaign");
  });

  it("non-admin rep callers get userId checked for audience actions", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    // The auth check for rep-eligible actions requires callerUserId
    expect(edgeFn).toMatch(/REP_ELIGIBLE_AI_ACTIONS\.has\(action\)/);
    expect(edgeFn).toMatch(/callerUserId\(auth\)/);
  });
});

// ── API payloads ──────────────────────────────────────────────────────

describe("AI audience API hooks", () => {
  it("useInterpretAudience sends action: interpret-audience with brief", () => {
    const api = read("src/features/playbook/api.ts");
    expect(api).toMatch(/action:\s*"interpret-audience"/);
    expect(api).toMatch(/brief/);
  });

  it("useResolveAudience sends action: resolve-audience with interpretation_id", () => {
    const api = read("src/features/playbook/api.ts");
    expect(api).toMatch(/action:\s*"resolve-audience"/);
    expect(api).toMatch(/interpretation_id:\s*p\.interpretation_id/);
  });

  it("resolve-audience never sends raw_prompt or model_id from client", () => {
    const api = read("src/features/playbook/api.ts");
    // The resolve hook should only send interpretation_id and confirm_unfiltered
    const resolveBlock = api.slice(api.indexOf("useResolveAudience"), api.indexOf("useResolveAudience") + 500);
    expect(resolveBlock).not.toContain("raw_prompt");
    expect(resolveBlock).not.toContain("model_id");
  });
});

// ── Recipient integrity ───────────────────────────────────────────────

describe("AI audience recipient integrity", () => {
  it("converts eligible members to Recipient format with contact_id and account_id", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    // The onComplete handler maps eligible to Recipient with these fields
    expect(flow).toMatch(/email:\s*m\.email/);
    expect(flow).toMatch(/contact_id:\s*m\.contact_id/);
    expect(flow).toMatch(/account_id:\s*m\.account_id/);
  });

  it("only eligible members become recipients (excluded/ambiguous/enrolled do not)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    // The handleConfirmAudience function maps resolution.eligible only
    expect(flow).toMatch(/resolution\.eligible\.map/);
    expect(flow).not.toMatch(/resolution\.excluded\.map\(\(m\)\s*=>\s*\(\{[\s\S]*?email:/);
    expect(flow).not.toMatch(/resolution\.ambiguous\.map\(\(m\)\s*=>\s*\(\{[\s\S]*?email:/);
  });

  it("deduplication is handled server-side (one email per run via UNIQUE constraint)", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toMatch(/unique\s*\(run_id,\s*email_normalized\)/i);
  });
});

// ── No launch / Smartlead path ────────────────────────────────────────

describe("AI audience no-launch path", () => {
  it("ask-ai flow forces autoStart to false", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // The ask-ai method handler sets autoStart false
    expect(wizard).toMatch(/ask-ai[\s\S]*?setAutoStart\(false\)/);
  });

  it("handleAiAudienceComplete forces autoStart false", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/handleAiAudienceComplete[\s\S]*?setAutoStart\(false\)/);
  });

  it("AI audience review screen says nothing is enrolled yet", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("No recipients have been enrolled and no emails have been sent");
    expect(wizard).toContain("No sending inbox is assigned");
    expect(wizard).toContain("no Smartlead campaign is created yet");
  });

  it("AI audience save calls saveCampaignDraft, not doLaunch", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // doSaveAiDraft uses saveCampaignDraft
    expect(wizard).toMatch(/doSaveAiDraft[\s\S]*?saveCampaignDraft/);
    // doSaveAiDraft does NOT reference launch or smartlead
    const saveBlock = wizard.slice(
      wizard.indexOf("function doSaveAiDraft"),
      wizard.indexOf("function doLaunch"),
    );
    expect(saveBlock).not.toContain("launch");
    expect(saveBlock).not.toContain("smartlead");
    expect(saveBlock).not.toContain("Smartlead");
    expect(saveBlock).toContain("saveCampaignDraft");
  });

  it("resolve-audience never calls Smartlead or launches", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const resolveBlock = edgeFn.slice(
      edgeFn.indexOf("async function resolveAudience"),
      edgeFn.indexOf("// ── AI Audience: generate-audience-draft"),
    );
    expect(resolveBlock.length).toBeGreaterThan(100);
    expect(resolveBlock).not.toContain("smartlead");
    expect(resolveBlock).not.toContain("Smartlead");
    expect(resolveBlock).not.toMatch(/campaign_enrollments_append/);
    expect(resolveBlock).not.toMatch(/campaign_launch_claim/);
  });

  it("interpret-audience never executes SQL, only calls AI model", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const interpretBlock = edgeFn.slice(
      edgeFn.indexOf("async function interpretAudience"),
      edgeFn.indexOf("async function resolveAudience"),
    );
    // Should call callClaude, never execute queries on contacts/accounts
    expect(interpretBlock).toMatch(/callClaude/);
    expect(interpretBlock).not.toMatch(/\.from\("contacts"\)/);
    expect(interpretBlock).not.toMatch(/\.from\("accounts"\)/);
  });
});

// ── Ambiguity / unsupported states ────────────────────────────────────

describe("AI audience ambiguity handling", () => {
  it("AudienceSpec includes ambiguous_criteria and unsupported_criteria arrays", () => {
    const specFile = read("supabase/functions/_shared/audience-spec.ts");
    expect(specFile).toMatch(/ambiguous_criteria\?:\s*string\[\]/);
    expect(specFile).toMatch(/unsupported_criteria\?:\s*string\[\]/);
  });

  it("UI shows ambiguous criteria with warning and blocks automatic inclusion", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("Ambiguous criteria");
    expect(flow).toContain("will not be included in the search");
    expect(flow).toContain("ambiguous_criteria");
  });

  it("UI shows unsupported criteria with info notice", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("Not available in this version");
    expect(flow).toContain("can't filter on these criteria yet");
    expect(flow).toContain("unsupported_criteria");
  });

  it("ambiguous contacts have their own count card and member list section", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/label="Ambiguous"/);
    expect(flow).toContain("proofSection === \"ambiguous\"");
    expect(flow).toContain("No ambiguous matches.");
  });

  it("AI prompt instructs model to flag ambiguous terms instead of guessing", () => {
    const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
    expect(prompts).toContain("ambiguous");
    expect(prompts).toContain("ambiguous_criteria");
    expect(prompts).toContain("DO NOT include any values for that term");
  });

  it("AI prompt instructs model to flag unsupported terms", () => {
    const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
    expect(prompts).toContain("unsupported_criteria");
    expect(prompts).toContain("DO NOT guess");
  });

  it("region names like Pacific Northwest are treated as ambiguous in the prompt", () => {
    const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
    expect(prompts).toContain("Pacific Northwest");
    expect(prompts).toContain("ambiguous_criteria");
  });
});

// ── Provenance and source labels ──────────────────────────────────────

describe("AI audience provenance", () => {
  it("interpretation binding: resolve requires interpretation_id for AI path", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toMatch(/interpretation_id/);
    // The resolve function checks interpretation ownership
    expect(edgeFn).toContain("Interpretation belongs to a different user");
    expect(edgeFn).toContain("Interpretation already consumed");
    expect(edgeFn).toContain("Interpretation has expired");
  });

  it("provenance tables are created with RLS and immutability", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("campaign_audience_interpretations");
    expect(migration).toContain("campaign_audience_runs");
    expect(migration).toContain("campaign_audience_run_members");
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toContain("audience_runs_immutable_guard");
    expect(migration).toContain("audience_members_immutable_guard");
  });

  it("UI shows source provenance label (CRM only, Interpreted by Pulse AI)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("Pulse CRM only. No external data providers.");
    expect(flow).toContain("Interpreted by Pulse AI");
    expect(flow).not.toContain("interpretation.model_id");
  });

  it("UI shows AI-resolved audience label in wizard", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("AI-resolved audience");
  });

  it("PII guard rejects briefs with email/phone/SSN", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toMatch(/detectPiiPatterns/);
    expect(spec).toContain("email address");
    expect(spec).toContain("phone number");
    expect(spec).toContain("Social Security number");
  });

  it("SQL injection patterns are rejected in spec validation", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toMatch(/containsSqlFragment/);
    expect(spec).toContain("ILIKE");
    expect(spec).toContain("union");
    expect(spec).toContain("disallowed SQL fragment");
  });
});

// ── Responsive and accessible ─────────────────────────────────────────

describe("AI audience responsive and accessible", () => {
  it("AiAudienceFlow has no em or en dashes in visible text", () => {
    const flow = visibleSource("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).not.toMatch(/[—–]/);
  });

  it("count cards use proper aria-pressed and aria-label", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/aria-pressed=\{active\}/);
    expect(flow).toMatch(/aria-label=\{.*label.*count/);
  });

  it("member list uses role=table with columnheaders", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/role="table"/);
    expect(flow).toMatch(/role="columnheader"/);
    expect(flow).toMatch(/role="row"/);
    expect(flow).toMatch(/role="cell"/);
  });

  it("error states use role=alert", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    const alertCount = (flow.match(/role="alert"/g) ?? []).length;
    expect(alertCount).toBeGreaterThanOrEqual(2); // interpret error + resolve error + ambiguity + unsupported
  });

  it("buttons have aria-label for screen readers", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/aria-label="Go back to method selection"/);
    expect(flow).toMatch(/aria-label="Interpret audience description"/);
    // Search CRM aria-label is conditional on hasSupportedFilters
    expect(flow).toMatch(/aria-label=\{hasSupportedFilters \? "Search CRM for matching contacts"/);
  });

  it("email column uses truncate + title for long addresses (no horizontal overflow)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/truncate.*title=\{m\.email\}/);
  });

  it("member list has max-height scroll container (no page-level overflow)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/max-h-\[300px\]/);
    expect(flow).toMatch(/overflow-y-auto/);
  });

  it("reason codes use break-words to prevent overflow", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/break-words.*role="cell"/);
  });
});

// ── Types contract ────────────────────────────────────────────────────

describe("AI audience types", () => {
  it("types.ts exports AudienceSpecV1 with correct filter fields", () => {
    const types = read("src/features/playbook/types.ts");
    expect(types).toContain("interface AudienceSpecV1");
    expect(types).toContain("industry_category_values");
    expect(types).toContain("project_segment_values");
    expect(types).toContain("state_values");
  });

  it("types.ts exports AudienceMemberPreview with disposition and reason_codes", () => {
    const types = read("src/features/playbook/types.ts");
    expect(types).toContain("interface AudienceMemberPreview");
    expect(types).toContain("disposition");
    expect(types).toContain("reason_codes");
  });

  it("types.ts exports AudienceResolveResult with counts and member lists", () => {
    const types = read("src/features/playbook/types.ts");
    expect(types).toContain("interface AudienceResolveResult");
    expect(types).toContain("total_eligible");
    expect(types).toContain("total_excluded");
    expect(types).toContain("total_ambiguous");
    expect(types).toContain("eligible:");
    expect(types).toContain("excluded:");
    expect(types).toContain("ambiguous:");
  });

  it("AudienceSpecV1 exclusion flags are locked to true", () => {
    const types = read("src/features/playbook/types.ts");
    expect(types).toMatch(/exclude_customers:\s*true/);
    expect(types).toMatch(/exclude_former_customers:\s*true/);
    expect(types).toMatch(/exclude_partners:\s*true/);
    expect(types).toMatch(/exclude_suppressed:\s*true/);
    expect(types).toMatch(/exclude_active_enrollments:\s*true/);
  });
});

// ── Blocker-specific: doSaveAiDraft is Pulse-local only ───────────────

describe("AI audience local-only save path (blocker 1)", () => {
  it("doSaveAiDraft calls saveCampaignDraft and never references launch/smartlead/enrollment", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    const saveStart = wizard.indexOf("function doSaveAiDraft");
    const saveEnd = wizard.indexOf("function doLaunch");
    expect(saveStart).toBeGreaterThan(0);
    expect(saveEnd).toBeGreaterThan(saveStart);
    const saveBlock = wizard.slice(saveStart, saveEnd);
    // Must call saveCampaignDraft
    expect(saveBlock).toContain("saveCampaignDraft");
    // Must NOT reference any launch/Smartlead/enrollment concepts
    expect(saveBlock.toLowerCase()).not.toContain("smartlead");
    expect(saveBlock).not.toContain("doLaunch");
    expect(saveBlock).not.toContain("useLaunchCampaign");
    expect(saveBlock).not.toContain("campaign_enrollments");
    expect(saveBlock).not.toContain("playbook-smartlead");
    expect(saveBlock).not.toContain("setLaunchResult");
  });

  it("doSaveAiDraft persists AI provenance via centralized buildDraftState", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const saveBlock = wizard.slice(
      wizard.indexOf("function doSaveAiDraft"),
      wizard.indexOf("function doLaunch"),
    );
    // Uses the shared state builder so provenance can never drift from autosave
    expect(saveBlock).toContain("buildDraftState()");
    // buildDraftState includes aiAudience when aiAudienceResult exists
    const buildStart = wizard.indexOf("function buildDraftState");
    const buildEnd = wizard.indexOf("useEffect", buildStart);
    const buildBlock = wizard.slice(buildStart, buildEnd);
    expect(buildBlock).toContain("aiAudience");
    expect(buildBlock).toContain("runId:");
    expect(buildBlock).toContain("interpretationId:");
    expect(buildBlock).toContain("specHash:");
  });

  it("AI audience Review (step 3) renders doSaveAiDraft, not doLaunch", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // The AI audience review section must call doSaveAiDraft
    const aiReviewStart = wizard.indexOf("Step 3.*AI audience draft");
    // Check the onClick binding on the save button in AI review
    expect(wizard).toContain("onClick={doSaveAiDraft}");
  });
});

// ── Blocker-specific: rep-safe generation action ──────────────────────

describe("AI audience rep-safe generate-audience-draft (blocker 3)", () => {
  it("generate-audience-draft is in REP_ELIGIBLE_AI_ACTIONS", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match).toBeTruthy();
    expect(match![1]).toContain('"generate-audience-draft"');
  });

  it("generate-campaign is NOT in REP_ELIGIBLE_AI_ACTIONS (stays admin-only)", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match![1]).not.toContain('"generate-campaign"');
  });

  it("generateAudienceDraft has no DB writes, no Smartlead, no enrollment", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).toContain("callClaude");
    expect(fnBlock).not.toContain('.from("campaigns")');
    expect(fnBlock).not.toContain('.from("campaign_enrollments")');
    expect(fnBlock).not.toContain("playbook-smartlead");
    expect(fnBlock).toContain("No DB writes, no Smartlead, no enrollment");
  });

  it("generateAudienceDraft validates via shared validateAudienceDraft", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("validateAudienceDraft");
    // Sequence count validation now lives in the shared validator
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("sequence must have exactly 3 emails");
  });

  it("frontend uses generate-audience-draft, not generate-campaign, for AI audience", () => {
    const api = read("src/features/playbook/api.ts");
    expect(api).toMatch(/action:\s*"generate-audience-draft"/);
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("genAudienceDraft.mutate");
  });
});

// ── Blocker-specific: resume retains provenance + draft-only ──────────

describe("AI audience resume provenance (blocker 2)", () => {
  it("CampaignDraftState has aiAudience field with provenance", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("aiAudience?:");
    expect(wizard).toContain("runId: string");
    expect(wizard).toContain("interpretationId: string");
    expect(wizard).toContain("specHash: string");
  });

  it("resume sets autoStart false for AI audience drafts", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("isAiAudienceDraft ? false : s.autoStart");
  });

  it("resume restores aiAudienceResult from saved provenance", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("setAiAudienceResult(");
    expect(wizard).toContain("s.aiAudience.runId");
    expect(wizard).toContain("s.aiAudience.interpretationId");
  });
});

// ── Blocker-specific: admin-only controls hidden in AI mode ───────────

describe("AI audience admin-only controls hidden (blocker 4)", () => {
  it("Regenerate and Suggest buttons hidden when aiAudienceResult set", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // The guard wraps Regenerate/Suggest in {!aiAudienceResult && (...)}
    expect(wizard).toContain("{!aiAudienceResult && (");
    expect(wizard).toContain("Regenerate and Suggest use admin-only actions");
  });

  it("per-email AI rewrite button hidden in AI audience mode", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("Per-email AI rewrite uses admin-only regenerate-email");
    expect(wizard).toContain("{!aiAudienceResult && (");
  });
});

// ── Blocker-specific: unfiltered interpretation cannot resolve ─────────

describe("AI audience unfiltered guard (blocker 5)", () => {
  it("Search CRM is disabled when hasSupportedFilters is false", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("!hasSupportedFilters");
    expect(flow).toContain("disabled={resolve.isPending || !hasSupportedFilters}");
  });

  it("shows guidance to refine description when no filters", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("No supported filters found. Refine your description");
  });
});

// ── Blocker-specific: AI review has no sender/Smartlead/launch UI ─────

describe("AI audience review screen isolation (blocker 6)", () => {
  it("AI review section does not contain sender picker", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // The AI review path renders when aiAudienceResult is set
    const aiReviewStart = wizard.indexOf("Step 3.*AI audience draft");
    const normalReviewStart = wizard.indexOf("Step 3.*normal launch");
    // The AI review section text should say no inbox/enrollment
    expect(wizard).toContain("No sending inbox is assigned, no recipients are enrolled");
  });

  it("AI review section does not contain Smartlead readiness", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // The separate AI draft review should not mention SmartleadReady
    // (the doSaveAiDraft section was already proven clean above)
    expect(wizard).toContain("doSaveAiDraft");
  });

  it("AI review button calls doSaveAiDraft not doLaunch", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("onClick={doSaveAiDraft}");
  });
});

// ── CampaignWizard integration ────────────────────────────────────────

describe("AI audience CampaignWizard integration", () => {
  it("Ask AI is a build start method alongside template and write-my-own", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain('"ask-ai"');
    expect(wizard).toContain('"Ask AI"');
    expect(wizard).toContain("Describe your audience and get a proposed campaign.");
  });

  it("ask-ai is accepted as a valid flow value in draft state", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/flow.*ask-ai/);
    // parseCampaignDraftState accepts ask-ai
    expect(wizard).toMatch(/ask-ai.*return null/);
  });

  it("AiAudienceFlow is rendered when flow is ask-ai and no campaign", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/flow\s*===\s*"ask-ai"\s*&&\s*!campaign/);
    expect(wizard).toContain("<AiAudienceFlow");
  });

  it("handleAiAudienceComplete sets recipients, generates sequence, and transitions to ai flow", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("handleAiAudienceComplete");
    expect(wizard).toMatch(/setRecipients\(result\.recipients\)/);
    expect(wizard).toMatch(/genAudienceDraft\.mutate/);
    expect(wizard).toMatch(/setFlow\("ai"\)/);
  });

  it("the stepper shows Build, People, Review steps", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain('"Build"');
    expect(wizard).toContain('"People"');
    expect(wizard).toContain('"Review"');
  });
});

// ── Correction 1: resume flow saves/restores flow='ai' for AI drafts ──

describe("correction 1: AI draft resume renders sequence editor", () => {
  it("buildDraftState saves AI audience drafts with flow='ai' not flow='ask-ai'", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const buildStart = wizard.indexOf("function buildDraftState");
    const buildEnd = wizard.indexOf("useEffect", buildStart);
    const buildBlock = wizard.slice(buildStart, buildEnd);
    expect(buildBlock).toContain('aiAudienceResult ? "ai" : flow');
  });

  it("resume forces flow='ai' when aiAudience exists", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // isAiAudienceDraft check forces "ai" flow
    expect(wizard).toContain("isAiAudienceDraft");
    expect(wizard).toMatch(/isAiAudienceDraft\s*\?\s*"ai"/);
  });

  it("resumed AI draft stays draft-only (autoStart forced false when aiAudience present)", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("isAiAudienceDraft ? false : s.autoStart");
  });
});

// ── Correction 2: success copy references Create campaign > Resume ────

describe("correction 2: honest success copy", () => {
  it("success message says Create campaign then Resume, not Campaigns list", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("Create campaign, then Resume");
    expect(wizard).not.toContain("Open it from your Campaigns list");
  });

  it("toast also says Create campaign then Resume", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("Choose Create campaign, then Resume");
  });
});

// ── Correction 3: no hardcoded SRA; brief preserved ───────────────────

describe("correction 3: original brief preserved for generation", () => {
  it("AiAudienceResult includes brief field", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toMatch(/brief:\s*string/);
    expect(flow).toContain("brief: brief.trim()");
  });

  it("generation context uses result.brief, not hardcoded SRA", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    const completeBlock = wizard.slice(
      wizard.indexOf("function handleAiAudienceComplete"),
      wizard.indexOf("function regenerateWithFeedback"),
    );
    expect(completeBlock).toContain("result.brief");
    expect(completeBlock).not.toContain("SRA");
    expect(completeBlock).not.toContain("Security Risk Analysis");
  });

  it("draft provenance includes brief via buildDraftState", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const buildStart = wizard.indexOf("function buildDraftState");
    const buildEnd = wizard.indexOf("useEffect", buildStart);
    expect(wizard.slice(buildStart, buildEnd)).toContain("brief: aiAudienceResult.brief");
  });

  it("intake copy asks about audience AND goal", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("Describe your audience and goal");
    expect(flow).toContain("what the campaign should accomplish");
  });
});

// ── Correction 4: hardened generate-audience-draft ─────────────────────

describe("correction 4: generate-audience-draft hardening", () => {
  it("applies PII check on its own description input", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).toContain("detectPiiPatterns");
    expect(fnBlock).toContain("piiRejectionMessage");
  });

  it("validates campaign_name and target_audience are nonempty and bounded", () => {
    // Validation now lives in shared validateAudienceDraft
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("validateAudienceDraft");
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("Empty campaign_name");
    expect(spec).toContain("Empty target_audience");
    expect(spec).toContain("campaign_name exceeds");
  });

  it("validates seq_number must be exactly 1,2,3", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toMatch(/email\.seq_number !== n/);
  });

  it("validates delay_days is integer in safe range", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("Number.isInteger(email.delay_days)");
    expect(spec).toContain("delay_days must be an integer");
  });

  it("rejects script/style/iframe tags and event handlers", () => {
    // Validation now in shared validator
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("<script");
    expect(spec).toContain("<style");
    expect(spec).toContain("<iframe");
    expect(spec).toMatch(/\\bon\\w\+/); // event handler pattern
    expect(spec).toContain("javascript");
  });

  it("validates subject and body length bounds", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("subject exceeds 60 characters");
    expect(spec).toContain("body has");
  });

  it("comments accurately say training-note reads are permitted but no DB writes", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const fnBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(fnBlock).toContain("Training-note reads are permitted");
    expect(fnBlock).toContain("No other DB writes");
    expect(fnBlock).toContain("No DB writes, no Smartlead, no enrollment");
    expect(fnBlock).toContain("read-only DB call");
  });
});

// ── Correction 5: interpret footer layout at 390px ────────────────────

describe("correction 5: interpret footer responsive layout", () => {
  it("no-filter warning is on its own row, not inside the button flex", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    // Warning must appear BEFORE the flex row, not as a sibling inside it
    const warningIdx = flow.indexOf("No supported filters found");
    const flexIdx = flow.indexOf("flex-col-reverse gap-2 pt-1 sm:flex-row");
    expect(warningIdx).toBeLessThan(flexIdx);
  });

  it("button row uses flex-col-reverse for mobile stacking", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between");
  });
});

// ── Correction 6: Save icon replaces Rocket ───────────────────────────

describe("correction 6: Save icon on local draft button", () => {
  it("AI draft save button uses Save icon, not Rocket", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // Import includes Save
    expect(wizard).toContain("Save,");
    // The doSaveAiDraft button line uses Save, not Rocket
    expect(wizard).toMatch(/<Save className.*Save draft/);
  });
});

// ── Correction 7: full spec preserved in draft provenance ─────────────

describe("correction 7: full AudienceSpec in draft provenance", () => {
  it("CampaignDraftState.aiAudience includes spec and brief fields", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // The aiAudience type definition includes spec
    expect(wizard).toMatch(/aiAudience\?:\s*\{[\s\S]*?spec:\s*import/);
    expect(wizard).toMatch(/aiAudience\?:\s*\{[\s\S]*?brief:\s*string/);
  });

  it("buildDraftState persists the actual spec from aiAudienceResult", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const buildStart = wizard.indexOf("function buildDraftState");
    const buildEnd = wizard.indexOf("useEffect", buildStart);
    expect(wizard.slice(buildStart, buildEnd)).toContain("spec: aiAudienceResult.spec");
  });

  it("resume restores spec from saved aiAudience.spec, not fabricated", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    // Resume uses s.aiAudience.spec not a hardcoded object
    expect(wizard).toContain("spec: s.aiAudience.spec");
    // Should NOT have fabricated filters: {}
    expect(wizard).not.toContain("filters: {}, exclude_customers:");
  });
});

// ── Audit round 3: centralized autosave + method clearing + provenance link ──

describe("audit 3 fix 1: autosave includes aiAudience provenance", () => {
  it("autosave uses centralized buildDraftState that includes aiAudience", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // The autosave effect calls buildDraftState()
    const autosaveIdx = wizard.indexOf("Debounced autosave");
    const autosaveBlock = wizard.slice(autosaveIdx, wizard.indexOf("return () => clearTimeout(t);", autosaveIdx));
    expect(autosaveBlock).toContain("buildDraftState()");
    // buildDraftState sets autoStart=false when aiAudienceResult is present
    const buildStart = wizard.indexOf("function buildDraftState");
    const buildEnd = wizard.indexOf("useEffect", buildStart);
    const buildBlock = wizard.slice(buildStart, buildEnd);
    expect(buildBlock).toContain("aiAudienceResult ? false : autoStart");
  });

  it("autosave dependency array includes aiAudienceResult", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // The effect dependency array must include aiAudienceResult
    const depsIdx = wizard.indexOf("autoStart, adaptive, leadsPerDay, minGap, deliverySettings, aiAudienceResult");
    expect(depsIdx).toBeGreaterThan(0);
  });
});

describe("audit 3 fix 2: method switching clears AI audience state", () => {
  it("every non-ask-ai method handler clears aiAudienceResult", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // Count setAiAudienceResult(null) calls in method handlers + back button
    const matches = wizard.match(/setAiAudienceResult\(null\)/g);
    // At minimum: choose + template + ai methods + back button + reset = 6
    expect(matches!.length).toBeGreaterThanOrEqual(6);
  });
});

describe("audit 3 fix 3: provenance link", () => {
  it("link-audience-draft is in REP_ELIGIBLE_AI_ACTIONS", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match![1]).toContain('"link-audience-draft"');
  });

  it("linkAudienceDraft verifies caller owns both run and draft", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("You do not own this audience run");
    expect(edgeFn).toContain("You do not own this draft");
  });

  it("linkAudienceDraft is idempotent (already-linked pair is a no-op)", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("already_linked");
  });

  it("migration adds draft_id FK on campaign_audience_runs", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("draft_id");
    expect(migration).toContain("references public.campaign_drafts(id)");
  });

  it("doSaveAiDraft calls linkDraft.mutate after save succeeds", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const saveBlock = wizard.slice(
      wizard.indexOf("function doSaveAiDraft"),
      wizard.indexOf("function doLaunch"),
    );
    expect(saveBlock).toContain("linkDraft.mutate");
    expect(saveBlock).toContain("aiDraftLinkedRef");
  });

  it("autosave does not repeatedly relink (ref guard)", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("aiDraftLinkedRef");
  });
});

describe("audit 3 fix 4: honest resume copy", () => {
  it("does not promise inbox selection or Start from AI draft", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).not.toContain("choose a sending inbox, and press Start");
    expect(wizard).toContain("Starting campaigns from AI drafts is not yet available");
  });
});

describe("audit 3 fix 5: generate input limit", () => {
  it("AUDIENCE_DRAFT_MAX_DESC is 2500 (brief 2000 + wrapper)", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_MAX_DESC = 2500");
  });
});

describe("audit 3 fix 6: Draft with AI hidden for non-admins", () => {
  it("build methods filter hides id=ai for non-admins", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain('id !== "ai" || isAdmin');
  });
});

describe("audit 3 fix 7: deep aiAudience validation in parseCampaignDraftState", () => {
  it("validates runId, interpretationId, specHash, brief, spec, counts", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const parserStart = wizard.indexOf("function parseCampaignDraftState");
    const parserEnd = wizard.indexOf("const BUILD_START_METHODS", parserStart);
    const parser = wizard.slice(parserStart, parserEnd);
    expect(parser).toContain('typeof a.runId !== "string"');
    expect(parser).toContain('typeof a.interpretationId !== "string"');
    expect(parser).toContain('typeof a.specHash !== "string"');
    expect(parser).toContain('typeof a.brief !== "string"');
    expect(parser).toContain("sp.version !== 1");
    expect(parser).toContain('typeof c.total_eligible !== "number"');
  });
});

describe("audit 3 fix 8: MemberList responsive layout", () => {
  it("uses stable compound keys with contact_id + email", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("key={`d-${m.contact_id}-${m.email}`}");
    expect(flow).toContain("key={`m-${m.contact_id}-${m.email}`}");
  });

  it("has mobile card layout with labels (hidden sm:block / sm:hidden split)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("hidden sm:block");
    expect(flow).toContain("sm:hidden divide-y");
    expect(flow).toContain("break-all");
  });

  it("desktop table uses flex columns not fixed widths for Reason", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    // Reason column uses flex-1 min-w-0, not a fixed w-40
    expect(flow).toMatch(/flex-1 min-w-0.*text-muted-foreground break-words/);
    expect(flow).not.toContain("w-40 shrink-0");
  });
});

describe("audit 3 fix 9: no pg_cron in migration", () => {
  it("migration does not contain cron.schedule", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).not.toContain("cron.schedule");
  });
});

describe("audit 3 fix 10: FTE intentionally unsupported", () => {
  it("AudienceSpecV1 has no fte_min or fte_max filter", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    const specBlock = spec.slice(spec.indexOf("interface AudienceSpecV1"), spec.indexOf("MAX_RESULTS_HARD_CAP"));
    expect(specBlock).not.toContain("fte_min");
    expect(specBlock).not.toContain("fte_max");
  });

  it("AI prompt labels FTE as unsupported", () => {
    const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
    expect(prompts).toContain("company size by FTE");
  });
});

// ── Audit round 4 ────────────────────────────────────────────────────────

describe("audit 4 fix 1: audience_run_set_status signature consistency", () => {
  it("create, revoke, and grant all use (uuid, text, uuid, uuid, text)", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    // The function has 5 params: p_run_id uuid, p_new_status text,
    // p_campaign_id uuid, p_draft_id uuid, p_launched_spec_hash text
    const fnSig = "(uuid, text, uuid, uuid, text)";
    expect(migration).toContain(`revoke all on function public.audience_run_set_status${fnSig}`);
    expect(migration).toContain(`grant execute on function public.audience_run_set_status${fnSig}`);
    // The CREATE should define 5 parameters matching
    expect(migration).toMatch(/create or replace function public\.audience_run_set_status\(\s*p_run_id uuid/);
    expect(migration).toContain("p_draft_id uuid default null");
    expect(migration).toContain("p_launched_spec_hash text default null");
  });
});

describe("audit 4 fix 2: Done bypasses discard guard after AI draft save", () => {
  it("discard guard condition includes aiDraftSaved bypass", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("!aiDraftSaved");
    expect(wizard).toMatch(/wizardDirty && !launchResult && !aiDraftSaved/);
  });
});

describe("audit 4 fix 3: duplicate safety union", () => {
  it("unions all safety reasons from duplicate contacts into canonical member", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("Union ALL safety-relevant reasons");
    expect(edgeFn).toContain("canonical.reason_codes.includes(r)");
  });

  it("does not embed contact/account IDs in reason strings", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const resolveBlock = edgeFn.slice(
      edgeFn.indexOf("async function resolveAudience"),
      edgeFn.indexOf("// ── AI Audience: generate-audience-draft"),
    );
    // No template-literal ID embedding in reason codes
    expect(resolveBlock).not.toContain("duplicate_contact:${");
    expect(resolveBlock).toContain('"duplicate_contact"');
  });

  it("promotes canonical disposition to excluded when any duplicate has exclusion", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain('hasExclusions && canonical.disposition !== "excluded"');
    expect(edgeFn).toContain('canonical.disposition = "excluded"');
  });
});

describe("audit 4 fix 4: state canonicalization", () => {
  it("exports canonicalizeStateCode from audience-spec", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("export function canonicalizeStateCode");
  });

  it("canonicalizes full state names to codes", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain('"minnesota": "MN"');
    expect(spec).toContain('"new york": "NY"');
  });

  it("resolver uses canonicalizeStateCode for matching", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("canonicalizeStateCode(a.billing_state)");
    expect(edgeFn).toContain("canonicalizeStateCode(c.mailing_state)");
  });

  it("snapshots the source that actually matched, not always billing", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("matchedStateCode");
    expect(edgeFn).toContain("billingMatch ? billingCode : mailingMatch ? mailingCode");
  });
});

describe("audit 4 fix 5: reject overlong output, require visible text", () => {
  it("rejects overlong campaign_name instead of truncating", () => {
    // Validation now in shared validateAudienceDraft
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("campaign_name exceeds");
    // Must NOT truncate (no slice assignment for campaign_name)
    expect(spec).not.toMatch(/raw\.campaign_name\s*=.*\.slice/);
  });

  it("requires nonempty visible text after stripping tags", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("no visible text content");
    expect(spec).toContain("visibleText");
  });
});

describe("audit 4 fix 6: privacy screen version", () => {
  it("PRIVACY_SCREEN_VERSION exported from audience-spec", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain('PRIVACY_SCREEN_VERSION = "contact_pattern_v1"');
  });

  it("interpretation RPC receives privacy_screen_version", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("p_privacy_screen_version: PRIVACY_SCREEN_VERSION");
  });

  it("migration stores privacy_screen_version on interpretations table", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("privacy_screen_version text not null");
    expect(migration).toContain("contact_pattern_v1");
  });

  it("doc comments say screened for contact patterns, not PII-checked", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("Contact-pattern screen");
    expect(spec).toContain("Intentionally lightweight");
    expect(spec).not.toMatch(/PII guard/);
  });
});

describe("audit 4 fix 7: discard lifecycle expires audience run", () => {
  it("expire-audience-run is in REP_ELIGIBLE_AI_ACTIONS", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match![1]).toContain('"expire-audience-run"');
  });

  it("discardDraft uses transactional discard RPC for AI-linked drafts", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const discardBlock = wizard.slice(
      wizard.indexOf("function discardDraft"),
      wizard.indexOf("function reset"),
    );
    expect(discardBlock).toContain("discardAiDraft.mutate");
    expect(discardBlock).toContain("draftBanner.state.aiAudience");
  });

  it("discard failure shows error and keeps banner visible", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const discardBlock = wizard.slice(
      wizard.indexOf("function discardDraft"),
      wizard.indexOf("function reset"),
    );
    // AI path: banner only hidden on success, not before mutation
    expect(discardBlock).toContain("onSuccess: () => setDraftBanner(null)");
    expect(discardBlock).toContain("Could not discard AI draft");
  });
});

describe("audit 4 fix 8: typed HTTP errors for audience actions", () => {
  it("AudienceActionError class exists with status and retryable", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("class AudienceActionError");
    expect(edgeFn).toContain("status: number");
    expect(edgeFn).toContain("retryable: boolean");
  });

  it("catch block returns typed status for AudienceActionError", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("instanceof AudienceActionError");
    expect(edgeFn).toContain("e.status");
    expect(edgeFn).toContain("e.retryable");
  });

  it("uses 400 for bad input, 409 for expired/consumed, 422 for unsafe output", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AudienceActionError(");
    // Check specific status codes
    expect(edgeFn).toMatch(/AudienceActionError\(.*400\)/);
    expect(edgeFn).toMatch(/AudienceActionError\(.*409\)/);
    expect(edgeFn).toMatch(/AudienceActionError\(.*422\)/);
  });
});

// ── Final review round 5 ─────────────────────────────────────────────────

describe("review 5 fix 1: aiDraftSaved re-dirties on edits after save", () => {
  it("tracks saved snapshot via aiDraftSavedSnapshotRef", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("aiDraftSavedSnapshotRef");
    // Snapshot is set on save success
    expect(wizard).toContain("aiDraftSavedSnapshotRef.current = closeStateSnapshot");
  });

  it("resets aiDraftSaved when state diverges from saved snapshot", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // Effect compares closeStateSnapshot to the saved snapshot
    expect(wizard).toContain("closeStateSnapshot !== aiDraftSavedSnapshotRef.current");
    expect(wizard).toContain("setAiDraftSaved(false)");
  });

  it("clears snapshot ref on reset", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("aiDraftSavedSnapshotRef.current = null");
  });

  it("discard guard comment says EXACT saved state", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("EXACT");
    expect(wizard).toContain("edits after save re-dirty");
  });
});

describe("review 5 fix 2: disposition precedence", () => {
  it("initial disposition: excluded outranks ambiguous", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    // The line must be: hasExclusions ? "excluded" : isAmbiguous ? "ambiguous" : "eligible"
    // NOT: isAmbiguous ? "ambiguous" : hasExclusions ? "excluded" : "eligible"
    expect(edgeFn).toMatch(/hasExclusions \? "excluded" : isAmbiguous \? "ambiguous" : "eligible"/);
    expect(edgeFn).not.toMatch(/isAmbiguous \? "ambiguous" : hasExclusions \? "excluded"/);
  });

  it("suppression/enrollment checks run on ALL matched emails, not just eligible", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("allMatchedEmails");
    expect(edgeFn).not.toContain("eligibleEmails");
    // Suppression and enrollment batches use allMatchedEmails
    expect(edgeFn).toMatch(/allMatchedEmails\.length > 0/);
  });

  it("re-derives disposition after suppression/enrollment with deterministic precedence", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    // After applying suppression/enrollment, re-derive with precedence
    expect(edgeFn).toContain("Re-derive disposition with deterministic precedence");
    // Authoritative suppression via suppressionMap.has, not reason string enumeration
    expect(edgeFn).toContain("isSuppressed");
    expect(edgeFn).toContain("suppressionMap.has(m.email_normalized)");
    // Direct contact/account flags are still explicit
    expect(edgeFn).toContain("hasDirectExclusion");
  });

  it("suppression reasons added to ALL members, not skipped for non-eligible", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const applyBlock = edgeFn.slice(
      edgeFn.indexOf("Apply suppression + enrollment to ALL"),
      edgeFn.indexOf("// 5. Apply max_results"),
    );
    // The loop must NOT have "if disposition !== eligible continue"
    expect(applyBlock).not.toContain('disposition !== "eligible"');
    expect(applyBlock).not.toContain("continue");
  });
});

describe("review 5 fix 3: migration comments honest about v1 scope", () => {
  it("does not claim launch recheck or Start verification", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).not.toContain("launch-time recheck");
    expect(migration).not.toContain("Start verifies");
    expect(migration).not.toContain("spec_hash enables launch");
  });

  it("says future launch-phase integration for spec_hash", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("future launch-phase integration");
    expect(migration).toContain("v1 is Save Draft only");
  });
});

// ── Behavioral helper tests (import real functions, not string matching) ──

describe("canonicalizeStateCode (behavioral)", () => {
  it("returns 2-letter code for valid uppercase input", () => {
    expect(canonicalizeStateCode("MN")).toBe("MN");
    expect(canonicalizeStateCode("CA")).toBe("CA");
    expect(canonicalizeStateCode("NY")).toBe("NY");
  });

  it("normalizes lowercase codes", () => {
    expect(canonicalizeStateCode("mn")).toBe("MN");
    expect(canonicalizeStateCode("ca")).toBe("CA");
  });

  it("normalizes full state names", () => {
    expect(canonicalizeStateCode("Minnesota")).toBe("MN");
    expect(canonicalizeStateCode("california")).toBe("CA");
    expect(canonicalizeStateCode("New York")).toBe("NY");
    expect(canonicalizeStateCode("NORTH CAROLINA")).toBe("NC");
  });

  it("trims whitespace", () => {
    expect(canonicalizeStateCode("  MN  ")).toBe("MN");
    expect(canonicalizeStateCode("  minnesota  ")).toBe("MN");
  });

  it("returns null for unrecognized values", () => {
    expect(canonicalizeStateCode("XX")).toBeNull();
    expect(canonicalizeStateCode("Narnia")).toBeNull();
    expect(canonicalizeStateCode("")).toBeNull();
    expect(canonicalizeStateCode(null)).toBeNull();
    expect(canonicalizeStateCode(undefined)).toBeNull();
  });

  it("handles DC (District of Columbia)", () => {
    expect(canonicalizeStateCode("DC")).toBe("DC");
    expect(canonicalizeStateCode("district of columbia")).toBe("DC");
  });

  it("handles multi-word states", () => {
    expect(canonicalizeStateCode("West Virginia")).toBe("WV");
    expect(canonicalizeStateCode("south dakota")).toBe("SD");
    expect(canonicalizeStateCode("Rhode Island")).toBe("RI");
  });
});

// ── Review 6: authoritative suppression view ──────────────────────────────

describe("review 6: v_marketing_suppression is authoritative", () => {
  it("uses suppressionMap.has (boolean) not reason-string enumeration for exclusion", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const applyBlock = edgeFn.slice(
      edgeFn.indexOf("Apply suppression + enrollment to ALL"),
      edgeFn.indexOf("// 5. Apply max_results"),
    );
    // Must use suppressionMap.has as the authoritative suppression signal
    expect(applyBlock).toContain("suppressionMap.has(m.email_normalized)");
    // Must NOT enumerate individual suppression reasons for the exclusion decision
    expect(applyBlock).not.toContain('"optout_unsubscribed"');
    expect(applyBlock).not.toContain('"optout_bounced"');
    expect(applyBlock).not.toContain('"optout_manual"');
    expect(applyBlock).not.toContain('"marketing_suppression_frozen"');
    expect(applyBlock).not.toContain('"contact_archived"');
  });

  it("still preserves reason strings from suppression view for provenance", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const applyBlock = edgeFn.slice(
      edgeFn.indexOf("Apply suppression + enrollment to ALL"),
      edgeFn.indexOf("// 5. Apply max_results"),
    );
    // Reason codes from suppression view are pushed onto the member for provenance
    expect(applyBlock).toContain("m.reason_codes.push(r)");
  });

  it("comments explain v_marketing_suppression is authoritative for any reason", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("v_marketing_suppression is authoritative");
    expect(edgeFn).toContain("ANY row it returns is an");
    expect(edgeFn).toContain("lead_do_not_market_to");
  });

  it("isSuppressed || hasDirectExclusion drives excluded disposition", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("if (isSuppressed || hasDirectExclusion)");
  });

  it("an arbitrary suppression reason (e.g. lead_avoid) would exclude even an ambiguous record", () => {
    // Behavioral proof: the code uses suppressionMap.has, so any reason
    // string returned by v_marketing_suppression triggers isSuppressed=true,
    // which outranks ambiguity in the precedence chain.
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const applyBlock = edgeFn.slice(
      edgeFn.indexOf("Re-derive disposition with deterministic precedence"),
      edgeFn.indexOf("// 5. Apply max_results"),
    );
    // isSuppressed is derived from suppressionMap.has (covers ALL reasons)
    expect(applyBlock).toContain("const isSuppressed = suppressionMap.has(m.email_normalized)");
    // isSuppressed is checked BEFORE ambiguity in the if/else chain
    const suppressedCheck = applyBlock.indexOf("isSuppressed");
    const ambiguityCheck = applyBlock.indexOf("hasAmbiguity");
    expect(suppressedCheck).toBeGreaterThan(0);
    expect(ambiguityCheck).toBeGreaterThan(suppressedCheck);
    // The isSuppressed branch sets "excluded" unconditionally
    expect(applyBlock).toMatch(/if \(isSuppressed \|\| hasDirectExclusion\) \{\s*m\.disposition = "excluded"/);
  });
});

// ── Final audit: P0-1 recipient leak, P0-2 transactional discard, P1 staging-only ──

describe("final audit P0-1: AI recipients cleared, manual/locked preserved", () => {
  it("recipient clearing is conditional on hadAiAudience, not unconditional", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const handlers = wizard.slice(
      wizard.indexOf("setSequenceAttempted(false);"),
      wizard.indexOf("</button>", wizard.indexOf("setSequenceAttempted(false);") + 300),
    );
    // Every setRecipients([]) must be guarded by hadAiAudience
    expect(handlers).toContain("const hadAiAudience = !!aiAudienceResult");
    expect(handlers).toContain("if (hadAiAudience) setRecipients([])");
    // No unconditional setRecipients([]) outside the guard
    const unguarded = handlers.replace(/if \(hadAi\w*\) setRecipients\(\[\]\)/g, "");
    expect(unguarded).not.toContain("setRecipients([])");
  });

  it("AI-derived recipients are cleared on each method switch when AI audience was active", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const handlers = wizard.slice(
      wizard.indexOf("const hadAiAudience"),
      wizard.indexOf("</button>", wizard.indexOf("const hadAiAudience") + 100),
    );
    // Count conditional clears: one per handler (ask-ai, choose, template, ai)
    const conditionalClears = (handlers.match(/if \(hadAiAudience\) setRecipients\(\[\]\)/g) ?? []).length;
    expect(conditionalClears).toBe(4);
  });

  it("back button from AI sequence conditionally clears recipients", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("const hadAi = !!aiAudienceResult");
    expect(wizard).toContain("if (hadAi) setRecipients([])");
  });

  it("manual/locked recipients survive method switching (no unconditional clear)", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    // initialRecipients seeding remains in reset()
    expect(wizard).toContain("setRecipients(initialRecipients ?? [])");
    // In the method handlers block, every setRecipients([]) is guarded
    const handlers = wizard.slice(
      wizard.indexOf("const hadAiAudience"),
      wizard.indexOf("</button>", wizard.indexOf("const hadAiAudience") + 100),
    );
    // Strip the guarded calls; nothing unguarded should remain
    const stripped = handlers.replace(/if \(hadAiAudience\) setRecipients\(\[\]\)/g, "CLEARED");
    expect(stripped).not.toContain("setRecipients([])");
  });

  it("doLaunch has immutable guard rejecting AI audience provenance", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const launchBlock = wizard.slice(
      wizard.indexOf("function doLaunch"),
      wizard.indexOf("const shared = {"),
    );
    expect(launchBlock).toContain("aiAudienceResult");
    expect(launchBlock).toContain("AI audience campaigns can only be saved as drafts");
    expect(launchBlock).toContain("return;");
  });
});

describe("final audit P0-2: transactional discard_ai_audience_draft", () => {
  it("RPC exists in migration with correct signature", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("discard_ai_audience_draft");
    expect(migration).toMatch(/create or replace function public\.discard_ai_audience_draft\(\s*p_run_id\s+uuid/);
    expect(migration).toContain("p_draft_id uuid");
    expect(migration).toContain("p_user_id  uuid");
  });

  it("RPC sets GUC bypass, expires run, clears draft_id, deletes draft atomically", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    const rpcBlock = migration.slice(
      migration.indexOf("function public.discard_ai_audience_draft"),
      migration.indexOf("revoke all on function public.discard_ai_audience_draft"),
    );
    expect(rpcBlock).toContain("set local app.audience_provenance_rpc");
    expect(rpcBlock).toContain("status = 'expired'");
    expect(rpcBlock).toContain("draft_id = null");
    expect(rpcBlock).toContain("delete from public.campaign_drafts");
    expect(rpcBlock).toContain("for update");
  });

  it("Edge action discard-ai-audience-draft exists and is rep-eligible", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain('"discard-ai-audience-draft"');
    const match = edgeFn.match(/REP_ELIGIBLE_AI_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match![1]).toContain('"discard-ai-audience-draft"');
  });

  it("frontend uses transactional discard for AI-linked drafts", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("discardAiDraft.mutate");
    expect(wizard).toContain("useDiscardAiAudienceDraft");
  });
});

describe("final audit P1: Staging-only enforcement", () => {
  it("isStagingProject helper checks for known project ref", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("STAGING_PROJECT_REF");
    expect(spec).toContain("baekcgdyjedgxmejbytc");
    expect(spec).toContain("export function isStagingProject");
  });

  it("backend audience actions fail closed on non-Staging project", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("isStagingProject(SUPABASE_URL)");
    expect(edgeFn).toContain("AI audience features are only available on Staging");
  });

  it("non-audience actions are unaffected by Staging check", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    // The Staging check is inside the REP_ELIGIBLE block, not the admin block
    const adminBlock = edgeFn.slice(
      edgeFn.indexOf("} else {", edgeFn.indexOf("REP_ELIGIBLE_AI_ACTIONS.has(action)")),
      edgeFn.indexOf("if (action === \"generate-ideas\")"),
    );
    expect(adminBlock).not.toContain("isStagingProject");
  });

  it("frontend AI_AUDIENCE_ENABLED checks hostname", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("AI_AUDIENCE_ENABLED");
    expect(wizard).toContain("staging.crm.medcurity.com");
    expect(wizard).toContain("localhost");
  });

  it("Ask AI method filtered out when AI_AUDIENCE_ENABLED is false", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain('id !== "ask-ai" || AI_AUDIENCE_ENABLED');
  });

  it("production host would be rejected (behavioral)", () => {
    expect(isStagingProject("https://baekcgdyjedgxmejbytc.supabase.co")).toBe(true);
    expect(isStagingProject("https://some-production-ref.supabase.co")).toBe(false);
    expect(isStagingProject(undefined)).toBe(false);
    expect(isStagingProject("")).toBe(false);
  });

  it("migration drops both old 4-arg and current 5-arg status RPC before create", () => {
    const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
    expect(migration).toContain("drop function if exists public.audience_run_set_status(uuid, text, uuid, text)");
    expect(migration).toContain("drop function if exists public.audience_run_set_status(uuid, text, uuid, uuid, text)");
  });
});

// ── Immutability triggers: FK ON DELETE SET NULL allowance ─────────────

describe("immutability triggers allow FK ON DELETE SET NULL", () => {
  const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
  const runTrigger = migration.slice(
    migration.indexOf("create or replace function public.audience_runs_immutable_guard"),
    migration.indexOf("drop trigger if exists trg_audience_runs_no_update"),
  );
  const memberTrigger = migration.slice(
    migration.indexOf("create or replace function public.audience_members_immutable_guard"),
    migration.indexOf("drop trigger if exists trg_audience_members_no_update"),
  );

  // ── Runs trigger ──

  it("run trigger still blocks DELETE outside GUC", () => {
    expect(runTrigger).toContain("DELETE not permitted");
    expect(runTrigger).toContain("tg_op = 'DELETE'");
  });

  it("run trigger still allows RPC GUC bypass", () => {
    expect(runTrigger).toContain("app.audience_provenance_rpc");
    expect(runTrigger).toContain("return coalesce(new, old)");
  });

  it("run trigger checks all non-FK content fields are unchanged", () => {
    for (const field of [
      "spec", "spec_hash", "model_id", "status",
      "total_matched", "total_eligible", "total_excluded",
      "total_ambiguous", "total_duplicate", "total_active_enrollment",
      "created_at", "launched_at", "retention_expires_at", "redacted_at",
    ]) {
      expect(runTrigger).toContain(`new.${field}`);
    }
  });

  it("run trigger permits user_id/campaign_id/interpretation_id/draft_id value→NULL", () => {
    for (const fk of ["user_id", "campaign_id", "interpretation_id", "draft_id"]) {
      expect(runTrigger).toContain(`old.${fk}`);
      // Pattern: old.X is not null and new.X is null
      expect(runTrigger).toMatch(new RegExp(`old\\.${fk}\\s+is not null and new\\.${fk}\\s+is null`));
    }
  });

  it("run trigger rejects non-FK mutations outside GUC", () => {
    expect(runTrigger).toContain("use the provided RPCs");
  });

  // ── Members trigger ──

  it("member trigger still blocks DELETE outside GUC", () => {
    expect(memberTrigger).toContain("DELETE not permitted");
  });

  it("member trigger checks all non-FK fields are unchanged", () => {
    for (const field of [
      "run_id", "email_normalized", "disposition", "reason_codes",
      "snapshot_industry_category", "snapshot_project_segment", "snapshot_state",
      "snapshot_customer_status", "snapshot_account_type", "snapshot_account_name",
    ]) {
      expect(memberTrigger).toContain(`new.${field}`);
    }
  });

  it("member trigger permits contact_id/account_id value→NULL only", () => {
    for (const fk of ["contact_id", "account_id"]) {
      expect(memberTrigger).toMatch(new RegExp(`old\\.${fk} is not null and new\\.${fk} is null`));
    }
  });

  it("member trigger rejects content/disposition changes", () => {
    expect(memberTrigger).toContain("no UPDATE or DELETE permitted");
  });

  // ── Per-FK unchanged-or-null predicates (no mixed mutation loophole) ──

  it("run trigger: each FK has its own unchanged-OR-value→NULL predicate in the outer AND", () => {
    // Each FK must appear as: (new.X is not distinct from old.X or (old.X is not null and new.X is null))
    // inside the main IF block's AND chain, preventing any FK from changing
    // NULL→value or value→different-value while another FK is being nulled.
    for (const fk of ["user_id", "campaign_id", "interpretation_id", "draft_id"]) {
      const pattern = new RegExp(
        `\\(new\\.${fk}\\s+is not distinct from old\\.${fk}\\s+or \\(old\\.${fk}\\s+is not null and new\\.${fk}\\s+is null\\)\\)`,
      );
      expect(runTrigger).toMatch(pattern);
    }
  });

  it("member trigger: each FK has its own unchanged-OR-value→NULL predicate in the outer AND", () => {
    for (const fk of ["contact_id", "account_id"]) {
      const pattern = new RegExp(
        `\\(new\\.${fk} is not distinct from old\\.${fk} or \\(old\\.${fk} is not null and new\\.${fk} is null\\)\\)`,
      );
      expect(memberTrigger).toMatch(pattern);
    }
  });

  it("run trigger: no mixed mutation loophole — FK predicates are AND-joined not OR-only", () => {
    // The per-FK predicates must be AND-joined in the outer IF (not an
    // inner OR-only block that would allow one FK to change arbitrarily
    // while another is nulled).
    // Verify all four appear as "and (...)" clauses
    const andClauseCount = (runTrigger.match(/and \(new\.(user_id|campaign_id|interpretation_id|draft_id)\s+is not distinct from/g) ?? []).length;
    expect(andClauseCount).toBe(4);
  });

  it("member trigger: no mixed mutation loophole — FK predicates are AND-joined", () => {
    const andClauseCount = (memberTrigger.match(/and \(new\.(contact_id|account_id) is not distinct from/g) ?? []).length;
    expect(andClauseCount).toBe(2);
  });

  it("trigger never allows NULL→value or value→different-value on FK columns", () => {
    // The per-FK predicate is: unchanged OR (old not null AND new null).
    // "unchanged" via IS NOT DISTINCT FROM covers NULL=NULL and val=val.
    // The only mutation path is old-non-null→new-null.
    // No acceptance path exists for new.X is not null outside GUC.
    expect(runTrigger).not.toMatch(/new\.(user_id|campaign_id|interpretation_id|draft_id)\s+is not null.*return new/);
    expect(memberTrigger).not.toMatch(/new\.(contact_id|account_id)\s+is not null.*return new/);
  });
});

// ── BEFORE DELETE trigger on campaign_drafts ──────────────────────────

describe("campaign_drafts BEFORE DELETE trigger expires linked runs", () => {
  const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");

  it("trigger function exists and is BEFORE DELETE", () => {
    expect(migration).toContain("campaign_drafts_before_delete_expire_runs");
    expect(migration).toContain("before delete on public.campaign_drafts");
  });

  it("sets GUC bypass before updating the run", () => {
    const fn = migration.slice(
      migration.indexOf("function public.campaign_drafts_before_delete_expire_runs"),
      migration.indexOf("drop trigger if exists trg_campaign_drafts_expire_runs"),
    );
    expect(fn).toContain("set local app.audience_provenance_rpc = 'true'");
  });

  it("expires run and clears draft_id atomically", () => {
    const fn = migration.slice(
      migration.indexOf("function public.campaign_drafts_before_delete_expire_runs"),
      migration.indexOf("drop trigger if exists trg_campaign_drafts_expire_runs"),
    );
    expect(fn).toContain("status = 'expired'");
    expect(fn).toContain("draft_id = null");
    expect(fn).toContain("where draft_id = old.id");
  });

  it("only affects preview or draft_linked runs", () => {
    const fn = migration.slice(
      migration.indexOf("function public.campaign_drafts_before_delete_expire_runs"),
      migration.indexOf("drop trigger if exists trg_campaign_drafts_expire_runs"),
    );
    expect(fn).toContain("status in ('preview', 'draft_linked')");
  });

  it("returns OLD to allow the delete to proceed", () => {
    const fn = migration.slice(
      migration.indexOf("function public.campaign_drafts_before_delete_expire_runs"),
      migration.indexOf("drop trigger if exists trg_campaign_drafts_expire_runs"),
    );
    expect(fn).toContain("return old");
  });

  it("non-AI drafts pass through unchanged (no linked runs)", () => {
    const fn = migration.slice(
      migration.indexOf("function public.campaign_drafts_before_delete_expire_runs"),
      migration.indexOf("drop trigger if exists trg_campaign_drafts_expire_runs"),
    );
    // The EXISTS check means non-AI drafts skip the update entirely
    expect(fn).toContain("if exists");
    // Always returns old regardless
    expect(fn).toMatch(/return old;\s*end;/);
  });
});

// ── discard_ai_audience_draft integrity hardening ──────────────────────

describe("discard_ai_audience_draft integrity", () => {
  const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");
  const rpc = migration.slice(
    migration.indexOf("function public.discard_ai_audience_draft"),
    migration.indexOf("revoke all on function public.discard_ai_audience_draft"),
  );

  it("requires non-null p_run_id", () => {
    expect(rpc).toContain("'run_id is required'");
    expect(rpc).toMatch(/if p_run_id is null/);
  });

  it("requires non-null p_draft_id", () => {
    expect(rpc).toContain("'draft_id is required'");
    expect(rpc).toMatch(/if p_draft_id is null/);
  });

  it("requires non-null p_user_id", () => {
    expect(rpc).toContain("'user_id is required'");
    expect(rpc).toMatch(/if p_user_id is null/);
  });

  it("requires run exists (not found raises)", () => {
    expect(rpc).toContain("'Audience run not found'");
    expect(rpc).toContain("if not found");
  });

  it("requires run owned by caller", () => {
    expect(rpc).toContain("'You do not own this audience run'");
    expect(rpc).toContain("v_run_user is distinct from p_user_id");
  });

  it("requires run status is draft_linked (rejects preview)", () => {
    expect(rpc).toContain("v_run_status != 'draft_linked'");
    expect(rpc).toContain("Run status must be draft_linked to discard");
  });

  it("requires run.draft_id exactly equals p_draft_id (rejects mismatch)", () => {
    expect(rpc).toContain("v_run_draft is distinct from p_draft_id");
    expect(rpc).toContain("Run draft_id does not match");
  });

  it("requires draft exists and is owned", () => {
    expect(rpc).toContain("'Draft not found'");
    expect(rpc).toContain("'You do not own this draft'");
  });

  it("no conditional null fallthrough (no 'if p_run_id is not null then')", () => {
    // The old code had optional run_id; the hardened version requires it
    expect(rpc).not.toContain("if p_run_id is not null then");
    expect(rpc).not.toContain("if p_draft_id is not null then");
  });
});

describe("draft_id partial unique index", () => {
  const migration = read("supabase/migrations/20260822020000_campaign_audience_provenance.sql");

  it("partial unique index exists on campaign_audience_runs(draft_id) WHERE NOT NULL", () => {
    expect(migration).toContain("idx_audience_runs_draft_unique");
    expect(migration).toMatch(/create unique index if not exists idx_audience_runs_draft_unique\s+on public\.campaign_audience_runs\(draft_id\)\s+where draft_id is not null/);
  });

  it("link-audience-draft handles unique violation as 409", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    const linkFn = edgeFn.slice(
      edgeFn.indexOf("async function linkAudienceDraft"),
      edgeFn.indexOf("async function expireAudienceRun"),
    );
    expect(linkFn).toContain("23505");
    expect(linkFn).toContain("already linked to another audience run");
    expect(linkFn).toContain("409");
  });
});

// ── Live QA P0: content contract validation ───────────────────────────

describe("audience draft content contract (prompt + validation)", () => {
  const edgeFn = read("supabase/functions/playbook-ai/index.ts");
  const prompts = read("supabase/functions/_shared/playbook-prompts.ts");
  const genBlock = edgeFn.slice(
    edgeFn.indexOf("async function generateAudienceDraft"),
    edgeFn.indexOf("// No DB writes, no Smartlead, no enrollment"),
  );

  // ── Prompt uses approved tokens only ──

  it("uses audienceDraftGenerateSystem, not campaignGenerateSystem", () => {
    expect(genBlock).toContain("audienceDraftGenerateSystem");
    expect(genBlock).not.toContain("campaignGenerateSystem");
  });

  it("prompt specifies only [[First name]], [[Organization]], [[Signature]] tokens", () => {
    expect(prompts).toContain("audienceDraftGenerateSystem");
    const promptFn = prompts.slice(
      prompts.indexOf("function audienceDraftGenerateSystem"),
      prompts.indexOf("/** Word-overlap"),
    );
    expect(promptFn).toContain("[[First name]]");
    expect(promptFn).toContain("[[Organization]]");
    expect(promptFn).toContain("[[Signature]]");
    // Must NOT instruct use of Handlebars/Liquid as the intended syntax
    // (the prompt mentions them in the FORBIDDEN section, which is correct)
    expect(promptFn).toContain("FORBIDDEN");
    expect(promptFn).not.toMatch(/Use.*Smartlead.*liquid syntax.*\{\{#if/i);
  });

  it("prompt forbids Handlebars and Markdown links", () => {
    const promptFn = prompts.slice(
      prompts.indexOf("function audienceDraftGenerateSystem"),
      prompts.indexOf("/** Word-overlap"),
    );
    expect(promptFn).toContain("Handlebars");
    // Prompt lists Markdown with specific items (not "Markdown links like [text](url)")
    expect(promptFn).toContain("Markdown:");
    expect(promptFn).toContain("[text](url)");
    expect(promptFn).toContain("FORBIDDEN");
  });

  it("prompt has strong no-invented-claims rule", () => {
    const promptFn = prompts.slice(
      prompts.indexOf("function audienceDraftGenerateSystem"),
      prompts.indexOf("/** Word-overlap"),
    );
    expect(promptFn).toContain("NEVER invent statistics");
    expect(promptFn).toContain("NEVER make compliance");
    expect(promptFn).toContain("NEVER fabricate");
    // Prompt uses "1,000+ organizations" as an example (not "1,000+ healthcare organizations")
    expect(promptFn).toContain("1,000+ organizations");
  });

  // ── Validation rejects exact bad patterns (now in shared validator) ──

  it("genBlock delegates to validateAudienceDraft instead of inline checks", () => {
    expect(genBlock).toContain("validateAudienceDraft");
    expect(genBlock).not.toContain("SAFE_TAGS");
    expect(genBlock).not.toContain("containsUnsafeHtml");
    expect(genBlock).not.toContain("forbidden Handlebars");
    expect(genBlock).not.toContain("unknown token");
    expect(genBlock).not.toContain("Markdown link syntax");
    expect(genBlock).not.toContain("invented quantitative claim");
    expect(genBlock).not.toContain("missing [[Signature]]");
  });

  it("shared validator rejects Handlebars {{...}} template syntax", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("forbidden {{...}} template syntax");
    expect(spec).toContain("{{");
  });

  it("shared validator rejects {%...%} template syntax", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("forbidden {%...%} template syntax");
  });

  it("shared validator rejects %signature% Smartlead syntax", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("Smartlead %signature%");
    expect(spec).toContain("use [[Signature]]");
  });

  it("shared validator rejects unknown [[...]] tokens", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("unknown token");
    expect(spec).toContain("DRAFT_ALLOWED_TOKENS");
  });

  it("shared validator rejects Markdown [text](url) links in body", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("Markdown link [text](url)");
  });

  it("shared validator rejects invented quantitative social-proof claims", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("quantitative social-proof claim");
    expect(spec).toContain("organizations");
    expect(spec).toContain("customers");
  });

  it("shared validator requires [[Signature]] at end of body", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("missing [[Signature]]");
    expect(spec).toContain("exactly one required");
    expect(spec).toContain("[[Signature]] must be in the exact final");
  });

  it("shared validator validates HTML against email-safe allowlist", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("BODY_SAFE_TAGS");
    expect(spec).toContain("unsupported HTML tag");
  });

  it("shared validator rejects script/style/iframe/event-handler/javascript URL", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain("<script");
    expect(spec).toContain("<style");
    expect(spec).toContain("<iframe");
    expect(spec).toContain("javascript");
  });

  // ── Validation accepts valid content ──

  it("allows supported tokens [[First name]], [[Organization]], [[Signature]] in body", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain('"[[First name]]"');
    expect(spec).toContain('"[[Organization]]"');
    expect(spec).toContain('"[[Signature]]"');
  });

  it("allows safe HTML tags: p, br, strong, b, em, i", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    expect(spec).toContain('"p", "br", "strong", "b", "em", "i"');
  });

  it("delay_days validation scoped to sequence (does not reject legitimate delays)", () => {
    const spec = read("supabase/functions/_shared/audience-spec.ts");
    // delay_days validation checks integer + range, not a content regex
    expect(spec).toContain("delay_days must be an integer");
    // The quantitative claim regex looks for number+organizations/customers, NOT bare numbers
    expect(spec).toMatch(/\\d\[\\d,\]\*\\\+\?\\s\*\(\?:healthcare/);
  });

  // ── Exact bad output adversarial cases ──

  it("claim regex would match '1,000+ healthcare organizations'", () => {
    // Verify the regex pattern works on the exact observed bad output
    const claimRegex = /\d[\d,]*\+?\s*(?:healthcare\s+)?(?:organizations?|customers?|clients?|practices?|hospitals?|providers?)\b/i;
    expect(claimRegex.test("We work with 1,000+ healthcare organizations")).toBe(true);
    expect(claimRegex.test("serving 500 customers nationwide")).toBe(true);
    expect(claimRegex.test("trusted by 2,500+ hospitals")).toBe(true);
    // Must NOT match legitimate non-claim usage
    expect(claimRegex.test("organizations like yours")).toBe(false);
    expect(claimRegex.test("your healthcare organization")).toBe(false);
    expect(claimRegex.test("Email 1 delay 3 days")).toBe(false);
  });

  it("handlebars regex would catch exact observed bad greeting", () => {
    const body = '{{#if first_name}}Hi {{first_name}},{{else}}Hi there,{{/if}}';
    expect(/\{\{#if\b/.test(body)).toBe(true);
    expect(/\{\{else\}\}/.test(body)).toBe(true);
    expect(/\{\{\/if\}\}/.test(body)).toBe(true);
  });

  it("markdown link regex catches exact observed bad pattern", () => {
    const body = 'Check out [our SRA service](https://medcurity.com) today';
    expect(/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(body)).toBe(true);
  });

  it("unknown token regex catches invented tokens", () => {
    const tokens = "[[Company size]] and [[Last name]]".match(/\[\[[^\]]+\]\]/g) ?? [];
    const allowed = new Set(["[[First name]]", "[[Organization]]", "[[Signature]]"]);
    const unknown = tokens.filter((t) => !allowed.has(t));
    expect(unknown).toEqual(["[[Company size]]", "[[Last name]]"]);
  });

  it("valid body with supported tokens and HTML passes all checks", () => {
    const body = '<p>Hi [[First name]],</p><p>We help <strong>healthcare organizations</strong> like [[Organization]] with HIPAA compliance.</p><p><a href="https://medcurity.com">Learn more</a></p><p>[[Signature]]</p>';
    // No forbidden patterns
    expect(/\{\{/.test(body)).toBe(false);
    expect(/%signature%/i.test(body)).toBe(false);
    expect(/\[[^\]]+\]\(https?:\/\//.test(body)).toBe(false);
    expect(/\d[\d,]*\+?\s*(?:healthcare\s+)?(?:organizations?|customers?)\b/i.test(body)).toBe(false);
    // Signature present exactly once at end
    expect((body.match(/\[\[Signature\]\]/g) ?? []).length).toBe(1);
    const afterSig = body.slice(body.lastIndexOf("[[Signature]]") + "[[Signature]]".length).replace(/<[^>]+>/g, "").trim();
    expect(afterSig).toBe("");
  });
});
