import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { activityLabel, formatDate } from "@/lib/formatters";
import type { ActivityType } from "@/types/crm";
import { toast } from "sonner";

type ArchivedRecord = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  // Activities identify by subject and carry their own type/date columns.
  subject?: string;
  activity_type?: ActivityType;
  activity_date?: string | null;
  created_at?: string;
  account?: { name: string } | null;
  archived_at: string;
  archive_reason: string | null;
};

// Activities need the parent account name for the Related column; the
// other tables are self-describing.
const SELECT_FOR: Record<string, string> = {
  activities: "*, account:accounts!account_id(id, name)",
};

function useArchivedRecords(table: string, scopeUserId: string | null) {
  return useQuery({
    queryKey: ["archived", table, scopeUserId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from(table)
        .select(SELECT_FOR[table] ?? "*")
        .not("archived_at", "is", null);
      // For imports (the leads table), hide promoted tombstones — a
      // converted import lives on as its contact and shouldn't be
      // "restored" from here. This tab is for avoided / manually-archived
      // imports an admin might want back.
      if (table === "leads") query = query.neq("status", "converted");
      // Non-admins see only what they own or archived themselves. RLS
      // enforces exactly this slice server-side (20260817104000); asking
      // for it explicitly keeps the query honest rather than relying on
      // rows being silently filtered out.
      if (scopeUserId) {
        query = query.or(
          `owner_user_id.eq.${scopeUserId},archived_by.eq.${scopeUserId}`,
        );
      }
      const { data, error } = await query.order("archived_at", { ascending: false });
      if (error) throw error;
      // as unknown as: the select string is now a variable (activities need
      // an embedded account), and supabase-js can only infer a row shape
      // from a string literal — a non-literal degrades to
      // GenericStringError[], which a direct `as` rejects.
      return data as unknown as ArchivedRecord[];
    },
  });
}

function useRestoreRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase.rpc("restore_record", {
        target_table: table,
        target_id: id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["archived", vars.table] });
      qc.invalidateQueries({ queryKey: [vars.table] });
      toast.success("Record restored");
    },
    onError: (err) => {
      toast.error("Failed to restore: " + (err as Error).message);
    },
  });
}

function getDisplayName(record: ArchivedRecord): string {
  if (record.name) return record.name;
  if (record.subject) return record.subject;
  if (record.first_name && record.last_name) return `${record.first_name} ${record.last_name}`;
  return record.id;
}

function ArchivedTable({ table, scopeUserId }: { table: string; scopeUserId: string | null }) {
  const { data: records, isLoading, isError, isFetching, refetch } = useArchivedRecords(table, scopeUserId);
  const restoreMutation = useRestoreRecord();
  // Activities get two extra columns (type + when it happened) — a bare
  // subject isn't enough to tell two archived tasks apart.
  const isActivities = table === "activities";

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        message={`Couldn't load archived ${table}.`}
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!records?.length) {
    return (
      <EmptyState
        icon={Archive}
        title="No archived records"
        description={
          scopeUserId
            ? `No archived ${table} you own or archived yourself`
            : `No archived ${table} found`
        }
      />
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{isActivities ? "Subject" : "Name"}</TableHead>
            {isActivities && <TableHead>Type</TableHead>}
            {isActivities && <TableHead>Date</TableHead>}
            {isActivities && <TableHead>Related Account</TableHead>}
            <TableHead>Archived Date</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="font-medium">{getDisplayName(record)}</TableCell>
              {isActivities && (
                <TableCell className="text-muted-foreground">
                  {record.activity_type ? activityLabel(record.activity_type) : "—"}
                </TableCell>
              )}
              {isActivities && (
                <TableCell className="text-muted-foreground">
                  {/* Same fallback the Activities list uses: the real
                      interaction date when set, else the logged date. */}
                  {formatDate(record.activity_date ?? record.created_at ?? record.archived_at)}
                </TableCell>
              )}
              {isActivities && (
                <TableCell className="text-muted-foreground">
                  {record.account?.name ?? "—"}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">
                {formatDate(record.archived_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {record.archive_reason ?? "—"}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restoreMutation.mutate({ table, id: record.id })}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restore
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ArchiveManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  // Everyone can archive; before 20260817104000 only admins could undo it,
  // so a rep's own mistake needed someone else. Non-admins now get the
  // page scoped to the rows RLS and restore_record() actually let them
  // touch: the ones they own or archived themselves.
  const scopeUserId = isAdmin ? null : profile?.id ?? null;

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Archive Manager" : "Your Archived Records"}
        description={
          isAdmin
            ? "Restore previously archived records (all users)"
            : "Restore records you own or archived yourself"
        }
      />

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          {/* Imports stay admin-only: leads are frozen and have no
              rep-facing surface, and restore_record() rejects them for
              non-admins. */}
          {isAdmin && <TabsTrigger value="leads">Imports</TabsTrigger>}
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <ArchivedTable table="accounts" scopeUserId={scopeUserId} />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <ArchivedTable table="contacts" scopeUserId={scopeUserId} />
        </TabsContent>
        <TabsContent value="opportunities" className="mt-4">
          <ArchivedTable table="opportunities" scopeUserId={scopeUserId} />
        </TabsContent>
        <TabsContent value="activities" className="mt-4">
          <ArchivedTable table="activities" scopeUserId={scopeUserId} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="leads" className="mt-4">
            <ArchivedTable table="leads" scopeUserId={null} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
