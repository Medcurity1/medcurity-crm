import { useState, useEffect, useCallback, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { AiAssistantDialog } from "@/components/AiAssistantDialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { WelcomeWizard } from "@/features/auth/WelcomeWizard";
import { QuickCreateDialog } from "@/components/QuickCreateDialog";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { useAuth } from "@/features/auth/AuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IdleWarningDialog } from "@/components/IdleWarningDialog";

const pathMap: Record<string, string> = {
  "": "Home",
  accounts: "Accounts",
  contacts: "Contacts",
  leads: "Leads",
  "lead-lists": "Lead Lists",
  sequences: "Sequences",
  opportunities: "Opportunities",
  pipeline: "Pipeline",
  renewals: "Renewals",
  reports: "Reports",
  forecasting: "Reports",
  analytics: "Reports",
  archive: "Archive",
  admin: "Admin Settings",
  settings: "My Settings",
};

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}

export function AppLayout() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { profile, markOnboarded } = useAuth();
  const [collapsed, setCollapsed] = useState(isMobile);

  // Welcome wizard DISABLED 2026-04-27.
  //
  // Background: the RLS policy that lets users self-stamp onboarded_at
  // was missing for non-admin users, so the wizard re-popped on every
  // refresh. We added the policy in migration 20260427000004 but
  // existing users have already SEEN the wizard repeatedly — pushing
  // it again now (even once) is annoying and at least one user got
  // stuck where Skip/Close didn't work.
  //
  // Set the flag below to true to re-enable for genuine first-time
  // logins ONLY, after we backfill onboarded_at for everyone who's
  // already been in the app:
  //
  //   UPDATE public.user_profiles SET onboarded_at = now()
  //   WHERE onboarded_at IS NULL;
  //
  // (run that in the Supabase SQL editor on prod first)
  const WIZARD_ENABLED = false;
  const showWizard = WIZARD_ENABLED && !!profile && !profile.onboarded_at;

  // Auto-logout on inactivity. Defaults to 60 min idle; shows a 60s warning
  // modal so the user can cancel before being booted.
  const idle = useIdleLogout({
    idleMs: 60 * 60 * 1000,
    warnMs: 60 * 1000,
    enabled: !!profile,
  });

  // Poll for new in-app notifications and pop them as toasts (top-right).
  // Runs as long as the user is signed in.
  useNotificationToasts();

  // Quick Create dialog
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Keyboard shortcuts help dialog
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // AI assistant dialog
  const [showAssistant, setShowAssistant] = useState(false);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onQuickCreate: useCallback(() => setShowQuickCreate(true), []),
    onShowHelp: useCallback(() => setShowShortcutsHelp(true), []),
  });

  const section = location.pathname.split("/")[1] || "";
  const sectionName = pathMap[section] ?? section;

  // Auto-collapse when switching to mobile
  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile]);

  const handleToggle = useCallback(() => setCollapsed((c) => !c), []);
  const handleOverlayClick = useCallback(() => setCollapsed(true), []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {isMobile && !collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/40 transition-opacity"
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}

      <Sidebar
        collapsed={collapsed}
        onToggle={handleToggle}
        isMobile={isMobile}
      />

      <main className="flex-1 overflow-y-auto bg-background">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <span className="text-sm font-medium text-muted-foreground">{sectionName}</span>
          <div className="flex items-center gap-1">
            <GlobalSearch />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAssistant(true)}
              title="AI Assistant"
              className="gap-1.5"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Ask AI</span>
            </Button>
            <NotificationsDropdown />
            <UserMenu />
          </div>
        </div>
        {/* Widened content area: 2xl caps at 1536px (was 7xl=1280px) so
            data tables (opportunities list, reports, etc.) have more
            horizontal room without having to scroll. Brayden 2026-04-17. */}
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <div className="animate-pulse text-muted-foreground">
                  Loading...
                </div>
              </div>
            }
          >
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Suspense>
        </div>
      </main>

      {/* Welcome Wizard overlay */}
      <WelcomeWizard
        open={showWizard}
        onComplete={() => {
          void markOnboarded();
        }}
      />

      <IdleWarningDialog
        open={idle.warning}
        secondsRemaining={idle.secondsRemaining}
        onStay={idle.dismissWarning}
      />

      <AiAssistantDialog open={showAssistant} onOpenChange={setShowAssistant} />

      {/* Quick Create dialog */}
      <QuickCreateDialog
        open={showQuickCreate}
        onOpenChange={setShowQuickCreate}
      />

      {/* Keyboard shortcuts help dialog */}
      <KeyboardShortcutsDialog
        open={showShortcutsHelp}
        onOpenChange={setShowShortcutsHelp}
      />
    </div>
  );
}
