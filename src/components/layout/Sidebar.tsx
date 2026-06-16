import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Building2,
  Users,
  UserPlus,
  Handshake,
  Target,
  Kanban,
  Package,
  RefreshCw,
  BarChart3,
  Archive,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  KeyRound,
  Search,
  Calendar as CalendarIcon,
  Clock,
  Sparkles,
  MessageSquarePlus,
  ExternalLink,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PulseLogo } from "@/components/PulseLogo";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
}

type NavItem = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /**
   * If set, the link opens in a new tab via a plain <a>. Used for tools
   * that live outside the CRM. Activity still flows back into the CRM via
   * the nexus-activity webhook.
   */
  external?: boolean;
  /**
   * Optional pill shown next to the label (e.g. "Coming Soon", "Admin").
   * `className` carries the pill's color so each badge can look distinct.
   */
  badge?: { label: string; className: string };
};

// Badge color presets. Coming Soon = vibrant orange; Admin = cool sky
// blue; New = red (draws the eye to a freshly launched tab).
const COMING_SOON_BADGE = "bg-orange-500 text-white";
const ADMIN_BADGE = "bg-sky-500 text-white";
const NEW_BADGE = "bg-red-500 text-white";

const navItems: NavItem[] = [
  { to: "/", icon: Home, label: "Home" },
  // Meddy: website chat command center. Live as of 2026-06-16 (the website
  // chat now points at the CRM). Sits right under Home so reps catch incoming
  // website chats first. "New" badge flags the freshly launched tab.
  { to: "/meddy", icon: Bot, label: "Meddy", badge: { label: "New", className: NEW_BADGE } },
  { to: "/accounts", icon: Building2, label: "Accounts" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/opportunities", icon: Target, label: "Opportunities" },
  { to: "/pipeline", icon: Kanban, label: "Pipeline" },
  { to: "/partners", icon: Handshake, label: "Partners" },
  { to: "/calendar", icon: CalendarIcon, label: "Calendar" },
  { to: "/activities", icon: Clock, label: "Activities" },
  { to: "/products", icon: Package, label: "Products" },
  { to: "/renewals", icon: RefreshCw, label: "Renewals" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  // Forecasting + Analytics moved into /reports as tabs (2026-04-17).
  { to: "/requests", icon: MessageSquarePlus, label: "Requests", badge: { label: "New", className: NEW_BADGE } },
  // Nexus: future per-user command center. Lives at the bottom for now
  // with a Coming Soon badge; will eventually move up to replace Home.
  { to: "/nexus", icon: Sparkles, label: "Nexus", badge: { label: "Coming Soon", className: COMING_SOON_BADGE } },
];

const adminItems: NavItem[] = [
  // Leads = the admin-only working list / import drop zone. Kept the
  // "Leads" name (reps don't see it; admins manage + promote to Contacts).
  { to: "/leads", icon: UserPlus, label: "Leads", badge: { label: "Admin", className: ADMIN_BADGE } },
  { to: "/archive", icon: Archive, label: "Archive", badge: { label: "Admin", className: ADMIN_BADGE } },
  { to: "/admin", icon: Settings, label: "Admin Settings", badge: { label: "Admin", className: ADMIN_BADGE } },
];

export function Sidebar({ collapsed, onToggle, isMobile = false }: SidebarProps) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const allItems = profile?.role === "admin" || profile?.role === "super_admin"
    ? [...navItems, ...adminItems]
    : [...navItems];

  function roleColor(role: string) {
    switch (role) {
      case "super_admin": return "bg-destructive text-destructive-foreground";
      case "admin": return "bg-primary text-primary-foreground";
      case "sales": return "bg-chart-2 text-white";
      case "renewals": return "bg-chart-3 text-white";
      default: return "";
    }
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-screen border-r border-border bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-60",
        isMobile && "fixed inset-y-0 left-0 z-40 shadow-lg",
        isMobile && collapsed && "-translate-x-full"
      )}
    >
      {/* Logo — mirror-chrome Pulse. Theme-aware stage: dark mode keeps the
          dark slate block with the silver chrome; light mode gets a light
          block with the graphite chrome (same pairing the seasonal login
          uses). Both tones render; CSS shows the one matching the theme.
          The reflection fades out at the block's bottom edge, so the
          "floor" visually ends right where the search section starts. */}
      <div className="shrink-0 overflow-hidden border-b border-border bg-[linear-gradient(180deg,#eef1f6_0%,#e1e7f0_100%)] dark:bg-[linear-gradient(180deg,#14181f_0%,#1b212d_100%)]">
        {!collapsed ? (
          <div className="flex h-16 items-end px-4 pb-0">
            <PulseLogo variant="full" tone="graphite" className="block h-14 w-auto dark:hidden" />
            <PulseLogo variant="full" tone="silver" className="hidden h-14 w-auto dark:block" />
          </div>
        ) : (
          <div className="flex h-16 items-end justify-center pb-0">
            <PulseLogo variant="mark" tone="graphite" className="block h-14 w-auto dark:hidden" />
            <PulseLogo variant="mark" tone="silver" className="hidden h-14 w-auto dark:block" />
          </div>
        )}
      </div>

      {/* Search button */}
      <div className="px-2 pt-2">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={() => {
                  document.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
                  );
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search (&#8984;K)</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-muted-foreground"
            size="sm"
            onClick={() => {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
              );
            }}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="pointer-events-none h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground inline-flex">
              <span className="text-xs">&#8984;</span>K
            </kbd>
          </Button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {allItems.map((item) => {
          const isActive = item.external
            ? false
            : item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
          const linkClasses = cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-primary"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          );
          const link = item.external ? (
            <a
              key={item.to}
              href={item.to}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClasses}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && (
                <span className="flex-1 flex items-center justify-between gap-2">
                  {item.label}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </span>
              )}
            </a>
          ) : (
            <NavLink key={item.to} to={item.to} className={linkClasses}>
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && (
                <span className="flex-1 flex items-center justify-between gap-2">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <Badge
                      className={cn(
                        "shrink-0 h-4 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide border-transparent",
                        item.badge.className,
                      )}
                    >
                      {item.badge.label}
                    </Badge>
                  )}
                </span>
              )}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.to} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">
                  {item.label}
                  {item.external && " (opens in new tab)"}
                </TooltipContent>
              </Tooltip>
            );
          }
          return link;
        })}
      </nav>

      <Separator />

      {/* User section */}
      {!collapsed && profile && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {profile.full_name
                ? profile.full_name.charAt(0).toUpperCase()
                : "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {profile.full_name ?? "Unknown User"}
              </p>
              <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", roleColor(profile.role))}>
                {profile.role}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => navigate("/change-password")}
          >
            <KeyRound className="h-4 w-4" />
            Change Password
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      )}

      {collapsed && (
        <div className="p-2 space-y-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={() => navigate("/change-password")}
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Change Password</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={signOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign Out</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
