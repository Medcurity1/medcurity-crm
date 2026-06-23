// Ideas tab — weekly AI-generated marketing ideas. Phase A renders the
// data + empty state; the "Generate" action + thumbs feedback land in
// Phase B (the AI brain).

import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdeas } from "./api";

export function IdeasTab() {
  // Latest week (no arg = all, ordered; we show the most recent week's set).
  const { data: ideas, isLoading } = useIdeas();

  if (isLoading) {
    return (
      <div className="space-y-2 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!ideas?.length) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={Lightbulb}
          title="No ideas yet"
          description="Each week Playbook will write you a ranked set of marketing ideas from real performance, upcoming events, and your training notes. Generation arrives in the next update."
        />
      </div>
    );
  }

  // Show the most recent week's ideas.
  const latestWeek = ideas.reduce((w, i) => (i.week_date > w ? i.week_date : w), ideas[0].week_date);
  const current = ideas.filter((i) => i.week_date === latestWeek);

  return (
    <div className="space-y-3 pt-4">
      <p className="text-sm text-muted-foreground">Week of {latestWeek}</p>
      {current.map((idea) => (
        <Card key={idea.id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-sm">{idea.title}</h3>
              <div className="flex gap-1 shrink-0">
                <Badge variant="secondary" className="text-[10px] capitalize">{idea.action_type}</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{idea.effort}</Badge>
              </div>
            </div>
            {idea.description && (
              <p className="text-sm text-muted-foreground">{idea.description}</p>
            )}
            {idea.reasoning && (
              <p className="text-xs text-muted-foreground/80">📊 {idea.reasoning}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
