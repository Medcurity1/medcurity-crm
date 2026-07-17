// Admin → Tags: the one place to see the whole tag vocabulary, how much
// each tag is used, rename typos, and delete accidental/stale tags
// (Nathan, 2026-07-17 — prep for the Jordan-list promotion batch tag).

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Tag } from "@/types/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { tagColorClass } from "./TagChips";
import { useTags, useTagUsageCounts, useUpdateTag, useDeleteTag } from "./api";

export function TagManager() {
  const { data: tags, isLoading } = useTags();
  const { data: counts } = useTagUsageCounts();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  function startRename(tag: Tag) {
    setEditingId(tag.id);
    setDraftName(tag.name);
  }

  async function saveRename(tag: Tag) {
    const name = draftName.trim();
    if (!name || name === tag.name) {
      setEditingId(null);
      return;
    }
    try {
      await updateTag.mutateAsync({ id: tag.id, name });
      toast.success(`Renamed to "${name}"`);
      setEditingId(null);
    } catch (e) {
      toast.error("Couldn't rename: " + (e as Error).message);
    }
  }

  const pendingUses = pendingDelete ? (counts?.get(pendingDelete.id) ?? 0) : 0;

  return (
    <Card className="p-6">
      <div className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold">Tags</h2>
        <p className="text-sm text-muted-foreground">
          The org-wide tag vocabulary for contacts. Renaming updates the tag
          everywhere it's applied; deleting removes it from every contact
          (the contacts themselves are untouched). Tags are applied from the
          Contacts list and contact pages.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : !tags?.length ? (
        <p className="text-sm text-muted-foreground">
          No tags yet — create one from the Contacts list ("Add tag").
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead className="w-32">Contacts</TableHead>
              <TableHead className="w-36">Created</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  {editingId === t.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(t);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8 max-w-xs"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => saveRename(t)}
                        disabled={updateTag.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge className={cn("border-transparent", tagColorClass(t.color))}>
                        {t.name}
                      </Badge>
                      {t.description && (
                        <span className="truncate text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {counts?.get(t.id) ?? "…"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(t.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => startRename(t)} title="Rename">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setPendingDelete(t)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete tag "${pendingDelete?.name ?? ""}"?`}
        description={
          pendingUses > 0
            ? `This removes the tag from ${pendingUses} contact${pendingUses === 1 ? "" : "s"}. The contacts themselves are not changed. This cannot be undone.`
            : "This tag isn't applied to any contacts. This cannot be undone."
        }
        confirmLabel="Delete tag"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteTag.mutateAsync(pendingDelete.id);
            toast.success(`Deleted "${pendingDelete.name}"`);
          } catch (e) {
            toast.error("Couldn't delete: " + (e as Error).message);
          } finally {
            setPendingDelete(null);
          }
        }}
      />
    </Card>
  );
}
