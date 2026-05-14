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
import { Badge } from "@/components/ui/badge";
import { formatName } from "@/lib/formatters";
import { AddContactDialog } from "./AddContactDialog";

/**
 * A contact shown on the Account Contacts tab — either homed at this
 * account (contacts.account_id = X) or linked via
 * contact_account_links. The `link` field tells the UI which it is so
 * we can label them and offer "Remove from this account" only on
 * linked ones (removing a home contact would silently change their
 * account_id, which is what we're explicitly avoiding).
 */
type RowKind = "home" | "linked";
interface ContactRow extends Contact {
  link: RowKind;
}

export function AccountContacts({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: rows, isLoading } = useQuery<ContactRow[]>({
    queryKey: ["account-contacts", accountId],
    queryFn: async () => {
      // Two parallel reads — the "home" set (contacts.account_id = X)
      // plus everyone linked via contact_account_links. Merge in JS
      // with a dedupe on contact.id, preferring "home" labeling when
      // a contact is somehow both (shouldn't happen but cheap guard).
      const [homeRes, linkedRes] = await Promise.all([
        supabase
          .from("contacts")
          .select("*")
          .eq("account_id", accountId)
          .is("archived_at", null)
          .order("last_name"),
        supabase
          .from("contact_account_links")
          .select("added_at, contact:contacts!contact_id(*)")
          .eq("account_id", accountId),
      ]);
      if (homeRes.error) throw homeRes.error;
      if (linkedRes.error) throw linkedRes.error;

      const seen = new Set<string>();
      const out: ContactRow[] = [];
      for (const c of (homeRes.data ?? []) as Contact[]) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ ...c, link: "home" });
      }
      for (const r of linkedRes.data ?? []) {
        const c = (r as unknown as { contact: Contact | null }).contact;
        if (!c || seen.has(c.id) || c.archived_at) continue;
        seen.add(c.id);
        out.push({ ...c, link: "linked" });
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
        .from("contact_account_links")
        .delete()
        .eq("contact_id", contactId)
        .eq("account_id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact removed from this account");
      qc.invalidateQueries({ queryKey: ["account-contacts", accountId] });
      qc.invalidateQueries({ queryKey: ["contact-record-links"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (isLoading)
    return <div className="text-sm text-muted-foreground">Loading contacts...</div>;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Contact
        </Button>
      </div>

      <AddContactDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        recordKind="account"
        recordId={accountId}
      />

      {!rows?.length ? (
        <EmptyState
          icon={Users}
          title="No contacts"
          description="Add a contact to this account"
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
                <TableHead></TableHead>
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
                    <div className="flex gap-1">
                      {c.is_primary && (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-100 text-emerald-700"
                        >
                          Primary
                        </Badge>
                      )}
                      {c.link === "linked" && (
                        <Badge
                          variant="secondary"
                          className="bg-sky-100 text-sky-700"
                          title="This contact's home account is elsewhere; they're linked to this account."
                        >
                          Linked
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.link === "linked" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Remove from this account (contact is not deleted)"
                        disabled={removeLink.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${formatName(c.first_name, c.last_name)} from this account? The contact itself will not be deleted.`,
                            )
                          ) {
                            removeLink.mutate(c.id);
                          }
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
