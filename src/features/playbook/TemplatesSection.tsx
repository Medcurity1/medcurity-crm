// Sequence template gallery — the entry point into the one builder. Each preset
// (8-Touch, Warming, …) is a starting point you open, view, and launch on a
// list/contact. A "Custom" card starts an empty builder.
//
// "Use this template" (preview dialog) and SequenceEditor's "Use this
// sequence" (Campaigns overhaul S3) both open the SAME CampaignWizard
// instance in `mode="template"` — this component owns that instance since
// it's the one place both launch triggers converge.

import { useState } from "react";
import { Rocket, Flame, Wand2, Sparkles, Clock, Layers, ArrowRight, Pencil, Copy, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCampaignTemplates, useDeleteTemplate } from "./api";
import { SequenceTimeline, SequenceMiniPreview } from "./SequenceTimeline";
import { SequenceEditor } from "./SequenceEditor";
import { CampaignWizard } from "./CampaignWizard";
import type { CampaignTemplate, SequenceStep } from "./types";

type EditorSeed = (Partial<CampaignTemplate> & { steps: SequenceStep[] }) | null;
type LaunchSeed = { template_id: string | null; name: string; steps: SequenceStep[] };

const CATEGORY: Record<string, { icon: typeof Rocket; accent: string; chip: string; label: string }> = {
  flagship:      { icon: Rocket,   accent: "from-amber-500/20 to-orange-500/10", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "Flagship" },
  warming:       { icon: Flame,    accent: "from-orange-500/20 to-rose-500/10",  chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400", label: "Warming" },
  post_demo:     { icon: Sparkles, accent: "from-violet-500/20 to-fuchsia-500/10", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", label: "Post-demo" },
  re_engagement: { icon: Sparkles, accent: "from-sky-500/20 to-cyan-500/10",     chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", label: "Re-engage" },
  event:         { icon: Sparkles, accent: "from-emerald-500/20 to-teal-500/10", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", label: "Event" },
  custom:        { icon: Wand2,    accent: "from-slate-500/20 to-slate-400/10",  chip: "bg-slate-500/15 text-slate-600 dark:text-slate-300", label: "Custom" },
};

export function TemplatesSection() {
  const { data: templates, isLoading } = useCampaignTemplates();
  const del = useDeleteTemplate();
  const [preview, setPreview] = useState<CampaignTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeed, setEditorSeed] = useState<EditorSeed>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignTemplate | null>(null);
  // Bumped on every open so the editor REMOUNTS fresh — the dialog stays
  // mounted between uses, so without a changing key its internal step state
  // would carry over (e.g. "Customize a copy" showed the last sequence built).
  const [editorNonce, setEditorNonce] = useState(0);

  // Same remount-fresh pattern for the launch wizard (Campaigns overhaul S3):
  // both "Use this template" (below) and SequenceEditor's "Use this
  // sequence" (via onLaunch) open this same instance.
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchSeed, setLaunchSeed] = useState<LaunchSeed | null>(null);
  const [launchNonce, setLaunchNonce] = useState(0);

  const openLaunch = (seed: LaunchSeed) => {
    setLaunchSeed(seed);
    setLaunchNonce((n) => n + 1);
    setLaunchOpen(true);
  };

  const openBlank = () => {
    setEditorSeed(null);
    setEditorNonce((n) => n + 1);
    setEditorOpen(true);
  };
  const openCustomize = (t: CampaignTemplate) => {
    // Customizing a preset creates a NEW custom copy (no id) — never mutates
    // the shared preset everyone starts from.
    setEditorSeed({
      name: `${t.name} (copy)`,
      description: t.description,
      category: "custom",
      steps: t.steps,
    });
    setPreview(null);
    setEditorNonce((n) => n + 1);
    setEditorOpen(true);
  };
  const openEdit = (t: CampaignTemplate) => {
    setEditorSeed({ ...t });
    setPreview(null);
    setEditorNonce((n) => n + 1);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Start a campaign from a template</h3>
        <p className="text-xs text-muted-foreground">
          Pick a proven sequence, edit any step, then launch it on a list or contact. Email steps send automatically; calls and LinkedIn become your tasks in Up Next.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(templates ?? []).map((t) => {
            const cat = CATEGORY[t.category] ?? CATEGORY.custom;
            const Icon = cat.icon;
            return (
              <Card
                key={t.id}
                className="py-0 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all overflow-hidden"
                onClick={() => setPreview(t)}
              >
                <div className={cn("h-1.5 w-full bg-gradient-to-r", cat.accent)} />
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("h-8 w-8 rounded-md flex items-center justify-center", cat.chip)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <Badge variant="outline" className={cn("text-[10px]", cat.chip, "border-transparent")}>{cat.label}</Badge>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">{t.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <SequenceMiniPreview steps={t.steps} />
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{t.step_count ?? t.steps.length}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.duration_days ?? "—"}d</span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Start from scratch */}
          <Card
            className="py-0 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all border-dashed overflow-hidden"
            onClick={openBlank}
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-slate-500/20 to-slate-400/10" />
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="h-8 w-8 rounded-md flex items-center justify-center bg-slate-500/15 text-slate-600 dark:text-slate-300">
                  <Wand2 className="h-4 w-4" />
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-sm">Custom sequence</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Build your own from scratch — same builder, empty canvas.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Template preview dialog — the visual timeline */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>{preview.name}</DialogTitle>
                <DialogDescription>{preview.description}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3 text-xs text-muted-foreground -mt-1 mb-1">
                <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{preview.step_count ?? preview.steps.length} touches</span>
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{preview.duration_days ?? "—"} days</span>
              </div>
              {preview.domain_rules?.start_anchor === "nearest_monday" && (
                <p className="text-[11px] text-muted-foreground -mt-0.5 mb-1">
                  Weekdays shown assume a Monday start (the actual dates are set when you launch).
                </p>
              )}
              <SequenceTimeline steps={preview.steps} />
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex items-center gap-1 order-2 sm:order-1">
                  {!preview.is_preset && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(preview)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 order-1 sm:order-2">
                  {preview.is_preset ? (
                    <Button variant="outline" size="sm" onClick={() => openCustomize(preview)}>
                      <Copy className="h-4 w-4 mr-1" /> Customize a copy
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => openEdit(preview)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                  )}
                  <Button
                    variant="ai"
                    onClick={() => {
                      openLaunch({ template_id: preview.id, name: preview.name, steps: preview.steps });
                      setPreview(null);
                    }}
                  >
                    <span className="ai-icon mr-1"><ArrowRight className="h-4 w-4" /></span>
                    Use this template
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* The one builder — edit/create a sequence. key remounts it fresh
          per open so a reopen never shows the previously-built sequence. */}
      <SequenceEditor
        key={editorNonce}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editorSeed}
        onLaunch={(t) => openLaunch({ template_id: t.id, name: t.name, steps: t.steps })}
      />

      {/* Launch wizard, template mode (Campaigns overhaul S3) — opened from
          "Use this template" above or SequenceEditor's "Use this sequence"
          via onLaunch. key remounts it fresh per open, same reason as the
          editor above. */}
      <CampaignWizard
        key={launchNonce}
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        mode="template"
        templateSeed={launchSeed ?? { template_id: null, name: "", steps: [] }}
      />

      {/* Delete a custom template */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sequence?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will be removed. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  del.mutate(deleteTarget.id, {
                    onSuccess: () => toast.success("Sequence deleted"),
                    onError: (e) => toast.error("Delete failed: " + (e as Error).message),
                  });
                }
                // Close the preview too — otherwise the just-deleted template
                // stays on screen with live Edit/Delete/Use buttons.
                setPreview(null);
                setDeleteTarget(null);
              }}
            >
              Delete sequence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
