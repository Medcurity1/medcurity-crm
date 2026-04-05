import { useState } from "react";
import {
  ListChecks,
  Plus,
  Search,
  Trash2,
  UserPlus,
  PlayCircle,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import {
  useLeadLists,
  useCreateLeadList,
  useDeleteLeadList,
  useLeadListMembers,
  useLeadListMemberCount,
  useAddToList,
  useRemoveFromList,
  useSearchLeadsForList,
} from "./lead-lists-api";
import { useSequences, useEnrollInSequence } from "@/features/sequences/sequences-api";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDate } from "@/lib/formatters";
import type { LeadList, LeadListMember } from "@/types/crm";

// ---------------------------------------------------------------------------
// Create list dialog
// ---------------------------------------------------------------------------

function CreateListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { profile } = useAuth();
  const createMutation = useCreateLeadList();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        owner_user_id: profile!.id,
      });
      toast.success("List created");
      setName("");
      setDescription("");
      onOpenChange(false);
    } catch {
      toast.error("Failed to create list");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Lead List</DialogTitle>
          <DialogDescription>
            Create a targeted list of leads for outreach.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Healthcare Prospects Q2"
            />
          </div>
          <div>
            <Label htmlFor="list-desc">Description</Label>
            <Textarea
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create List"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add leads dialog
// ---------------------------------------------------------------------------

function AddLeadsDialog({
  open,
  onOpenChange,
  listId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listId: string;
}) {
  const [search, setSearch] = useState("");
  const { data: results, isLoading } = useSearchLeadsForList(search);
  const addMutation = useAddToList();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Leads to List</DialogTitle>
          <DialogDescription>
            Search for leads by name, email, or company.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
            />
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : results && results.length > 0 ? (
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">
                        {lead.first_name} {lead.last_name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lead.email ?? "---"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lead.company ?? "---"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            addMutation.mutate(
                              { list_id: listId, lead_id: lead.id },
                              {
                                onSuccess: () => toast.success("Lead added"),
                                onError: () =>
                                  toast.error("Already in list or error"),
                              }
                            );
                          }}
                          disabled={addMutation.isPending}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : search.length >= 2 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No leads found.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Type at least 2 characters to search.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Enroll in sequence dialog
// ---------------------------------------------------------------------------

function EnrollSequenceDialog({
  open,
  onOpenChange,
  members,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: LeadListMember[];
}) {
  const { data: sequences } = useSequences();
  const enrollMutation = useEnrollInSequence();
  const { profile } = useAuth();

  async function handleEnroll(sequenceId: string) {
    let count = 0;
    for (const member of members) {
      try {
        await enrollMutation.mutateAsync({
          sequence_id: sequenceId,
          lead_id: member.lead_id,
          contact_id: member.contact_id,
          owner_user_id: profile?.id ?? null,
        });
        count++;
      } catch {
        // Skip duplicates or errors
      }
    }
    toast.success(`Enrolled ${count} member(s) in sequence`);
    onOpenChange(false);
  }

  const activeSequences = (sequences ?? []).filter((s) => s.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll in Sequence</DialogTitle>
          <DialogDescription>
            Enroll all {members.length} list member(s) in a sales sequence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {!activeSequences.length ? (
            <p className="text-sm text-muted-foreground">
              No active sequences. Create one first.
            </p>
          ) : (
            activeSequences.map((seq) => (
              <Button
                key={seq.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleEnroll(seq.id)}
                disabled={enrollMutation.isPending}
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                {seq.name} ({seq.steps.length} steps)
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// List detail view
// ---------------------------------------------------------------------------

function ListDetailView({
  list,
  onBack,
}: {
  list: LeadList;
  onBack: () => void;
}) {
  const { data: members, isLoading } = useLeadListMembers(list.id);
  const removeMutation = useRemoveFromList();
  const [showAddLeads, setShowAddLeads] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);

  function getName(m: LeadListMember): string {
    if (m.lead) return `${m.lead.first_name ?? ""} ${m.lead.last_name ?? ""}`.trim();
    if (m.contact) return `${m.contact.first_name ?? ""} ${m.contact.last_name ?? ""}`.trim();
    return "Unknown";
  }

  function getEmail(m: LeadListMember): string {
    if (m.lead) return m.lead.email ?? "";
    if (m.contact) return m.contact.email ?? "";
    return "";
  }

  function getCompany(m: LeadListMember): string {
    if (m.lead) return m.lead.company ?? "";
    if (m.contact) return m.contact.account?.name ?? "";
    return "";
  }

  function getPhone(m: LeadListMember): string {
    if (m.lead) return m.lead.phone ?? "";
    if (m.contact) return m.contact.phone ?? "";
    return "";
  }

  function getStatus(m: LeadListMember): string {
    if (m.lead) return m.lead.status ?? "";
    return "contact";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{list.name}</h2>
          {list.description && (
            <p className="text-sm text-muted-foreground">
              {list.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowEnroll(true)}
            disabled={!members?.length}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Enroll in Sequence
          </Button>
          <Button onClick={() => setShowAddLeads(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Leads
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !members?.length ? (
        <EmptyState
          icon={UserPlus}
          title="No members yet"
          description="Add leads to this list."
        />
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{getName(m)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {getEmail(m) || "---"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getCompany(m) || "---"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{getStatus(m)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {getPhone(m) || "---"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        removeMutation.mutate(
                          { memberId: m.id, listId: list.id },
                          {
                            onSuccess: () => toast.success("Removed from list"),
                          }
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddLeadsDialog
        open={showAddLeads}
        onOpenChange={setShowAddLeads}
        listId={list.id}
      />

      {members && (
        <EnrollSequenceDialog
          open={showEnroll}
          onOpenChange={setShowEnroll}
          members={members}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function LeadListsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedList, setSelectedList] = useState<LeadList | null>(null);
  const { data: lists, isLoading } = useLeadLists();
  const { data: memberCounts } = useLeadListMemberCount();
  const deleteMutation = useDeleteLeadList();

  if (selectedList) {
    return (
      <ListDetailView
        list={selectedList}
        onBack={() => setSelectedList(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Lists"
        description="Create targeted lists for outreach campaigns."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create List
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : !lists?.length ? (
        <EmptyState
          icon={ListChecks}
          title="No lead lists yet"
          description="Create your first list to organize leads for outreach."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedList(list)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ListChecks className="h-5 w-5 text-primary shrink-0" />
                    {list.name}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(list.id, {
                        onSuccess: () => toast.success("List deleted"),
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {list.description && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {list.description}
                  </p>
                )}
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{memberCounts?.[list.id] ?? 0} members</span>
                  <span>Created {formatDate(list.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateListDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
