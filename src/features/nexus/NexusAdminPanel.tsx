// Nexus admin controls (jordan-v4-spec §11) — the "Nexus" tab in Admin
// Settings. Two sections:
//
//   1. System default layout — edits nexus_default_widgets with the SAME
//      grid + builder the homepage uses (NexusGrid/WidgetBuilder in
//      mode="default"). Changes apply to NEW users only.
//   2. Per-user editor — pick any active user and edit their live page
//      (NexusGrid userId / WidgetBuilder targetUserId), plus Reset to
//      default and, for never-initialized users, Initialize now.
//
// The outer AdminSettings already gates this to admin/super_admin; RLS
// (is_admin policies + the RPCs' own checks) is the real enforcement.

import { useMemo, useState } from "react";
import { Info, Plus, RotateCcw, Sparkles, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAllUsers } from "@/features/admin/admin-api";
import {
  useDefaultWidgets,
  useInitializeUserNexus,
  useNexusUserState,
  useNexusWidgets,
  useResetUserNexus,
} from "./api";
import { MAX_WIDGETS, type NexusWidget } from "./types";
import { NexusGrid } from "./NexusGrid";
import { WidgetBuilder } from "./WidgetBuilder";

export function NexusAdminPanel() {
  return (
    <div className="space-y-6">
      <DefaultLayoutSection />
      <PerUserSection />
    </div>
  );
}

/** Shared "Add a Widget" button with the 8-cap tooltip treatment. */
function AddWidgetButton({
  atCap,
  onClick,
}: {
  atCap: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button size="sm" onClick={onClick} disabled={atCap}>
      <Plus className="h-4 w-4 mr-2" />
      Add a Widget
    </Button>
  );
  if (!atCap) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span wrapper so the tooltip still fires on the disabled button */}
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        Pages hold at most {MAX_WIDGETS} widgets. Remove one to add another.
      </TooltipContent>
    </Tooltip>
  );
}

// ── Section 1: system default layout ─────────────────────────────────

function DefaultLayoutSection() {
  const { data: defaults } = useDefaultWidgets();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<NexusWidget | null>(null);

  const count = defaults?.length ?? 0;
  const atCap = count >= MAX_WIDGETS;
  const nextPosition = defaults?.length
    ? Math.max(...defaults.map((w) => w.position)) + 1
    : 0;

  function openBuilder(widget: NexusWidget | null) {
    setEditing(widget);
    setBuilderOpen(true);
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            System default layout
          </h2>
          <p className="text-sm text-muted-foreground">
            The starting Nexus page every new user is seeded from. Add, edit,
            remove, and drag to reorder — exactly like the homepage.
          </p>
        </div>
        <AddWidgetButton atCap={atCap} onClick={() => openBuilder(null)} />
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <p>
          <span className="font-medium">Changes apply to new users only.</span>{" "}
          Anyone who already has a Nexus page keeps their current layout — use
          the per-user editor below (or Reset to default) to change an
          existing page. Widget previews here show <em>your</em> data, since
          the default layout has no owner.
        </p>
      </div>

      <NexusGrid mode="default" onEditWidget={(w) => openBuilder(w)} />

      <WidgetBuilder
        mode="default"
        open={builderOpen}
        onOpenChange={(o) => {
          setBuilderOpen(o);
          if (!o) setEditing(null);
        }}
        widget={editing}
        nextPosition={nextPosition}
      />
    </Card>
  );
}

// ── Section 2: per-user editor ───────────────────────────────────────

function PerUserSection() {
  const { data: users } = useAllUsers();
  const [selectedId, setSelectedId] = useState<string>("");

  const activeUsers = useMemo(
    () => (users ?? []).filter((u) => u.is_active),
    [users],
  );
  const selectedUser = activeUsers.find((u) => u.id === selectedId);

  return (
    <Card className="p-6">
      <div className="space-y-1 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <UserCog className="h-4 w-4 text-muted-foreground" />
          Configure a user's page
        </h2>
        <p className="text-sm text-muted-foreground">
          Open any rep's live Nexus page in edit mode — add, remove, and set
          up widgets on their behalf. Changes show up for them immediately.
        </p>
      </div>

      <div className="max-w-sm space-y-2 mb-6">
        <Label htmlFor="nexus-user-picker">User</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger id="nexus-user-picker">
            <SelectValue placeholder="Pick a user…" />
          </SelectTrigger>
          <SelectContent>
            {activeUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? "Unnamed User"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedUser ? (
        <UserNexusEditor
          key={selectedUser.id}
          userId={selectedUser.id}
          userName={selectedUser.full_name ?? "this user"}
        />
      ) : (
        <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-6 text-center">
          Pick a user above to view and edit their Nexus page.
        </p>
      )}
    </Card>
  );
}

function UserNexusEditor({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const { data: state, isLoading: stateLoading } = useNexusUserState(userId);
  const { data: widgets } = useNexusWidgets(userId);
  const initialize = useInitializeUserNexus();
  const reset = useResetUserNexus();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<NexusWidget | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const count = widgets?.length ?? 0;
  const atCap = count >= MAX_WIDGETS;
  const nextPosition = widgets?.length
    ? Math.max(...widgets.map((w) => w.position)) + 1
    : 0;

  function openBuilder(widget: NexusWidget | null) {
    setEditing(widget);
    setBuilderOpen(true);
  }

  if (stateLoading) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        Checking {userName}'s Nexus page…
      </p>
    );
  }

  // Never initialized: seed first. Editing an unseeded page would get
  // double-seeded on the user's own first visit (nexus_initialize only
  // no-ops once the state marker exists), so the grid stays read-only
  // until the admin initializes.
  if (!state?.initialized) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
        <p className="text-sm">
          <span className="font-medium">{userName} hasn't opened Nexus yet.</span>{" "}
          Their page will seed itself from the system default on first visit —
          or initialize it now to start configuring it for them.
        </p>
        <Button
          size="sm"
          onClick={() => initialize.mutate(userId)}
          disabled={initialize.isPending}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {initialize.isPending ? "Initializing…" : "Initialize now"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Editing <span className="font-medium text-foreground">{userName}</span>
          's live page · {count} of {MAX_WIDGETS} widgets
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to default
          </Button>
          <AddWidgetButton atCap={atCap} onClick={() => openBuilder(null)} />
        </div>
      </div>

      <NexusGrid userId={userId} onEditWidget={(w) => openBuilder(w)} />

      <WidgetBuilder
        open={builderOpen}
        onOpenChange={(o) => {
          setBuilderOpen(o);
          if (!o) setEditing(null);
        }}
        widget={editing}
        nextPosition={nextPosition}
        targetUserId={userId}
      />

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Reset ${userName}'s Nexus page?`}
        description={`This wipes ${userName}'s current layout — every widget and its configuration — and replaces it with the system default. This can't be undone.`}
        confirmLabel="Reset to default"
        destructive
        onConfirm={() => reset.mutate(userId)}
      />
    </div>
  );
}
