// AiAudienceFlow: the Ask AI sub-flow inside the Campaign wizard.
//
// Three sub-steps:
//   1. Ask: user describes audience in plain English
//   2. Interpret: shows parsed spec + ambiguity/unsupported items for review
//   3. Proof: shows resolved audience with exact counts and per-member reasons
//
// After proof is confirmed, the parent wizard triggers sequence generation
// and proceeds to the normal Build → People → Review flow.
//
// Hard rules:
//   - CRM-only: no external discovery
//   - PII guidance at intake
//   - Ambiguous/unsupported criteria block automatic inclusion
//   - Eligible recipients enter the shared builder exactly once (deduped)
//   - Source provenance and why-matched/excluded labels understandable
//   - Desktop + exact 390x844 responsive, accessible, no horizontal overflow

import { useState } from "react";
import {
  Loader2, Sparkles, ArrowLeft, AlertTriangle, CheckCircle2,
  Users, UserX, HelpCircle, ShieldAlert, Search, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInterpretAudience, useResolveAudience, type Recipient } from "./api";
import type {
  AudienceSpecV1,
  AudienceInterpretResult,
  AudienceResolveResult,
  AudienceMemberPreview,
} from "./types";

// ── Human-readable labels ──────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  customer_account: "Current customer",
  former_customer_account: "Former customer",
  partner_account: "Partner organization",
  contact_do_not_contact: "Marked do-not-contact",
  account_do_not_contact: "Account marked do-not-contact",
  contact_no_longer_employed: "No longer employed",
  contact_archived: "Archived contact",
  no_industry_category_set: "No industry category set on account",
  no_project_segment_set: "No project segment set on account",
  no_state_set: "No state set on account or contact",
  active_enrollment_elsewhere: "Already enrolled in another campaign",
  over_max_results_cap: "Over audience size limit",
  duplicate_contact: "Duplicate email (another contact)",
  optout_unsubscribed: "Unsubscribed from marketing",
  optout_bounced: "Email bounced",
  optout_manual: "Manually opted out",
  marketing_suppression_frozen: "On frozen suppression list",
};

function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ");
}

const INDUSTRY_LABELS: Record<string, string> = {
  hospital: "Hospital",
  rural_hospital: "Rural hospital",
  medical_group: "Medical group",
  fqhc: "FQHC",
  rural_health_clinic: "Rural health clinic",
  skilled_nursing: "Skilled nursing",
  long_term_care: "Long-term care",
  home_health: "Home health",
  hospice: "Hospice",
  behavioral_health: "Behavioral health",
  dental: "Dental",
  pediatrics: "Pediatrics",
  specialty_clinic: "Specialty clinic",
  urgent_care: "Urgent care",
  imaging_center: "Imaging center",
  lab_services: "Lab services",
  pharmacy: "Pharmacy",
  telemedicine: "Telemedicine",
  tribal_health: "Tribal health",
  public_health_agency: "Public health agency",
  healthcare_it_vendor: "Healthcare IT vendor",
  managed_service_provider: "Managed service provider",
  healthcare_consulting: "Healthcare consulting",
  insurance_payer: "Insurance payer",
  other_healthcare: "Other healthcare",
  other: "Other",
  community_health_center: "Community health center",
  university_hospital: "University hospital",
  medical_practice: "Medical practice",
  primary_care: "Primary care",
  primary_care_association: "Primary care association",
};
function industryLabel(val: string): string {
  return INDUSTRY_LABELS[val] ?? val.replace(/_/g, " ");
}

const SEGMENT_LABELS: Record<string, string> = {
  rural_hospital: "Rural hospital",
  community_hospital: "Community hospital",
  enterprise: "Enterprise",
  medium_sized: "Medium-sized",
  small_sized: "Small-sized",
  fqhc: "FQHC",
  voa: "VOA",
  franchise: "Franchise",
  strategic_partner: "Strategic partner",
  it_vendor_third_party: "IT vendor / third party",
  independent_associations: "Independent associations",
  other: "Other",
};
function segmentLabel(val: string): string {
  return SEGMENT_LABELS[val] ?? val.replace(/_/g, " ");
}

const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ── Sub-step types ─────────────────────────────────────────────────────

type AiSubStep = "ask" | "interpret" | "proof";

export interface AiAudienceResult {
  runId: string;
  interpretationId: string;
  specHash: string;
  spec: AudienceSpecV1;
  /** The user's original PII-checked brief, preserved for generation context. */
  brief: string;
  recipients: Recipient[];
  counts: AudienceResolveResult["counts"];
  eligible: AudienceMemberPreview[];
  excluded: AudienceMemberPreview[];
  ambiguous: AudienceMemberPreview[];
  activeEnrollments: AudienceMemberPreview[];
}

interface AiAudienceFlowProps {
  onComplete: (result: AiAudienceResult) => void;
  onBack: () => void;
}

// ── Component ──────────────────────────────────────────────────────────

export function AiAudienceFlow({ onComplete, onBack }: AiAudienceFlowProps) {
  const [subStep, setSubStep] = useState<AiSubStep>("ask");
  const [brief, setBrief] = useState("");
  const [interpretation, setInterpretation] = useState<AudienceInterpretResult | null>(null);
  const [resolution, setResolution] = useState<AudienceResolveResult | null>(null);
  const [proofSection, setProofSection] = useState<"eligible" | "excluded" | "ambiguous" | "enrolled">("eligible");

  const interpret = useInterpretAudience();
  const resolve = useResolveAudience();

  const briefReady = brief.trim().length >= 10;

  function handleInterpret() {
    interpret.mutate(brief.trim(), {
      onSuccess: (result) => {
        setInterpretation(result);
        setSubStep("interpret");
      },
    });
  }

  function handleResolve() {
    if (!interpretation) return;
    resolve.mutate(
      { interpretation_id: interpretation.interpretation_id },
      {
        onSuccess: (result) => {
          setResolution(result);
          setSubStep("proof");
        },
      },
    );
  }

  function handleConfirmAudience() {
    if (!resolution || !interpretation) return;
    // Convert eligible members to Recipient format for the shared wizard
    const recipients: Recipient[] = resolution.eligible.map((m) => ({
      email: m.email,
      contact_id: m.contact_id,
      account_id: m.account_id,
      company_name: m.account_name ?? undefined,
    }));
    onComplete({
      runId: resolution.run_id,
      interpretationId: interpretation.interpretation_id,
      specHash: resolution.spec_hash,
      spec: interpretation.spec,
      brief: brief.trim(),
      recipients,
      counts: resolution.counts,
      eligible: resolution.eligible,
      excluded: resolution.excluded,
      ambiguous: resolution.ambiguous,
      activeEnrollments: resolution.active_enrollments,
    });
  }

  const spec = interpretation?.spec;
  const hasAmbiguity = (spec?.ambiguous_criteria?.length ?? 0) > 0;
  const hasUnsupported = (spec?.unsupported_criteria?.length ?? 0) > 0;
  // True when the AI returned no usable filters at all (zero supported criteria)
  const hasSupportedFilters = !!(
    (spec?.filters.industry_category_values?.length) ||
    (spec?.filters.project_segment_values?.length) ||
    (spec?.filters.state_values?.length)
  );

  // ── Ask sub-step ───────────────────────────────────────────────────

  if (subStep === "ask") {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold" id="ai-audience-heading">Describe your audience and goal</h3>
          <p className="text-xs text-muted-foreground">
            Tell Pulse who you want to reach and what the campaign should accomplish. Use organization types, states, and segments, not individual names or emails.
          </p>
        </div>

        <div className="camp-card p-4 space-y-3">
          <Textarea
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. Hospitals and FQHCs in Minnesota and Wisconsin. Introduce our compliance services and offer a demo."
            aria-labelledby="ai-audience-heading"
            aria-describedby="ai-audience-guidance"
            className="resize-none"
          />
          <p id="ai-audience-guidance" className="text-[11px] text-muted-foreground">
            Pulse searches your CRM only. Current customers, partners, do-not-contact, and already-enrolled people are automatically excluded.
          </p>
          {interpret.isError && (
            <p className="text-xs text-destructive flex items-start gap-1.5" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{(interpret.error as Error).message}</span>
            </p>
          )}
        </div>

        <div className="flex justify-between pt-1">
          <Button variant="ghost" onClick={onBack} aria-label="Go back to method selection">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <button
            type="button"
            className="camp-btn-primary"
            onClick={handleInterpret}
            disabled={!briefReady || interpret.isPending}
            aria-label="Interpret audience description"
          >
            {interpret.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Interpreting…</>
              : <><Search className="h-4 w-4" /> Find matching people</>}
          </button>
        </div>
      </div>
    );
  }

  // ── Interpret sub-step ─────────────────────────────────────────────

  if (subStep === "interpret" && spec) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Here's what Pulse understood</h3>
          <p className="text-xs text-muted-foreground">
            Review the criteria below. Pulse will search your CRM for contacts matching these filters.
          </p>
        </div>

        <div className="camp-card p-4 space-y-3">
          {/* Criteria summary */}
          <div className="space-y-2">
            {spec.filters.industry_category_values && spec.filters.industry_category_values.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Organization type</p>
                <div className="flex flex-wrap gap-1">
                  {spec.filters.industry_category_values.map((v) => (
                    <span key={v} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                      {industryLabel(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {spec.filters.project_segment_values && spec.filters.project_segment_values.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Segment</p>
                <div className="flex flex-wrap gap-1">
                  {spec.filters.project_segment_values.map((v) => (
                    <span key={v} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                      {segmentLabel(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {spec.filters.state_values && spec.filters.state_values.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">States</p>
                <div className="flex flex-wrap gap-1">
                  {spec.filters.state_values.map((v) => (
                    <span key={v} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                      {US_STATE_NAMES[v] ?? v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!spec.filters.industry_category_values?.length &&
             !spec.filters.project_segment_values?.length &&
             !spec.filters.state_values?.length && (
              <p className="text-xs text-muted-foreground">No specific filters. This would match all contacts in the CRM.</p>
            )}
          </div>

          {/* Always-on exclusions */}
          <div className="rounded-lg border px-3 py-2 text-[11px] text-muted-foreground space-y-0.5" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
            <p className="font-medium text-foreground text-xs">Automatic exclusions</p>
            <p>Current customers, former customers, partners, do-not-contact, bounced, unsubscribed, no-longer-employed, archived, and people already in another campaign are excluded.</p>
          </div>
        </div>

        {/* Ambiguous criteria */}
        {hasAmbiguity && (
          <div className="camp-card p-4 space-y-2 border-amber-300 dark:border-amber-700" role="alert">
            <div className="flex items-start gap-2">
              <HelpCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Ambiguous criteria</p>
                <p className="text-xs text-muted-foreground">These terms could mean different things. They will not be included in the search. Refine your description or proceed without them.</p>
              </div>
            </div>
            <ul className="list-disc list-inside text-xs space-y-1 ml-6">
              {spec.ambiguous_criteria!.map((c, i) => (
                <li key={i} className="break-words">{c}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Unsupported criteria */}
        {hasUnsupported && (
          <div className="camp-card p-4 space-y-2 border-blue-300 dark:border-blue-700" role="alert">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Not available in this version</p>
                <p className="text-xs text-muted-foreground">Pulse can't filter on these criteria yet. They won't affect the search.</p>
              </div>
            </div>
            <ul className="list-disc list-inside text-xs space-y-1 ml-6">
              {spec.unsupported_criteria!.map((c, i) => (
                <li key={i} className="break-words">{c}</li>
              ))}
            </ul>
          </div>
        )}

        {resolve.isError && (
          <p className="text-xs text-destructive flex items-start gap-1.5" role="alert">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{(resolve.error as Error).message}</span>
          </p>
        )}

        {!hasSupportedFilters && (
          <p className="text-xs text-amber-600 rounded-md border border-amber-200 dark:border-amber-800 px-3 py-2">
            No supported filters found. Refine your description to include organization types, states, or segments before searching.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => { setSubStep("ask"); setInterpretation(null); }} aria-label="Go back to description">
            <ArrowLeft className="h-4 w-4 mr-1" /> Edit description
          </Button>
          <button
            type="button"
            className="camp-btn-primary"
            onClick={handleResolve}
            disabled={resolve.isPending || !hasSupportedFilters}
            aria-label={hasSupportedFilters ? "Search CRM for matching contacts" : "Add at least one filter before searching"}
          >
            {resolve.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching…</>
              : <><Users className="h-4 w-4" /> Search CRM</>}
          </button>
        </div>
      </div>
    );
  }

  // ── Proof sub-step ─────────────────────────────────────────────────

  if (subStep === "proof" && resolution) {
    const { counts } = resolution;
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Audience preview</h3>
          <p className="text-xs text-muted-foreground">
            {counts.total_eligible > 0
              ? `Found ${counts.total_eligible} eligible ${counts.total_eligible === 1 ? "person" : "people"} from your CRM.`
              : "No eligible people matched your criteria."}
            {counts.scan_truncated && " Results were capped. Narrow your criteria for a complete view."}
          </p>
        </div>

        {/* Summary counts */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountCard
            label="Eligible"
            count={counts.total_eligible}
            icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
            active={proofSection === "eligible"}
            onClick={() => setProofSection("eligible")}
          />
          <CountCard
            label="Excluded"
            count={counts.total_excluded}
            icon={<UserX className="h-4 w-4 text-red-500" />}
            active={proofSection === "excluded"}
            onClick={() => setProofSection("excluded")}
          />
          <CountCard
            label="Ambiguous"
            count={counts.total_ambiguous}
            icon={<HelpCircle className="h-4 w-4 text-amber-500" />}
            active={proofSection === "ambiguous"}
            onClick={() => setProofSection("ambiguous")}
          />
          <CountCard
            label="In campaigns"
            count={counts.total_active_enrollment}
            icon={<ShieldAlert className="h-4 w-4 text-blue-500" />}
            active={proofSection === "enrolled"}
            onClick={() => setProofSection("enrolled")}
          />
        </div>

        {counts.total_duplicate > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {counts.total_duplicate} duplicate email{counts.total_duplicate === 1 ? "" : "s"} across contacts; each email appears only once.
          </p>
        )}

        {/* Member list for selected section */}
        <MemberList
          section={proofSection}
          eligible={resolution.eligible}
          excluded={resolution.excluded}
          ambiguous={resolution.ambiguous}
          activeEnrollments={resolution.active_enrollments}
        />

        {/* Source label */}
        <div className="rounded-lg border px-3 py-2 text-[11px] text-muted-foreground" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
          <span className="font-medium text-foreground">Source:</span> Pulse CRM only. No external data providers.
          {interpretation && <> Interpreted by Pulse AI.</>}
        </div>

        <div className="flex justify-between pt-1">
          <Button variant="ghost" onClick={() => { setSubStep("interpret"); setResolution(null); }} aria-label="Go back to review criteria">
            <ArrowLeft className="h-4 w-4 mr-1" /> Edit criteria
          </Button>
          <button
            type="button"
            className="camp-btn-primary"
            onClick={handleConfirmAudience}
            disabled={counts.total_eligible === 0}
            aria-label={counts.total_eligible > 0
              ? `Use ${counts.total_eligible} eligible ${counts.total_eligible === 1 ? "person" : "people"} and generate emails`
              : "No eligible people to continue with"}
          >
            <Sparkles className="h-4 w-4" />
            {counts.total_eligible > 0
              ? `Use ${counts.total_eligible} ${counts.total_eligible === 1 ? "person" : "people"} and generate emails`
              : "No eligible people"}
          </button>
        </div>
      </div>
    );
  }

  // Fallback.should not happen
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────

function CountCard({
  label, count, icon, active, onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "camp-card flex flex-col items-center gap-1 p-3 text-center transition-colors cursor-pointer",
        active && "ring-2 ring-primary/50",
      )}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${count}`}
    >
      {icon}
      <span className="text-lg font-bold tabular-nums">{count}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

function MemberList({
  section, eligible, excluded, ambiguous, activeEnrollments,
}: {
  section: "eligible" | "excluded" | "ambiguous" | "enrolled";
  eligible: AudienceMemberPreview[];
  excluded: AudienceMemberPreview[];
  ambiguous: AudienceMemberPreview[];
  activeEnrollments: AudienceMemberPreview[];
}) {
  const members = section === "eligible" ? eligible
    : section === "excluded" ? excluded
    : section === "ambiguous" ? ambiguous
    : activeEnrollments;

  const [showAll, setShowAll] = useState(false);
  const INITIAL_SHOW = 20;
  const visible = showAll ? members : members.slice(0, INITIAL_SHOW);

  if (members.length === 0) {
    return (
      <div className="camp-card p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {section === "eligible" ? "No eligible people matched." :
           section === "excluded" ? "No one was excluded." :
           section === "ambiguous" ? "No ambiguous matches." :
           "No one is already enrolled elsewhere."}
        </p>
      </div>
    );
  }

  const reasons = (m: AudienceMemberPreview) =>
    m.reason_codes.filter((r) => r !== "duplicate_contact").map(reasonLabel).join(", ") || "-";

  return (
    <div className="camp-card overflow-hidden">
      <div className="overflow-y-auto max-h-[300px]" role="list" aria-label={`${section} contacts`}>
        {/* Desktop: table rows (hidden on mobile) */}
        <div className="hidden sm:block" role="table">
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground border-b sticky top-0 bg-inherit z-10" role="row" style={{ borderColor: "var(--camp-line)" }}>
            <span className="flex-[2] min-w-0" role="columnheader">Email</span>
            <span className="flex-1 min-w-0" role="columnheader">Organization</span>
            <span className="w-16 shrink-0" role="columnheader">State</span>
            {section !== "eligible" && <span className="flex-1 min-w-0" role="columnheader">Reason</span>}
          </div>
          {visible.map((m) => (
            <div
              key={`d-${m.contact_id}-${m.email}`}
              className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-0 hover:bg-accent/50"
              role="row"
              style={{ borderColor: "var(--camp-line)" }}
            >
              <span className="flex-[2] min-w-0 truncate" role="cell" title={m.email}>{m.email}</span>
              <span className="flex-1 min-w-0 truncate text-muted-foreground" role="cell" title={m.account_name ?? ""}>{m.account_name ?? "-"}</span>
              <span className="w-16 shrink-0 text-muted-foreground" role="cell">{m.state ? (US_STATE_NAMES[m.state] ?? m.state) : "-"}</span>
              {section !== "eligible" && (
                <span className="flex-1 min-w-0 text-muted-foreground break-words" role="cell">{reasons(m)}</span>
              )}
            </div>
          ))}
        </div>
        {/* Mobile: stacked cards with labels (hidden on desktop) */}
        <div className="sm:hidden divide-y" style={{ borderColor: "var(--camp-line)" }}>
          {visible.map((m) => (
            <div key={`m-${m.contact_id}-${m.email}`} className="px-3 py-2 space-y-0.5 text-xs" role="listitem">
              <p className="font-medium break-all">{m.email}</p>
              {m.account_name && <p className="text-muted-foreground"><span className="text-[10px] uppercase tracking-wide">Org</span> {m.account_name}</p>}
              {m.state && <p className="text-muted-foreground"><span className="text-[10px] uppercase tracking-wide">State</span> {US_STATE_NAMES[m.state] ?? m.state}</p>}
              {section !== "eligible" && <p className="text-muted-foreground break-words"><span className="text-[10px] uppercase tracking-wide">Reason</span> {reasons(m)}</p>}
            </div>
          ))}
        </div>
      </div>
      {members.length > INITIAL_SHOW && (
        <div className="px-3 py-2 border-t text-center" style={{ borderColor: "var(--camp-line)" }}>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}
            aria-label={showAll ? "Show fewer results" : `Show all ${members.length} results`}>
            {showAll ? "Show fewer" : `Show all ${members.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
