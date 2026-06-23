// Ideas tab — weekly AI-generated marketing ideas with the team feedback
// loop (thumbs up/down → training notes), a week navigator, and on-demand
// generation. Ported from the Nexus Playbook ideas view.

import { useState } from "react";
import { Lightbulb, Sparkles, ThumbsUp, ThumbsDown, Loader2, CalendarCheck } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIdeas, useIdeaWeeks, useGenerateIdeas, useIdeaFeedback } from "./api";
import type { PlaybookIdea } from "./types";

function IdeaCard({ idea }: { idea: PlaybookIdea }) {
  const feedback = useIdeaFeedback();
  const [showBad, setShowBad] = useState(false);
  const [badNote, setBadNote] = useState("");

  const isGood = idea.status === "good" || idea.status === "booked";
  const isBad = idea.status === "bad";

  return (
    <Card className={cn("py-0", isBad && "opacity-60")}>
      <CardContent className="px-4 py-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm">{idea.title}</h3>
          <div className="flex gap-1 shrink-0">
            <Badge variant="secondary" className="text-[10px] capitalize">{idea.action_type}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">{idea.effort}</Badge>
          </div>
        </div>
        {idea.description && <p className="text-sm text-muted-foreground">{idea.description}</p>}
        {idea.reasoning && <p className="text-xs text-muted-foreground/80">📊 {idea.reasoning}</p>}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant={isGood ? "default" : "outline"}
            size="sm"
            className="h-7 px-2"
            disabled={feedback.isPending}
            onClick={() => feedback.mutate({ id: idea.id, status: "good" })}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={isBad ? "destructive" : "outline"}
            size="sm"
            className="h-7 px-2"
            disabled={feedback.isPending}
            onClick={() => setShowBad((v) => !v)}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={idea.status === "booked" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={feedback.isPending}
            onClick={() => feedback.mutate({ id: idea.id, status: "booked" })}
          >
            <CalendarCheck className="h-3.5 w-3.5 mr-1" />
            Booked
          </Button>
          {idea.status !== "new" && (
            <span className="text-[10px] text-muted-foreground capitalize ml-auto">{idea.status}</span>
          )}
        </div>

        {showBad && (
          <div className="space-y-2 pt-1">
            <Textarea
              placeholder="What was wrong with this idea? (becomes a training note so the AI learns)"
              value={badNote}
              onChange={(e) => setBadNote(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={feedback.isPending}
                onClick={() =>
                  feedback.mutate(
                    { id: idea.id, status: "bad", feedbackNote: badNote.trim() || undefined },
                    { onSuccess: () => { setShowBad(false); setBadNote(""); } },
                  )
                }
              >
                Save feedback
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowBad(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IdeasTab() {
  const { data: weeks } = useIdeaWeeks();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const selectedWeek = week ?? weeks?.[0];
  const { data: ideas, isLoading } = useIdeas(selectedWeek);
  const generate = useGenerateIdeas();

  function handleGenerate(force: boolean) {
    generate.mutate(
      { force },
      {
        onSuccess: (res) => {
          if (res.cached) toast.info("Showing this week's existing ideas.");
          else toast.success(`Generated ${res.ideas?.length ?? 0} ideas.`);
          if (res.week_date) setWeek(res.week_date);
        },
      },
    );
  }

  const hasAny = (weeks?.length ?? 0) > 0;

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-3 flex-wrap">
        {hasAny && weeks && (
          <Select value={selectedWeek} onValueChange={setWeek}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Week" />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w} value={w}>Week of {w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          onClick={() => handleGenerate(hasAny)}
          disabled={generate.isPending}
        >
          {generate.isPending ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-1" /> {hasAny ? "Regenerate this week" : "Generate ideas"}</>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !ideas?.length ? (
        <EmptyState
          icon={Lightbulb}
          title="No ideas yet"
          description="Generate a ranked set of marketing ideas built from real campaign performance, planned campaigns, and your training notes."
        />
      ) : (
        ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} />)
      )}
    </div>
  );
}
