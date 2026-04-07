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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  Loader2,
  UserPlus,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import type { AppRole, UserProfile } from "@/types/crm";
import { useAllUsers, useUpdateUserProfile, useInviteUser } from "./admin-api";

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

function generatePassword(): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  let password = "";
  const array = new Uint32Array(12);
  crypto.getRandomValues(array);
  for (let i = 0; i < 12; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

// ── Invite User Dialog ──────────────────────────────────────────────

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inviteUser = useInviteUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("sales");
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function resetForm() {
    setEmail("");
    setPassword("");
    setFullName("");
    setRole("sales");
    setCreatedPassword(null);
    setCopied(false);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  function handleGeneratePassword() {
    setPassword(generatePassword());
  }

  async function handleCopyPassword() {
    if (!createdPassword) return;
    await navigator.clipboard.writeText(createdPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !fullName || !role) return;

    inviteUser.mutate(
      { email, password, full_name: fullName, role },
      {
        onSuccess: () => {
          toast.success("User created! Share the credentials below.");
          setCreatedPassword(password);
        },
        onError: (err) => {
          toast.error(`Failed to create user: ${err.message}`);
        },
      },
    );
  }

  // After successful creation, show the credentials
  if (createdPassword) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User Created Successfully</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share these credentials with the new user. They will not be shown
              again.
            </p>
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Email
                  </p>
                  <p className="text-sm font-mono">{email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Temporary Password
                  </p>
                  <p className="text-sm font-mono">{createdPassword}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCopyPassword}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Full Name</Label>
            <Input
              id="invite-name"
              placeholder="Jane Smith"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-password">Temporary Password</Label>
            <div className="flex gap-2">
              <Input
                id="invite-password"
                type="text"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleGeneratePassword}
                title="Generate random password"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              value={role}
              onValueChange={(val) => setRole(val as AppRole)}
            >
              <SelectTrigger id="invite-role">
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={inviteUser.isPending}>
              {inviteUser.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create User"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Users Manager ──────────────────────────────────────────────

export function UsersManager() {
  const { data: users, isLoading } = useAllUsers();
  const updateUser = useUpdateUserProfile();
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("sales");
  const [editActive, setEditActive] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

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
      },
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users?.length ?? 0} user{users?.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
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
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-800"
                      >
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

      {/* Edit User Dialog */}
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

      {/* Invite User Dialog */}
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
