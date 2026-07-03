// Nexus — the customizable widget homepage (jordan-v4-spec §2-§4).
// Replaces the old static HomePage at "/". Each rep gets a 2-column grid
// of up to 8 widgets they can add, rename, reorder, and configure.
// First-time visitors are seeded from the system default layout via
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
import { WidgetBuilder } from "./WidgetBuilder";

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
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<NexusWidget | null>(null);

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
    <Button onClick={() => openBuilder(null)} disabled={atCap}>
      <Plus className="h-4 w-4 mr-2" />
      Add a Widget
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {getGreeting()}, {profile?.full_name ?? "there"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Your day at a glance — arrange it however you work.
          </p>
        </div>
        {atCap ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper so the tooltip still fires on the disabled button */}
              <span tabIndex={0}>{addButton}</span>
            </TooltipTrigger>
            <TooltipContent>
              You've hit the {MAX_WIDGETS}-widget limit. Remove one to add
              another.
            </TooltipContent>
          </Tooltip>
        ) : (
          addButton
        )}
      </div>

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
    </div>
  );
}
