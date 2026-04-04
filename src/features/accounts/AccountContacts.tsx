import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
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

export function AccountContacts({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts", { account_id: accountId }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("account_id", accountId)
        .order("last_name");
      if (error) throw error;
      return data as Contact[];
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading contacts...</div>;

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
                  <TableCell className="text-muted-foreground">{c.title ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                  <TableCell>
                    {c.is_primary && (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                        Primary
                      </Badge>
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
