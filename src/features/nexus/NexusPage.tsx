// Nexus — the customizable widget dashboard (jordan-v4-spec §2-§4).
// Lives at /nexus while it's being tested (the classic dashboard stays
// at "/" — Nathan, 2026-07-03). Each rep gets a 2-column grid of up to
// 8 widgets they can add, rename, reorder, and configure. First-time
// visitors are seeded from the system default layout via
// nexus_initialize (idempotent, once per session).

import { useState } from "react";
import { Plus, Inbox } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNexusInitialize, useNexusWidgets } from "./api";
import { MAX_WIDGETS, type NexusWidget } from "./types";
import { NexusGrid } from "./NexusGrid";
import { WidgetBuilder } from "./WidgetBuilder";
import { useMyRequestTypes } from "@/features/requests/api";
import { NexusRequestWidgets } from "@/features/requests/RequestWidgets";

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
  const [tab, setTab] = useState("dashboard");

  // Routed reviewers (product → Rachel, collateral/CRM → Jordan, all → Nathan)
  // get a "Requests" tab with their incoming requests + approve/deny. Reps
  // with no routed types just see their dashboard, no tab bar.
  const { data: myRequestTypes } = useMyRequestTypes();
  const hasRequests = (myRequestTypes?.length ?? 0) > 0;
  const onDashboard = !hasRequests || tab === "dashboard";

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
        {/* "Add a Widget" only makes sense on the dashboard tab. */}
        {onDashboard &&
          (atCap ? (
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
          ))}
      </div>

      {hasRequests ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="requests" className="gap-2">
              <Inbox className="h-4 w-4" /> Requests
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-6">
            <NexusGrid onEditWidget={(w) => openBuilder(w)} />
          </TabsContent>
          <TabsContent value="requests" className="mt-6">
            <NexusRequestWidgets />
          </TabsContent>
        </Tabs>
      ) : (
        <NexusGrid onEditWidget={(w) => openBuilder(w)} />
      )}

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
