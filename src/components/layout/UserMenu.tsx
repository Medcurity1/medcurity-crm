import { useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { Settings, UserCog, KeyRound, LogOut, Shield, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTheme } from "@/hooks/useTheme";

/**
 * Account/settings dropdown that lives in the top bar (next to search).
 * Shows My Settings for everyone; Admin Settings only for admin + super_admin.
 * Keeps the frequently-needed actions one click away rather than buried in
 * the sidebar.
 *
 * Light/dark toggle (Nathan 8/19): right of the name, inside this menu —
 * flipping themes should never require leaving the current page or opening
 * Settings. The flip always sets an EXPLICIT light or dark (never cycles
 * back to "system"; the full three-way choice still lives in My Settings),
 * and rides a view transition for a soft crossfade where the browser
 * supports it.
 */
export function UserMenu() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();
  const isDark = resolved === "dark";

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (typeof doc.startViewTransition === "function") {
      // flushSync so the class flip lands inside the transition snapshot.
      doc.startViewTransition(() => flushSync(() => setMode(next)));
    } else {
      setMode(next);
    }
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
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {profile?.full_name ?? "Account"}
              </span>
              {profile?.role && (
                <span className="text-xs text-muted-foreground capitalize">
                  {profile.role.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isDark}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-300",
                isDark
                  ? "border-indigo-400/40 bg-indigo-500/25"
                  : "border-amber-400/50 bg-amber-300/30",
              )}
            >
              <span
                className={cn(
                  "relative flex h-5 w-5 translate-x-0.5 items-center justify-center rounded-full bg-background shadow-sm transition-transform duration-300",
                  isDark && "translate-x-[22px]",
                )}
              >
                <Sun
                  className={cn(
                    "absolute h-3 w-3 text-amber-500 transition-all duration-300",
                    isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
                  )}
                />
                <Moon
                  className={cn(
                    "absolute h-3 w-3 text-indigo-400 transition-all duration-300",
                    isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0",
                  )}
                />
              </span>
            </button>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

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
