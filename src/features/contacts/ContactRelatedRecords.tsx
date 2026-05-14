import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

/**
 * "Related Records" section on a Contact detail page — lists every
 * account and opportunity the contact appears on, via the home
 * account (contacts.account_id), additional accounts
 * (contact_account_links), and opportunity stakeholder rows
 * (contact_opportunity_links).
 *
 * Used to answer "where does this contact appear?" — the same data
 * the Contact Cross-Linkage report aggregates across all contacts.
 */
export function ContactRelatedRecords({
  contactId,
  homeAccountId,
}: {
  contactId: string;
  homeAccountId: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["contact-related-records", contactId],
    queryFn: async () => {
      const [homeAcct, linkedAccts, linkedOpps] = await Promise.all([
        homeAccountId
          ? supabase
              .from("accounts")
              .select("id, name")
              .eq("id", homeAccountId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("contact_account_links")
          .select("added_at, account:accounts!account_id(id, name)")
          .eq("contact_id", contactId),
        supabase
          .from("contact_opportunity_links")
          .select(
            "added_at, opportunity:opportunities!opportunity_id(id, name, stage, amount)",
          )
          .eq("contact_id", contactId),
      ]);

      const home =
        homeAcct.data && !homeAcct.error
          ? (homeAcct.data as { id: string; name: string })
          : null;
      const accounts = ((linkedAccts.data ?? []) as unknown as Array<{
        added_at: string;
        account: { id: string; name: string } | null;
      }>)
        .map((r) => r.account)
        .filter((a): a is { id: string; name: string } => !!a);
      const opps = ((linkedOpps.data ?? []) as unknown as Array<{
        added_at: string;
        opportunity: {
          id: string;
          name: string;
          stage: string | null;
          amount: number | null;
        } | null;
      }>)
        .map((r) => r.opportunity)
        .filter(
          (
            o,
          ): o is {
            id: string;
            name: string;
            stage: string | null;
            amount: number | null;
          } => !!o,
        );
      return { home, accounts, opps };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const home = data?.home ?? null;
  const accounts = data?.accounts ?? [];
  const opps = data?.opps ?? [];
  const isEmpty = !home && accounts.length === 0 && opps.length === 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Related Records</h3>
          <span className="text-xs text-muted-foreground">
            {(home ? 1 : 0) + accounts.length + opps.length} total
          </span>
        </div>

        {isEmpty ? (
          <p className="text-sm text-muted-foreground">
            This contact isn't attached to any accounts or opportunities yet.
          </p>
        ) : (
          <div className="space-y-4">
            {(home || accounts.length > 0) && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Accounts
                </h4>
                <ul className="space-y-1">
                  {home && (
                    <li className="flex items-center justify-between text-sm">
                      <Link
                        to={`/accounts/${home.id}`}
                        className="text-primary hover:underline flex items-center gap-1.5"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {home.name}
                      </Link>
                      <Badge
                        variant="secondary"
                        className="bg-emerald-100 text-emerald-700"
                      >
                        Home
                      </Badge>
                    </li>
                  )}
                  {accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <Link
                        to={`/accounts/${a.id}`}
                        className="text-primary hover:underline flex items-center gap-1.5"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {a.name}
                      </Link>
                      <Badge
                        variant="secondary"
                        className="bg-sky-100 text-sky-700"
                      >
                        Linked
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {opps.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Opportunities
                </h4>
                <ul className="space-y-1">
                  {opps.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <Link
                        to={`/opportunities/${o.id}`}
                        className="text-primary hover:underline flex items-center gap-1.5"
                      >
                        <TrendingUp className="h-3.5 w-3.5" />
                        {o.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {o.stage ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
