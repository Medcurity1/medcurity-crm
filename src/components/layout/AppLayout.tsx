import { useState, useEffect, useCallback, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";
import { AiAssistantDialog } from "@/components/AiAssistantDialog";
import { Button } from "@/components/ui/button";
import { Menu as MenuIcon, Sparkles } from "lucide-react";
import { WelcomeWizard } from "@/features/auth/WelcomeWizard";
import { QuickCreateDialog } from "@/components/QuickCreateDialog";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { QuickTaskDialog } from "@/features/activities/QuickTaskDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { useMeddyPresence } from "@/features/meddy/useMeddyPresence";
import { useAuth } from "@/features/auth/AuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IdleWarningDialog } from "@/components/IdleWarningDialog";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { NewYearCelebration } from "@/components/seasonal/NewYearCelebration";

const pathMap: Record<string, string> = {
  "": "Home",
  accounts: "Accounts",
  contacts: "Contacts",
  leads: "Leads",
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

  // Inactivity auto-logout, now a long HIPAA backstop rather than a short
  // timeout. Reps keep the CRM open all day to stay "available" for Meddy
  // chats, so a 12h idle window never trips during a workday of just sitting
  // available (availability runs off the Meddy heartbeat, not this timer),
  // but an abandoned-yet-running machine still logs off overnight. The
  // primary session control is now "close every tab => logged out"
  // (crossTabSession.ts); this is the secondary safeguard.
  const idle = useIdleLogout({
    idleMs: 12 * 60 * 60 * 1000,
    warnMs: 60 * 1000,
    enabled: !!profile,
  });

  // Poll for new in-app notifications and pop them as toasts (top-right).
  // Runs as long as the user is signed in.
  useNotificationToasts();

  // Meddy availability, SITE-WIDE. Keeps the signed-in user "available" for
  // website chats while they work anywhere in the CRM (not just the Meddy
  // tab). They go unavailable only via the manual Away toggle or session end.
  useMeddyPresence(!!profile);

  // Quick Create dialog
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Quick Task dialog (Ctrl+Space global capture)
  const [showQuickTask, setShowQuickTask] = useState(false);

  // Keyboard shortcuts help dialog
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // AI assistant dialog
  const [showAssistant, setShowAssistant] = useState(false);

  // Register keyboard shortcuts
  const { prefs } = useUserPreferences();
  useKeyboardShortcuts({
    onQuickCreate: useCallback(() => setShowQuickCreate(true), []),
    onShowHelp: useCallback(() => setShowShortcutsHelp(true), []),
    onQuickTask: useCallback(() => setShowQuickTask(true), []),
    quickTaskShortcut: prefs.quickTaskShortcut,
  });

  const section = location.pathname.split("/")[1] || "";
  const sectionName = pathMap[section] ?? section;

  // Auto-collapse when switching to mobile, and close the mobile slide-out
  // menu after navigating to a new tab (so tapping a tab dismisses it).
  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile, location.pathname]);

  const handleToggle = useCallback(() => setCollapsed((c) => !c), []);
  const handleOverlayClick = useCallback(() => setCollapsed(true), []);

  // Publish half the sidebar's current width as a CSS variable so dialogs
  // (which portal to <body>) can center themselves over the CONTENT area
  // rather than the full viewport. On mobile the sidebar overlays, so the
  // content area IS the viewport and the offset is zero.
  useEffect(() => {
    const offset = isMobile ? "0px" : collapsed ? "32px" : "120px";
    document.documentElement.style.setProperty("--dialog-x-offset", offset);
    return () => {
      document.documentElement.style.setProperty("--dialog-x-offset", "0px");
    };
  }, [isMobile, collapsed]);

  // Staging banner. Detect via hostname so we never accidentally show
  // it in production. Added 2026-05-12 after a user spent time editing
  // records on staging thinking it was prod and reported the data as
  // "lost." Banner is unmissable on purpose.
  const isStaging =
    typeof window !== "undefined" &&
    (window.location.hostname.startsWith("staging.") ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

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
        {isStaging && (
          <div className="sticky top-0 z-20 bg-yellow-400 text-black text-center text-sm font-semibold py-1.5 border-b-2 border-yellow-600 shadow-sm">
            ⚠️ STAGING ENVIRONMENT — data here is NOT real. For production go to{" "}
            <a
              href="https://crm.medcurity.com"
              className="underline hover:text-yellow-900"
            >
              crm.medcurity.com
            </a>
          </div>
        )}
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleToggle}
                title="Menu"
                aria-label="Open navigation menu"
                className="h-8 w-8 shrink-0"
              >
                <MenuIcon className="h-5 w-5" />
              </Button>
            )}
            <span className="text-sm font-medium text-muted-foreground truncate">{sectionName}</span>
          </div>
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
        {/* Product announcement nudge (e.g. new-feature launch). Lives in
            the persistent shell so it stays until dismissed, even across
            navigation. No-op when ACTIVE_ANNOUNCEMENT is null. */}
        <AnnouncementBanner />
        {/* One-time desktop-notification permission nudge (snoozes 14
            days on "Not now"; disappears forever once answered). */}
        <NotificationPermissionPrompt />
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

      {/* Quick Task dialog — opened globally with Ctrl+Space from any screen */}
      <QuickTaskDialog
        open={showQuickTask}
        onOpenChange={setShowQuickTask}
      />

      {/* Keyboard shortcuts help dialog */}
      <KeyboardShortcutsDialog
        open={showShortcutsHelp}
        onOpenChange={setShowShortcutsHelp}
      />

      {/* One-time January fireworks (first login of the new year). */}
      <NewYearCelebration />
    </div>
  );
}
