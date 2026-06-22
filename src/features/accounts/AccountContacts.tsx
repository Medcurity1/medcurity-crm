import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users, Star, Archive } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Contact } from "@/types/crm";
import { useSetPrimaryContact, useArchiveContact } from "@/features/contacts/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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

/**
 * Contacts homed at this account (contacts.account_id = X).
 *
 * Contacts are 1:1 with accounts — if the same person needs to appear
 * at another account, reps just create a new contact under that
 * account. There is no cross-account linkage here on purpose.
 */
export function AccountContacts({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const setPrimary = useSetPrimaryContact();
  const archiveContact = useArchiveContact();
  const [archiveTarget, setArchiveTarget] = useState<Contact | null>(null);
  const { data: contacts, isLoading } = useQuery({
    queryKey: ["account-contacts", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("account_id", accountId)
        .is("archived_at", null)
        // Primary contact pinned to the top, then alphabetical by last name.
        .order("is_primary", { ascending: false })
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
  });

  if (isLoading)
    return <div className="text-sm text-muted-foreground">Loading contacts...</div>;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/contacts/new?account_id=${accountId}`)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Contact
        </Button>
      </div>

      {!contacts?.length ? (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
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
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                    {c.is_primary ? (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-100 text-emerald-700"
                      >
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        Primary
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        disabled={setPrimary.isPending}
                        onClick={() =>
                          setPrimary.mutate(
                            { id: c.id, accountId },
                            {
                              onSuccess: () =>
                                toast.success(
                                  `${formatName(c.first_name, c.last_name)} is now the primary contact.`,
                                ),
                              onError: (err: Error) =>
                                toast.error("Couldn't set primary", {
                                  description: err.message,
                                }),
                            },
                          )
                        }
                      >
                        <Star className="h-3 w-3 mr-1" />
                        Make primary
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Archive contact"
                      aria-label="Archive contact"
                      onClick={() => setArchiveTarget(c)}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title="Archive this contact?"
        description={
          archiveTarget
            ? `"${formatName(archiveTarget.first_name, archiveTarget.last_name)}" will be hidden from this account's contact list. Their emails and history are kept, and an admin can restore them.`
            : ""
        }
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          const t = archiveTarget;
          setArchiveTarget(null);
          if (!t) return;
          archiveContact.mutate(
            { id: t.id, reason: "Archived from account contacts" },
            {
              onSuccess: () =>
                toast.success(`${formatName(t.first_name, t.last_name)} archived.`),
              onError: (err: Error) =>
                toast.error("Couldn't archive contact", {
                  description: err.message,
                }),
            },
          );
        }}
      />
    </div>
  );
}
