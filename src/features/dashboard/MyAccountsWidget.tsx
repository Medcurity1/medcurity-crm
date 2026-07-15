import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, customerStatusLabel } from "@/lib/formatters";
import type { CustomerStatus } from "@/types/crm";

interface MyAccountRow {
  id: string;
  name: string;
  customer_status: CustomerStatus | null;
  acv: number | null;
}

export function MyAccountsWidget({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "my-accounts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("accounts")
        .select("id, name, customer_status, acv")
        .eq("owner_user_id", userId)
        .is("archived_at", null)
        .order("acv", { ascending: false, nullsFirst: false })
        .limit(10);
      if (error) throw error;
      return (rows ?? []) as unknown as MyAccountRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          My Accounts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">
            No accounts assigned to you yet.
          </p>
        ) : (
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">ACV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        to={`/accounts/${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={row.customer_status ?? "prospect"}
                        variant="customerStatus"
                        label={customerStatusLabel(row.customer_status)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {row.acv != null ? formatCurrency(Number(row.acv)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
