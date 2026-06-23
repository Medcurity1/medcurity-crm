// Campaign wizard — Describe -> Preview/Edit -> Recipients -> Launch.
// AI writes the sequence (Claude), recipients come from a contact tag
// (the custom lists) or pasted emails, and Launch creates the campaign in
// Smartlead. autoStart defaults OFF so it lands as a DRAFT for review.

import { useState } from "react";
import { Loader2, Sparkles, Wand2, ArrowLeft, ArrowRight, Rocket, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTags } from "@/features/tags/api";
import {
  useGenerateCampaign,
  useSuggestCampaign,
  useRegenerateEmail,
  useEmailAccounts,
  useLaunchCampaign,
  fetchRecipientsByTag,
  type GeneratedCampaign,
  type Recipient,
} from "./api";

type Step = 1 | 2 | 3 | 4;

export function CampaignWizard({
  open,
  onOpenChange,
  initialDescription = "",
  sourceIdeaId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDescription?: string;
  sourceIdeaId?: string;
}) {
  const { profile } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [description, setDescription] = useState(initialDescription);
  const [campaign, setCampaign] = useState<GeneratedCampaign | null>(null);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientTag, setRecipientTag] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [inboxId, setInboxId] = useState<string>("");
  const [autoStart, setAutoStart] = useState(false);
  const [adaptive, setAdaptive] = useState(false);
  const [launchResult, setLaunchResult] = useState<{ id: number; started: boolean; leads: number } | null>(null);

  const gen = useGenerateCampaign();
  const suggest = useSuggestCampaign();
  const regen = useRegenerateEmail();
  const { data: tags } = useTags();
  const { data: inboxes } = useEmailAccounts();
  const launch = useLaunchCampaign();

  function reset() {
    setStep(1); setDescription(initialDescription); setCampaign(null); setSuggestions(null);
    setRecipients([]); setRecipientTag(""); setPasted(""); setInboxId(""); setAutoStart(false);
    setAdaptive(false); setLaunchResult(null);
  }
  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function handleGenerate() {
    gen.mutate(description, {
      onSuccess: (r) => { setCampaign(r.campaign); setStep(2); },
    });
  }

  function editEmail(seq: number, patch: Partial<GeneratedCampaign["sequence"][number]>) {
    setCampaign((c) =>
      c ? { ...c, sequence: c.sequence.map((e) => (e.seq_number === seq ? { ...e, ...patch } : e)) } : c,
    );
  }

  async function loadTagRecipients(tagId: string) {
    setRecipientTag(tagId);
    if (!tagId) { setRecipients([]); return; }
    try {
      const recs = await fetchRecipientsByTag(tagId);
      setRecipients(recs);
      toast.success(`${recs.length} contacts loaded from tag.`);
    } catch (e) {
      toast.error("Couldn't load contacts: " + (e as Error).message);
    }
  }

  function applyPasted() {
    const recs: Recipient[] = pasted
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => /.+@.+\..+/.test(s))
      .map((email) => ({ email }));
    setRecipients(recs);
    toast.success(`${recs.length} emails parsed.`);
  }

  function doLaunch() {
    if (!campaign) return;
    launch.mutate(
      {
        campaign_name: campaign.campaign_name,
        target_audience: campaign.target_audience,
        sequence: campaign.sequence,
        recipients,
        email_account_id: inboxId ? Number(inboxId) : undefined,
        source_idea_id: sourceIdeaId,
        autoStart,
        adaptiveEnabled: adaptive,
        owner_id: profile?.id,
      },
      {
        onSuccess: (r) => {
          setLaunchResult({ id: r.smartlead_campaign_id, started: r.auto_started, leads: r.leads_added });
          toast.success(r.auto_started ? "Campaign launched and started." : "Campaign created as a draft in Smartlead.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Campaign — Step {step} of 4</DialogTitle>
          <DialogDescription>
            {step === 1 && "Describe the campaign you want. The AI writes the email sequence."}
            {step === 2 && "Review and edit the sequence. Rewrite any email or ask for suggestions."}
            {step === 3 && "Choose who gets it — a contact tag (custom list) or pasted emails."}
            {step === 4 && "Pick the sending inbox and launch. Leave 'start now' off to review the draft in Smartlead first."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — Describe */}
        {step === 1 && (
          <div className="space-y-3">
            <Label>What's the campaign?</Label>
            <Textarea
              rows={5}
              placeholder="e.g. A 3-email cold sequence to small dental practices (1-20 staff) introducing the SRA and offering a quick demo."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button onClick={handleGenerate} disabled={description.trim().length < 20 || gen.isPending}>
              {gen.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Writing…</> : <><Sparkles className="h-4 w-4 mr-1" /> Generate sequence</>}
            </Button>
          </div>
        )}

        {/* Step 2 — Preview / Edit */}
        {step === 2 && campaign && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Campaign name</Label>
              <Input value={campaign.campaign_name} onChange={(e) => setCampaign({ ...campaign, campaign_name: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">Target: {campaign.target_audience}</p>
            {campaign.sequence.map((email) => (
              <div key={email.seq_number} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Email {email.seq_number} · day {email.delay_days}</span>
                  <Button
                    variant="ghost" size="sm" className="h-7 text-xs"
                    disabled={regen.isPending}
                    onClick={() =>
                      regen.mutate(
                        { description, campaign, seq_number: email.seq_number },
                        { onSuccess: (r) => editEmail(email.seq_number, r.email) },
                      )
                    }
                  >
                    <Wand2 className="h-3.5 w-3.5 mr-1" /> Rewrite
                  </Button>
                </div>
                <Input value={email.subject} onChange={(e) => editEmail(email.seq_number, { subject: e.target.value })} placeholder="Subject" />
                <Textarea rows={5} value={email.body_html} onChange={(e) => editEmail(email.seq_number, { body_html: e.target.value })} />
              </div>
            ))}
            <Button variant="outline" size="sm" disabled={suggest.isPending} onClick={() => suggest.mutate(campaign, { onSuccess: (r) => setSuggestions(r.suggestions) })}>
              {suggest.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Thinking…</> : "Suggest improvements"}
            </Button>
            {suggestions && <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{suggestions}</pre>}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(3)}>Recipients <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 3 — Recipients */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>From a contact tag (custom list)</Label>
              <Select value={recipientTag} onValueChange={loadTagRecipients}>
                <SelectTrigger><SelectValue placeholder="Pick a tag…" /></SelectTrigger>
                <SelectContent>
                  {(tags ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Excludes Do-Not-Contact and No-Longer-Employed automatically.</p>
            </div>
            <div className="space-y-1">
              <Label>Or paste emails</Label>
              <Textarea rows={3} placeholder="one@x.com, two@y.com…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <Button size="sm" variant="outline" onClick={applyPasted} disabled={!pasted.trim()}>Use pasted emails</Button>
            </div>
            <p className="text-sm font-medium">{recipients.length} recipients selected</p>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(4)} disabled={recipients.length === 0}>Launch step <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 4 — Launch */}
        {step === 4 && campaign && (
          <div className="space-y-3">
            {launchResult ? (
              <div className="rounded-md border p-4 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 mx-auto text-green-600" />
                <p className="text-sm font-medium">
                  {launchResult.started ? "Campaign launched and started." : "Campaign created as a draft in Smartlead."}
                </p>
                <p className="text-xs text-muted-foreground">{launchResult.leads} leads added · Smartlead #{launchResult.id}</p>
                {!launchResult.started && (
                  <p className="text-xs text-muted-foreground">Review and start it in Smartlead when you're ready.</p>
                )}
                <Button size="sm" onClick={() => close(false)}>Done</Button>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>Sending inbox</Label>
                  <Select value={inboxId} onValueChange={setInboxId}>
                    <SelectTrigger><SelectValue placeholder="Pick an inbox…" /></SelectTrigger>
                    <SelectContent>
                      {(inboxes ?? []).map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.from_email ?? a.from_name ?? `Inbox ${a.id}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                  Start sending immediately (leave off to review the draft in Smartlead first)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={adaptive} onChange={(e) => setAdaptive(e.target.checked)} />
                  Enable adaptive monitoring (AI proposes tweaks to unsent emails based on performance)
                </label>
                <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  {campaign.sequence.length} emails · {recipients.length} recipients
                  {autoStart ? " · will START sending" : " · will be saved as a DRAFT"}
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                  <Button onClick={doLaunch} disabled={launch.isPending}>
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
