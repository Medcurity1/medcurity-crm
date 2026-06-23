// Training notes slide-over: the team's persistent guidance that steers
// every Playbook AI generation. Add notes, see where each came from
// (manual / system / thumbs_down / campaign_result / adaptation), delete.

import { useState } from "react";
import { Trash2, Plus, Brain } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrainingNotes, useAddTrainingNote, useDeleteTrainingNote } from "./api";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by team",
  system: "System",
  thumbs_down: "From 👎 feedback",
  campaign_result: "From a campaign result",
  adaptation_feedback: "From an adaptation",
};

function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source.startsWith("newsletter:")) return "Newsletter";
  return source;
}

export function TrainingPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: notes, isLoading } = useTrainingNotes();
  const addNote = useAddTrainingNote();
  const deleteNote = useDeleteTrainingNote();
  const [draft, setDraft] = useState("");

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    addNote.mutate(
      { note: text },
      { onSuccess: () => setDraft("") },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Training
          </SheetTitle>
          <SheetDescription>
            Notes here become hard rules the AI follows when writing ideas,
            campaigns, and adaptations. The more you teach it, the better it gets.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 py-4">
          <div className="space-y-2">
            <Textarea
              placeholder="e.g. Always lead with the SRA. Never use fear tactics."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!draft.trim() || addNote.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add note
            </Button>
          </div>

          <div className="border-t pt-3 space-y-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))
            ) : !notes?.length ? (
              <p className="text-sm text-muted-foreground">No training notes yet.</p>
            ) : (
              notes.map((n) => (
                <div
                  key={n.id}
                  className="group flex items-start gap-2 rounded-md border p-2.5 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <p className="whitespace-pre-wrap">{n.note}</p>
                    <Badge variant="secondary" className="mt-1.5 text-[10px] font-normal">
                      {sourceLabel(n.source)}
                    </Badge>
                  </div>
                  <button
                    type="button"
                    title="Delete note"
                    onClick={() => deleteNote.mutate(n.id)}
                    className="shrink-0 p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
