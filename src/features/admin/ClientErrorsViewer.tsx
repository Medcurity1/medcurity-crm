import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeDate } from "@/lib/formatters";
import { format, parseISO } from "date-fns";

interface ClientErrorRow {
  id: number;
  occurred_at: string;
  user_id: string | null;
  user_email: string | null;
  user_full_name: string | null;
  route: string | null;
  mutation_key: string | null;
  error_message: string | null;
  error_code: string | null;
  error_details: Record<string, unknown> | null;
  payload_summary: Record<string, unknown> | null;
  user_agent: string | null;
  app_version: string | null;
}

const PAGE_SIZE = 50;

function useClientErrors() {
  return useQuery({
    queryKey: ["client_errors", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_errors")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as ClientErrorRow[];
    },
    refetchInterval: 60_000, // refresh once a minute
  });
}

function formatTimestamp(s: string): string {
  return format(parseISO(s), "MMM d, yyyy h:mm a");
}

export function ClientErrorsViewer() {
  const { data, isLoading, error } = useClientErrors();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-4">
        Failed to load client errors: {(error as Error).message}
      </p>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No client errors recorded. When a save in the app fails — including
        the silent kind a user might miss — it will show up here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Showing the most recent {rows.length} client-side mutation failures.
        Refreshes every minute. Every failed save (call, note, contact,
        opportunity, etc.) is captured here, even if the user closed the
        tab before seeing the error toast.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Route</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isOpen = expandedId === r.id;
              return (
                <>
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                  >
                    <TableCell className="text-sm whitespace-nowrap">
                      <div>{formatTimestamp(r.occurred_at)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeDate(r.occurred_at)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.user_full_name ?? r.user_email ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.mutation_key ? (
                        <Badge variant="outline" className="font-mono text-xs">
                          {r.mutation_key}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          (unlabeled)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-md truncate">
                      {r.error_message}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                      {r.route ?? "—"}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${r.id}-detail`}>
                      <TableCell colSpan={5} className="bg-muted/30 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="font-semibold mb-1">Error details</p>
                            <pre className="bg-muted rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                              {JSON.stringify(
                                {
                                  code: r.error_code,
                                  message: r.error_message,
                                  ...r.error_details,
                                },
                                null,
                                2
                              )}
                            </pre>
                          </div>
                          <div>
                            <p className="font-semibold mb-1">
                              Payload summary
                            </p>
                            <pre className="bg-muted rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                              {r.payload_summary
                                ? JSON.stringify(r.payload_summary, null, 2)
                                : "(none captured)"}
                            </pre>
                            {r.user_agent && (
                              <p className="mt-2 text-muted-foreground">
                                UA: {r.user_agent}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
