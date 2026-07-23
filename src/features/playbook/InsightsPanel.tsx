// Insights slide-over (Campaigns overhaul Phase 4 — the AI learning loop).
// Shows AI-proposed template edits (playbook-ai's campaign-insights action,
// queued in campaign_suggestions), grouped by template, with Apply/Dismiss.
// Applying edits the TEMPLATE only — a launched campaign's steps are a
// frozen snapshot, so nothing here ever touches a running campaign. Mirrors
// TrainingPanel.tsx's Sheet structure.

import { useMemo, useState } from "react";
import { Check, X, Lightbulb, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCampaignSuggestions,
  useCampaignTemplates,
  useSaveTemplate,
  useDecideSuggestion,
} from "./api";
import { applySuggestionToTemplate, suggestionApplyDisabledReason } from "./suggestion-apply";
import type { CampaignSuggestion, CampaignTemplate, SuggestionKind } from "./types";

const KIND_LABEL: Record<SuggestionKind, string> = {
  subject: "subject",
  body: "body",
  timing: "timing",
  audience: "audience",
  general: "general",
};

function suggestionLabel(s: CampaignSuggestion): string {
  if (s.step_order == null) {
    return s.kind === "audience" ? "Audience" : "General";
  }
  return `Email ${s.step_order} ${KIND_LABEL[s.kind]}`;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  applied: { label: "Applied", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  dismissed: { label: "Dismissed", className: "bg-muted text-muted-foreground" },
};

function TruncatedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160;
  return (
    <p className="whitespace-pre-wrap break-words">
      {expanded || !long ? text : text.slice(0, 160) + "…"}
      {long && (
        <button
          type="button"
          className="ml-1 text-primary hover:underline text-xs"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </p>
  );
}

function SuggestionCard({
  suggestion,
  template,
  onApply,
  onDismiss,
  applying,
  deciding,
  templateBusy,
}: {
  suggestion: CampaignSuggestion;
  template: CampaignTemplate | undefined;
  onApply: (s: CampaignSuggestion) => void;
  onDismiss: (s: CampaignSuggestion) => void;
  applying: boolean;
  deciding: boolean;
  // True while ANY suggestion for this same template is mid-apply — not just
  // this card's own `applying`. Guards against applying two suggestions on
  // the same template in quick succession: the apply mutation full-
  // overwrites campaign_templates.steps from the React-Query-cached
  // template, so a second apply that starts before the first's refetch
  // resolves reads stale steps and silently reverts the first edit. See
  // InsightsPanel's handleApply/inFlightTemplateId.
  templateBusy: boolean;
}) {
  const disabledReason = suggestionApplyDisabledReason(template, suggestion);

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="text-[10px] font-normal">
          {suggestionLabel(suggestion)}
        </Badge>
      </div>

      {(suggestion.current_value || suggestion.suggested_value) && (
        <div className="space-y-1.5">
          {suggestion.current_value && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</p>
              <TruncatedText text={suggestion.current_value} />
            </div>
          )}
          {suggestion.suggested_value && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggested</p>
              <TruncatedText text={suggestion.suggested_value} />
            </div>
          )}
        </div>
      )}

      <p className="text-muted-foreground text-xs">{suggestion.rationale}</p>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!!disabledReason || applying || deciding || templateBusy}
          title={disabledReason ?? (templateBusy ? "Another suggestion for this template is being applied…" : undefined)}
          onClick={() => onApply(suggestion)}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {applying ? "Applying…" : "Apply"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={applying || deciding || templateBusy}
          onClick={() => onDismiss(suggestion)}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function InsightsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: suggestions, isLoading } = useCampaignSuggestions();
  const { data: templates } = useCampaignTemplates();
  const saveTemplate = useSaveTemplate();
  const decide = useDecideSuggestion();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which template currently has an apply in flight (or null). Distinct from
  // busyId (which suggestion's card shows the spinner) — this drives the
  // shared disable-gate across every OTHER pending suggestion for the same
  // template, so a second Apply can't fire before the first's template
  // refetch has landed. See SuggestionCard's `templateBusy` doc comment.
  const [inFlightTemplateId, setInFlightTemplateId] = useState<string | null>(null);
  const [decidedOpen, setDecidedOpen] = useState(false);

  const templatesById = useMemo(() => {
    const m: Record<string, CampaignTemplate> = {};
    for (const t of templates ?? []) m[t.id] = t;
    return m;
  }, [templates]);

  const pending = useMemo(
    () => (suggestions ?? []).filter((s) => s.status === "pending"),
    [suggestions],
  );
  const decidedList = useMemo(
    () => (suggestions ?? []).filter((s) => s.status !== "pending"),
    [suggestions],
  );

  const pendingByTemplate = useMemo(() => {
    const groups: { templateId: string; templateName: string; items: CampaignSuggestion[] }[] = [];
    const idx: Record<string, number> = {};
    for (const s of pending) {
      const name = templatesById[s.template_id]?.name ?? "Unknown template";
      if (!(s.template_id in idx)) {
        idx[s.template_id] = groups.length;
        groups.push({ templateId: s.template_id, templateName: name, items: [] });
      }
      groups[idx[s.template_id]].items.push(s);
    }
    return groups;
  }, [pending, templatesById]);

  async function handleApply(s: CampaignSuggestion) {
    const template = templatesById[s.template_id];
    if (!template) return;
    const result = applySuggestionToTemplate(template, s);
    if (!result) return; // button is disabled in this state; guard anyway
    setBusyId(s.id);
    // Lock every OTHER pending suggestion on this same template out of
    // Apply/Dismiss for the duration of this call (see SuggestionCard's
    // `templateBusy` prop) — without this, a second apply on the same
    // template started before this one's saveTemplate.mutateAsync resolves
    // would read the same stale `templatesById[s.template_id]` snapshot
    // captured above and full-overwrite `steps` from it, silently reverting
    // whatever this call is about to save.
    setInFlightTemplateId(s.template_id);
    try {
      // mutateAsync only resolves once useSaveTemplate's own onSuccess
      // (qc.invalidateQueries) has run, so templatesById is already fresh
      // by the time we clear the lock below — the next Apply on this
      // template reads the just-applied steps, not a stale snapshot.
      await saveTemplate.mutateAsync({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        steps: result.steps,
        domain_rules: template.domain_rules,
      });
    } catch (e) {
      toast.error("Couldn't update the template: " + (e as Error).message);
      setBusyId(null);
      setInFlightTemplateId(null);
      return;
    }
    try {
      await decide.mutateAsync({ id: s.id, decision: "applied" });
      toast.success(`Applied to ${template.name}.`);
    } finally {
      setBusyId(null);
      setInFlightTemplateId(null);
    }
  }

  function handleDismiss(s: CampaignSuggestion) {
    setBusyId(s.id);
    decide.mutate(
      { id: s.id, decision: "dismissed" },
      { onSettled: () => setBusyId(null) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Insights
          </SheetTitle>
          <SheetDescription>
            What the AI noticed in your campaigns, with suggested changes to
            the templates they came from. Applying a suggestion only edits
            the template — campaigns already running are never touched.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          ) : !pending.length ? (
            <p className="text-sm text-muted-foreground">
              No suggestions right now. These show up automatically once a
              campaign has enough send data to learn from.
            </p>
          ) : (
            pendingByTemplate.map((group) => (
              <div key={group.templateId} className="space-y-2">
                <p className="text-sm font-medium">{group.templateName}</p>
                <div className="space-y-2">
                  {group.items.map((s) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      template={templatesById[s.template_id]}
                      onApply={handleApply}
                      onDismiss={handleDismiss}
                      applying={busyId === s.id && saveTemplate.isPending}
                      deciding={busyId === s.id && decide.isPending}
                      templateBusy={saveTemplate.isPending && inFlightTemplateId === s.template_id}
                    />
                  ))}
                </div>
              </div>
            ))
          )}

          {decidedList.length > 0 && (
            <div className="border-t pt-3">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setDecidedOpen((o) => !o)}
              >
                {decidedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Decided ({decidedList.length})
              </button>
              {decidedOpen && (
                <div className="mt-2 space-y-2">
                  {decidedList.map((s) => {
                    const meta = STATUS_META[s.status] ?? { label: s.status, className: "" };
                    return (
                      <div key={s.id} className="rounded-md border p-2.5 text-xs space-y-1 opacity-80">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {templatesById[s.template_id]?.name ?? "Unknown template"} · {suggestionLabel(s)}
                          </Badge>
                          <Badge variant="secondary" className={meta.className + " text-[10px]"}>
                            {meta.label}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">{s.rationale}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
