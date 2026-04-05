import { useState, useEffect, useCallback, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { GlobalSearch } from "@/components/GlobalSearch";
import { WelcomeWizard } from "@/features/auth/WelcomeWizard";
import { QuickCreateDialog } from "@/components/QuickCreateDialog";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

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
  archive: "Archive",
  admin: "Settings",
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
  const [collapsed, setCollapsed] = useState(isMobile);

  // Welcome wizard state
  const [showWizard, setShowWizard] = useState(
    () => !localStorage.getItem("crm_onboarded")
  );

  // Quick Create dialog
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Keyboard shortcuts help dialog
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

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
          <GlobalSearch />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <div className="animate-pulse text-muted-foreground">
                  Loading...
                </div>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Welcome Wizard overlay */}
      <WelcomeWizard
        open={showWizard}
        onComplete={() => setShowWizard(false)}
      />

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
