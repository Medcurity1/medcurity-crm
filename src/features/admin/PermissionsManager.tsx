import { Fragment, useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { AppRole } from "@/types/crm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Capability {
  key: string;
  label: string;
  category: string;
}

type PermissionsMap = Record<string, Record<AppRole, boolean>>;

// ---------------------------------------------------------------------------
// Default permissions data
// ---------------------------------------------------------------------------

const CAPABILITIES: Capability[] = [
  { key: "view_accounts", label: "View Accounts", category: "Accounts" },
  { key: "edit_accounts", label: "Create/Edit Accounts", category: "Accounts" },
  { key: "archive_accounts", label: "Archive Accounts", category: "Accounts" },
  { key: "view_contacts", label: "View Contacts", category: "Contacts" },
  { key: "edit_contacts", label: "Create/Edit Contacts", category: "Contacts" },
  { key: "view_leads", label: "View Leads", category: "Leads" },
  { key: "edit_leads", label: "Create/Edit Leads", category: "Leads" },
  { key: "convert_leads", label: "Convert Leads", category: "Leads" },
  { key: "view_opportunities", label: "View Opportunities", category: "Opportunities" },
  { key: "edit_opportunities", label: "Create/Edit Opportunities", category: "Opportunities" },
  { key: "view_pipeline", label: "View Pipeline", category: "Pipeline" },
  { key: "view_renewals", label: "View Renewals", category: "Renewals" },
  { key: "view_reports", label: "View Reports", category: "Reports" },
  { key: "build_reports", label: "Build Reports", category: "Reports" },
  { key: "manage_custom_fields", label: "Manage Custom Fields", category: "Admin" },
  { key: "manage_users", label: "Manage Users", category: "Admin" },
  { key: "restore_archived", label: "Restore Archived", category: "Admin" },
];

const ROLES: { value: AppRole; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "renewals", label: "Renewals" },
  { value: "admin", label: "Admin" },
];

function getDefaultPermissions(): PermissionsMap {
  return {
    view_accounts:         { sales: true,  renewals: true,  admin: true },
    edit_accounts:         { sales: true,  renewals: true,  admin: true },
    archive_accounts:      { sales: false, renewals: false, admin: true },
    view_contacts:         { sales: true,  renewals: true,  admin: true },
    edit_contacts:         { sales: true,  renewals: true,  admin: true },
    view_leads:            { sales: true,  renewals: true,  admin: true },
    edit_leads:            { sales: true,  renewals: false, admin: true },
    convert_leads:         { sales: true,  renewals: false, admin: true },
    view_opportunities:    { sales: true,  renewals: true,  admin: true },
    edit_opportunities:    { sales: true,  renewals: true,  admin: true },
    view_pipeline:         { sales: true,  renewals: true,  admin: true },
    view_renewals:         { sales: false, renewals: true,  admin: true },
    view_reports:          { sales: true,  renewals: true,  admin: true },
    build_reports:         { sales: true,  renewals: true,  admin: true },
    manage_custom_fields:  { sales: false, renewals: false, admin: true },
    manage_users:          { sales: false, renewals: false, admin: true },
    restore_archived:      { sales: false, renewals: false, admin: true },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionsManager() {
  const [permissions, setPermissions] = useState<PermissionsMap>(getDefaultPermissions);

  const handleToggle = useCallback(
    (capabilityKey: string, role: AppRole, checked: boolean) => {
      setPermissions((prev) => ({
        ...prev,
        [capabilityKey]: {
          ...prev[capabilityKey],
          [role]: checked,
        },
      }));
      toast.info("Permission updated (in-memory only for MVP)");
    },
    [],
  );

  // Group capabilities by category for visual separation
  let lastCategory = "";

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Capability</TableHead>
              {ROLES.map((r) => (
                <TableHead key={r.value} className="text-center w-[120px]">
                  {r.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {CAPABILITIES.map((cap) => {
              const showCategory = cap.category !== lastCategory;
              lastCategory = cap.category;

              return (
                <Fragment key={cap.key}>
                  {showCategory && (
                    <TableRow className="bg-muted/40">
                      <TableCell
                        colSpan={4}
                        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-2"
                      >
                        {cap.category}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="font-medium text-sm">
                      {cap.label}
                    </TableCell>
                    {ROLES.map((r) => (
                      <TableCell key={r.value} className="text-center">
                        <Checkbox
                          checked={permissions[cap.key]?.[r.value] ?? false}
                          onCheckedChange={(checked) =>
                            handleToggle(cap.key, r.value, checked === true)
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Changes are stored locally for now. A future update will persist these
        to the <code className="bg-muted px-1 py-0.5 rounded text-xs">role_permissions</code> table.
      </p>
    </div>
  );
}
