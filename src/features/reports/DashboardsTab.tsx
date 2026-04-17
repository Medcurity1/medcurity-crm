import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Lock, Globe } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { LayoutDashboard } from "lucide-react";
import {
  useDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
} from "./dashboards-api";
import { DashboardView } from "./DashboardView";
import { errorMessage } from "@/lib/errors";
import type { Dashboard } from "@/types/crm";

/**
 * Top-level dashboards UI. Renders a dashboard picker + view/edit
 * controls. Users can create multiple named dashboards (personal or
 * public). The actual widget grid is rendered by DashboardView.
 */
export function DashboardsTab() {
  const { data: dashboards, isLoading } = useDashboards();
  const deleteDash = useDeleteDashboard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Dashboard | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Dashboard | null>(null);

  // Once dashboards load, default-select the first one.
  useEffect(() => {
    if (!activeId && dashboards && dashboards.length > 0) {
      setActiveId(dashboards[0].id);
    }
    // If the active dashboard got deleted out from under us, fall back.
    if (
      activeId &&
      dashboards &&
      !dashboards.some((d) => d.id === activeId)
    ) {
      setActiveId(dashboards[0]?.id ?? null);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm">Dashboard</Label>
        <Select
          value={activeId ?? ""}
          onValueChange={(v) => setActiveId(v)}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dashboards.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span className="inline-flex items-center gap-1">
                  {d.is_public ? (
                    <Globe className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                  {d.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
        {active && (
          <>
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
          </>
        )}
      </div>

      {active && <DashboardView dashboard={active} />}

      <CreateDashboardDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(d) => setActiveId(d.id)}
      />

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
            const id = deleting.id;
            try {
              await deleteDash.mutateAsync(id);
              toast.success("Dashboard deleted");
              setDeleting(null);
            } catch (err) {
              toast.error("Failed to delete: " + errorMessage(err));
            }
          }}
        />
      )}
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
