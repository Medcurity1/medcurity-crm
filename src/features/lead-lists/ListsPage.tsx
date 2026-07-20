import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ListChecks, Plus, Pencil, Trash2, X, Search, UserPlus2, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatPhone } from "@/components/PhoneInput";
import { cn } from "@/lib/utils";
import type { LeadList } from "@/types/crm";
import {
  useLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  useLeadListMembers,
  useLeadListMemberCount,
  useRemoveFromList,
  useSearchContactsForList,
  useBulkAddContactsToList,
} from "./lead-lists-api";

/**
 * Lists — the management home for call/contact lists (lead-type retirement
 * D2: lists are pure CONTACT lists now). The add-to-list flows on Contacts
 * and account Sales Status already existed; this page restores the missing
 * half: see every list, prune members, rename, delete, and add contacts
 * from the list side. The Cold Call widget reads the same lists.
 *
 * Note: removing a contact from its LAST list can auto-deactivate the
 * account's working status (Summer's design — membership drives
 * sales_active). That's intended; the footnote below says so.
 */

export function ListsPage() {
  const { data: lists, isLoading } = useLeadLists();
  const { data: counts } = useLeadListMemberCount();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = useMemo(
    () => lists?.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  return (
    <div>
      <PageHeader
        title="Lists"
        description="Call and contact lists. Adding a contact to a list marks its account as actively worked; the Cold Call widget pulls from these."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New list
          </Button>
        }
      />

      <CreateOrRenameListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !lists?.length ? (
        <EmptyState
          icon={ListChecks}
          title="No lists yet"
          description="Create a list here, or select contacts on the Contacts tab and use “Add to list”."
          action={{ label: "New list", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
          <Card>
            <CardContent className="p-2">
              <div className="space-y-1">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSelectedId(l.id)}
                    className={cn(
                      "w-full text-left rounded-md px-3 py-2 hover:bg-muted transition-colors",
                      selectedId === l.id && "bg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{l.name}</span>
                      <Badge variant="secondary">{counts?.[l.id] ?? 0}</Badge>
                    </div>
                    {l.description && (
                      <p className="text-xs text-muted-foreground truncate">{l.description}</p>
                    )}
                    {l.is_dynamic && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                        <Sparkles className="h-3 w-3" />
                        was a smart list (now static)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {selected ? (
            <ListDetail key={selected.id} list={selected} onDeleted={() => setSelectedId(null)} />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Select a list to see and manage its members.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ListDetail({ list, onDeleted }: { list: LeadList; onDeleted: () => void }) {
  const { data: members, isLoading } = useLeadListMembers(list.id);
  const removeMutation = useRemoveFromList();
  const deleteMutation = useDeleteLeadList();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: candidates } = useSearchContactsForList(search, list.id);
  const bulkAdd = useBulkAddContactsToList();

  const contactMembers = (members ?? []).filter((m) => m.contact);

  async function addCandidate(contactId: string) {
    try {
      await bulkAdd.mutateAsync({ list_id: list.id, contact_ids: [contactId] });
      toast.success("Added to list");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate">{list.name}</h3>
            {list.description && (
              <p className="text-sm text-muted-foreground">{list.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Rename
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete list
            </Button>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts to add..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
          {!!candidates?.length && (
            <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void addCandidate(c.id);
                    setSearch("");
                  }}
                >
                  <span className="truncate">
                    {c.first_name} {c.last_name}
                    {c.account?.name && (
                      <span className="text-muted-foreground"> — {c.account.name}</span>
                    )}
                  </span>
                  <UserPlus2 className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : contactMembers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No members yet — search above, or select contacts on the Contacts tab and “Add to list”.
          </p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactMembers.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link
                        to={`/contacts/${m.contact!.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {m.contact!.first_name} {m.contact!.last_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {(m.contact as { account?: { name?: string } | null })?.account?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{m.contact!.email ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {m.contact!.phone ? formatPhone(m.contact!.phone) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Remove from list"
                        disabled={removeMutation.isPending}
                        onClick={() =>
                          removeMutation.mutate(
                            { memberId: m.id, listId: list.id },
                            {
                              onSuccess: () => toast.success("Removed from list"),
                              onError: (e) => toast.error((e as Error).message),
                            },
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Heads up: removing a contact from its last list can switch its account back to
          not-actively-worked (that’s how Sales Status stays honest).
        </p>
      </CardContent>

      <CreateOrRenameListDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        existing={list}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${list.name}”?`}
        description="The list and its memberships go away; the contacts themselves are untouched. This can't be undone."
        confirmLabel="Delete list"
        destructive
        onConfirm={() =>
          deleteMutation.mutate(list.id, {
            onSuccess: () => {
              toast.success("List deleted");
              onDeleted();
            },
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
    </Card>
  );
}

function CreateOrRenameListDialog({
  open,
  onOpenChange,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: LeadList;
  onCreated?: (id: string) => void;
}) {
  const { user } = useAuth();
  const createMutation = useCreateLeadList();
  const updateMutation = useUpdateLeadList();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (existing) {
        await updateMutation.mutateAsync({
          id: existing.id,
          name: trimmed,
          description: description.trim() || null,
        });
        toast.success("List updated");
      } else {
        if (!user?.id) return;
        const created = await createMutation.mutateAsync({
          name: trimmed,
          description: description.trim() || undefined,
          owner_user_id: user.id,
        });
        toast.success("List created");
        onCreated?.(created.id);
        setName("");
        setDescription("");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Rename list" : "New list"}</DialogTitle>
          <DialogDescription>
            {existing
              ? "Update the list's name or description."
              : "A list groups contacts for calling or outreach."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. WA rural hospitals — Q3 calls"
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-desc">Description (optional)</Label>
            <Input
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
          >
            {existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
