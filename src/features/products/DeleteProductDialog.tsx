import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntriesForProduct, useProductReferences } from "./api";
import type { Product } from "@/types/crm";

/**
 * Three options surface here, depending on what the product is in:
 *
 * 1. Remove from one price book — for any product in any books.
 *    Just navigates to that book's matrix view.
 * 2. Archive — admin-only, recommended whenever the product is on
 *    any opportunity. Hides the product from non-admin pickers /
 *    lists / reports but preserves all opportunity_products line
 *    items so revenue history stays accurate.
 * 3. Hard delete — admin-only and only when zero opportunities
 *    reference the product. Optionally cascades through
 *    price_book_entries.
 */
export function DeleteProductDialog({
  product,
  isAdmin,
  onClose,
  onArchive,
  onDelete,
  isPending,
}: {
  product: Product | null;
  isAdmin: boolean;
  onClose: () => void;
  onArchive: (reason: string | null) => void;
  onDelete: (cascadeEntries: boolean) => void;
  isPending: boolean;
}) {
  const navigate = useNavigate();
  const { data: entries, isLoading: entriesLoading } = useEntriesForProduct(product?.id);
  const { data: refs, isLoading: refsLoading } = useProductReferences(product?.id);

  const isLoading = entriesLoading || refsLoading;
  const opportunityCount = refs?.opportunityCount ?? 0;
  const entryCount = refs?.entryCount ?? 0;
  const onAnyOpp = opportunityCount > 0;

  const byBook = useMemo(() => {
    const m = new Map<string, { id: string; name: string; entryCount: number }>();
    for (const e of entries ?? []) {
      const key = e.price_book_id;
      const existing = m.get(key);
      if (existing) {
        existing.entryCount += 1;
      } else {
        m.set(key, {
          id: e.price_book_id,
          name: e.price_book?.name ?? "Untitled Price Book",
          entryCount: 1,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  useEffect(() => {
    if (!product) {
      setConfirmingDelete(false);
      setArchiveReason("");
    }
  }, [product]);

  function navigateToBook(bookId: string) {
    onClose();
    navigate(`/products?tab=price_books&expand=${bookId}`);
  }

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove "{product?.name}"?</DialogTitle>
          <DialogDescription>
            Choose how to handle this product. We won't break revenue history on existing
            opportunities.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                <span className="font-medium">{opportunityCount}</span> opportunit
                {opportunityCount === 1 ? "y" : "ies"} reference this product
              </p>
              <p>
                <span className="font-medium">{entryCount}</span> price-book entr
                {entryCount === 1 ? "y" : "ies"} across {byBook.length} book
                {byBook.length === 1 ? "" : "s"}
              </p>
            </div>

            {byBook.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Remove from one price book</p>
                <p className="text-xs text-muted-foreground">
                  Opens that price book so you can remove just this product. Other prices stay.
                </p>
                <div className="border rounded-md divide-y">
                  {byBook.map((b) => (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => navigateToBook(b.id)}
                      className="w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors flex items-center justify-between gap-2"
                    >
                      <span>
                        <span className="font-medium">{b.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({b.entryCount} entr{b.entryCount === 1 ? "y" : "ies"})
                        </span>
                      </span>
                      <span className="text-xs text-primary">Open →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {byBook.length > 0 && <hr />}

            {isAdmin && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {onAnyOpp ? "Archive product (recommended)" : "Archive product"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Hides "{product?.name}" from product pickers, lists, and reports for everyone
                  except admins. Existing opportunity line items keep their pricing — revenue
                  history stays intact. You can unarchive any time.
                </p>
                <Input
                  placeholder="Reason (optional, e.g. 'discontinued 2026')"
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                />
                <Button
                  variant="default"
                  className="w-full"
                  onClick={() => onArchive(archiveReason.trim() || null)}
                  disabled={isPending}
                >
                  {isPending ? "Archiving..." : "Archive"}
                </Button>
              </div>
            )}

            {isAdmin && <hr />}

            {isAdmin && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {onAnyOpp ? "Or hard-delete (not recommended)" : "Or delete entirely"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {onAnyOpp ? (
                    <>
                      Blocked when the product is on any opportunity. Use Archive above to keep
                      revenue history intact.
                    </>
                  ) : (
                    <>
                      Permanently removes the product
                      {entryCount > 0
                        ? ` and clears it from ${byBook.length} price book${
                            byBook.length === 1 ? "" : "s"
                          }`
                        : ""}
                      . Cannot be undone. Safe because no opportunities reference it.
                    </>
                  )}
                </p>
                {!onAnyOpp &&
                  (!confirmingDelete ? (
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => setConfirmingDelete(true)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete permanently
                    </Button>
                  ) : (
                    <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                      <p className="text-sm font-medium text-destructive">
                        Really delete? Cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmingDelete(false)}
                          disabled={isPending}
                        >
                          Back
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="flex-1"
                          onClick={() => onDelete(entryCount > 0)}
                          disabled={isPending}
                        >
                          {isPending ? "Deleting..." : "Yes, delete forever"}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
