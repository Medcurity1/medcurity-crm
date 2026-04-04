import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { RenewalQueueRow } from "@/types/crm";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/formatters";

function useRenewalQueue() {
  return useQuery({
    queryKey: ["renewal_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_queue")
        .select("*")
        .order("days_until_renewal", { ascending: true });
      if (error) throw error;
      return data as RenewalQueueRow[];
    },
  });
}

function urgencyColor(days: number | null): string {
  if (days === null) return "";
  if (days <= 30) return "bg-red-50 text-red-700";
  if (days <= 60) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

export function RenewalsQueue() {
  const { data: renewals, isLoading } = useRenewalQueue();

  const totalARR = renewals?.reduce((sum, r) => sum + Number(r.current_arr), 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Renewals Queue"
        description="Contracts expiring within 120 days"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Upcoming Renewals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{renewals?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Total ARR at Risk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{formatCurrency(totalARR)}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !renewals?.length ? (
        <EmptyState
          icon={RefreshCw}
          title="No upcoming renewals"
          description="No contracts are expiring within the next 120 days"
        />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Current ARR</TableHead>
                <TableHead>Contract End</TableHead>
                <TableHead>Days Until Renewal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renewals.map((r) => (
                <TableRow key={r.source_opportunity_id}>
                  <TableCell>
                    <Link
                      to={`/accounts/${r.account_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.account_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(r.current_arr))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.contract_end_date)}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
                      urgencyColor(r.days_until_renewal)
                    )}>
                      {r.days_until_renewal !== null ? `${r.days_until_renewal} days` : "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
