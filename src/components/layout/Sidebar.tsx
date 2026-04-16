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
  TrendingUp,
  LineChart,
  Archive,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  KeyRound,
  Search,
  PlayCircle,
  ListChecks,
  Mail,
  Calendar as CalendarIcon,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { branding } from "@/lib/branding";
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

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/accounts", icon: Building2, label: "Accounts" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/partners", icon: Handshake, label: "Partners" },
  { to: "/leads", icon: UserPlus, label: "Leads" },
  { to: "/lead-lists", icon: ListChecks, label: "Lead Lists" },
  { to: "/sequences", icon: PlayCircle, label: "Sequences" },
  { to: "/email-templates", icon: Mail, label: "Email Templates" },
  { to: "/opportunities", icon: Target, label: "Opportunities" },
  { to: "/pipeline", icon: Kanban, label: "Pipeline" },
  { to: "/calendar", icon: CalendarIcon, label: "Calendar" },
  { to: "/activities", icon: Clock, label: "Activities" },
  { to: "/products", icon: Package, label: "Products" },
  { to: "/renewals", icon: RefreshCw, label: "Renewals" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  { to: "/forecasting", icon: TrendingUp, label: "Forecasting" },
  { to: "/analytics", icon: LineChart, label: "Analytics" },
];

const adminItems = [
  { to: "/archive", icon: Archive, label: "Archive" },
  { to: "/admin", icon: Settings, label: "Admin Settings" },
];

export function Sidebar({ collapsed, onToggle, isMobile = false }: SidebarProps) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const allItems = profile?.role === "admin" || profile?.role === "super_admin"
    ? [...navItems, ...adminItems]
    : navItems;

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
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-border shrink-0">
        {!collapsed && (
          <span className="text-lg font-bold text-primary tracking-tight">
            {branding.fullTitle}
          </span>
        )}
        {collapsed && (
          <span className="text-lg font-bold text-primary mx-auto">{branding.shortName}</span>
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
          const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.to} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
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
