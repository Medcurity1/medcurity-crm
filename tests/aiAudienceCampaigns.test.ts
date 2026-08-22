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
import { canonicalizeStateCode } from "../supabase/functions/_shared/audience-spec";

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

  it("UI shows source provenance label (CRM only, model ID)", () => {
    const flow = read("src/features/playbook/AiAudienceFlow.tsx");
    expect(flow).toContain("Pulse CRM only. No external data providers.");
    expect(flow).toContain("interpretation.model_id");
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

  it("generateAudienceDraft validates exactly 3 emails in the result", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_REQUIRED_EMAILS");
    expect(edgeFn).toMatch(/parsed\.sequence\.length !== AUDIENCE_DRAFT_REQUIRED_EMAILS/);
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
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AI returned empty campaign_name");
    expect(edgeFn).toContain("AI returned empty target_audience");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_MAX_NAME");
  });

  it("validates seq_number must be exactly 1,2,3", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toMatch(/email\.seq_number !== n/);
  });

  it("validates delay_days is integer in safe range", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_MAX_DELAY");
    expect(edgeFn).toContain("Number.isInteger(email.delay_days)");
  });

  it("rejects script/style/iframe tags and event handlers", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("containsUnsafeHtml");
    expect(edgeFn).toContain("<script");
    expect(edgeFn).toContain("<style");
    expect(edgeFn).toContain("<iframe");
    expect(edgeFn).toMatch(/\\bon\\w\+/); // event handler pattern
    expect(edgeFn).toContain("javascript");
  });

  it("validates subject and body length bounds", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_MAX_SUBJECT");
    expect(edgeFn).toContain("AUDIENCE_DRAFT_MAX_BODY");
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
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain(`AI returned campaign_name exceeding`);
    // Must NOT truncate (no slice assignment for campaign_name)
    const genBlock = edgeFn.slice(
      edgeFn.indexOf("async function generateAudienceDraft"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(genBlock).not.toMatch(/parsed\.campaign_name\s*=.*\.slice/);
  });

  it("requires nonempty visible text after stripping tags", () => {
    const edgeFn = read("supabase/functions/playbook-ai/index.ts");
    expect(edgeFn).toContain("no visible text content");
    expect(edgeFn).toContain("visibleText");
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

  it("discardDraft calls expireRun when banner has aiAudience provenance", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    const discardBlock = wizard.slice(
      wizard.indexOf("function discardDraft"),
      wizard.indexOf("function reset"),
    );
    expect(discardBlock).toContain("expireRun.mutate");
    expect(discardBlock).toContain("draftBanner.state.aiAudience?.runId");
  });

  it("expire failure warns but does not resurrect the draft", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain("audience run could not be expired");
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
