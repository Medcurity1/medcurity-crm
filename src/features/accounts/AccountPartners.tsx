import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Network, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { AccountPartnership } from "@/types/crm";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AddPartnerDialog } from "./AddPartnerDialog";

/**
 * Bi-directional partner tab on an Account detail page.
 *
 * Two sections inside one tab:
 *   1. "Partner Of" — accounts where THIS account is the member
 *      (shows the partner above us; rare for most accounts to have
 *      more than one)
 *   2. "Member Accounts" — accounts where THIS account is the partner
 *      (shows the members underneath us; could be many)
 *
 * Either side can be empty. If both are empty we still render the
 * tab with a clear "+ Add Partner" CTA — chose this over hiding
 * the tab so users always know where to add a partnership.
 *
 * Add Partner dialog asks the user whether the new account is a
 * Partner OF this account or a Member OF this account, so they
 * never have to think about which column gets which id.
 */
export function AccountPartners({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AccountPartnership | null>(null);

  // Fetches BOTH directions in one round trip — we filter in the
  // browser since partnerships are <100 rows even for the largest
  // umbrella partner. Joins both account references so the table
  // can render names + status without a per-row lookup.
  const { data, isLoading } = useQuery({
    queryKey: ["account_partners", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_partners")
        .select(
          "*, " +
          "partner_account:accounts!partner_account_id(id, name, account_type, lifecycle_status), " +
          "member_account:accounts!member_account_id(id, name, account_type, lifecycle_status)"
        )
        .or(`partner_account_id.eq.${accountId},member_account_id.eq.${accountId}`);
      if (error) throw error;
      return ((data ?? []) as unknown) as AccountPartnership[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (partnership: AccountPartnership) => {
      const { error } = await supabase
        .from("account_partners")
        .delete()
        .eq("id", partnership.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account_partners", accountId] });
      toast.success("Partnership removed");
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error("Couldn't remove partnership: " + (err as Error).message);
      setPendingDelete(null);
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading partnerships…</div>;
  }

  // Split rows by which side this account is on. The same partnership
  // can never appear in both lists (FK uniqueness on the pair) so a
  // simple partition is fine.
  const partnersOfThisAccount = (data ?? []).filter(
    (p) => p.member_account_id === accountId
  );
  const membersOfThisAccount = (data ?? []).filter(
    (p) => p.partner_account_id === accountId
  );

  const isEmpty =
    partnersOfThisAccount.length === 0 && membersOfThisAccount.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {isEmpty
            ? "No partner relationships yet."
            : `${partnersOfThisAccount.length + membersOfThisAccount.length} partnership${partnersOfThisAccount.length + membersOfThisAccount.length === 1 ? "" : "s"}`}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Partner
        </Button>
      </div>

      {/* "Partner Of" — this account is the MEMBER */}
      {partnersOfThisAccount.length > 0 && (
        <PartnershipSection
          title="Partner Of"
          subtitle="Umbrella partner accounts that this account belongs to"
          icon={<ArrowUp className="h-4 w-4 text-muted-foreground" />}
          rows={partnersOfThisAccount}
          showSide="partner"
          onDelete={setPendingDelete}
        />
      )}

      {/* "Member Accounts" — this account is the PARTNER */}
      {membersOfThisAccount.length > 0 && (
        <PartnershipSection
          title="Member Accounts"
          subtitle="Accounts that came in through this partner"
          icon={<ArrowDown className="h-4 w-4 text-muted-foreground" />}
          rows={membersOfThisAccount}
          showSide="member"
          onDelete={setPendingDelete}
        />
      )}

      {isEmpty && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <Network className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No partner relationships for this account yet.
          </p>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Partner
          </Button>
        </div>
      )}

      <AddPartnerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accountId={accountId}
        onAdded={() =>
          qc.invalidateQueries({ queryKey: ["account_partners", accountId] })
        }
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Remove partnership?"
        description={
          pendingDelete
            ? `This removes the link between "${pendingDelete.partner_account?.name ?? "?"}" and "${pendingDelete.member_account?.name ?? "?"}". The accounts themselves are not deleted.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />
    </div>
  );
}

function PartnershipSection({
  title,
  subtitle,
  icon,
  rows,
  showSide,
  onDelete,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: AccountPartnership[];
  // "partner" → render the partner_account column (this account is member)
  // "member"  → render the member_account column (this account is partner)
  showSide: "partner" | "member";
  onDelete: (p: AccountPartnership) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <div>
          <h3 className="text-sm font-semibold">
            {title} <span className="text-muted-foreground font-normal">({rows.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const target =
                showSide === "partner" ? p.partner_account : p.member_account;
              if (!target) return null;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      to={`/accounts/${target.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {target.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {target.lifecycle_status ? (
                      <Badge variant="outline" className="font-normal capitalize">
                        {target.lifecycle_status.replace(/_/g, " ")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {target.account_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.role ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
