import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import type { AppRole, UserProfile } from "@/types/crm";
import { useAllUsers, useUpdateUserProfile } from "./admin-api";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "renewals", label: "Renewals" },
  { value: "admin", label: "Admin" },
];

function roleBadgeClass(role: AppRole): string {
  switch (role) {
    case "admin":
      return "bg-primary text-primary-foreground";
    case "sales":
      return "bg-chart-2 text-white";
    case "renewals":
      return "bg-chart-3 text-white";
  }
}

export function UsersManager() {
  const { data: users, isLoading } = useAllUsers();
  const updateUser = useUpdateUserProfile();
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("sales");
  const [editActive, setEditActive] = useState(true);

  function handleOpenEdit(user: UserProfile) {
    setEditingUser(user);
    setEditRole(user.role);
    setEditActive(user.is_active);
  }

  function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;

    updateUser.mutate(
      {
        id: editingUser.id,
        role: editRole,
        is_active: editActive,
      },
      {
        onSuccess: () => {
          toast.success("User profile updated");
          setEditingUser(null);
        },
        onError: (err) => {
          toast.error(`Failed to update user: ${err.message}`);
        },
      }
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Invite instructions */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
        <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Inviting New Users</p>
          <p className="mt-1">
            To add a new user, create their account in the Supabase Auth
            dashboard first. Once they sign in, a profile will be automatically
            created. You can then edit their role and status here.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users?.length ?? 0} user{users?.length !== 1 ? "s" : ""}
        </p>
      </div>

      {users && users.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.full_name ?? "Unnamed User"}
                    <span className="block text-xs text-muted-foreground font-mono">
                      {user.id.slice(0, 8)}...
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={roleBadgeClass(user.role)}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.is_active ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-800"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-red-100 text-red-800">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleOpenEdit(user)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          No user profiles found.
        </div>
      )}

      <Dialog
        open={!!editingUser}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveUser} className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <p className="text-sm">
                {editingUser?.full_name ?? "Unnamed User"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-role">Role</Label>
              <Select
                value={editRole}
                onValueChange={(val) => setEditRole(val as AppRole)}
              >
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="user-active"
                checked={editActive}
                onCheckedChange={setEditActive}
              />
              <Label htmlFor="user-active" className="cursor-pointer">
                Active
              </Label>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingUser(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
