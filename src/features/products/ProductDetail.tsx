import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Cloud, User, Package } from "lucide-react";
import {
  useProduct,
  useUpdateProduct,
  useDeleteProduct,
  useEntriesForProduct,
  useProductFamilies,
} from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrencyDetailed, formatDateTime } from "@/lib/formatters";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";

const PRICING_MODELS = [
  { value: "per_fte", label: "Per FTE" },
  { value: "flat_rate", label: "Flat Rate" },
  { value: "tiered", label: "Tiered" },
];

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const { data: product, isLoading } = useProduct(id);
  const { data: families } = useProductFamilies();
  const { data: entries } = useEntriesForProduct(id);
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading || !product) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  async function handleToggleActive(next: boolean) {
    if (!product) return;
    try {
      await updateMutation.mutateAsync({ id: product.id, is_active: next });
      toast.success(next ? "Marked active" : "Marked inactive");
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    }
  }

  async function handleDelete(cascade: boolean) {
    if (!product) return;
    try {
      await deleteMutation.mutateAsync({ id: product.id, cascade });
      toast.success(
        cascade
          ? `Deleted "${product.name}" and removed from all price books`
          : `Deleted "${product.name}"`
      );
      navigate("/products");
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.toLowerCase().includes("foreign") || msg.toLowerCase().includes("violates")) {
        toast.error("Can't delete — product is still in a price book. Use 'Delete + remove from price books' instead.");
      } else {
        toast.error("Failed: " + msg);
      }
      setConfirmDelete(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link
          to="/products"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Products
        </Link>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-xl">{product.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 font-mono">{product.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {product.sf_id ? (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 gap-1">
                  <Cloud className="h-3 w-3" /> Imported
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 gap-1">
                  <User className="h-3 w-3" /> Manual
                </Badge>
              )}
              <div className="flex items-center gap-2 ml-2">
                <Switch
                  checked={product.is_active}
                  disabled={!isAdmin}
                  onCheckedChange={handleToggleActive}
                  aria-label="Toggle active"
                />
                <Label className="text-sm text-muted-foreground">
                  {product.is_active ? "Active" : "Inactive"}
                </Label>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="related">
            Related {entries?.length ? `(${entries.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Family" value={product.product_family ?? "\u2014"} />
                <Field
                  label="Pricing Model"
                  value={
                    PRICING_MODELS.find((m) => m.value === product.pricing_model)?.label ??
                    product.pricing_model ??
                    "Per FTE"
                  }
                />
                <Field
                  label="Flat Price"
                  value={
                    product.has_flat_price
                      ? product.default_arr != null
                        ? formatCurrencyDetailed(product.default_arr)
                        : "Enabled (no price set)"
                      : "Off (priced via price books)"
                  }
                />
                <Field
                  label="Salesforce ID"
                  value={
                    <span className="font-mono text-xs">
                      {product.sf_id ?? "\u2014 (created in CRM)"}
                    </span>
                  }
                />
              </div>

              {product.description && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Description
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{product.description}</p>
                </div>
              )}

              <hr />

              <div>
                <h4 className="text-sm font-semibold mb-3">System Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  <Field
                    label="Created By"
                    value={product.creator?.full_name ?? (product.created_by ? "Unknown user" : "System / Import")}
                  />
                  <Field label="Created Date" value={formatDateTime(product.created_at)} />
                  <Field
                    label="Last Modified By"
                    value={product.updater?.full_name ?? (product.updated_by ? "Unknown user" : "—")}
                  />
                  <Field label="Last Modified Date" value={formatDateTime(product.updated_at)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="related" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price Books</CardTitle>
              <p className="text-sm text-muted-foreground">
                Books where this product has a defined price. Set prices from the Price Books tab on the main Products page.
              </p>
            </CardHeader>
            <CardContent>
              {!entries?.length ? (
                <p className="text-sm text-muted-foreground py-2">
                  This product isn't in any price book yet.
                </p>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Price Book</TableHead>
                        <TableHead>FTE Range</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">
                            {e.price_book?.name ?? e.price_book_id}
                            {e.price_book?.is_default && (
                              <Badge
                                variant="secondary"
                                className="ml-2 bg-blue-100 text-blue-700 text-xs"
                              >
                                Default
                              </Badge>
                            )}
                            {e.price_book && !e.price_book.is_active && (
                              <Badge
                                variant="secondary"
                                className="ml-2 bg-slate-100 text-slate-700 text-xs"
                              >
                                Inactive
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {e.fte_range ?? "All"}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrencyDetailed(e.unit_price)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <ProductEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        product={product}
        families={families ?? []}
      />

      {/* Delete confirmation */}
      <DeleteProductFlow
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        productName={product.name}
        entries={entries ?? []}
        isLoading={false}
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// Delete flow — shared with ProductsPage. Keeps the same UX:
// - List each price book as a "navigate here" entry
// - Plus a single destructive "Delete entirely" with a 2-click guard
// ──────────────────────────────────────────────

function DeleteProductFlow({
  open,
  onClose,
  productName,
  entries,
  isLoading,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  entries: Array<{
    id: string;
    price_book_id: string;
    price_book?: { id: string; name: string } | null;
  }>;
  isLoading: boolean;
  isPending: boolean;
  onConfirm: (cascade: boolean) => void;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const byBook = useMemo(() => {
    const m = new Map<string, { id: string; name: string; entryCount: number }>();
    for (const e of entries) {
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

  const inUse = byBook.length > 0;

  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  function navigateToBook(bookId: string) {
    onClose();
    navigate(`/products?tab=price_books&expand=${bookId}`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete "{productName}"?</DialogTitle>
          <DialogDescription>
            {inUse
              ? "This product is in one or more price books. Choose what you want to do."
              : "This product isn't in any price book. Safe to delete."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? null : inUse ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Remove from one price book</p>
              <p className="text-xs text-muted-foreground">
                Opens the price book and lets you remove just this product.
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

            <hr />

            <div className="space-y-2">
              <p className="text-sm font-medium">Or delete the product entirely</p>
              <p className="text-xs text-muted-foreground">
                Removes "{productName}" from all {byBook.length} price book
                {byBook.length === 1 ? "" : "s"} and deletes the product. Cannot be undone.
              </p>
              {!confirming ? (
                <Button
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                  disabled={isPending}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete product completely
                </Button>
              ) : (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    Really delete? This wipes {entries.length} price-book entr
                    {entries.length === 1 ? "y" : "ies"} too.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirming(false)}
                      disabled={isPending}
                    >
                      Back
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onConfirm(true)}
                      disabled={isPending}
                      className="flex-1"
                    >
                      {isPending ? "Deleting..." : "Yes, delete everything"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {!inUse && !isLoading && (
            <Button
              variant="destructive"
              onClick={() => onConfirm(false)}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Edit Dialog (mirrors the one on ProductsPage,
   but uses the family picklist + flat-price gate.
   ────────────────────────────────────────────── */

type ProductLike = {
  id: string;
  name: string;
  code: string;
  product_family: string | null;
  pricing_model: string | null;
  has_flat_price: boolean;
  default_arr: number | null;
  description: string | null;
};

function ProductEditDialog({
  open,
  onOpenChange,
  product,
  families,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: ProductLike;
  families: Array<{ id: string; name: string }>;
}) {
  const updateMutation = useUpdateProduct();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [family, setFamily] = useState<string>("");
  const [pricingModel, setPricingModel] = useState("per_fte");
  const [hasFlatPrice, setHasFlatPrice] = useState(false);
  const [defaultArr, setDefaultArr] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name ?? "");
    setCode(product.code ?? "");
    setFamily(product.product_family ?? "");
    setPricingModel(product.pricing_model ?? "per_fte");
    setHasFlatPrice(product.has_flat_price ?? false);
    setDefaultArr(
      product.default_arr != null ? String(product.default_arr) : ""
    );
    setDescription(product.description ?? "");
  }, [open, product]);

  async function handleSave() {
    if (!name.trim() || !code.trim()) {
      toast.error("Name and Code are required");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: product.id,
        name: name.trim(),
        code: code.trim(),
        product_family: family || null,
        pricing_model: pricingModel,
        has_flat_price: hasFlatPrice,
        default_arr: hasFlatPrice && defaultArr ? Number(defaultArr) : null,
        description: description.trim() || null,
      });
      toast.success("Product updated");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
          <DialogDescription>Update product details.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ed-name">Name *</Label>
              <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-code">Code *</Label>
              <Input id="ed-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Family</Label>
              <Select
                value={family || "none"}
                onValueChange={(v) => setFamily(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {families.map((f) => (
                    <SelectItem key={f.id} value={f.name}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Pricing Model</Label>
              <Select value={pricingModel} onValueChange={setPricingModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center gap-2 mb-2">
              <Switch
                id="ed-flat"
                checked={hasFlatPrice}
                onCheckedChange={setHasFlatPrice}
              />
              <Label htmlFor="ed-flat" className="cursor-pointer text-sm font-medium">
                Use flat price
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              When off, this product is priced via price book entries. Turn on only if it has one
              fixed price across every opportunity.
            </p>
            <div className="space-y-2">
              <Label htmlFor="ed-arr" className={!hasFlatPrice ? "text-muted-foreground" : ""}>
                Flat Price (ARR)
              </Label>
              <Input
                id="ed-arr"
                type="number"
                step="0.01"
                disabled={!hasFlatPrice}
                value={defaultArr}
                onChange={(e) => setDefaultArr(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ed-desc">Description</Label>
            <Textarea
              id="ed-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this product? Reps will see this when adding to opportunities."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
