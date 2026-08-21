// Campaign wizard — two entry modes sharing one Recipients/Launch flow:
//   - "ai" (default): Describe -> Preview/Edit -> Recipients -> Launch. AI
//     writes the email sequence (Claude).
//   - "template" (Campaigns overhaul S3): opened from TemplatesSection's
//     "Use this template" or SequenceEditor's "Launch this sequence" — skips
//     Describe and seeds this launch from the template's steps. Write my own
//     uses the same per-launch editor. Add/remove/reorder, day/timing, and
//     EMAIL_AUTO / EMAIL_HYBRID / CALL / LINKEDIN are all editable here.
//     Edits apply to THIS launch only; the saved template is never written.
// Recipients come from a contact tag, a CSV upload, or pasted emails; Launch
// creates the campaign in Smartlead AND enrolls every recipient
// (campaign_enrollments) — see playbook-smartlead/index.ts's `launch`
// action. New campaigns default to starting after the final explicit launch
// confirmation; Save as draft remains a deliberate Review-step choice.

import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogDiscardGuard } from "@/hooks/useDialogDiscardGuard";
import {
  Loader2, Sparkles, Wand2, ArrowLeft, ArrowRight, Rocket, CheckCircle2, AlertTriangle,
  Plus, Trash2, Eye, PencilLine, PenLine, LayoutTemplate, RotateCw, UserRound, Building2, Signature,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTags } from "@/features/tags/api";
import { formatRelativeDate } from "@/lib/formatters";
import { CampaignRecipients } from "./CampaignRecipients";
import { SequenceTimeline } from "./SequenceTimeline";
import { SequenceStepList } from "./SequenceStepList";
import { CATEGORY } from "./template-category";
import { builderProgress, initialLaunchStep, resumeLaunchStep } from "./campaign-launch";
import { partitionSuppression, normalizeEmail, type SuppressionEntry } from "./suppression";
import type { SequenceStep } from "./types";
import {
  AUTHOR_TOKENS,
  authorTextToTemplateHtml,
  campaignPreviewHtml,
  hasUnsupportedRichEmailHtml,
  insertAuthorToken,
  templateToAuthorText,
} from "./campaign-content";
import { incompleteAutoEmails, recommendedCustomSequence } from "./sequence-authoring";
import {
  DEFAULT_DELIVERY_SETTINGS, DELIVERY_DAY_OPTIONS, deliverySummary, normalizeDeliverySettings,
  type DeliverySettings,
} from "./delivery-settings";
import {
  useGenerateCampaign, useSuggestCampaign, useRegenerateEmail, useEmailAccounts, useLaunchCampaign,
  useInboxHealth, useSmartleadStatus, useActiveUsers, useCampaignTemplates, smartleadUrl,
  fetchLatestCampaignDraft, saveCampaignDraft, deleteCampaignDraft,
  type GeneratedCampaign, type Recipient, type ActiveEnrollmentEntry,
} from "./api";

type Step = 1 | 2 | 3;
const MAX_EMAILS = 7;
const REGEN_CHIPS = [
  "Make subject lines shorter",
  "More direct and urgent tone",
  "Softer, more educational tone",
  "Add more personalization",
  "Fewer emails in the sequence",
  "More follow-ups",
];

function plain(htmlStr: string): string {
  return htmlStr.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function emailSrcDoc(bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px;line-height:1.5;padding:16px;max-width:600px;margin:0 auto;">${bodyHtml}</div>`;
}
function parseSuggestions(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 8);
}

function ReadinessRow({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return (
    <div className="camp-check">
      <span className="camp-check-dot" data-ok={ready}>
        {ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

/** Plain-English send-ramp estimate for the template-mode Launch step —
 *  deliberately a small, LOCAL approximation rather than importing the real
 *  server-side module (supabase/functions/_shared/campaign-scheduling.ts is
 *  Deno-side and has no business shipping in the browser bundle). Not meant
 *  to be exact — "within"/"around" language signals an estimate; the server
 *  computes everyone's real date at launch. */
function projectSendRamp(steps: SequenceStep[], leadsPerDay: number, recipientCount: number): string | null {
  if (!recipientCount || !steps.length || leadsPerDay <= 0) return null;
  const sendDays = Math.max(1, Math.ceil(recipientCount / leadsPerDay));
  const emailAutoOffsets = steps.filter((s) => s.channel === "EMAIL_AUTO").map((s) => s.day_offset);
  const baseline = emailAutoOffsets.length
    ? Math.min(...emailAutoOffsets)
    : Math.min(...steps.map((s) => s.day_offset));
  const firstCall = [...steps]
    .filter((s) => s.channel === "CALL")
    .sort((a, b) => a.day_offset - b.day_offset)[0];

  let msg = `At ${leadsPerDay}/day, everyone's first email is out within ${sendDays} send day${sendDays === 1 ? "" : "s"}`;
  if (firstCall) {
    const relOffset = firstCall.day_offset - baseline;
    const d = new Date();
    d.setDate(d.getDate() + relOffset);
    msg += `; your first call tasks land around ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  return msg + ".";
}

/** Autosave payload for campaign_drafts.state_json (see api.ts's
 *  saveCampaignDraft/fetchLatestCampaignDraft). `v` is a version marker so a
 *  future shape change can tell an old saved draft apart from a fresh one
 *  instead of guessing. */
interface CampaignDraftState {
  v: 1;
  mode: "ai" | "template";
  flow?: "choose" | "ai" | "template";
  customSequence?: boolean;
  step: Step;
  description: string;
  campaign: GeneratedCampaign | null;
  templateName: string;
  templateSteps: SequenceStep[];
  recipients: Recipient[];
  suppressionOverrides: string[];
  enrollmentOverrides: string[];
  inboxId: string;
  ownerId: string;
  autoStart: boolean;
  adaptive: boolean;
  leadsPerDay: number;
  minGap: number;
  delivery?: Partial<DeliverySettings>;
}

/** Type-guards a campaign_drafts.state_json blob before trusting it — an old
 *  or malformed row (schema drift, hand-edited row, a future version this
 *  build doesn't know about) is treated as no draft at all rather than
 *  crashing the resume. */
function parseCampaignDraftState(json: unknown): CampaignDraftState | null {
  if (!json || typeof json !== "object") return null;
  const s = json as Record<string, unknown>;
  if (s.v !== 1) return null;
  if (s.mode !== "ai" && s.mode !== "template") return null;
  if (s.flow !== undefined && s.flow !== "choose" && s.flow !== "ai" && s.flow !== "template") return null;
  if (typeof s.step !== "number") return null;
  if (typeof s.description !== "string") return null;
  if (s.campaign !== null && typeof s.campaign !== "object") return null;
  if (typeof s.templateName !== "string") return null;
  if (!Array.isArray(s.templateSteps)) return null;
  if (!Array.isArray(s.recipients)) return null;
  if (!Array.isArray(s.suppressionOverrides)) return null;
  if (!Array.isArray(s.enrollmentOverrides)) return null;
  if (typeof s.inboxId !== "string") return null;
  if (typeof s.ownerId !== "string") return null;
  if (typeof s.autoStart !== "boolean") return null;
  if (typeof s.adaptive !== "boolean") return null;
  if (typeof s.leadsPerDay !== "number") return null;
  if (typeof s.minGap !== "number") return null;
  if (s.customSequence !== undefined && typeof s.customSequence !== "boolean") return null;
  return s as unknown as CampaignDraftState;
}

const BUILD_START_METHODS = [
  {
    id: "template" as const,
    label: "Use a template",
    description: "Start from proven copy.",
    Icon: LayoutTemplate,
  },
  {
    id: "ai" as const,
    label: "Draft with AI",
    description: "Describe the audience and goal.",
    Icon: Sparkles,
  },
  {
    id: "choose" as const,
    label: "Write my own",
    description: "Paste, write, or build the sequence yourself.",
    Icon: PenLine,
  },
];

export function CampaignWizard({
  open, onOpenChange, initialDescription = "", sourceIdeaId,
  mode = "ai",
  templateSeed,
  initialRecipients,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDescription?: string;
  sourceIdeaId?: string;
  /** "template" skips Describe and edits a template's own steps instead of
   *  an AI-generated sequence (Campaigns overhaul S3). Callers should also
   *  change the `key` prop on each open (mirrors TemplatesSection's
   *  editorNonce pattern for SequenceEditor) so templateSeed's initial
   *  values are captured fresh rather than stale from a previous open. */
  mode?: "ai" | "template";
  templateSeed?: { template_id: string | null; name: string; steps: SequenceStep[] };
  /** Pre-seeds the Recipients step (Campaigns overhaul S7 — the right-click
   *  "Start a campaign…" fast path via QuickCampaignDialog). Recipients
   *  built this way still run the normal suppression / already-enrolled
   *  checks — CampaignRecipients.tsx treats `recipients` opaquely regardless
   *  of source, so seeding this wizard's state is all that's needed. Callers
   *  should bump the `key` prop on each open, same as templateSeed, so a
   *  stale list from a previous open never leaks in. */
  initialRecipients?: Recipient[];
}) {
  const { profile } = useAuth();
  const hasLockedRecipients = (initialRecipients?.length ?? 0) > 0;
  const [step, setStep] = useState<Step>(initialLaunchStep(mode, hasLockedRecipients));
  const [description, setDescription] = useState(initialDescription);
  const [campaign, setCampaign] = useState<GeneratedCampaign | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [appliedSug, setAppliedSug] = useState<Set<number>>(new Set());
  const [showRegen, setShowRegen] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [codeView, setCodeView] = useState<Set<number>>(new Set());
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients ?? []);
  const [suppression, setSuppression] = useState<SuppressionEntry[]>([]);
  const [suppressionOverrides, setSuppressionOverrides] = useState<string[]>([]);
  const [activeEnrollments, setActiveEnrollments] = useState<ActiveEnrollmentEntry[]>([]);
  const [enrollmentOverrides, setEnrollmentOverrides] = useState<string[]>([]);
  const [recipientChecksPending, setRecipientChecksPending] = useState(hasLockedRecipients);
  const [recipientChecksFailed, setRecipientChecksFailed] = useState(false);
  const [inboxId, setInboxId] = useState("");
  // Campaign owner (defaults to whoever opened the wizard) — call/LinkedIn
  // tasks and reply alerts still go to each person's own account owner; this
  // only covers people without one. See the Select in Step 4.
  const [ownerId, setOwnerId] = useState(profile?.id ?? "");
  // Every new path defaults to starting only after the explicit final
  // confirmation. Review still offers Save as draft as a deliberate choice.
  const [autoStart, setAutoStart] = useState(true);
  const [adaptive, setAdaptive] = useState(false);
  const [leadsPerDay, setLeadsPerDay] = useState(25);
  const [minGap, setMinGap] = useState(15);
  const [sendDays, setSendDays] = useState<number[]>(DEFAULT_DELIVERY_SETTINGS.daysOfWeek);
  const [sendStart, setSendStart] = useState(DEFAULT_DELIVERY_SETTINGS.startHour);
  const [sendEnd, setSendEnd] = useState(DEFAULT_DELIVERY_SETTINGS.endHour);
  const [sendTimezone, setSendTimezone] = useState(DEFAULT_DELIVERY_SETTINGS.timezone);
  const [advancedDeliveryOpen, setAdvancedDeliveryOpen] = useState(false);
  const deliveryBaselineRef = useRef<DeliverySettings | null>(null);
  const [launchResult, setLaunchResult] = useState<{
    id: number; started: boolean; leads: number; failed: number;
    suppressionDropped: number; alreadyEnrolledDropped: number; enrolled: number; tasksCreated: number;
  } | null>(null);
  // Launch confirmation step (a small summary AlertDialog between the outer
  // Launch button and the actual doLaunch() call).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Autosave / resume — see the two effects below. draftIdRef remembers the
  // one campaign_drafts row this session owns (undefined id => next save
  // inserts; once set, every later save updates the same row). draftBanner
  // holds an unresolved "resume this?" offer found on open; resuming or
  // discarding clears it.
  const draftIdRef = useRef<string | null>(null);
  const draftCheckedRef = useRef(false);
  // Serialized snapshot of the first "has content" state of this open —
  // the autosave effect's dirty gate (only divergence from it gets saved).
  const autosaveBaselineRef = useRef<string | null>(null);
  const closeBaselineRef = useRef<string | null>(null);
  const [wizardDirty, setWizardDirty] = useState(false);
  const [draftBanner, setDraftBanner] = useState<{
    id: string; title: string; updatedAt: string; state: CampaignDraftState;
  } | null>(null);
  // Template mode's own content state — a deep-copied, freely-editable copy
  // of templateSeed.steps. Edits here apply to THIS launch only; the saved
  // template (campaign_templates row) is never touched by the wizard.
  const [templateName, setTemplateName] = useState(templateSeed?.name ?? "");
  const [templateSteps, setTemplateSteps] = useState<SequenceStep[]>(
    templateSeed?.steps ? templateSeed.steps.map((s) => ({ ...s })) : [],
  );
  const [flow, setFlow] = useState<"choose" | "ai" | "template">(mode === "template" ? "template" : "choose");
  const [customSequence, setCustomSequence] = useState(false);
  const [editingSequence, setEditingSequence] = useState(false);
  const [sequenceAttempted, setSequenceAttempted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const gen = useGenerateCampaign();
  const suggest = useSuggestCampaign();
  const regen = useRegenerateEmail();
  const { data: tags } = useTags();
  const { data: templates } = useCampaignTemplates();
  const { data: inboxes } = useEmailAccounts();
  const { data: activeUsers } = useActiveUsers();
  const { data: sl, isLoading: smartleadLoading, isError: smartleadError } = useSmartleadStatus();
  // Launch is allowed only after the integration query positively confirms
  // the connection. Loading and error states stay unready instead of being
  // mistaken for a healthy connection.
  const smartleadReady = sl?.configured === true;
  const smartleadDisabled = !smartleadReady;
  // Lazy — only fires once the wizard has actually reached the cadence/inbox
  // step (Campaigns overhaul Phase 5's "Sending inboxes" note below).
  const { data: inboxHealth } = useInboxHealth(step === 3);
  const launch = useLaunchCampaign();

  // Two independent soft-alert rails against the SAME raw recipient list —
  // Do-Not-Email (S2) and "already actively enrolled elsewhere" (S3). A
  // person is sendable only if they clear BOTH (or were explicitly
  // overridden on whichever one flagged them). The server re-checks both
  // independently before anything is sent/enrolled — this is the client
  // half of each safety rail, same as CampaignRecipients.tsx's own (purely
  // display) partitions.
  const suppressionPartition = useMemo(
    () => partitionSuppression(recipients, (r) => r.email, suppression, suppressionOverrides),
    [recipients, suppression, suppressionOverrides],
  );
  const enrollmentPartition = useMemo(
    () => partitionSuppression(
      recipients, (r) => r.email,
      activeEnrollments.map((e) => ({ email: e.email, reason: e.campaign_name })),
      enrollmentOverrides,
    ),
    [recipients, activeEnrollments, enrollmentOverrides],
  );
  const sendableRecipients = useMemo(() => {
    const okSuppression = new Set(
      [...suppressionPartition.eligible, ...suppressionPartition.overridden].map((r) => normalizeEmail(r.email)),
    );
    const okEnrollment = new Set(
      [...enrollmentPartition.eligible, ...enrollmentPartition.overridden].map((r) => normalizeEmail(r.email)),
    );
    return recipients.filter(
      (r) => okSuppression.has(normalizeEmail(r.email)) && okEnrollment.has(normalizeEmail(r.email)),
    );
  }, [recipients, suppressionPartition, enrollmentPartition]);

  // The chosen inbox's current load (Campaigns overhaul Phase 5) — only
  // meaningful once an inbox is actually picked, and only ever non-null once
  // inboxHealth has loaded (step === 3).
  const selectedInboxHealth = useMemo(
    () => (inboxId ? (inboxHealth ?? []).find((ib) => String(ib.id) === inboxId) ?? null : null),
    [inboxHealth, inboxId],
  );
  // Remaining daily capacity on the chosen inbox: its Smartlead daily limit
  // minus what its active campaigns already draw. null = limit unknown — no
  // clamp, never treated as 0 (same "unknown, not zero" rule as
  // InboxHealthDialog).
  const inboxHeadroom = useMemo(() => {
    if (!selectedInboxHealth || selectedInboxHealth.daily_limit == null) return null;
    return Math.max(0, selectedInboxHealth.daily_limit - selectedInboxHealth.total_leads_per_day);
  }, [selectedInboxHealth]);
  // What the launch actually sends as leads/day: capped at the inbox's
  // remaining room whenever the limit is known. Floor of 1 — the edge
  // action's `Number(...) || 25` treats 0 as unset and would default it
  // straight back to 25.
  const effectiveLeadsPerDay = inboxHeadroom != null ? Math.min(leadsPerDay, Math.max(1, inboxHeadroom)) : leadsPerDay;
  const deliverySettings = useMemo(() => normalizeDeliverySettings({
    daysOfWeek: sendDays,
    startHour: sendStart,
    endHour: sendEnd,
    timezone: sendTimezone,
    campaignDailyVolume: effectiveLeadsPerDay,
    messageSpacingMinutes: minGap,
  }), [sendDays, sendStart, sendEnd, sendTimezone, effectiveLeadsPerDay, minGap]);

  function openDeliveryEditor() {
    deliveryBaselineRef.current = { ...deliverySettings, campaignDailyVolume: leadsPerDay, daysOfWeek: [...deliverySettings.daysOfWeek] };
    setSettingsOpen(true);
  }
  function keepDeliveryEdits() {
    deliveryBaselineRef.current = null;
    setSettingsOpen(false);
    setAdvancedDeliveryOpen(false);
  }
  function cancelDeliveryEdits() {
    const baseline = deliveryBaselineRef.current;
    if (baseline) {
      setSendDays(baseline.daysOfWeek);
      setSendStart(baseline.startHour);
      setSendEnd(baseline.endHour);
      setSendTimezone(baseline.timezone);
      setLeadsPerDay(baseline.campaignDailyVolume);
      setMinGap(baseline.messageSpacingMinutes);
    }
    keepDeliveryEdits();
  }

  const rampProjection = useMemo(
    () => (templateSteps.length ? projectSendRamp(templateSteps, effectiveLeadsPerDay, sendableRecipients.length) : null),
    [mode, templateSteps, effectiveLeadsPerDay, sendableRecipients.length],
  );

  // The picked sending inbox's display label, for the launch-confirmation
  // summary (Step 4's own inbox picker already renders this inline).
  const selectedInbox = useMemo(
    () => (inboxId ? (inboxes ?? []).find((a) => String(a.id) === inboxId) ?? null : null),
    [inboxes, inboxId],
  );

  // Is there anything worth not losing? Drives both the autosave effect and
  // the "draft saved" toast on close — an empty wizard has nothing to save.
  const hasMeaningfulContent = useMemo(() => {
    if (recipients.length > 0) return true;
    if (templateName.trim()) return true;
    if (mode === "ai" && campaign?.sequence.some((e) => e.subject.trim() || plain(e.body_html).trim())) return true;
    if (templateSteps.some((s) => (s.subject_template ?? "").trim() || plain(s.body_template ?? "").trim())) return true;
    return false;
  }, [recipients, templateName, mode, campaign, templateSteps]);

  const closeStateSnapshot = useMemo(() => JSON.stringify({
    step, description, campaign, templateName, templateSteps, flow, customSequence,
    recipients, suppressionOverrides, enrollmentOverrides, inboxId, ownerId,
    autoStart, adaptive, leadsPerDay, minGap, sendDays, sendStart, sendEnd, sendTimezone,
  }), [
    step, description, campaign, templateName, templateSteps, flow, customSequence,
    recipients, suppressionOverrides, enrollmentOverrides, inboxId, ownerId,
    autoStart, adaptive, leadsPerDay, minGap, sendDays, sendStart, sendEnd, sendTimezone,
  ]);

  useEffect(() => {
    if (!open) {
      closeBaselineRef.current = null;
      setWizardDirty(false);
      return;
    }
    if (closeBaselineRef.current === null) {
      closeBaselineRef.current = closeStateSnapshot;
      setWizardDirty(false);
      return;
    }
    setWizardDirty(closeStateSnapshot !== closeBaselineRef.current);
  }, [open, closeStateSnapshot]);

  // Guard every Radix dismissal path, including the built-in X, Escape,
  // and outside click. Autosave is still a recovery net, but it must not be
  // used as permission to silently close while a person is actively editing.
  const discard = useDialogDiscardGuard(wizardDirty && !launchResult, () => {
    reset();
    onOpenChange(false);
  });

  // Resume-a-draft check, once per open. Skipped entirely when
  // initialRecipients was passed — that's a deliberate fresh start (right-
  // click "Start a campaign…"), never a "did you mean to resume?" moment.
  useEffect(() => {
    if (!open) { draftCheckedRef.current = false; return; }
    if (initialRecipients) return;
    if (draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    // Fetch filters by user AND mode (see fetchLatestCampaignDraft) — the
    // mode re-check here is belt-and-braces, since a resume can't switch
    // the `mode` prop. A mismatched draft is left alone, never deleted.
    fetchLatestCampaignDraft(mode)
      .then((row) => {
        if (!row) return;
        const parsed = parseCampaignDraftState(row.state_json);
        if (!parsed) { deleteCampaignDraft(row.id).catch(() => {}); return; }
        if (parsed.mode !== mode) return;
        setDraftBanner({ id: row.id, title: row.title, updatedAt: row.updated_at, state: parsed });
      })
      .catch(() => {}); // resume is a convenience — a failed check shouldn't block the wizard
  }, [open, initialRecipients, mode]);

  // Debounced autosave — while the dialog is open, the user has actually
  // CHANGED something, and it isn't mid-launch or already launched. The
  // baseline snapshot is the dirty gate (adversarial review): template mode
  // seeds templateName/steps and quick-campaign passes initialRecipients,
  // so "has content" alone would write a draft row (and toast "Draft
  // saved") on every open-then-close with zero user interaction. Same row
  // every time (draftIdRef), so this never piles up more than one row per
  // session.
  useEffect(() => {
    if (!open) { autosaveBaselineRef.current = null; return; }
    if (launch.isPending || launchResult || !hasMeaningfulContent) return;
    const state: CampaignDraftState = {
      v: 1, mode, flow, customSequence, step, description, campaign, templateName, templateSteps,
      recipients, suppressionOverrides, enrollmentOverrides, inboxId, ownerId,
      autoStart, adaptive, leadsPerDay, minGap, delivery: deliverySettings,
    };
    const serialized = JSON.stringify(state);
    if (autosaveBaselineRef.current === null) {
      // First qualifying render of this open — record what "untouched"
      // looks like; only divergence from it is worth saving.
      autosaveBaselineRef.current = serialized;
      return;
    }
    if (serialized === autosaveBaselineRef.current) return;
    const title = campaign?.campaign_name.trim() || templateName.trim() || "Untitled campaign";
    const t = setTimeout(() => {
      saveCampaignDraft({ id: draftIdRef.current ?? undefined, title, state_json: state as unknown as Record<string, unknown> })
        .then((id) => { draftIdRef.current = id; })
        .catch(() => {}); // best-effort — an autosave failure shouldn't interrupt the wizard
    }, 1500);
    return () => clearTimeout(t);
  }, [
    open, launch.isPending, launchResult, hasMeaningfulContent,
    mode, flow, customSequence, step, description, campaign, templateName, templateSteps,
    recipients, suppressionOverrides, enrollmentOverrides, inboxId, ownerId,
    autoStart, adaptive, leadsPerDay, minGap, deliverySettings,
  ]);

  function resumeDraft() {
    if (!draftBanner) return;
    const s = draftBanner.state;
    // Never resume PAST the Recipients step: the suppression + already-
    // enrolled data is fetched only while CampaignRecipients is mounted
    // (step 3), so landing straight on step 4 would show an unwarned
    // recipient count and skip the per-person review screen every launch
    // is supposed to pass through (final-sweep catch). The server would
    // still re-check before sending — this keeps the UI honest too.
    setStep(resumeLaunchStep(mode, s.step, hasLockedRecipients));
    setDescription(s.description); setCampaign(s.campaign);
    setTemplateName(s.templateName); setTemplateSteps(s.templateSteps);
    setFlow(s.flow ?? (s.campaign ? "ai" : s.templateSteps.length ? "template" : mode === "template" ? "template" : "choose"));
    setCustomSequence(Boolean(s.customSequence));
    setEditingSequence(false);
    setSequenceAttempted(false);
    setRecipients(s.recipients);
    setSuppressionOverrides(s.suppressionOverrides); setEnrollmentOverrides(s.enrollmentOverrides);
    setInboxId(s.inboxId); setOwnerId(s.ownerId);
    setAutoStart(s.autoStart); setAdaptive(s.adaptive);
    const delivery = normalizeDeliverySettings(s.delivery ?? {
      campaignDailyVolume: s.leadsPerDay,
      messageSpacingMinutes: s.minGap,
    });
    setLeadsPerDay(delivery.campaignDailyVolume); setMinGap(delivery.messageSpacingMinutes);
    setSendDays(delivery.daysOfWeek); setSendStart(delivery.startHour);
    setSendEnd(delivery.endHour); setSendTimezone(delivery.timezone);
    draftIdRef.current = draftBanner.id;
    setDraftBanner(null);
  }
  function discardDraft() {
    if (!draftBanner) return;
    const id = draftBanner.id;
    setDraftBanner(null);
    deleteCampaignDraft(id).catch(() => {});
  }

  function reset() {
    setStep(initialLaunchStep(mode, hasLockedRecipients));
    setDescription(initialDescription); setCampaign(null); setSuggestions(null); setAppliedSug(new Set());
    setShowRegen(false); setRegenFeedback(""); setCodeView(new Set());
    setRecipients(initialRecipients ?? []); setInboxId(""); setOwnerId(profile?.id ?? "");
    setSuppression([]); setSuppressionOverrides([]);
    setActiveEnrollments([]); setEnrollmentOverrides([]);
    setRecipientChecksPending(hasLockedRecipients);
    setRecipientChecksFailed(false);
    setAutoStart(true); setAdaptive(false); setLeadsPerDay(25); setMinGap(15); setLaunchResult(null);
    setTemplateName(templateSeed?.name ?? "");
    setTemplateSteps(templateSeed?.steps ? templateSeed.steps.map((s) => ({ ...s })) : []);
    setFlow(mode === "template" ? "template" : "choose");
    setCustomSequence(false);
    setEditingSequence(false); setSequenceAttempted(false); setSettingsOpen(false);
    setConfirmOpen(false); setDraftBanner(null); draftIdRef.current = null;
    autosaveBaselineRef.current = null;
    closeBaselineRef.current = null;
    setWizardDirty(false);
  }
  function close(o: boolean) {
    if (o) onOpenChange(true);
    else discard.requestClose();
  }

  function handleGenerate(desc?: string) {
    gen.mutate(desc ?? description, { onSuccess: (r) => {
      const requestedName = templateName.trim();
      setCampaign(requestedName ? { ...r.campaign, campaign_name: requestedName } : r.campaign);
      setFlow("ai"); setSuggestions(null); setAppliedSug(new Set());
    } });
  }
  function regenerateWithFeedback() {
    const fb = regenFeedback.trim();
    if (!fb) return;
    gen.mutate(`Original request: ${description}\n\nRevise the whole sequence with this feedback: ${fb}`, {
      onSuccess: (r) => { setCampaign(r.campaign); setShowRegen(false); setRegenFeedback(""); },
    });
  }
  function applySuggestion(text: string, i: number) {
    gen.mutate(`${description}\n\nApply this specific improvement to the sequence: ${text}`, {
      onSuccess: (r) => { setCampaign(r.campaign); setAppliedSug((s) => new Set(s).add(i)); },
    });
  }

  function editEmail(seq: number, patch: Partial<GeneratedCampaign["sequence"][number]>) {
    setCampaign((c) => c ? { ...c, sequence: c.sequence.map((e) => (e.seq_number === seq ? { ...e, ...patch } : e)) } : c);
  }
  function addEmail() {
    setCampaign((c) => {
      if (!c || c.sequence.length >= MAX_EMAILS) return c;
      const next = c.sequence.length + 1;
      return { ...c, sequence: [...c.sequence, { seq_number: next, delay_days: 3, subject: "", body_html: "" }] };
    });
  }
  function deleteEmail(seq: number) {
    setCampaign((c) => {
      if (!c || c.sequence.length <= 1) return c;
      const kept = c.sequence.filter((e) => e.seq_number !== seq).map((e, i) => ({ ...e, seq_number: i + 1 }));
      return { ...c, sequence: kept };
    });
  }
  function toggleCode(seq: number) {
    setCodeView((s) => { const n = new Set(s); n.has(seq) ? n.delete(seq) : n.add(seq); return n; });
  }

  function handleLaunchSuccess(r: {
    smartlead_campaign_id: number;
    auto_started: boolean;
    leads_added: number;
    leads_failed?: number;
    suppression_dropped?: number;
    already_enrolled_dropped?: number;
    enrolled?: number;
    tasks_created?: number;
    warning?: string;
  }) {
    const enrolled = r.enrolled ?? 0;
    const tasksCreated = r.tasks_created ?? 0;
    const suppressionDropped = r.suppression_dropped ?? 0;
    const alreadyEnrolledDropped = r.already_enrolled_dropped ?? 0;
    setLaunchResult({
      id: r.smartlead_campaign_id, started: r.auto_started,
      leads: r.leads_added, failed: r.leads_failed ?? 0,
      suppressionDropped, alreadyEnrolledDropped, enrolled, tasksCreated,
    });
    // The draft's job is done — a launched campaign is the real record now.
    // BOTH rows can exist (adversarial review): the session's own autosave
    // row (draftIdRef) AND a still-unresolved resume offer from a previous
    // session (draftBanner, when the user ignored the banner and built
    // fresh) — leaving the banner row behind meant "you have an unfinished
    // campaign" forever after every launch.
    if (draftIdRef.current) {
      const id = draftIdRef.current;
      draftIdRef.current = null;
      deleteCampaignDraft(id).catch(() => {});
    }
    // A still-set banner means the offer was ignored (resume/discard both
    // clear it) — its row is stale now too.
    if (draftBanner) {
      deleteCampaignDraft(draftBanner.id).catch(() => {});
      setDraftBanner(null);
    }
    let msg = r.auto_started
      ? `Campaign started. ${enrolled} ${enrolled === 1 ? "person" : "people"} enrolled, ${tasksCreated} task${tasksCreated === 1 ? "" : "s"} scheduled.`
      : `Draft saved in Pulse. ${enrolled} ${enrolled === 1 ? "person" : "people"} enrolled. Press Start on the campaign card when you are ready.`;
    const notes: string[] = [];
    if (suppressionDropped > 0) notes.push(`${suppressionDropped} on the Do-Not-Email list skipped`);
    if (alreadyEnrolledDropped > 0) notes.push(`${alreadyEnrolledDropped} already enrolled elsewhere skipped`);
    if (notes.length) msg += ` (${notes.join("; ")})`;
    toast.success(msg);
    // A launch can succeed with a problem attached (some people failed to
    // upload; a bookkeeping write failed after sending started) — surface
    // it, don't swallow it (outside-review fix 3).
    if (r.warning) toast.warning(r.warning, { duration: 12000 });
  }

  function doLaunch() {
    if (smartleadDisabled) {
      toast.error("Reconnect Smartlead before launching this campaign.");
      return;
    }
    if (!senderReady || !selectedInbox) {
      toast.error("Choose an available sending inbox before launching.");
      return;
    }
    if (!deliveryReady) {
      toast.error("Choose at least one sending day and an end time after the start time.");
      return;
    }
    if (!copyReady || !audienceReady) {
      toast.error("Finish every launch-readiness check before launching.");
      return;
    }
    const shared = {
      recipients: sendableRecipients,
      email_account_id: inboxId ? Number(inboxId) : undefined,
      source_idea_id: sourceIdeaId,
      autoStart,
      adaptiveEnabled: adaptive,
      owner_id: ownerId || profile?.id,
      authoring_method: flow === "ai" ? "ai" as const : customSequence ? "write_own" as const : "template" as const,
      schedule: {
        max_new_leads_per_day: effectiveLeadsPerDay,
        days_of_week: deliverySettings.daysOfWeek,
        start_hour: deliverySettings.startHour,
        end_hour: deliverySettings.endHour,
        timezone: deliverySettings.timezone,
        min_time_btw_emails: deliverySettings.messageSpacingMinutes,
      },
      suppression_overrides: suppressionOverrides,
      enrollment_overrides: enrollmentOverrides,
    };
    if (flow === "ai") {
      if (!campaign) return;
      launch.mutate(
        {
          ...shared,
          campaign_name: campaign.campaign_name,
          target_audience: campaign.target_audience,
          sequence: campaign.sequence,
        },
        { onSuccess: handleLaunchSuccess },
      );
    } else {
      if (!templateName.trim()) return;
      launch.mutate(
        {
          ...shared,
          campaign_name: templateName,
          steps: templateSteps,
          template_id: customSequence ? undefined : (templateSeed?.template_id ?? undefined),
        },
        { onSuccess: handleLaunchSuccess },
      );
    }
  }

  const canGenerate = description.trim().length >= 20;
  const progress = builderProgress(mode, step, hasLockedRecipients);
  const displayTotal = progress.displayTotal;
  const displayStep = progress.displayStep;
  const templateEmailSteps = templateSteps.filter((s) => s.channel === "EMAIL_AUTO");
  const templateTaskSteps = templateSteps.filter((s) => s.channel !== "EMAIL_AUTO");
  const sequencePreviewContext = {
    firstName: recipients[0]?.first_name,
    recipientEmail: recipients[0]?.email,
    organization: recipients[0]?.company_name,
  };
  // Every automated email needs real wording before it can go out — block
  // Continue (template mode) / Launch (AI mode) until subject AND body are
  // both non-empty on every EMAIL_AUTO step. AI mode already writes copy for
  // every email it generates, so this rarely fires there; it's a cheap
  // last-line guard, not the primary flow. Field-level warnings wait for
  // touch+blur or a Continue/Done attempt.
  const isEmailStepEmpty = (
    subject: string | undefined,
    bodyHtml: string | undefined,
    requireSubject = true,
  ) => !plain(bodyHtml ?? "").trim() || (requireSubject && !subject?.trim());
  const incompleteTemplateEmails = incompleteAutoEmails(templateSteps);
  const aiEmailsIncomplete = flow === "ai" && !!campaign &&
    campaign.sequence.some((e) => isEmailStepEmpty(e.subject, e.body_html, e.seq_number === 1));
  function continueFromBuild() {
    if (incompleteTemplateEmails.length > 0) {
      setSequenceAttempted(true);
      setEditingSequence(true);
      return;
    }
    setEditingSequence(false);
    setStep(hasLockedRecipients ? 3 : 2);
  }

  // Launch-confirmation summary (Step 4's Launch button opens this instead
  // of calling doLaunch() directly). Mirrors the same counts the Step 4
  // summary strip below already shows.
  const confirmEmailCount = flow === "ai" ? (campaign?.sequence.length ?? 0) : templateEmailSteps.length;
  const confirmTouchCount = flow === "template" ? templateTaskSteps.length : 0;
  const confirmEmailsIncomplete = flow === "template" && incompleteTemplateEmails.length > 0;
  const confirmInboxLabel = selectedInbox
    ? (selectedInbox.from_email ?? selectedInbox.from_name ?? `Inbox ${selectedInbox.id}`)
    : "No sending inbox picked";
  const copyReady = flow === "ai"
    ? !!campaign && campaign.sequence.length > 0 && !aiEmailsIncomplete
    : templateEmailSteps.length > 0 && !confirmEmailsIncomplete;
  const audienceReady = !recipientChecksPending && !recipientChecksFailed && sendableRecipients.length > 0;
  const senderReady = !!selectedInbox && inboxHeadroom !== 0;
  const deliveryReady = sendDays.length > 0 && sendStart < sendEnd;

  const stepperSteps = mode === "ai" && !hasLockedRecipients ? ["Build", "People", "Review"] : null;

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="camp-scope camp-shell w-[min(50rem,calc(100vw-2rem))] sm:max-w-3xl max-h-[min(90vh,calc(100dvh-2rem))] gap-0 p-0 overflow-hidden flex flex-col">
          {/* Top bar — name of the flow, the Build/People/Review stepper,
              and the close X (the shared dialog close sits top-right). */}
          <div
            className="flex items-center justify-between gap-3 px-6 py-3.5 pr-12 shrink-0 border-b flex-wrap"
            style={{ borderColor: "var(--camp-line)" }}
          >
            <DialogHeader className="contents">
              <DialogTitle className="text-sm font-semibold tracking-tight">
                {mode === "template" ? "Launch a sequence" : "New campaign"}
              </DialogTitle>
              <DialogDescription className="sr-only">{progress.description}</DialogDescription>
            </DialogHeader>
            {stepperSteps ? (
              <div className="camp-stepper">
                {stepperSteps.map((label, i) => (
                  <span
                    key={label}
                    className="camp-step"
                    data-state={displayStep === i + 1 ? "current" : displayStep > i + 1 ? "done" : "todo"}
                  >
                    <span className="camp-step-num">{displayStep > i + 1 ? "✓" : i + 1}</span>
                    {label}
                  </span>
                ))}
              </div>
            ) : displayTotal > 1 ? (
              <span className="text-xs text-muted-foreground">
                {progress.title} · step {displayStep} of {displayTotal}
              </span>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Resume-a-draft banner — only on the wizard's first screen. */}
          {draftBanner && displayStep === 1 && (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span>You have an unfinished campaign from {formatRelativeDate(draftBanner.updatedAt)}. Resume it?</span>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="xs" variant="outline" className="h-6" onClick={resumeDraft}>Resume</Button>
                <Button size="xs" variant="ghost" className="h-6 text-muted-foreground" onClick={discardDraft}>Discard</Button>
              </div>
            </div>
          )}

          {hasLockedRecipients && !launchResult && (
            <CampaignRecipients
              compact
              recipients={recipients} setRecipients={setRecipients} tags={tags ?? []}
              suppression={suppression} setSuppression={setSuppression}
              suppressionOverrides={suppressionOverrides} setSuppressionOverrides={setSuppressionOverrides}
              activeEnrollments={activeEnrollments} setActiveEnrollments={setActiveEnrollments}
              enrollmentOverrides={enrollmentOverrides} setEnrollmentOverrides={setEnrollmentOverrides}
              onChecksPendingChange={setRecipientChecksPending}
              onChecksFailedChange={setRecipientChecksFailed}
            />
          )}

          {/* Step 1 — Build */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-1">
                {stepperSteps && <p className="camp-step-kicker">Step 1 of {displayTotal}</p>}
                <h2 className="camp-step-title">What are you sending?</h2>
              </div>
              <div className="space-y-1.5 sm:max-w-md">
                <Label className="text-xs">
                  Campaign name <span aria-hidden="true" className="text-muted-foreground">*</span>
                </Label>
                <Input
                  value={flow === "ai" ? (campaign?.campaign_name ?? templateName) : templateName}
                  onChange={(e) => {
                    setTemplateName(e.target.value);
                    if (flow === "ai" && campaign) setCampaign({ ...campaign, campaign_name: e.target.value });
                  }}
                  placeholder="What should this campaign be called?"
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">How would you like to start?</p>
                <div className="camp-methods" role="group" aria-label="How would you like to start?">
                  {BUILD_START_METHODS.map(({ id, label, description, Icon }) => {
                    const selected = id === "choose"
                      ? flow === "template" && customSequence
                      : id === "template"
                        ? flow === "template" && !customSequence
                        : flow === "ai";
                    return (
                      <button
                        key={id}
                        type="button"
                        data-method={id}
                        data-selected={selected}
                        aria-pressed={selected}
                        className="camp-method"
                        onClick={() => {
                          setSequenceAttempted(false);
                          if (id === "choose") {
                            setFlow("template");
                            if (!customSequence) setTemplateSteps(recommendedCustomSequence());
                            setCustomSequence(true);
                            setAutoStart(true);
                            setEditingSequence(false);
                          } else if (id === "template") {
                            setFlow("template");
                            setCustomSequence(false);
                            setAutoStart(true);
                            setEditingSequence(false);
                            setTemplateSteps(templateSeed?.steps ? templateSeed.steps.map((s) => ({ ...s })) : []);
                          } else {
                            setFlow("ai");
                            setAutoStart(true);
                            setEditingSequence(false);
                          }
                        }}
                      >
                        <span className="camp-icon-chip" aria-hidden="true">
                          <Icon className="h-4 w-4" />
                        </span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              {flow === "ai" && !campaign && (
                <div className="camp-card p-4 space-y-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Describe the campaign</Label>
                    <Textarea
                      rows={3}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Who is it for, what should it say, and how many touches? e.g. Rural hospital compliance leads in MN. Introduce our SRA service and book a call. Three emails and one call over two weeks."
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="camp-btn-primary" onClick={() => handleGenerate()} disabled={!canGenerate || gen.isPending}>
                      {gen.isPending
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing…</>
                        : <><Sparkles className="h-4 w-4" /> Generate sequence</>}
                    </button>
                    {!canGenerate && description.length > 0 && (
                      <p className="text-xs text-muted-foreground">Add a little more detail first.</p>
                    )}
                  </div>
                </div>
              )}

              {flow === "template" && !templateSteps.length && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(templates ?? []).map((t) => {
                    const cat = CATEGORY[t.category] ?? CATEGORY.custom;
                    const Icon = cat.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="camp-method !flex-row !items-center !gap-2 !p-3"
                        onClick={() => {
                          setTemplateName((current) => current.trim() || t.name);
                          setTemplateSteps(t.steps.map((s) => ({ ...s })));
                          setFlow("template");
                          setCustomSequence(false);
                          setEditingSequence(false);
                          setSequenceAttempted(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="text-sm font-medium truncate">{t.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {(flow === "template" && templateSteps.length > 0 && !editingSequence) && (
                <div className="space-y-3">
                  <div className="camp-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{customSequence ? "Recommended sequence" : "This launch's sequence"}</p>
                        <p className="text-xs text-muted-foreground">
                          {customSequence
                            ? "Ready to use. Customize it for this launch if you need to."
                            : "Edits apply to this launch only. The saved template stays unchanged."}
                        </p>
                      </div>
                      <button type="button" className="camp-btn shrink-0 text-xs" onClick={() => setEditingSequence(true)}>
                        <PencilLine className="h-3.5 w-3.5" /> Customize sequence
                      </button>
                    </div>
                    <SequenceTimeline steps={templateSteps} previewContext={sequencePreviewContext} />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="camp-btn-primary"
                      onClick={continueFromBuild}
                      disabled={!templateName.trim() || recipientChecksPending || recipientChecksFailed || (hasLockedRecipients && sendableRecipients.length === 0)}
                    >
                      {hasLockedRecipients ? "Review" : "Choose people"} <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI sequence editor lives on Build after a draft is generated */}
          {step === 1 && flow === "ai" && campaign && (
            <div className="space-y-3">
              <div className="space-y-1.5 sm:max-w-md">
                <Label className="text-xs">Audience</Label>
                <Input
                  value={campaign.target_audience}
                  onChange={(e) => setCampaign({ ...campaign, target_audience: e.target.value })}
                  placeholder="Who this campaign is for"
                />
              </div>
              {gen.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rewriting the sequence…</div>
              )}

              {campaign.sequence.map((email) => {
                const isPreview = codeView.has(email.seq_number);
                const authorBody = templateToAuthorText(email.body_html);
                const hasAdvancedFormatting = hasUnsupportedRichEmailHtml(email.body_html);
                return (
                  <div key={email.seq_number} className="camp-card p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">Email {email.seq_number}</span>
                        {email.seq_number === 1 ? (
                          <span className="text-[11px] text-muted-foreground">Send immediately</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                            Send
                            <Input
                              type="number" min={1} max={60} value={email.delay_days}
                              onChange={(e) => editEmail(email.seq_number, { delay_days: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                              className="h-6 w-14 text-xs px-1"
                            />
                            days after previous
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="xs" className="h-6" disabled={hasAdvancedFormatting} onClick={() => toggleCode(email.seq_number)}>
                          {isPreview ? <><PencilLine className="h-3 w-3 mr-1" /> Write</> : <><Eye className="h-3 w-3 mr-1" /> Preview</>}
                        </Button>
                        <Button
                          variant="ai" size="xs" className="h-6"
                          disabled={regen.isPending}
                          onClick={() => regen.mutate({ description, campaign, seq_number: email.seq_number }, { onSuccess: (r) => editEmail(email.seq_number, r.email) })}
                        >
                          {regen.isPending && regen.variables?.seq_number === email.seq_number
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><span className="ai-icon"><Wand2 className="h-3 w-3" /></span></>}
                        </Button>
                        <Button variant="ghost" size="xs" className="h-6 text-muted-foreground hover:text-destructive"
                          disabled={campaign.sequence.length <= 1} onClick={() => deleteEmail(email.seq_number)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <Input value={templateToAuthorText(email.subject)} onChange={(e) => editEmail(email.seq_number, { subject: e.target.value })}
                      placeholder={email.seq_number === 1 ? "Subject" : "Subject (blank = threaded reply)"} />
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[11px] text-muted-foreground">Add to subject</span>
                      <Button type="button" variant="outline" size="xs" onClick={() => editEmail(email.seq_number, { subject: insertAuthorToken(templateToAuthorText(email.subject), AUTHOR_TOKENS.firstName) })}>
                        <UserRound className="h-3 w-3 mr-1" /> First name
                      </Button>
                      <Button type="button" variant="outline" size="xs" onClick={() => editEmail(email.seq_number, { subject: insertAuthorToken(templateToAuthorText(email.subject), AUTHOR_TOKENS.organization) })}>
                        <Building2 className="h-3 w-3 mr-1" /> Organization
                      </Button>
                    </div>
                    {hasAdvancedFormatting ? (
                      <>
                        <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                          This email has advanced layout or embedded images. Pulse is preserving it exactly; rebuild it as clean copy in the template editor before changing the body.
                        </p>
                        <div className="rounded border bg-white overflow-hidden">
                          <iframe title={`Email ${email.seq_number}`} srcDoc={emailSrcDoc(email.body_html)} sandbox="" className="w-full min-h-[160px]" />
                        </div>
                      </>
                    ) : <>
                    {!isPreview && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-[11px] text-muted-foreground">Personalize email</span>
                        {[
                          [AUTHOR_TOKENS.firstName, "First name", UserRound],
                          [AUTHOR_TOKENS.organization, "Organization", Building2],
                          [AUTHOR_TOKENS.signature, "Signature", Signature],
                        ].map(([token, label, Icon]) => (
                          <Button key={String(token)} type="button" variant="outline" size="xs" onClick={() => editEmail(email.seq_number, { body_html: authorTextToTemplateHtml(insertAuthorToken(authorBody, String(token))) })}>
                            <Icon className="h-3 w-3 mr-1" /> {String(label)}
                          </Button>
                        ))}
                      </div>
                    )}
                    {isPreview ? (
                      <div className="rounded border bg-white overflow-hidden">
                        <iframe title={`Email ${email.seq_number}`} srcDoc={emailSrcDoc(campaignPreviewHtml(email.body_html, { firstName: recipients[0]?.first_name, organization: recipients[0]?.company_name }))} sandbox="" className="w-full min-h-[160px]" />
                      </div>
                    ) : (
                      <Textarea rows={7} value={authorBody}
                        placeholder="Write the email exactly as it should read. Pulse handles personalization and formatting."
                        onChange={(e) => editEmail(email.seq_number, { body_html: authorTextToTemplateHtml(e.target.value) })} />
                    )}
                    </>}
                    <p className="text-[11px] text-muted-foreground truncate">Preview: {plain(email.body_html).slice(0, 100) || "None"}</p>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="camp-btn text-xs" onClick={addEmail} disabled={campaign.sequence.length >= MAX_EMAILS}>
                  <Plus className="h-4 w-4" /> Add follow-up
                </button>
                <Button size="sm" variant="ai" onClick={() => setShowRegen((v) => !v)} disabled={gen.isPending}>
                  <span className="ai-icon mr-1"><RotateCw className="h-4 w-4" /></span> Regenerate
                </Button>
                <Button size="sm" variant="ai" disabled={suggest.isPending}
                  onClick={() => suggest.mutate(campaign, { onSuccess: (r) => { setSuggestions(parseSuggestions(r.suggestions)); setAppliedSug(new Set()); } })}>
                  {suggest.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Thinking…</> : <><span className="ai-icon mr-1"><Sparkles className="h-4 w-4" /></span> Suggest improvements</>}
                </Button>
              </div>

              {showRegen && (
                <div className="rounded-md border p-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {REGEN_CHIPS.map((c) => (
                      <button key={c} type="button" className="text-[11px] rounded-full border px-2 py-0.5 hover:bg-accent"
                        onClick={() => setRegenFeedback((f) => f ? `${f}; ${c}` : c)}>{c}</button>
                    ))}
                  </div>
                  <Textarea rows={2} placeholder="What should change across the whole sequence?" value={regenFeedback} onChange={(e) => setRegenFeedback(e.target.value)} />
                  <Button size="sm" variant="ai" onClick={regenerateWithFeedback} disabled={!regenFeedback.trim() || gen.isPending}>
                    {gen.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <span className="ai-icon mr-1"><RotateCw className="h-4 w-4" /></span>} Regenerate with this feedback
                  </Button>
                </div>
              )}

              {suggestions && (
                <div className="rounded-md border p-2 space-y-2">
                  <p className="text-xs font-medium">Suggested improvements</p>
                  {suggestions.map((s, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{s}</span>
                      {appliedSug.has(i) ? (
                        <span className="text-emerald-600 shrink-0 inline-flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" /> Applied</span>
                      ) : (
                        <Button size="xs" variant="ai" className="h-6 shrink-0" disabled={gen.isPending} onClick={() => applySuggestion(s, i)}>
                          <span className="ai-icon mr-0.5"><Sparkles className="h-3 w-3" /></span> Apply
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => { setCampaign(null); setFlow("choose"); setCustomSequence(false); }}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <button
                  type="button"
                  className="camp-btn-primary"
                  onClick={() => setStep(hasLockedRecipients ? 3 : 2)}
                  disabled={aiEmailsIncomplete || recipientChecksPending || recipientChecksFailed || (hasLockedRecipients && sendableRecipients.length === 0)}
                >
                  {hasLockedRecipients ? "Review" : "Choose people"} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Template / write-my-own sequence editor */}
          {editingSequence && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="camp-step-title !text-lg">Your sequence</h2>
              </div>
              {step !== 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Campaign name</Label>
                  <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="What should this launch be called?" />
                </div>
              )}

              <SequenceStepList
                steps={templateSteps}
                onChange={setTemplateSteps}
                previewContext={sequencePreviewContext}
                revealErrors={sequenceAttempted}
                launchOnlyNotice
              />

              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setEditingSequence(false)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <button
                  type="button"
                  className="camp-btn-primary"
                  onClick={() => {
                    if (incompleteTemplateEmails.length > 0) {
                      setSequenceAttempted(true);
                      return;
                    }
                    setEditingSequence(false);
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — People */}
          {step === 2 && !editingSequence && (
            <div className="space-y-4">
              <div className="space-y-1">
                {stepperSteps && <p className="camp-step-kicker">Step 2 of {displayTotal}</p>}
                <h2 className="camp-step-title">Who should get this?</h2>
              </div>
              <CampaignRecipients
                recipients={recipients} setRecipients={setRecipients} tags={tags ?? []}
                suppression={suppression} setSuppression={setSuppression}
                suppressionOverrides={suppressionOverrides} setSuppressionOverrides={setSuppressionOverrides}
                activeEnrollments={activeEnrollments} setActiveEnrollments={setActiveEnrollments}
                enrollmentOverrides={enrollmentOverrides} setEnrollmentOverrides={setEnrollmentOverrides}
                onChecksPendingChange={setRecipientChecksPending}
                onChecksFailedChange={setRecipientChecksFailed}
              />
              {recipients.length > 0 && sendableRecipients.length === 0 && (
                <p className="text-xs text-amber-600">
                  {suppressionPartition.dropped.length > 0 && enrollmentPartition.dropped.length > 0
                    ? "Everyone here is either on the Do-Not-Email list or already enrolled in another campaign. Use Include anyway or Enroll in both above, or add different people, to continue."
                    : suppressionPartition.dropped.length > 0
                      ? "Everyone here is on the Do-Not-Email list. Use Include anyway on at least one person above, or add different people, to continue."
                      : "Everyone here is already enrolled in another campaign. Use Enroll in both on at least one person above, or add different people, to continue."}
                </p>
              )}
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <button type="button" className="camp-btn-primary" onClick={() => setStep(3)} disabled={recipientChecksPending || recipientChecksFailed || sendableRecipients.length === 0}>
                  Review campaign <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Review */}
          {step === 3 && !editingSequence && (
            <div className="space-y-4">
              {!launchResult && (
                <div className="space-y-1">
                  {stepperSteps && <p className="camp-step-kicker">Step {displayTotal} of {displayTotal}</p>}
                  <h2 className="camp-step-title">Ready when you are.</h2>
                </div>
              )}
              {launchResult ? (
                <div className="camp-card p-5 space-y-3">
                  {launchResult.failed > 0 ? <AlertTriangle className="h-8 w-8 text-amber-500" /> : <CheckCircle2 className="h-8 w-8 text-green-600" />}
                  <p className="text-base font-semibold">{launchResult.started ? "Campaign started." : "Draft saved in Pulse."}</p>
                  <p className="text-sm text-muted-foreground">
                    {launchResult.started ? "Sending is live." : "Nothing sends until you start it."} {confirmInboxLabel}. {launchResult.enrolled} {launchResult.enrolled === 1 ? "person" : "people"} enrolled.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {launchResult.leads} added{launchResult.failed > 0 ? ` · ${launchResult.failed} failed` : ""} · Smartlead #{launchResult.id}
                    {launchResult.started ? ` · ${launchResult.tasksCreated} task${launchResult.tasksCreated === 1 ? "" : "s"} scheduled` : ""}
                  </p>
                  {launchResult.failed > 0 && <p className="text-xs text-amber-600">Some recipients couldn't be added. Check the audience in Smartlead before you start.</p>}
                  {launchResult.suppressionDropped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {launchResult.suppressionDropped} suppressed contact{launchResult.suppressionDropped === 1 ? "" : "s"}{" "}
                      {launchResult.suppressionDropped === 1 ? "was" : "were"} not added (Do-Not-Email list).
                    </p>
                  )}
                  {launchResult.alreadyEnrolledDropped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {launchResult.alreadyEnrolledDropped} contact{launchResult.alreadyEnrolledDropped === 1 ? "" : "s"}{" "}
                      {launchResult.alreadyEnrolledDropped === 1 ? "was" : "were"} already enrolled elsewhere and skipped.
                    </p>
                  )}
                  {!launchResult.started && <p className="text-xs text-muted-foreground">Press Start on the campaign card when you are ready. Starting only in Smartlead would skip Pulse task scheduling.</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {smartleadUrl(launchResult.id) && (
                      <a className="camp-btn text-xs" href={smartleadUrl(launchResult.id)!} target="_blank" rel="noopener noreferrer">Open Smartlead</a>
                    )}
                    <button type="button" className="camp-btn-primary text-xs" onClick={() => close(false)}>Done</button>
                  </div>
                </div>
              ) : (
                <>
                  {(flow === "template" || templateSteps.length > 0) && (
                    <div className="camp-card p-4 space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <Label className="text-xs">Campaign name</Label>
                          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Campaign name" />
                        </div>
                        <button type="button" className="camp-btn shrink-0 text-xs" onClick={() => setEditingSequence(true)}>
                          <PencilLine className="h-3.5 w-3.5" /> Edit sequence
                        </button>
                      </div>
                      <SequenceTimeline
                        steps={templateSteps}
                        previewContext={sequencePreviewContext}
                        onEdit={() => setEditingSequence(true)}
                      />
                    </div>
                  )}
                  <div className="camp-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Delivery</p>
                        <p className="text-xs text-muted-foreground">
                          {deliverySummary(deliverySettings)} · {effectiveLeadsPerDay} new {effectiveLeadsPerDay === 1 ? "person" : "people"}/day
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Recommended defaults are ready to use. Follow-up timing stays with the sequence above.
                        </p>
                      </div>
                      <button type="button" className="camp-btn shrink-0 text-xs" onClick={settingsOpen ? keepDeliveryEdits : openDeliveryEditor}>
                        {settingsOpen ? "Keep changes" : "Edit delivery settings"}
                      </button>
                    </div>
                  {settingsOpen && (
                  <div className="mt-3 border-t pt-4 space-y-4" style={{ borderColor: "var(--camp-line)" }}>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">Sending days</Label>
                        <p className="text-[11px] text-muted-foreground">Choose the days Pulse may send campaign emails.</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Campaign sending days">
                        {DELIVERY_DAY_OPTIONS.map((day) => {
                          const active = sendDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              aria-pressed={active}
                              className="camp-pill h-9 min-w-12 justify-center border"
                              onClick={() => setSendDays((current) => active
                                ? (current.length > 1 ? current.filter((value) => value !== day.value) : current)
                                : [...current, day.value])}
                            >
                              {day.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Start sending at</Label>
                        <Input type="time" value={sendStart} onChange={(e) => setSendStart(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Stop sending at</Label>
                        <Input type="time" value={sendEnd} onChange={(e) => setSendEnd(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Timezone</Label>
                      <Select value={sendTimezone} onValueChange={setSendTimezone}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="America/Los_Angeles">Pacific time</SelectItem>
                          <SelectItem value="America/Denver">Mountain time</SelectItem>
                          <SelectItem value="America/Chicago">Central time</SelectItem>
                          <SelectItem value="America/New_York">Eastern time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Campaign daily volume</Label>
                      <Input type="number" min={1} max={500} value={leadsPerDay} onChange={(e) => setLeadsPerDay(Math.max(1, Math.min(500, Number(e.target.value) || 25)))} />
                      <p className="text-[11px] text-muted-foreground">How many new people this campaign may begin with each day. The selected mailbox's safety limit still wins.</p>
                    </div>
                    <button type="button" className="camp-btn w-fit text-xs" onClick={() => setAdvancedDeliveryOpen((v) => !v)} aria-expanded={advancedDeliveryOpen}>
                      {advancedDeliveryOpen ? "Hide advanced" : "Advanced delivery"}
                    </button>
                    {advancedDeliveryOpen && (
                      <div className="space-y-1 rounded-xl border p-3" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
                        <Label className="text-xs">Spacing between individual messages</Label>
                        <div className="flex items-center gap-2">
                          <Input className="max-w-28" type="number" min={1} max={120} value={minGap} onChange={(e) => setMinGap(Math.max(1, Math.min(120, Number(e.target.value) || 15)))} />
                          <span className="text-xs text-muted-foreground">minutes minimum</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">A deliverability safeguard inside a sending window. This is not the delay between follow-ups; that cadence is set in the sequence.</p>
                      </div>
                    )}
                    <div className="rounded-xl border px-3 py-2 text-[11px] text-muted-foreground" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
                      These changes stay in this campaign builder until you launch or save the campaign as a draft. Nothing is saved to Smartlead from this editor.
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end" style={{ borderColor: "var(--camp-line)" }}>
                      <button type="button" className="camp-btn justify-center" onClick={cancelDeliveryEdits}>Cancel changes</button>
                      <button type="button" className="camp-btn-primary justify-center" onClick={keepDeliveryEdits}>Use these delivery settings</button>
                    </div>
                  </div>
                  )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Campaign owner</Label>
                    <Select value={ownerId} onValueChange={setOwnerId}>
                      <SelectTrigger><SelectValue placeholder="Pick an owner…" /></SelectTrigger>
                      <SelectContent>
                        {(activeUsers ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.id}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Tasks and reply alerts go to each person's owner. This covers people without one.</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Sending inbox</Label>
                    <Select value={inboxId} onValueChange={setInboxId}>
                      <SelectTrigger><SelectValue placeholder="Pick an inbox…" /></SelectTrigger>
                      <SelectContent>
                        {(inboxes ?? []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.from_email ?? a.from_name ?? `Inbox ${a.id}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedInboxHealth && (selectedInboxHealth.campaigns.length > 0 || inboxHeadroom != null) && (
                      <p className="text-[11px] text-muted-foreground">
                        {selectedInboxHealth.campaigns.length > 0 && (
                          <>
                            This inbox is also sending for {selectedInboxHealth.campaigns.length} other campaign{selectedInboxHealth.campaigns.length === 1 ? "" : "s"}{" "}
                            ({selectedInboxHealth.total_leads_per_day} people/day). New sends share its daily capacity.{" "}
                          </>
                        )}
                        {inboxHeadroom != null && (
                          <>Room for ~{inboxHeadroom} more {inboxHeadroom === 1 ? "person" : "people"}/day (limit {selectedInboxHealth.daily_limit}/day).</>
                        )}
                      </p>
                    )}
                    {inboxHeadroom === 0 ? (
                      <p className="text-xs text-amber-600">
                        This inbox is already at its daily limit. Pick a different inbox to launch. (The server refuses a launch on a full inbox.)
                      </p>
                    ) : inboxHeadroom != null && leadsPerDay > inboxHeadroom ? (
                      <p className="text-xs text-amber-600">
                        That's more than this inbox has room for. The launch will be capped at {inboxHeadroom} new {inboxHeadroom === 1 ? "person" : "people"}/day.
                      </p>
                    ) : null}
                    {selectedInboxHealth && (
                      <div className="mt-2 rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
                        <div className="flex items-center gap-2">
                          <Signature className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-medium">Signature from {confirmInboxLabel}</p>
                            <p className="text-[11px] text-muted-foreground">Smartlead adds this account signature when it sends.</p>
                          </div>
                        </div>
                        {selectedInboxHealth.signature == null ? (
                          <p className="text-xs text-muted-foreground">Smartlead did not return a signature for this inbox. Review it in Sending inboxes before launch.</p>
                        ) : selectedInboxHealth.signature.trim() ? (
                          <iframe
                            title={`Signature preview for ${confirmInboxLabel}`}
                            sandbox=""
                            srcDoc={emailSrcDoc(selectedInboxHealth.signature)}
                            className="h-24 w-full rounded-lg border bg-white"
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">This Smartlead inbox currently has no signature.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div
                    className="inline-flex rounded-full p-1 w-fit border"
                    style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}
                  >
                    <button
                      type="button"
                      className="camp-pill"
                      aria-pressed={autoStart}
                      onClick={() => setAutoStart(true)}
                    >
                      Start sending on launch
                    </button>
                    <button
                      type="button"
                      className="camp-pill"
                      aria-pressed={!autoStart}
                      onClick={() => setAutoStart(false)}
                    >
                      Save as draft
                    </button>
                  </div>
                  {rampProjection && (
                    <p className="text-xs text-muted-foreground">{rampProjection}</p>
                  )}
                  <div className="camp-card overflow-hidden">
                    <div className="px-4 pt-3">
                      <p className="text-xs font-semibold">Launch readiness</p>
                    </div>
                    <div className="px-4 pb-2">
                      <ReadinessRow
                        ready={copyReady}
                        label="Sequence copy"
                        detail={copyReady
                          ? `${confirmEmailCount} automatic email${confirmEmailCount === 1 ? "" : "s"} ready${confirmTouchCount > 0 ? ` + ${confirmTouchCount} assigned task${confirmTouchCount === 1 ? "" : "s"}` : ""}.`
                          : "One or more automatic emails still need complete wording."}
                      />
                      <ReadinessRow
                        ready={audienceReady}
                        label="Audience safety"
                        detail={recipientChecksPending
                          ? "Checking Do-Not-Email status and other active campaigns…"
                          : recipientChecksFailed
                            ? "Safety checks did not finish. Go back and retry them."
                            : `${sendableRecipients.length} eligible ${sendableRecipients.length === 1 ? "person" : "people"}${suppressionPartition.dropped.length + enrollmentPartition.dropped.length > 0 ? `; ${suppressionPartition.dropped.length + enrollmentPartition.dropped.length} safely excluded` : ""}.`}
                      />
                      <ReadinessRow
                        ready={smartleadReady}
                        label="Smartlead connection"
                        detail={smartleadReady
                          ? "Smartlead is connected and ready for launch."
                          : smartleadLoading
                            ? "Checking the Smartlead connection…"
                            : smartleadError
                              ? "Pulse could not verify Smartlead. Retry after the connection check recovers."
                              : "Reconnect Smartlead before Pulse can create or start this campaign."}
                      />
                      <ReadinessRow
                        ready={deliveryReady}
                        label="Delivery schedule"
                        detail={deliveryReady ? deliverySummary(deliverySettings) : "Choose at least one sending day and an end time after the start time."}
                      />
                      <ReadinessRow
                        ready={senderReady}
                        label="Sending inbox"
                        detail={!selectedInbox
                          ? "Choose the exact inbox that should send this campaign."
                          : inboxHeadroom === 0
                            ? `${confirmInboxLabel} is already at its daily limit.`
                            : `${confirmInboxLabel} selected${inboxHeadroom != null ? `; room for about ${inboxHeadroom} more per day` : "; Smartlead will enforce its delivery limits"}.`}
                      />
                    </div>
                    <div
                      className={cn("px-4 py-2 text-[11px] border-t", autoStart ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
                      style={{ borderColor: "var(--camp-line)", background: autoStart ? undefined : "var(--camp-surface-2)" }}
                    >
                      {autoStart ? "Launch starts sending immediately." : "Launch saves a draft; nothing sends until you press Start."}
                    </div>
                  </div>
                  {aiEmailsIncomplete && (
                    <p className="text-xs text-amber-600">One or more emails still need wording. Go back to Build to finish them.</p>
                  )}
                  <div className={cn("flex pt-2", hasLockedRecipients ? "justify-end" : "justify-between")}>
                    {!hasLockedRecipients && (
                      <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                    )}
                    <button type="button" className="camp-btn-primary" onClick={() => setConfirmOpen(true)} disabled={launch.isPending || !copyReady || !audienceReady || !deliveryReady || !senderReady || smartleadDisabled}>
                      {launch.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Launching…</> : <><Rocket className="h-4 w-4" /> {autoStart ? "Launch campaign" : "Save draft"}</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Launch confirmation — a small plain-English summary between the
          Launch button above and the actual doLaunch() call. All of the
          outer button's own gating (aiEmailsIncomplete, smartleadDisabled,
          launch.isPending) still applies before this can even open. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="camp-scope camp-shell sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{autoStart ? "Ready to start sending?" : "Save this campaign as a draft?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5 text-left text-sm">
                <p>{sendableRecipients.length} {sendableRecipients.length === 1 ? "person" : "people"} will be added</p>
                <p>{confirmInboxLabel}</p>
                <p>
                  {confirmEmailCount} automatic email{confirmEmailCount === 1 ? "" : "s"}
                  {confirmTouchCount > 0 ? ` + ${confirmTouchCount} call/LinkedIn touch${confirmTouchCount === 1 ? "" : "es"}` : ""} per person
                </p>
                <p>{autoStart ? "Sending starts immediately after launch." : "Saves as a Pulse draft. Nothing sends until you press Start on the campaign card."}</p>
                <p>{effectiveLeadsPerDay} new {effectiveLeadsPerDay === 1 ? "person" : "people"}/day</p>
                <p>{deliverySummary(deliverySettings)}</p>
                <p>Follow-up cadence comes from the sequence; individual sends are spaced at least {minGap} minutes apart.</p>
                {confirmEmailsIncomplete && (
                  <p className="text-amber-600">Some emails are missing wording. Fix them before launching.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction className="camp-btn-primary" disabled={smartleadDisabled || !copyReady || !audienceReady || !deliveryReady || !senderReady || launch.isPending} onClick={doLaunch}>
              {autoStart
                ? `Launch to ${sendableRecipients.length} ${sendableRecipients.length === 1 ? "person" : "people"}`
                : `Save draft for ${sendableRecipients.length} ${sendableRecipients.length === 1 ? "person" : "people"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discard.dialog}
    </>
  );
}
