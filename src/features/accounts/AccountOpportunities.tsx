import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Opportunity } from "@/types/crm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { stageLabel, formatCurrency, formatDate } from "@/lib/formatters";

export function AccountOpportunities({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const { data: opps, isLoading } = useQuery({
    queryKey: ["opportunities", { account_id: accountId }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Opportunity[];
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading opportunities...</div>;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/opportunities/new?account_id=${accountId}`)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Opportunity
        </Button>
      </div>

      {!opps?.length ? (
        <EmptyState
          icon={Target}
          title="No opportunities"
          description="Create an opportunity for this account"
        />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Expected Close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opps.map((opp) => (
                <TableRow key={opp.id}>
                  <TableCell>
                    <Link
                      to={`/opportunities/${opp.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {opp.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      value={opp.stage}
                      variant="stage"
                      label={stageLabel(opp.stage)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(opp.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(opp.expected_close_date)}
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
