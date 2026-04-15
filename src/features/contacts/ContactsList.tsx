import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState } from "@/hooks/useUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Users, Plus, Search } from "lucide-react";
import { useContacts, useArchiveContact, useBulkUpdateOwner, useBulkDeleteContacts } from "./api";
import { toast } from "sonner";
import { useUsers } from "@/features/accounts/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatName } from "@/lib/formatters";

const PAGE_SIZE = 25;

export function ContactsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [search, setSearch] = useUrlState("q", "");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: result, isLoading } = useContacts({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: users } = useUsers();
  const archiveMutation = useArchiveContact();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteContacts();

  const contacts = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!contacts) return;
    const allVisible = contacts.map((c) => c.id);
    const allSelected = allVisible.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisible.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisible.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => archiveMutation.mutateAsync({ id })));
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Permanently delete ${selectedIds.size} contact(s)? This cannot be undone.`)) return;
    await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} contact(s) deleted.`);
  };

  const handleBulkAssignOwner = async (userId: string) => {
    await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
    setSelectedIds(new Set());
  };

  const allChecked =
    !!contacts?.length && contacts.every((c) => selectedIds.has(c.id));

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="People at your accounts"
        actions={
          <Button onClick={() => navigate("/contacts/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Contact
          </Button>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !contacts?.length ? (
        <EmptyState
          icon={Users}
          title="No contacts found"
          description={search ? "Try a different search term" : "Add your first contact"}
          action={!search ? {
            label: "New Contact",
            onClick: () => navigate("/contacts/new"),
          } : undefined}
        />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id} className="cursor-pointer" onClick={() => navigate(`/contacts/${contact.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => toggleSelect(contact.id)}
                        aria-label={`Select ${contact.first_name} ${contact.last_name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/contacts/${contact.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {formatName(contact.first_name, contact.last_name)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {contact.account ? (
                        <Link
                          to={`/accounts/${contact.account.id}`}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {contact.account.name}
                        </Link>
                      ) : "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.title ?? "\u2014"}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email ?? "\u2014"}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.phone ?? "\u2014"}</TableCell>
                    <TableCell>
                      {contact.is_primary && (
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
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={totalCount}
            onPageChange={setPage}
          />
        </>
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        onArchive={isAdmin ? handleBulkArchive : undefined}
        onDelete={isAdmin ? handleBulkDelete : undefined}
        onAssignOwner={handleBulkAssignOwner}
        users={users}
      />
    </div>
  );
}
