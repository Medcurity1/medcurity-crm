import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlNumberState, useUrlArrayState, useUrlState, useUrlSortState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Users, Plus, Search } from "lucide-react";
import { useContacts, useArchiveContact, useBulkUpdateOwner, useBulkDeleteContacts } from "./api";
import { toast } from "sonner";
import { useUsers } from "@/features/accounts/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { Pagination } from "@/components/Pagination";
import { formatPhone } from "@/components/PhoneInput";
import { BulkActionBar } from "@/components/BulkActionBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { SavedViews } from "@/features/saved-views/SavedViews";
import { ColumnPicker } from "@/features/list-columns/ColumnPicker";
import { useColumnPrefs } from "@/features/list-columns/useColumnPrefs";
import type { ColumnDescriptor } from "@/features/list-columns/columns";
import type { Contact } from "@/types/crm";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatName } from "@/lib/formatters";
import { ContactFlagBadges } from "./ContactFlagBadges";
import { useTags, useApplyTag, useContactTagsMap } from "@/features/tags/api";
import { TagChips } from "@/features/tags/TagChips";
import { TagPicker } from "@/features/tags/TagPicker";

const CONTACTS_COLUMNS: ColumnDescriptor[] = [
  { key: "select", label: "Select", locked: true, headClassName: "w-10" },
  { key: "name", label: "Name", sortKey: "last_name", locked: true },
  { key: "account", label: "Account", sortKey: "account.name" },
  { key: "title", label: "Title", sortKey: "title" },
  { key: "email", label: "Email", sortKey: "email" },
  { key: "phone", label: "Phone" },
  { key: "notes", label: "Notes" },
  { key: "tags", label: "Tags" },
  { key: "primary", label: "Primary" },
];

export function ContactsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [ownerFilter, setOwnerFilter] = useUrlArrayState("owner");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  const [statusFilter, setStatusFilter] = useUrlState("status", "active");
  const [tagFilter, setTagFilter] = useUrlArrayState("tags");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [pageSize, setPageSize] = useUrlNumberState("size", 25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk delete is confirmed via the app ConfirmDialog (not window.confirm)
  // so it matches the destructive-action pattern everywhere else.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Sort state is URL-backed (useUrlSortState) so a user can sort, drill
  // into a contact, then hit Back and find the list still sorted — plain
  // useState reset on every remount.
  const [sort, setSortState] = useUrlSortState("sort");
  const cols = useColumnPrefs("contacts", CONTACTS_COLUMNS);

  const { data: result, isLoading, isError, isFetching, refetch } = useContacts({
    search: search || undefined,
    ownerId: ownerFilter.length > 0 ? ownerFilter : undefined,
    verified:
      verifiedFilter === "verified"
        ? "true"
        : verifiedFilter === "unverified"
        ? "false"
        : undefined,
    archived:
      statusFilter === "archived"
        ? "archived"
        : statusFilter === "all"
        ? "all"
        : "active",
    tagIds: tagFilter.length > 0 ? tagFilter : undefined,
    page,
    pageSize,
    sortColumn: sort.column,
    // No sort in the URL → leave direction undefined so the API's
    // default (last_name ASC) applies instead of the hook's "desc".
    sortDirection: sort.column ? sort.direction : undefined,
  });
  const { data: users } = useUsers();
  const { data: allTags } = useTags();
  const applyTagMut = useApplyTag();
  const archiveMutation = useArchiveContact();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteContacts();

  const contacts = result?.data;
  const totalCount = result?.count ?? 0;
  // Tags for just this page's contacts, for the Tags column. Memoize the id
  // array so the tags query only refetches when the contacts actually change,
  // not on every render (a new array each render kept re-triggering the query).
  const contactIds = useMemo(() => (contacts ?? []).map((c) => c.id), [contacts]);
  const { data: tagsByContact } = useContactTagsMap(contactIds);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  function handleSort(next: SortState) {
    setSortState(next);
    setPage(0);
  }

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
    const count = ids.length;
    try {
      await Promise.all(ids.map((id) => archiveMutation.mutateAsync({ id })));
      setSelectedIds(new Set());
      toast.success(`${count} contact(s) archived.`);
    } catch (e) {
      // Keep the selection so the user can retry; surface why it failed.
      toast.error("Archive failed: " + (e as Error).message);
    }
  };

  // Opens the confirm dialog; the actual delete runs in doBulkDelete once
  // the user confirms.
  const handleBulkDelete = () => setConfirmBulkDelete(true);

  const doBulkDelete = async () => {
    // Capture the count BEFORE clearing the selection — reading selectedIds.size
    // after setSelectedIds(new Set()) showed "0 contact(s) deleted".
    const count = selectedIds.size;
    try {
      await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      toast.success(`${count} contact(s) deleted.`);
    } catch (e) {
      toast.error("Delete failed: " + (e as Error).message);
    }
  };

  const handleBulkAssignOwner = async (userId: string) => {
    const count = selectedIds.size;
    try {
      await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
      setSelectedIds(new Set());
      toast.success(`${count} contact(s) reassigned.`);
    } catch (e) {
      // Keep the selection so the user can retry; surface why it failed
      // instead of failing silently with the selection wiped.
      toast.error("Reassign failed: " + (e as Error).message);
    }
  };

  const allChecked =
    !!contacts?.length && contacts.every((c) => selectedIds.has(c.id));

  // Any filter narrowing the list — drives the empty-state copy so a
  // filtered-to-zero list says "adjust your filters", not "add your
  // first contact".
  const hasActiveFilters =
    !!search ||
    ownerFilter.length > 0 ||
    verifiedFilter !== "all" ||
    statusFilter !== "active" ||
    tagFilter.length > 0;

  const cellRenderers: Record<string, (c: Contact) => ReactNode> = {
    select: (c) => (
      <Checkbox
        checked={selectedIds.has(c.id)}
        onCheckedChange={() => toggleSelect(c.id)}
        aria-label={`Select ${c.first_name} ${c.last_name}`}
      />
    ),
    name: (c) => (
      <span className="inline-flex items-center gap-2">
        <Link
          to={`/contacts/${c.id}`}
          className="font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {formatName(c.first_name, c.last_name)}
        </Link>
        <ContactFlagBadges contact={c} />
      </span>
    ),
    account: (c) =>
      c.account ? (
        <Link
          to={`/accounts/${c.account.id}`}
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {c.account.name}
        </Link>
      ) : (
        "—"
      ),
    title: (c) => (
      <span className="text-muted-foreground">{c.title ?? "—"}</span>
    ),
    email: (c) => (
      <span
        className="block max-w-[240px] truncate text-muted-foreground"
        title={c.email ?? undefined}
      >
        {c.email ?? "—"}
      </span>
    ),
    phone: (c) => (
      <span className="text-muted-foreground">{c.phone ? formatPhone(c.phone) : "—"}</span>
    ),
    notes: (c) => (
      <span
        className="block max-w-[240px] truncate text-muted-foreground"
        title={c.notes ?? undefined}
      >
        {c.notes || "—"}
      </span>
    ),
    tags: (c) => {
      const list = tagsByContact?.get(c.id) ?? [];
      return list.length ? (
        <TagChips tags={list} className="max-w-[260px]" />
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
    primary: (c) =>
      c.is_primary ? (
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          Primary
        </Badge>
      ) : null,
  };

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

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative min-w-[220px] w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or title..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <MultiSelect
          value={ownerFilter}
          onChange={(v) => {
            setOwnerFilter(v);
            setPage(0);
          }}
          placeholder="All Owners"
          triggerClassName="w-40"
          options={[
            { value: "mine", label: "My Contacts" },
            ...(users ?? []).map((u) => ({
              value: u.id,
              label: u.full_name ?? "Unknown",
            })),
          ]}
        />
        <Select
          value={verifiedFilter}
          onValueChange={(v) => {
            setVerifiedFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Verified" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="verified">Verified only</SelectItem>
            <SelectItem value="unverified">Unverified only</SelectItem>
          </SelectContent>
        </Select>

        {isAdmin && (
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        )}

        <MultiSelect
          value={tagFilter}
          onChange={(v) => {
            setTagFilter(v);
            setPage(0);
          }}
          placeholder="All Tags"
          triggerClassName="w-36"
          options={(allTags ?? []).map((t) => ({ value: t.id, label: t.name }))}
        />

        <SavedViews entity="contacts" />
        <ColumnPicker columns={CONTACTS_COLUMNS} prefs={cols} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <QueryError
          message="Couldn't load contacts."
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      ) : !contacts?.length ? (
        <EmptyState
          icon={Users}
          title="No contacts found"
          description={hasActiveFilters ? "Try adjusting your search or filter" : "Add your first contact"}
          action={!hasActiveFilters ? {
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
                  {cols.visibleColumns.map((c) => {
                    if (c.key === "select") {
                      return (
                        <TableHead key="select" className="w-10">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={toggleAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                      );
                    }
                    return c.sortKey ? (
                      <SortableHeader
                        key={c.key}
                        column={c.sortKey}
                        sort={sort}
                        onSort={handleSort}
                        align={c.align}
                        className={c.headClassName}
                      >
                        {c.label}
                      </SortableHeader>
                    ) : (
                      <TableHead key={c.key} className={c.headClassName}>
                        {c.label}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id} className="cursor-pointer" onClick={() => navigate(`/contacts/${contact.id}`)}>
                    {cols.visibleColumns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={c.align === "right" ? "text-right" : undefined}
                        onClick={c.key === "select" ? (e) => e.stopPropagation() : undefined}
                      >
                        {cellRenderers[c.key]?.(contact)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
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
      >
        <TagPicker
          align="end"
          onPick={async (tag) => {
            const ids = Array.from(selectedIds);
            await applyTagMut.mutateAsync({ contactIds: ids, tagId: tag.id });
            toast.success(`Tagged ${ids.length} contact${ids.length === 1 ? "" : "s"} "${tag.name}"`);
            setSelectedIds(new Set());
          }}
          trigger={
            <Button variant="outline" size="sm">
              Add tag…
            </Button>
          }
        />
      </BulkActionBar>

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={(o) => !o && setConfirmBulkDelete(false)}
        title="Delete contacts?"
        description={`Permanently delete ${selectedIds.size} contact(s)? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmBulkDelete(false);
          void doBulkDelete();
        }}
      />
    </div>
  );
}
