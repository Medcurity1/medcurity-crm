import { useNavigate } from "react-router-dom";
import { Settings, UserCog, KeyRound, LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/AuthProvider";

/**
 * Account/settings dropdown that lives in the top bar (next to search).
 * Shows My Settings for everyone; Admin Settings only for admin + super_admin.
 * Keeps the frequently-needed actions one click away rather than buried in
 * the sidebar.
 */
export function UserMenu() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account menu"
          title="Account & settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {profile?.full_name && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{profile.full_name}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {profile.role?.replace(/_/g, " ")}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={() => navigate("/settings")}>
          <UserCog className="mr-2 h-4 w-4" />
          My Settings
        </DropdownMenuItem>

        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate("/admin")}>
            <Shield className="mr-2 h-4 w-4" />
            Admin Settings
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => navigate("/change-password")}>
          <KeyRound className="mr-2 h-4 w-4" />
          Change Password
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
