import { useEffect, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminSettingsNav } from "./AdminSettingsNav";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { CustomFieldsManager } from "./CustomFieldsManager";
import { UsersManager } from "./UsersManager";
import { PermissionsManager } from "./PermissionsManager";
import { RequiredFieldsManager } from "./RequiredFieldsManager";
import { IntegrationsManager } from "./IntegrationsManager";
import { PartnerRelationshipsImport } from "./PartnerRelationshipsImport";
import { DataExport } from "./DataExport";
import { PicklistsManager } from "@/features/picklists/PicklistsManager";
import { ObjectManager } from "./ObjectManager";
import { LayoutsViewer } from "@/features/layouts/LayoutsViewer";
import { ClientErrorsViewer } from "./ClientErrorsViewer";
import { AutomationsManager } from "./AutomationsManager";
import { SystemInfo } from "./SystemInfo";
import { RequestsInbox } from "@/features/requests/RequestsInbox";
import { RoutingEditor } from "@/features/requests/RoutingEditor";
import { AiAssistantAdmin } from "./AiAssistantAdmin";
import { TagManager } from "@/features/tags/TagManager";
import { Loader2 } from "lucide-react";

// The heaviest admin panels are lazy-loaded (with a Suspense boundary around
// the tab content below), so opening Admin to change one picklist no longer
// downloads/parses the entire admin surface up front.
const SalesforceImport = lazy(() => import("./SalesforceImport").then((m) => ({ default: m.SalesforceImport })));
const LayoutEditor = lazy(() => import("@/features/layouts/LayoutEditor").then((m) => ({ default: m.LayoutEditor })));
const AuditLogViewer = lazy(() => import("./AuditLogViewer").then((m) => ({ default: m.AuditLogViewer })));
const DataHealthDashboard = lazy(() => import("./DataHealthDashboard").then((m) => ({ default: m.DataHealthDashboard })));
const DataCleanupManager = lazy(() => import("./DataCleanupManager").then((m) => ({ default: m.DataCleanupManager })));
const MeddyAdminPanel = lazy(() => import("@/features/meddy/MeddyAdminPanel").then((m) => ({ default: m.MeddyAdminPanel })));
const NexusAdminPanel = lazy(() => import("@/features/nexus/NexusAdminPanel").then((m) => ({ default: m.NexusAdminPanel })));

/**
 * Top-level admin tabs. We collapsed schema/layout/picklist/required-field
 * management into a single "Object Manager" parent that has its own
 * sub-tabs, so the top bar stays readable.
 *
 * Legacy tab names (custom-fields, picklists, layouts, required-fields)
 * still resolve via the LEGACY_TAB_REDIRECTS map below — old links
 * keep working.
 */
const TOP_TABS = [
  "object-manager",
  "tags",
  "users",
  "permissions",
  "integrations",
  "automations",
  "data-import",
  "requests",
  "meddy",
  "nexus",
  "ai-assistant",
  "audit-log",
  "data-health",
  "data-cleanup",
  "system",
] as const;

const OBJECT_MANAGER_SUBTABS = [
  "schema",
  "layouts",
  "custom-fields",
  "picklists",
  "required-fields",
] as const;

/** Maps the OLD ?tab= values to the NEW (top, sub) pair. */
const LEGACY_TAB_REDIRECTS: Record<string, { top: string; sub?: string }> = {
  "custom-fields": { top: "object-manager", sub: "custom-fields" },
  "picklists": { top: "object-manager", sub: "picklists" },
  "layouts": { top: "object-manager", sub: "layouts" },
  "required-fields": { top: "object-manager", sub: "required-fields" },
};

type TopTab = (typeof TOP_TABS)[number];
type ObjSubTab = (typeof OBJECT_MANAGER_SUBTABS)[number];

export function AdminSettings() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { activeTab, activeSubTab } = (() => {
    const t = searchParams.get("tab") ?? "";
    const s = searchParams.get("sub") ?? "";

    // Legacy redirect: old ?tab=custom-fields → new top=object-manager, sub=custom-fields
    if (LEGACY_TAB_REDIRECTS[t]) {
      const r = LEGACY_TAB_REDIRECTS[t];
      return {
        activeTab: r.top as TopTab,
        activeSubTab: (r.sub as ObjSubTab) ?? "schema",
      };
    }

    const top: TopTab = (TOP_TABS as readonly string[]).includes(t)
      ? (t as TopTab)
      : "object-manager";
    const sub: ObjSubTab = (OBJECT_MANAGER_SUBTABS as readonly string[]).includes(s)
      ? (s as ObjSubTab)
      : "schema";
    return { activeTab: top, activeSubTab: sub };
  })();

  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        // Clear sub-tab unless we're entering Object Manager
        if (tab !== "object-manager") {
          next.delete("sub");
        }
        // Drop audit-log-specific filters when navigating away
        if (tab !== "audit-log") {
          next.delete("record_id");
          next.delete("related_account_id");
          next.delete("q");
          next.delete("entity");
          next.delete("action");
          next.delete("range");
          next.delete("changer");
          next.delete("page");
        }
        return next;
      },
      { replace: true }
    );
  };

  const setActiveSubTab = (sub: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "object-manager");
        next.set("sub", sub);
        return next;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    if (!loading && profile?.role !== "admin" && profile?.role !== "super_admin") {
      navigate("/", { replace: true });
    }
  }, [loading, profile, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage objects, users, integrations, and system configuration.
        </p>
      </div>

      {/* Grouped settings navigation (sticky rail on desktop, scrollable
          pill bar on narrow screens) — replaces the old wrapping tab rows.
          Content panels below still use the same URL-driven Tabs values. */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <AdminSettingsNav
          activeTab={activeTab}
          activeSubTab={activeSubTab}
          onSelectTab={setActiveTab}
          onSelectSubTab={setActiveSubTab}
        />

        <div className="flex-1 min-w-0 w-full">
      <div className="space-y-4">
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
        {/* ---------- OBJECT MANAGER (parent with sub-tabs) ---------- */}
        {activeTab === "object-manager" && (<div>
          {/* Sub-panel switching is plain conditional rendering — the nav
              rail (AdminSettingsNav) is the only tab-like UI, so no orphaned
              ARIA tabpanels or stray focus stops. */}
          <div className="space-y-4">
            {activeSubTab === "schema" && (<div>
              <ObjectManager />
            </div>)}

            {activeSubTab === "layouts" && (<div>
              {/* Admin and super_admin see the drag-and-drop editor; the
                  outer AdminSettings already gates this whole page to
                  those roles, but the editor also enforces internally. */}
              {profile?.role === "admin" || profile?.role === "super_admin" ? (
                <LayoutEditor />
              ) : (
                <LayoutsViewer />
              )}
            </div>)}

            {activeSubTab === "custom-fields" && (<div>
              <Card className="p-6">
                <div className="space-y-1 mb-6">
                  <h2 className="text-lg font-semibold">Custom Field Definitions</h2>
                  <p className="text-sm text-muted-foreground">
                    Define custom fields for accounts, contacts, and opportunities.
                    Fields appear in forms and detail views.
                  </p>
                </div>
                <CustomFieldsManager />
              </Card>
            </div>)}

            {activeSubTab === "picklists" && (<div>
              <PicklistsManager />
            </div>)}

            {activeSubTab === "required-fields" && (<div>
              <Card className="p-6">
                <div className="space-y-1 mb-6">
                  <h2 className="text-lg font-semibold">Required Fields</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure which fields must be filled before a record can be
                    saved. Settings apply per entity type.
                  </p>
                </div>
                <RequiredFieldsManager />
              </Card>
            </div>)}
          </div>
        </div>)}

        {/* ---------- USERS / PERMISSIONS ---------- */}
        {/* ---------- TAGS ---------- */}
        {activeTab === "tags" && <TagManager />}

        {activeTab === "users" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">User Management</h2>
              <p className="text-sm text-muted-foreground">
                Manage user roles and active status.
              </p>
            </div>
            <UsersManager />
          </Card>
        </div>)}

        {activeTab === "permissions" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Role Permissions</h2>
              <p className="text-sm text-muted-foreground">
                Define what each role can access. Toggle capabilities per role to
                customize your team's permissions.
              </p>
            </div>
            <PermissionsManager />
          </Card>
        </div>)}

        {/* ---------- INTEGRATIONS / AUTOMATIONS / DATA IMPORT ---------- */}
        {activeTab === "integrations" && (<div>
          <IntegrationsManager onNavigateTab={setActiveTab} />
        </div>)}

        {activeTab === "automations" && (<div>
          <AutomationsManager />
        </div>)}

        {activeTab === "data-import" && (<div className="space-y-6">
          <DataExport />
          <SalesforceImport />
          <PartnerRelationshipsImport />
        </div>)}

        {/* ---------- REQUESTS ---------- */}
        {activeTab === "requests" && (<div className="space-y-6">
          <Card className="p-6">
            <div className="space-y-1 mb-4">
              <h2 className="text-lg font-semibold">Request routing</h2>
              <p className="text-sm text-muted-foreground">
                Choose who gets notified and sees each request type on their
                Nexus dashboard. Saved per person, so it never depends on names.
              </p>
            </div>
            <RoutingEditor />
          </Card>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Requests</h2>
              <p className="text-sm text-muted-foreground">
                Every collateral, product, and CRM request submitted across the
                team. Filter by type, status, and time window.
              </p>
            </div>
            <RequestsInbox />
          </Card>
        </div>)}

        {/* ---------- MEDDY (website chat assistant) ---------- */}
        {activeTab === "meddy" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Meddy</h2>
              <p className="text-sm text-muted-foreground">
                Quick replies, the website knowledge base, and team phone
                notifications for the chat assistant.
              </p>
            </div>
            <MeddyAdminPanel />
          </Card>
        </div>)}

        {/* ---------- NEXUS (homepage widget layouts) ---------- */}
        {activeTab === "nexus" && (<div>
          <NexusAdminPanel />
        </div>)}

        {/* ---------- AI ASSISTANT (Ask AI read-only assistant) ---------- */}
        {activeTab === "ai-assistant" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Ask AI</h2>
              <p className="text-sm text-muted-foreground">
                Control the read-only AI assistant: which lookups it can perform,
                usage limits, the model it runs on, and recent activity.
              </p>
            </div>
            <AiAssistantAdmin />
          </Card>
        </div>)}

        {/* ---------- AUDIT / HEALTH / SYSTEM ---------- */}
        {activeTab === "audit-log" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Audit Log</h2>
              <p className="text-sm text-muted-foreground">
                View a complete trail of all changes made to records in the system.
              </p>
            </div>
            <AuditLogViewer />
          </Card>
        </div>)}

        {activeTab === "data-health" && (<div className="space-y-6">
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Data Health & Protection</h2>
              <p className="text-sm text-muted-foreground">
                Monitor data integrity, storage usage, and protection status.
              </p>
            </div>
            <DataHealthDashboard />
          </Card>

          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Silent Save Failures</h2>
              <p className="text-sm text-muted-foreground">
                Every client-side mutation that throws (a save, edit, or
                delete that didn't make it to the database) is captured
                here, with the user, route, and error details. Use this to
                investigate reports like "I logged that call but it's not
                showing up."
              </p>
            </div>
            <ClientErrorsViewer />
          </Card>
        </div>)}

        {activeTab === "data-cleanup" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Data Cleanup</h2>
              <p className="text-sm text-muted-foreground">
                Find and fix duplicates: merge duplicate accounts, and retire
                leads that already exist as a contact. Nothing here deletes data —
                duplicates are archived and merges can be undone.
              </p>
            </div>
            <DataCleanupManager />
          </Card>
        </div>)}

        {activeTab === "system" && (<div>
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">System Information</h2>
              <p className="text-sm text-muted-foreground">
                App version, build details, and database statistics.
              </p>
            </div>
            <SystemInfo />
          </Card>
        </div>)}
        </Suspense>
      </div>
        </div>
      </div>
    </div>
  );
}
