// Campaign wizard — two entry modes sharing one Recipients/Launch flow:
//   - "ai" (default): Describe -> Preview/Edit -> Recipients -> Launch. AI
//     writes the email sequence (Claude).
//   - "template" (Campaigns overhaul S3): opened from TemplatesSection's
//     "Use this template" or SequenceEditor's "Launch this sequence" — skips
//     Describe, edits a template's own EMAIL_AUTO steps instead of an
//     AI-generated sequence, and carries the non-email (CALL/LINKEDIN/
//     EMAIL_HYBRID) steps through read-only (they become tasks at launch,
//     not something this wizard edits).
// Recipients come from a contact tag, a CSV upload, or pasted emails; Launch
// creates the campaign in Smartlead AND enrolls every recipient
// (campaign_enrollments) — see playbook-smartlead/index.ts's `launch`
// action. autoStart defaults OFF in AI mode (review the Smartlead draft
// first) and ON in template mode (a template is already proven copy).

import { useMemo, useState } from "react";
import {
  Loader2, Sparkles, Wand2, ArrowLeft, ArrowRight, Rocket, CheckCircle2, AlertTriangle,
  Plus, Trash2, Eye, Code2, RotateCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
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
import { CampaignRecipients } from "./CampaignRecipients";
import { SequenceTimeline } from "./SequenceTimeline";
import { partitionSuppression, normalizeEmail, type SuppressionEntry } from "./suppression";
import type { SequenceStep } from "./types";
import {
  useGenerateCampaign, useSuggestCampaign, useRegenerateEmail, useEmailAccounts, useLaunchCampaign,
  type GeneratedCampaign, type Recipient, type ActiveEnrollmentEntry,
} from "./api";

type Step = 1 | 2 | 3 | 4;
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
  const [step, setStep] = useState<Step>(mode === "template" ? 2 : 1);
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
  const [inboxId, setInboxId] = useState("");
  // Template mode defaults ON (a template is already-proven copy someone
  // just wants running); AI mode defaults OFF (review the Smartlead draft
  // before it sends anything the AI just wrote).
  const [autoStart, setAutoStart] = useState(mode === "template");
  const [adaptive, setAdaptive] = useState(false);
  const [leadsPerDay, setLeadsPerDay] = useState(25);
  const [minGap, setMinGap] = useState(15);
  const [launchResult, setLaunchResult] = useState<{
    id: number; started: boolean; leads: number; failed: number;
    suppressionDropped: number; alreadyEnrolledDropped: number; enrolled: number; tasksCreated: number;
  } | null>(null);
  // Template mode's own content state — a deep-copied, freely-editable copy
  // of templateSeed.steps. Edits here apply to THIS launch only; the saved
  // template (campaign_templates row) is never touched by the wizard.
  const [templateName, setTemplateName] = useState(templateSeed?.name ?? "");
  const [templateSteps, setTemplateSteps] = useState<SequenceStep[]>(
    templateSeed?.steps ? templateSeed.steps.map((s) => ({ ...s })) : [],
  );

  const gen = useGenerateCampaign();
  const suggest = useSuggestCampaign();
  const regen = useRegenerateEmail();
  const { data: tags } = useTags();
  const { data: inboxes } = useEmailAccounts();
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

  const rampProjection = useMemo(
    () => (mode === "template" ? projectSendRamp(templateSteps, leadsPerDay, sendableRecipients.length) : null),
    [mode, templateSteps, leadsPerDay, sendableRecipients.length],
  );

  function reset() {
    setStep(mode === "template" ? 2 : 1);
    setDescription(initialDescription); setCampaign(null); setSuggestions(null); setAppliedSug(new Set());
    setShowRegen(false); setRegenFeedback(""); setCodeView(new Set());
    setRecipients(initialRecipients ?? []); setInboxId("");
    setSuppression([]); setSuppressionOverrides([]);
    setActiveEnrollments([]); setEnrollmentOverrides([]);
    setAutoStart(mode === "template"); setAdaptive(false); setLeadsPerDay(25); setMinGap(15); setLaunchResult(null);
    setTemplateName(templateSeed?.name ?? "");
    setTemplateSteps(templateSeed?.steps ? templateSeed.steps.map((s) => ({ ...s })) : []);
  }
  function close(o: boolean) { if (!o) reset(); onOpenChange(o); }

  function handleGenerate(desc?: string) {
    gen.mutate(desc ?? description, { onSuccess: (r) => { setCampaign(r.campaign); setSuggestions(null); setAppliedSug(new Set()); setStep(2); } });
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

  function patchTemplateStep(order: number, patch: Partial<SequenceStep>) {
    setTemplateSteps((steps) => steps.map((s) => (s.order === order ? { ...s, ...patch } : s)));
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
    let msg = `Campaign launched — ${enrolled} ${enrolled === 1 ? "person" : "people"} enrolled, ${tasksCreated} task${tasksCreated === 1 ? "" : "s"} scheduled.`;
    const notes: string[] = [];
    if (suppressionDropped > 0) notes.push(`${suppressionDropped} on the Do-Not-Email list skipped`);
    if (alreadyEnrolledDropped > 0) notes.push(`${alreadyEnrolledDropped} already enrolled elsewhere skipped`);
    if (notes.length) msg += ` (${notes.join("; ")})`;
    toast.success(msg);
  }

  function doLaunch() {
    const shared = {
      recipients: sendableRecipients,
      email_account_id: inboxId ? Number(inboxId) : undefined,
      source_idea_id: sourceIdeaId,
      autoStart,
      adaptiveEnabled: adaptive,
      owner_id: profile?.id,
      schedule: { max_new_leads_per_day: leadsPerDay, min_time_btw_emails: minGap },
      suppression_overrides: suppressionOverrides,
      enrollment_overrides: enrollmentOverrides,
    };
    if (mode === "ai") {
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
          template_id: templateSeed?.template_id ?? undefined,
        },
        { onSuccess: handleLaunchSuccess },
      );
    }
  }

  const canGenerate = description.trim().length >= 20;
  const displayTotal = mode === "template" ? 3 : 4;
  const displayStep = mode === "template" ? Math.max(1, step - 1) : step;
  const templateEmailSteps = templateSteps.filter((s) => s.channel === "EMAIL_AUTO");
  const templateTaskSteps = templateSteps.filter((s) => s.channel !== "EMAIL_AUTO");
  // Every automated email needs real wording before it can go out — block
  // Continue (template mode) / Launch (AI mode) until subject AND body are
  // both non-empty on every EMAIL_AUTO step. AI mode already writes copy for
  // every email it generates, so this rarely fires there; it's a cheap
  // last-line guard, not the primary flow (see the per-step hint below for
  // template mode, where a hand-cleared field is the real target).
  const isEmailStepEmpty = (subject: string | undefined, bodyHtml: string | undefined) =>
    !subject?.trim() || !plain(bodyHtml ?? "").trim();
  const incompleteTemplateEmails = templateEmailSteps.filter((s) =>
    isEmailStepEmpty(s.subject_template, s.body_template));
  const aiEmailsIncomplete = mode === "ai" && !!campaign &&
    campaign.sequence.some((e) => isEmailStepEmpty(e.subject, e.body_html));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "template" ? "Launch sequence" : "New Campaign"} — Step {displayStep} of {displayTotal}</DialogTitle>
          <DialogDescription>
            {mode === "ai" && step === 1 && "Describe the campaign you want. The AI writes the email sequence."}
            {mode === "ai" && step === 2 && "Review and edit the sequence. Rewrite any email, regenerate, or ask for suggestions."}
            {mode === "template" && step === 2 && "Review the automated emails — edit them for this launch only. Calls, LinkedIn, and review-and-send steps become your tasks automatically."}
            {step === 3 && "Choose who gets it — a contact tag, a CSV upload, or pasted emails."}
            {step === 4 && "Set the cadence, pick the inbox, and launch. Leave 'start now' off to review the draft in Smartlead first."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — Describe (AI mode only) */}
        {mode === "ai" && step === 1 && (
          <div className="space-y-3">
            <Label>What's the campaign?</Label>
            <Textarea
              rows={5}
              placeholder="e.g. A 3-email cold sequence to small dental practices (1-20 staff) introducing the SRA and offering a quick demo."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button variant="ai" onClick={() => handleGenerate()} disabled={!canGenerate || gen.isPending}>
              {gen.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Writing…</>
                : <><span className="ai-icon mr-1"><Sparkles className="h-4 w-4" /></span> Generate sequence</>}
            </Button>
            {!canGenerate && description.length > 0 && <p className="text-xs text-muted-foreground">A little more detail helps (20+ characters).</p>}
          </div>
        )}

        {/* Step 2 — Preview / Edit (AI mode) */}
        {mode === "ai" && step === 2 && campaign && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Campaign name</Label>
                <Input value={campaign.campaign_name} onChange={(e) => setCampaign({ ...campaign, campaign_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target audience</Label>
                <Input value={campaign.target_audience} onChange={(e) => setCampaign({ ...campaign, target_audience: e.target.value })} />
              </div>
            </div>

            {gen.isPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rewriting the sequence…</div>
            )}

            {campaign.sequence.map((email) => {
              const isCode = codeView.has(email.seq_number);
              return (
                <div key={email.seq_number} className="rounded-md border p-3 space-y-2">
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
                      <Button variant="ghost" size="xs" className="h-6" onClick={() => toggleCode(email.seq_number)} title="Toggle preview / HTML">
                        {isCode ? <><Eye className="h-3 w-3 mr-1" /> Preview</> : <><Code2 className="h-3 w-3 mr-1" /> HTML</>}
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
                  <Input value={email.subject} onChange={(e) => editEmail(email.seq_number, { subject: e.target.value })}
                    placeholder={email.seq_number === 1 ? "Subject" : "Subject (blank = threaded reply)"} />
                  {isCode ? (
                    <Textarea rows={6} className="font-mono text-[11px]" value={email.body_html}
                      onChange={(e) => editEmail(email.seq_number, { body_html: e.target.value })} />
                  ) : (
                    <div className="rounded border bg-white overflow-hidden">
                      <iframe title={`Email ${email.seq_number}`} srcDoc={emailSrcDoc(email.body_html)} sandbox="" className="w-full min-h-[160px]" />
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground truncate">Preview: {plain(email.body_html).slice(0, 100) || "—"}</p>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={addEmail} disabled={campaign.sequence.length >= MAX_EMAILS}>
                <Plus className="h-4 w-4 mr-1" /> Add follow-up
              </Button>
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
              <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(3)} disabled={!campaign.sequence.some((e) => e.subject && e.body_html)}>
                Recipients <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Review emails (template mode) */}
        {mode === "template" && step === 2 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Campaign name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="What should this launch be called?" />
            </div>

            {templateEmailSteps.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Automated emails — edit for this launch only, the saved template is untouched</p>
                {templateEmailSteps.map((s) => {
                  const isCode = codeView.has(s.order);
                  const incomplete = isEmailStepEmpty(s.subject_template, s.body_template);
                  return (
                    <div key={s.order} className={cn("rounded-md border p-3 space-y-2", incomplete && "border-amber-400/60")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">Day {s.day_offset} email</span>
                        <Button variant="ghost" size="xs" className="h-6" onClick={() => toggleCode(s.order)} title="Toggle preview / HTML">
                          {isCode ? <><Eye className="h-3 w-3 mr-1" /> Preview</> : <><Code2 className="h-3 w-3 mr-1" /> HTML</>}
                        </Button>
                      </div>
                      <Input
                        value={s.subject_template ?? ""}
                        placeholder="Subject"
                        onChange={(e) => patchTemplateStep(s.order, { subject_template: e.target.value })}
                      />
                      {isCode ? (
                        <Textarea rows={6} className="font-mono text-[11px]" value={s.body_template ?? ""}
                          onChange={(e) => patchTemplateStep(s.order, { body_template: e.target.value })} />
                      ) : (
                        <div className="rounded border bg-white overflow-hidden">
                          <iframe title={`Day ${s.day_offset} email`} srcDoc={emailSrcDoc(s.body_template ?? "")} sandbox="" className="w-full min-h-[160px]" />
                        </div>
                      )}
                      {incomplete && (
                        <p className="text-[11px] text-amber-600">This email still needs wording.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {templateTaskSteps.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Calls, LinkedIn & review-and-send steps — become your tasks, right on schedule</p>
                <SequenceTimeline steps={templateTaskSteps} />
              </div>
            )}

            {incompleteTemplateEmails.length > 0 && (
              <p className="text-xs text-amber-600">
                {incompleteTemplateEmails.length === 1
                  ? "One email above still needs wording before you can continue."
                  : `${incompleteTemplateEmails.length} emails above still need wording before you can continue.`}
              </p>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={() => setStep(3)} disabled={!templateName.trim() || incompleteTemplateEmails.length > 0}>
                Recipients <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Recipients (shared) */}
        {step === 3 && (
          <div className="space-y-3">
            <CampaignRecipients
              recipients={recipients} setRecipients={setRecipients} tags={tags ?? []}
              suppression={suppression} setSuppression={setSuppression}
              suppressionOverrides={suppressionOverrides} setSuppressionOverrides={setSuppressionOverrides}
              activeEnrollments={activeEnrollments} setActiveEnrollments={setActiveEnrollments}
              enrollmentOverrides={enrollmentOverrides} setEnrollmentOverrides={setEnrollmentOverrides}
            />
            {recipients.length > 0 && sendableRecipients.length === 0 && (
              <p className="text-xs text-amber-600">
                {suppressionPartition.dropped.length > 0 && enrollmentPartition.dropped.length > 0
                  ? "Everyone here is either on the Do-Not-Email list or already enrolled in another campaign. Check \"Include anyway\" / \"Enroll anyway\" above, or add different recipients, to continue."
                  : suppressionPartition.dropped.length > 0
                    ? "Everyone here is on the Do-Not-Email list. Check \"Include anyway\" on at least one person above, or add different recipients, to continue."
                    : "Everyone here is already enrolled in another campaign. Check \"Enroll anyway\" on at least one person above, or add different recipients, to continue."}
              </p>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(4)} disabled={sendableRecipients.length === 0}>Launch step <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 4 — Launch (shared) */}
        {step === 4 && (
          <div className="space-y-3">
            {launchResult ? (
              <div className="rounded-md border p-4 text-center space-y-2">
                {launchResult.failed > 0 ? <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" /> : <CheckCircle2 className="h-8 w-8 mx-auto text-green-600" />}
                <p className="text-sm font-medium">{launchResult.started ? "Campaign launched and started." : "Campaign created as a draft in Smartlead."}</p>
                <p className="text-xs text-muted-foreground">
                  {launchResult.leads} added{launchResult.failed > 0 ? ` · ${launchResult.failed} failed` : ""} · Smartlead #{launchResult.id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {launchResult.enrolled} enrolled{launchResult.started ? ` · ${launchResult.tasksCreated} task${launchResult.tasksCreated === 1 ? "" : "s"} scheduled` : ""}
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
                {!launchResult.started && <p className="text-xs text-muted-foreground">Review and start it in Smartlead when you're ready.</p>}
                <Button size="sm" onClick={() => close(false)}>Done</Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">New leads per day</Label>
                    <Input type="number" min={1} max={500} value={leadsPerDay} onChange={(e) => setLeadsPerDay(Math.max(1, Math.min(500, Number(e.target.value) || 25)))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Minutes between emails</Label>
                    <Input type="number" min={1} max={120} value={minGap} onChange={(e) => setMinGap(Math.max(1, Math.min(120, Number(e.target.value) || 15)))} />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Sends weekdays 9am–5pm Pacific. Lower daily volume + a longer gap protect deliverability.</p>

                <div className="space-y-1">
                  <Label className="text-xs">Sending inbox</Label>
                  <Select value={inboxId} onValueChange={setInboxId}>
                    <SelectTrigger><SelectValue placeholder="Pick an inbox…" /></SelectTrigger>
                    <SelectContent>
                      {(inboxes ?? []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.from_email ?? a.from_name ?? `Inbox ${a.id}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                  {mode === "template" ? "Start sending when I hit Launch" : "Start sending immediately (leave off to review the draft in Smartlead first)"}
                </label>
                {mode === "template" && (
                  <p className="text-[11px] text-muted-foreground -mt-2 ml-6">
                    Off = saved as a draft you review and start in Smartlead later.
                  </p>
                )}
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-not-allowed">
                  <input type="checkbox" checked={adaptive} disabled onChange={(e) => setAdaptive(e.target.checked)} />
                  Adaptive monitoring — AI tweaks unsent emails based on performance <span className="text-[11px] italic">(coming soon)</span>
                </label>
                {rampProjection && (
                  <p className="text-[11px] text-muted-foreground">{rampProjection}</p>
                )}
                <div className={cn("rounded-md p-2 text-xs", autoStart ? "bg-amber-50 text-amber-700" : "bg-muted/40 text-muted-foreground")}>
                  {mode === "ai" ? (campaign?.sequence.length ?? 0) : templateEmailSteps.length} emails
                  {mode === "template" && templateTaskSteps.length > 0 ? ` · ${templateTaskSteps.length} task step${templateTaskSteps.length === 1 ? "" : "s"}` : ""}
                  {" "}· {sendableRecipients.length} recipients
                  {suppressionPartition.dropped.length > 0 ? ` (${suppressionPartition.dropped.length} on the Do-Not-Email list excluded)` : ""}
                  {enrollmentPartition.dropped.length > 0 ? ` (${enrollmentPartition.dropped.length} already enrolled elsewhere excluded)` : ""}
                  {autoStart ? " · will START sending" : " · will be saved as a DRAFT"}
                </div>
                {aiEmailsIncomplete && (
                  <p className="text-xs text-amber-600">One or more emails still need wording — go back to Step 2 to finish them.</p>
                )}
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                  <Button onClick={doLaunch} disabled={launch.isPending || aiEmailsIncomplete}>
                    {launch.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Launching…</> : <><Rocket className="h-4 w-4 mr-1" /> {autoStart ? "Launch & start" : "Create draft"}</>}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
