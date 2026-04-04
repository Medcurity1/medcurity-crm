import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
import { formatDate } from "@/lib/formatters";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

type ArchivedRecord = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  archived_at: string;
  archive_reason: string | null;
};

function useArchivedRecords(table: string) {
  return useQuery({
    queryKey: ["archived", table],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });
      if (error) throw error;
      return data as ArchivedRecord[];
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
  if (record.first_name && record.last_name) return `${record.first_name} ${record.last_name}`;
  return record.id;
}

function ArchivedTable({ table }: { table: string }) {
  const { data: records, isLoading } = useArchivedRecords(table);
  const restoreMutation = useRestoreRecord();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!records?.length) {
    return (
      <EmptyState
        icon={Archive}
        title="No archived records"
        description={`No archived ${table} found`}
      />
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Archived Date</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="font-medium">{getDisplayName(record)}</TableCell>
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

  if (profile?.role !== "admin") {
    return <Navigate to="/accounts" replace />;
  }

  return (
    <div>
      <PageHeader
        title="Archive Manager"
        description="Restore previously archived records (admin only)"
      />

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <ArchivedTable table="accounts" />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <ArchivedTable table="contacts" />
        </TabsContent>
        <TabsContent value="opportunities" className="mt-4">
          <ArchivedTable table="opportunities" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
