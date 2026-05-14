import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Contact } from "@/types/crm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatName } from "@/lib/formatters";
import { AddContactDialog } from "@/features/accounts/AddContactDialog";

interface OppContactRow extends Contact {
  added_at: string | null;
}

/**
 * Opportunity Contacts tab. Mirrors SF's Contact Roles section — the
 * opp has its own explicit stakeholder list, decoupled from the
 * underlying account's contacts. This is the change from the previous
 * behavior, which just reused `AccountContacts(opp.account_id)` and
 * showed every contact at the account regardless of whether they
 * touched the deal.
 *
 * Stakeholders are stored in `contact_opportunity_links`. Adding a
 * contact here inserts one row; it does not touch the contact's home
 * account. Removing one deletes the link row only.
 */
export function OpportunityContacts({
  opportunityId,
  opportunityAccountId,
}: {
  opportunityId: string;
  /** The opp's home account_id — passed through to AddContactDialog
   *  so the "Create new contact" fallback can default the new
   *  contact's home account to the opp's account. */
  opportunityAccountId?: string | null;
}) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: rows, isLoading } = useQuery<OppContactRow[]>({
    queryKey: ["opportunity-contacts", opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_opportunity_links")
        .select("added_at, contact:contacts!contact_id(*)")
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
      const out: OppContactRow[] = [];
      for (const r of data ?? []) {
        const row = r as unknown as {
          contact: Contact | null;
          added_at: string | null;
        };
        const c = row.contact;
        if (!c || c.archived_at) continue;
        out.push({ ...c, added_at: row.added_at });
      }
      out.sort((a, b) =>
        (a.last_name ?? "").localeCompare(b.last_name ?? ""),
      );
      return out;
    },
  });

  const removeLink = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from("contact_opportunity_links")
        .delete()
        .eq("contact_id", contactId)
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact removed from this opportunity");
      qc.invalidateQueries({
        queryKey: ["opportunity-contacts", opportunityId],
      });
      qc.invalidateQueries({ queryKey: ["contact-record-links"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (isLoading)
    return (
      <div className="text-sm text-muted-foreground">Loading contacts...</div>
    );

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
          disabled={!opportunityAccountId}
          title={
            !opportunityAccountId
              ? "Attach this opportunity to an account first"
              : undefined
          }
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Contact
        </Button>
      </div>

      {opportunityAccountId && (
        <AddContactDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          opportunityId={opportunityId}
          accountId={opportunityAccountId}
        />
      )}

      {!rows?.length ? (
        <EmptyState
          icon={Users}
          title="No contacts on this opportunity"
          description="Add stakeholders involved in this deal."
        />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      to={`/contacts/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {formatName(c.first_name, c.last_name)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.title ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.phone ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Remove from this opportunity (contact is not deleted)"
                      disabled={removeLink.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${formatName(c.first_name, c.last_name)} from this opportunity? The contact itself will not be deleted.`,
                          )
                        ) {
                          removeLink.mutate(c.id);
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
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
