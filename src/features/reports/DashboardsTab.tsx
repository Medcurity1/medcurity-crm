import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Lock,
  Globe,
  ArrowLeft,
  LayoutDashboard,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import {
  useDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
} from "./dashboards-api";
import { DashboardView } from "./DashboardView";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDate } from "@/lib/formatters";
import type { Dashboard } from "@/types/crm";

/**
 * Top-level dashboards UI. Default landing shows a grid of every
 * dashboard the user can see (their own + public ones). Clicking one
 * opens the full DashboardView. The picker-dropdown approach was
 * confusing because users didn't realize multiple dashboards existed
 * (Brayden 2026-04-19).
 */
export function DashboardsTab() {
  const { profile } = useAuth();
  const { data: dashboards, isLoading } = useDashboards();
  const deleteDash = useDeleteDashboard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Dashboard | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Dashboard | null>(null);

  // If the active dashboard got deleted out from under us, fall back to landing.
  useEffect(() => {
    if (
      activeId &&
      dashboards &&
      !dashboards.some((d) => d.id === activeId)
    ) {
      setActiveId(null);
    }
  }, [dashboards, activeId]);

  const active = dashboards?.find((d) => d.id === activeId) ?? null;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading dashboards...</p>;
  }

  if (!dashboards || dashboards.length === 0) {
    return (
      <>
        <EmptyState
          icon={LayoutDashboard}
          title="No dashboards yet"
          description="Create your first dashboard to pin the reports and KPIs you watch most."
          action={{ label: "Create Dashboard", onClick: () => setCreating(true) }}
        />
        <CreateDashboardDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(d) => setActiveId(d.id)}
        />
      </>
    );
  }

  // Detail view — clicking into one dashboard.
  if (active) {
    const isOwner = active.owner_user_id === profile?.id;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setActiveId(null)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> All Dashboards
          </Button>
          <h2 className="text-lg font-semibold">{active.name}</h2>
          {active.is_public ? (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 gap-1">
              <Globe className="h-3 w-3" /> Public
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Private
            </Badge>
          )}
          {isOwner && (
            <div className="flex gap-1 ml-auto">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(active)}
              >
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(active)}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
          )}
        </div>

        {active.description && (
          <p className="text-sm text-muted-foreground">{active.description}</p>
        )}

        <DashboardView dashboard={active} />

        {editing && (
          <EditDashboardDialog
            open={!!editing}
            onOpenChange={(o) => !o && setEditing(null)}
            dashboard={editing}
          />
        )}

        {deleting && (
          <ConfirmDialog
            open={!!deleting}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={`Delete dashboard "${deleting.name}"?`}
            description="This can't be undone. The dashboard's widget layout will be lost."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              if (!deleting) return;
              try {
                await deleteDash.mutateAsync(deleting.id);
                toast.success("Dashboard deleted");
                setDeleting(null);
                setActiveId(null);
              } catch (err) {
                toast.error("Failed to delete: " + errorMessage(err));
              }
            }}
          />
        )}
      </div>
    );
  }

  // Landing view — grid of all dashboards.
  const myDashboards = dashboards.filter((d) => d.owner_user_id === profile?.id);
  const publicDashboards = dashboards.filter(
    (d) => d.owner_user_id !== profile?.id && d.is_public
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Dashboard
        </Button>
      </div>

      {myDashboards.length > 0 && (
        <DashboardSection
          title="My Dashboards"
          dashboards={myDashboards}
          onOpen={(d) => setActiveId(d.id)}
        />
      )}

      {publicDashboards.length > 0 && (
        <DashboardSection
          title="Public Dashboards"
          dashboards={publicDashboards}
          onOpen={(d) => setActiveId(d.id)}
        />
      )}

      <CreateDashboardDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(d) => setActiveId(d.id)}
      />
    </div>
  );
}

function DashboardSection({
  title,
  dashboards,
  onOpen,
}: {
  title: string;
  dashboards: Dashboard[];
  onOpen: (d: Dashboard) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </p>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {dashboards.map((d) => (
          <Card
            key={d.id}
            className="cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => onOpen(d)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2 truncate">
                  <LayoutDashboard className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{d.name}</span>
                </CardTitle>
                {d.is_public ? (
                  <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {d.description ? (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {d.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No description</p>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                {(d.layout?.length ?? 0)} widget{(d.layout?.length ?? 0) === 1 ? "" : "s"} ·
                Updated {formatDate(d.updated_at)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateDashboardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (d: Dashboard) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const create = useCreateDashboard();

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setIsPublic(false);
    }
  }, [open]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Dashboard name is required");
      return;
    }
    try {
      const d = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      });
      toast.success(`Dashboard "${d.name}" created`);
      onOpenChange(false);
      onCreated(d);
    } catch (err) {
      toast.error("Failed to create: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Dashboard</DialogTitle>
          <DialogDescription>
            Public dashboards are visible to everyone in the CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="dash-name">Name</Label>
            <Input
              id="dash-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Leadership Weekly"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dash-description">Description (optional)</Label>
            <Textarea
              id="dash-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="dash-public"
              checked={isPublic}
              onCheckedChange={(v) => setIsPublic(!!v)}
            />
            <Label htmlFor="dash-public" className="cursor-pointer">
              Make public (visible to everyone)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={create.isPending}>
            {create.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDashboardDialog({
  open,
  onOpenChange,
  dashboard,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dashboard: Dashboard;
}) {
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? "");
  const [isPublic, setIsPublic] = useState(dashboard.is_public);
  const update = useUpdateDashboard();

  useEffect(() => {
    if (open) {
      setName(dashboard.name);
      setDescription(dashboard.description ?? "");
      setIsPublic(dashboard.is_public);
    }
  }, [open, dashboard]);

  async function handleSave() {
    try {
      await update.mutateAsync({
        id: dashboard.id,
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      });
      toast.success("Dashboard updated");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to update: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="dash-edit-name">Name</Label>
            <Input
              id="dash-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dash-edit-description">Description</Label>
            <Textarea
              id="dash-edit-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="dash-edit-public"
              checked={isPublic}
              onCheckedChange={(v) => setIsPublic(!!v)}
            />
            <Label htmlFor="dash-edit-public" className="cursor-pointer">
              Public (visible to everyone)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
