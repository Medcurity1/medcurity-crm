import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { CustomFieldsManager } from "./CustomFieldsManager";
import { UsersManager } from "./UsersManager";
import { PermissionsManager } from "./PermissionsManager";
import { RequiredFieldsManager } from "./RequiredFieldsManager";
import { IntegrationsManager } from "./IntegrationsManager";
import { SalesforceImport } from "./SalesforceImport";
import { AuditLogViewer } from "./AuditLogViewer";
import { Loader2 } from "lucide-react";

export function AdminSettings() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("custom-fields");

  useEffect(() => {
    if (!loading && profile?.role !== "admin") {
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

  if (profile?.role !== "admin") {
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
          <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="required-fields">Required Fields</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="data-import">Data Import</TabsTrigger>
          <TabsTrigger value="audit-log">Audit Log</TabsTrigger>
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

        <TabsContent value="data-import">
          <SalesforceImport />
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
      </Tabs>
    </div>
  );
}
