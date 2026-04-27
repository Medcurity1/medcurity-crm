import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { CustomFieldsManager } from "./CustomFieldsManager";
import { UsersManager } from "./UsersManager";
import { PermissionsManager } from "./PermissionsManager";
import { RequiredFieldsManager } from "./RequiredFieldsManager";
import { IntegrationsManager } from "./IntegrationsManager";
import { SalesforceImport } from "./SalesforceImport";
import { PartnerRelationshipsImport } from "./PartnerRelationshipsImport";
import { PicklistsManager } from "@/features/picklists/PicklistsManager";
import { ObjectManager } from "./ObjectManager";
import { LayoutsViewer } from "@/features/layouts/LayoutsViewer";
import { AuditLogViewer } from "./AuditLogViewer";
import { AutomationsManager } from "./AutomationsManager";
import { SystemInfo } from "./SystemInfo";
import { DataHealthDashboard } from "./DataHealthDashboard";
import { Loader2 } from "lucide-react";

const VALID_TABS = [
  "object-manager",
  "layouts",
  "custom-fields",
  "picklists",
  "users",
  "permissions",
  "required-fields",
  "integrations",
  "automations",
  "data-import",
  "audit-log",
  "data-health",
  "system",
];

export function AdminSettings() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (() => {
    const t = searchParams.get("tab");
    return t && VALID_TABS.includes(t) ? t : "custom-fields";
  })();

  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        // Drop audit-log-specific filters when navigating away
        if (tab !== "audit-log") {
          next.delete("record_id");
          next.delete("q");
          next.delete("entity");
          next.delete("action");
          next.delete("range");
          next.delete("page");
        }
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
          Manage custom fields, users, and system configuration.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="object-manager">Object Manager</TabsTrigger>
          <TabsTrigger value="layouts">Page Layouts</TabsTrigger>
          <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
          <TabsTrigger value="picklists">Picklists</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="required-fields">Required Fields</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="data-import">Data Import</TabsTrigger>
          <TabsTrigger value="audit-log">Audit Log</TabsTrigger>
          <TabsTrigger value="data-health">Data Health</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="custom-fields">
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
        </TabsContent>

        <TabsContent value="object-manager">
          <ObjectManager />
        </TabsContent>

        <TabsContent value="layouts">
          <LayoutsViewer />
        </TabsContent>

        <TabsContent value="picklists">
          <PicklistsManager />
        </TabsContent>

        <TabsContent value="users">
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">User Management</h2>
              <p className="text-sm text-muted-foreground">
                Manage user roles and active status.
              </p>
            </div>
            <UsersManager />
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
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
        </TabsContent>

        <TabsContent value="required-fields">
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
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsManager onNavigateTab={setActiveTab} />
        </TabsContent>

        <TabsContent value="automations">
          <AutomationsManager />
        </TabsContent>

        <TabsContent value="data-import" className="space-y-6">
          <SalesforceImport />
          <PartnerRelationshipsImport />
        </TabsContent>

        <TabsContent value="audit-log">
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Audit Log</h2>
              <p className="text-sm text-muted-foreground">
                View a complete trail of all changes made to records in the system.
              </p>
            </div>
            <AuditLogViewer />
          </Card>
        </TabsContent>

        <TabsContent value="data-health">
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">Data Health & Protection</h2>
              <p className="text-sm text-muted-foreground">
                Monitor data integrity, storage usage, and protection status.
              </p>
            </div>
            <DataHealthDashboard />
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <Card className="p-6">
            <div className="space-y-1 mb-6">
              <h2 className="text-lg font-semibold">System Information</h2>
              <p className="text-sm text-muted-foreground">
                App version, build details, and database statistics.
              </p>
            </div>
            <SystemInfo />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
