// Nexus — the customizable widget dashboard (jordan-v4-spec §2-§4).
// Lives at /nexus while it's being tested (the classic dashboard stays
// at "/" — Nathan, 2026-07-03). Each rep gets a 2-column grid of up to
// 8 widgets they can add, rename, reorder, and configure. First-time
// visitors are seeded from the system default layout via
// nexus_initialize (idempotent, once per session).

import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNexusInitialize, useNexusWidgets } from "./api";
import { MAX_WIDGETS, type NexusWidget } from "./types";
import { NexusGrid } from "./NexusGrid";
import { useHomeLayoutImport } from "./home-import";
import { WidgetBuilder } from "./WidgetBuilder";
import { Briefing } from "./Briefing";
import { NexusTour } from "./NexusTour";
import { useDayQueue } from "./day-queue-api";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function NexusPage() {
  const { profile } = useAuth();

  // Seed first-time users from the system default layout (server-side
  // idempotent; cached for the session so it effectively runs once).
  useNexusInitialize();

  const { data: widgets } = useNexusWidgets();
  // Home layout carry-over (dormant until the landing flip; see home-import.ts).
  useHomeLayoutImport(widgets);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<NexusWidget | null>(null);

  // The briefing owns the greeting when it can load (same react-query
  // cache, so this costs no extra round trip). If the queue read fails
  // the briefing renders nothing and this page falls back to the header
  // it has always had.
  const { isError: briefingFailed } = useDayQueue();

  const count = widgets?.length ?? 0;
  const atCap = count >= MAX_WIDGETS;
  const nextPosition = widgets?.length
    ? Math.max(...widgets.map((w) => w.position)) + 1
    : 0;

  function openBuilder(widget: NexusWidget | null) {
    setEditing(widget);
    setBuilderOpen(true);
  }

  const addButton = (
    // data-tour anchors the third tour step (NexusTour.tsx). Inert until
    // swap day.
    <Button data-tour="add-widget" onClick={() => openBuilder(null)} disabled={atCap}>
      <Plus className="h-4 w-4 mr-2" />
      Add a Widget
    </Button>
  );

  const addControl = atCap ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span wrapper so the tooltip still fires on the disabled button */}
        <span tabIndex={0}>{addButton}</span>
      </TooltipTrigger>
      <TooltipContent>
        You've hit the {MAX_WIDGETS}-widget limit. Remove one to add another.
      </TooltipContent>
    </Tooltip>
  ) : (
    addButton
  );

  return (
    <div className="space-y-6">
      {briefingFailed && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {getGreeting()}, {profile?.full_name ?? "there"}
            </h1>
            <p className="text-muted-foreground mt-1">
              Your day at a glance. Arrange it however you work.
            </p>
          </div>
          {addControl}
        </div>
      )}

      {/* The anchor above the grid. Renders nothing if the queue read
          fails, in which case the header above takes over. */}
      <Briefing dividerActions={briefingFailed ? undefined : addControl} />

      <NexusGrid onEditWidget={(w) => openBuilder(w)} />

      <WidgetBuilder
        open={builderOpen}
        onOpenChange={(o) => {
          setBuilderOpen(o);
          if (!o) setEditing(null);
        }}
        widget={editing}
        nextPosition={nextPosition}
      />

      {/* First-visit tour. Renders null (before any hook runs) until
          NEXUS_IS_LANDING flips on swap day. See landing-flip.ts. */}
      <NexusTour />
    </div>
  );
}
