import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Trash2, ChevronDown, ChevronRight, Package, Cloud, User, Settings, X } from "lucide-react";
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useArchiveProduct,
  useUnarchiveProduct,
  useEntriesForProduct,
  useProductFamilies,
  useCreateProductFamily,
  useDeleteProductFamily,
  usePriceBooks,
  useCreatePriceBook,
  useUpdatePriceBook,
  usePriceBookEntries,
  useSetPriceBookEntryPrice,
} from "./api";
import { DeleteProductDialog } from "./DeleteProductDialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrencyDetailed, formatDate } from "@/lib/formatters";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";
import type { Product, PriceBook } from "@/types/crm";


const PRICING_MODELS = [
  { value: "per_fte", label: "Per FTE" },
  { value: "flat_rate", label: "Flat Rate" },
  { value: "tiered", label: "Tiered" },
];

/* ──────────────────────────────────────────────
   Products Page (default export for lazy loading)
   ────────────────────────────────────────────── */

export function ProductsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "price_books" ? "price_books" : "products";
  const expandPriceBookId = searchParams.get("expand");

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === "products") {
      params.delete("tab");
      params.delete("expand");
    } else {
      params.set("tab", next);
    }
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="Products & Price Books"
        description="Manage your product catalog and pricing"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="price_books">Price Books</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <ProductsTab isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="price_books" className="mt-4">
          <PriceBooksTab isAdmin={isAdmin} initialExpandId={expandPriceBookId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Products Tab
   ────────────────────────────────────────────── */

function ProductsTab({ isAdmin }: { isAdmin: boolean }) {
  const [showInactive, setShowInactive] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { data: products, isLoading } = useProducts({
    includeInactive: showInactive,
    includeArchived: isAdmin && showArchived,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [familiesOpen, setFamiliesOpen] = useState(false);
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const archiveMutation = useArchiveProduct();
  const unarchiveMutation = useUnarchiveProduct();

  function openNew() {
    setEditingProduct(null);
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setDialogOpen(true);
  }

  async function handleToggleActive(product: Product, next: boolean) {
    try {
      await updateMutation.mutateAsync({ id: product.id, is_active: next });
      toast.success(next ? "Marked active" : "Marked inactive");
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    }
  }

  async function handleArchive(reason: string | null) {
    if (!deleteTarget) return;
    try {
      await archiveMutation.mutateAsync({ id: deleteTarget.id, reason });
      toast.success(`Archived "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error("Failed to archive: " + errorMessage(err));
    }
  }

  async function handleDelete(cascadeEntries: boolean) {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, cascade: cascadeEntries });
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.toLowerCase().includes("foreign") || msg.toLowerCase().includes("violates")) {
        toast.error(
          "Can't delete — product is on an opportunity. Use Archive instead to preserve revenue history."
        );
      } else {
        toast.error("Failed to delete: " + msg);
      }
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const importedCount = products?.filter((p) => p.sf_id).length ?? 0;
  const manualCount = (products?.length ?? 0) - importedCount;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
              Show inactive
            </Label>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-archived"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              <Label
                htmlFor="show-archived"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Show archived (admin)
              </Label>
            </div>
          )}
          {(importedCount > 0 || manualCount > 0) && (
            <p className="text-sm text-muted-foreground">
              {importedCount} imported · {manualCount} manual
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setFamiliesOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Families
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </div>
        )}
      </div>

      {!products?.length ? (
        <EmptyState
          icon={Package}
          title="No products found"
          description="Add your first product to get started"
          action={
            isAdmin
              ? { label: "Add Product", onClick: openNew }
              : undefined
          }
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Pricing Model</TableHead>
                <TableHead className="text-right">Flat Price</TableHead>
                <TableHead className="text-center">Active</TableHead>
                {isAdmin && <TableHead className="w-32" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.flatMap((product) => {
                const isExpanded = expandedId === product.id;
                return [
                  <TableRow key={product.id} className="cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : product.id)}>
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium" onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/products/${product.id}`}
                          className="hover:underline text-foreground"
                        >
                          {product.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.code}</TableCell>
                      <TableCell className="text-muted-foreground">{product.product_family ?? "\u2014"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {product.sf_id ? (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 gap-1">
                              <Cloud className="h-3 w-3" /> Imported
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-700 gap-1">
                              <User className="h-3 w-3" /> Manual
                            </Badge>
                          )}
                          {product.archived_at && (
                            <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                              Archived
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {PRICING_MODELS.find((m) => m.value === product.pricing_model)?.label ?? product.pricing_model ?? "Per FTE"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {product.has_flat_price && product.default_arr != null
                          ? formatCurrencyDetailed(product.default_arr)
                          : "\u2014"}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={product.is_active}
                          disabled={!isAdmin || updateMutation.isPending}
                          onCheckedChange={(v) => handleToggleActive(product, v)}
                          aria-label="Toggle active"
                        />
                      </TableCell>
                      {isAdmin && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            {product.archived_at ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={unarchiveMutation.isPending}
                                onClick={async () => {
                                  try {
                                    await unarchiveMutation.mutateAsync(product.id);
                                    toast.success(`Unarchived "${product.name}"`);
                                  } catch (err) {
                                    toast.error("Failed: " + errorMessage(err));
                                  }
                                }}
                              >
                                Unarchive
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                                Edit
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(product)}
                              aria-label="Delete product"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                  </TableRow>,
                  ...(isExpanded ? [
                    <TableRow key={product.id + "-detail"} className="bg-muted/20 hover:bg-muted/20">
                      <TableCell />
                      <TableCell colSpan={isAdmin ? 8 : 7} className="py-4">
                        <ProductDetailPanel product={product} />
                      </TableCell>
                    </TableRow>
                  ] : []),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
      />

      <DeleteProductDialog
        product={deleteTarget}
        isAdmin={isAdmin}
        onClose={() => setDeleteTarget(null)}
        onArchive={handleArchive}
        onDelete={handleDelete}
        isPending={deleteMutation.isPending || archiveMutation.isPending}
      />

      <ManageFamiliesDialog open={familiesOpen} onOpenChange={setFamiliesOpen} />
    </>
  );
}

/* ──────────────────────────────────────────────
   Manage Families Dialog
   ────────────────────────────────────────────── */

function ManageFamiliesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: families, isLoading } = useProductFamilies();
  const createFam = useCreateProductFamily();
  const deleteFam = useDeleteProductFamily();
  const [newName, setNewName] = useState("");

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createFam.mutateAsync(name);
      setNewName("");
      toast.success("Family added");
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        toast.error("That family already exists");
      } else {
        toast.error("Failed: " + msg);
      }
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFam.mutateAsync(id);
      toast.success("Family removed");
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Product Families</DialogTitle>
          <DialogDescription>
            Add or remove the picklist values reps see when assigning a Family to a product. Removing a family won't change products already using it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="New family name (e.g. Add-on)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button onClick={handleAdd} disabled={createFam.isPending || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !families?.length ? (
            <p className="text-sm text-muted-foreground py-2">No families yet.</p>
          ) : (
            <div className="border rounded-lg divide-y">
              {families.map((f) => (
                <div key={f.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{f.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(f.id)}
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────
   Product Detail Panel (inline expand)
   ────────────────────────────────────────────── */

function ProductDetailPanel({ product }: { product: Product }) {
  const { data: entries, isLoading } = useEntriesForProduct(product.id);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Flat Price</p>
          <p>
            {product.has_flat_price
              ? product.default_arr != null
                ? formatCurrencyDetailed(product.default_arr)
                : "Enabled"
              : "Off"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Salesforce ID</p>
          <p className="font-mono text-xs">{product.sf_id ?? "\u2014 (created in CRM)"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Created</p>
          <p>{formatDate(product.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Updated</p>
          <p>{formatDate(product.updated_at)}</p>
        </div>
      </div>
      <div>
        <Link
          to={`/products/${product.id}`}
          className="text-xs text-primary hover:underline"
        >
          Open full detail page →
        </Link>
      </div>

      {product.description && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm whitespace-pre-wrap">{product.description}</p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Used in Price Books</p>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : !entries?.length ? (
          <p className="text-sm text-muted-foreground">Not in any price book yet.</p>
        ) : (
          <div className="border rounded bg-background">
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
                        <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700 text-xs">Default</Badge>
                      )}
                      {e.price_book && !e.price_book.is_active && (
                        <Badge variant="secondary" className="ml-2 bg-slate-100 text-slate-700 text-xs">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.fte_range ?? "All"}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetailed(e.unit_price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Product Dialog (Create / Edit)
   ────────────────────────────────────────────── */

function ProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
}) {
  const isEditing = !!product;
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const { data: families } = useProductFamilies();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [family, setFamily] = useState("");
  const [pricingModel, setPricingModel] = useState("per_fte");
  const [hasFlatPrice, setHasFlatPrice] = useState(false);
  const [defaultArr, setDefaultArr] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sync form state from product prop whenever the dialog opens.
  // Previously this lived in onOpenChange, but Radix only fires that
  // when the dialog state changes from inside (close, escape, click out)
  // — NOT when the parent flips `open` to true. So opening via an Edit
  // button left the form blank.
  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setCode(product.code);
      setFamily(product.product_family ?? "");
      setPricingModel(product.pricing_model ?? "per_fte");
      setHasFlatPrice(product.has_flat_price ?? false);
      setDefaultArr(product.default_arr != null ? String(product.default_arr) : "");
      setDescription(product.description ?? "");
      setIsActive(product.is_active);
    } else {
      setName("");
      setCode("");
      setFamily("");
      setPricingModel("per_fte");
      setHasFlatPrice(false);
      setDefaultArr("");
      setDescription("");
      setIsActive(true);
    }
  }, [open, product]);

  async function handleSave() {
    if (!name.trim() || !code.trim()) {
      toast.error("Name and Code are required");
      return;
    }

    const payload = {
      name: name.trim(),
      code: code.trim(),
      product_family: family || null,
      pricing_model: pricingModel,
      has_flat_price: hasFlatPrice,
      default_arr: hasFlatPrice && defaultArr ? Number(defaultArr) : null,
      description: description.trim() || null,
      is_active: isActive,
    };

    try {
      if (isEditing && product) {
        await updateMutation.mutateAsync({ id: product.id, ...payload });
        toast.success("Product updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Product created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save product: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Product" : "Add Product"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update product details." : "Add a new product to the catalog."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-name">Name *</Label>
              <Input id="prod-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-code">Code *</Label>
              <Input id="prod-code" value={code} onChange={(e) => setCode(e.target.value)} />
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
                  {(families ?? []).map((f) => (
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
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <Switch
                id="prod-flat"
                checked={hasFlatPrice}
                onCheckedChange={setHasFlatPrice}
              />
              <Label htmlFor="prod-flat" className="cursor-pointer text-sm font-medium">
                Use flat price
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              When off, this product is priced via price book entries. Turn on only if it has one fixed price across every opportunity.
            </p>
            <div className="space-y-2">
              <Label htmlFor="prod-arr" className={!hasFlatPrice ? "text-muted-foreground" : ""}>
                Flat Price (ARR)
              </Label>
              <Input
                id="prod-arr"
                type="number"
                step="0.01"
                disabled={!hasFlatPrice}
                value={defaultArr}
                onChange={(e) => setDefaultArr(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prod-desc">Description</Label>
            <Textarea
              id="prod-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this product? Reps will see this when adding to opportunities."
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="prod-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="prod-active" className="cursor-pointer">Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
            {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : isEditing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────
   Price Books Tab
   ────────────────────────────────────────────── */

function PriceBooksTab({
  isAdmin,
  initialExpandId,
}: {
  isAdmin: boolean;
  initialExpandId?: string | null;
}) {
  const { data: priceBooks, isLoading } = usePriceBooks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPb, setEditingPb] = useState<PriceBook | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandId ?? null);

  // If the URL says to expand a specific price book (e.g. user clicked
  // "Manage in this price book" from the delete dialog), open it once
  // the price books load.
  useEffect(() => {
    if (initialExpandId && priceBooks?.some((p) => p.id === initialExpandId)) {
      setExpandedId(initialExpandId);
    }
  }, [initialExpandId, priceBooks]);

  function openNew() {
    setEditingPb(null);
    setDialogOpen(true);
  }

  function openEdit(pb: PriceBook) {
    setEditingPb(pb);
    setDialogOpen(true);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        {isAdmin && (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            Add Price Book
          </Button>
        )}
      </div>

      {!priceBooks?.length ? (
        <EmptyState
          icon={Package}
          title="No price books yet"
          description="Create your first price book to define FTE-range pricing"
          action={isAdmin ? { label: "Add Price Book", onClick: openNew } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {priceBooks.map((pb) => (
            <PriceBookCard
              key={pb.id}
              priceBook={pb}
              isAdmin={isAdmin}
              expanded={expandedId === pb.id}
              onToggle={() => setExpandedId(expandedId === pb.id ? null : pb.id)}
              onEdit={() => openEdit(pb)}
            />
          ))}
        </div>
      )}

      <PriceBookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        priceBook={editingPb}
      />
    </>
  );
}

/* ──────────────────────────────────────────────
   Price Book Card
   ────────────────────────────────────────────── */

function PriceBookCard({
  priceBook,
  isAdmin,
  expanded,
  onToggle,
  onEdit,
}: {
  priceBook: PriceBook;
  isAdmin: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
            <CardTitle className="text-base">{priceBook.name}</CardTitle>
            {priceBook.is_default && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">Default</Badge>
            )}
            {priceBook.is_active ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Active</Badge>
            ) : (
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">Inactive</Badge>
            )}
          </button>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
        {priceBook.description && (
          <p className="text-sm text-muted-foreground mt-1 ml-6">{priceBook.description}</p>
        )}
        {priceBook.effective_date && (
          <p className="text-xs text-muted-foreground ml-6">
            Effective: {formatDate(priceBook.effective_date)}
          </p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent>
          <PriceBookEntriesSection priceBook={priceBook} isAdmin={isAdmin} />
        </CardContent>
      )}
    </Card>
  );
}

/* ──────────────────────────────────────────────
   Price Book Entries Section (within expanded card)
   ────────────────────────────────────────────── */

function PriceBookEntriesSection({
  priceBook,
  isAdmin,
}: {
  priceBook: PriceBook;
  isAdmin: boolean;
}) {
  const priceBookId = priceBook.id;
  // Default fte_range for new entries: book's own fte_range, else null.
  const defaultFteRange = priceBook.fte_range ?? null;

  const { data: entries, isLoading: entriesLoading } = usePriceBookEntries(priceBookId);
  const { data: products, isLoading: productsLoading } = useProducts();
  const setPrice = useSetPriceBookEntryPrice();

  const [showInactive, setShowInactive] = useState(false);
  const [hideUnpriced, setHideUnpriced] = useState(false);
  const [filter, setFilter] = useState("");

  if (entriesLoading || productsLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  // Build a map of product_id -> entry (only counting entries that match
  // this book's default fte_range, since we treat the book as scoped to
  // one tier). Entries with a different fte_range are still listed for
  // visibility but not editable inline (rare edge case).
  const entryByProduct = new Map<string, NonNullable<typeof entries>[number]>();
  for (const e of entries ?? []) {
    if ((e.fte_range ?? null) === defaultFteRange) {
      entryByProduct.set(e.product_id, e);
    }
  }
  const offTierEntries =
    entries?.filter((e) => (e.fte_range ?? null) !== defaultFteRange) ?? [];

  const visibleProducts = (products ?? []).filter((p) => {
    if (!showInactive && !p.is_active) return false;
    const matchesFilter =
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      (p.product_family ?? "").toLowerCase().includes(filter.toLowerCase());
    if (!matchesFilter) return false;
    const hasEntry = entryByProduct.has(p.id);
    if (hideUnpriced && !hasEntry) return false;
    return true;
  });

  const pricedCount = entryByProduct.size;
  const totalActive = (products ?? []).filter((p) => p.is_active).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter products..."
          className="max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Switch
            id={`pb-${priceBookId}-hide`}
            checked={hideUnpriced}
            onCheckedChange={setHideUnpriced}
          />
          <Label
            htmlFor={`pb-${priceBookId}-hide`}
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Only priced
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`pb-${priceBookId}-inactive`}
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <Label
            htmlFor={`pb-${priceBookId}-inactive`}
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Show inactive products
          </Label>
        </div>
        <p className="text-xs text-muted-foreground ml-auto">
          {pricedCount} priced · {totalActive} active products
          {defaultFteRange ? ` · FTE range ${defaultFteRange}` : ""}
        </p>
      </div>

      {!visibleProducts.length ? (
        <p className="text-sm text-muted-foreground py-2">No products to show.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Family</TableHead>
                <TableHead className="text-right w-48">Unit Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProducts.map((product) => {
                const entry = entryByProduct.get(product.id);
                return (
                  <PriceBookEntryRow
                    key={product.id}
                    product={product}
                    existingEntry={entry ?? null}
                    priceBookId={priceBookId}
                    fteRange={defaultFteRange}
                    isAdmin={isAdmin}
                    saveMutation={setPrice}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {offTierEntries.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {offTierEntries.length} entries on other FTE ranges (read-only here)
          </summary>
          <div className="border rounded-lg overflow-x-auto mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>FTE Range</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offTierEntries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.product?.name ?? e.product_id}
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
        </details>
      )}
    </div>
  );
}

function PriceBookEntryRow({
  product,
  existingEntry,
  priceBookId,
  fteRange,
  isAdmin,
  saveMutation,
}: {
  product: Product;
  existingEntry: { id: string; unit_price: number } | null;
  priceBookId: string;
  fteRange: string | null;
  isAdmin: boolean;
  saveMutation: ReturnType<typeof useSetPriceBookEntryPrice>;
}) {
  const initialValue = existingEntry ? String(existingEntry.unit_price) : "";
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  // Sync draft when the underlying entry changes (e.g. fresh load).
  useEffect(() => {
    setDraft(initialValue);
  }, [initialValue]);

  const isDirty = draft !== initialValue;

  async function commit() {
    if (!isDirty) return;
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error("Enter a valid price");
      setDraft(initialValue);
      return;
    }
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        price_book_id: priceBookId,
        product_id: product.id,
        fte_range: fteRange,
        unit_price: next,
        existing_entry_id: existingEntry?.id ?? null,
      });
      // Don't toast on every blur — too noisy in matrix mode.
    } catch (err) {
      toast.error(
        `Failed to save "${product.name}": ` +
          errorMessage(err)
      );
      setDraft(initialValue);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link to={`/products/${product.id}`} className="hover:underline">
          {product.name}
        </Link>
        {!product.is_active && (
          <Badge variant="secondary" className="ml-2 bg-slate-100 text-slate-700 text-xs">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {product.product_family ?? "\u2014"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {existingEntry && !isDirty && !saving && (
            <span className="text-xs text-emerald-600">saved</span>
          )}
          {saving && <span className="text-xs text-muted-foreground">saving…</span>}
          {isDirty && !saving && (
            <span className="text-xs text-amber-600">unsaved</span>
          )}
          <Input
            type="number"
            step="0.01"
            placeholder="—"
            disabled={!isAdmin || saving}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setDraft(initialValue);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="max-w-[140px] text-right"
          />
          {/* Explicit remove button when there's a saved entry. Faster
              and more discoverable than "clear the input + tab out". */}
          {existingEntry && isAdmin ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveMutation.mutateAsync({
                    price_book_id: priceBookId,
                    product_id: product.id,
                    fte_range: fteRange,
                    unit_price: null,
                    existing_entry_id: existingEntry.id,
                  });
                  setDraft("");
                } catch (err) {
                  toast.error(`Failed to remove: ${errorMessage(err)}`);
                } finally {
                  setSaving(false);
                }
              }}
              title="Remove from this price book"
              aria-label={`Remove ${product.name} from this price book`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <span className="w-7" /> /* spacer keeps inputs aligned */
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ──────────────────────────────────────────────
   Price Book Dialog (Create / Edit)
   ────────────────────────────────────────────── */

function PriceBookDialog({
  open,
  onOpenChange,
  priceBook,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  priceBook: PriceBook | null;
}) {
  const isEditing = !!priceBook;
  const createMutation = useCreatePriceBook();
  const updateMutation = useUpdatePriceBook();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Sync from prop on open — see ProductDialog comment for why useEffect
  // (controlled-open Radix doesn't fire onOpenChange).
  useEffect(() => {
    if (!open) return;
    if (priceBook) {
      setName(priceBook.name);
      setDescription(priceBook.description ?? "");
      setEffectiveDate(priceBook.effective_date ?? "");
      setIsDefault(priceBook.is_default);
      setIsActive(priceBook.is_active);
    } else {
      setName("");
      setDescription("");
      setEffectiveDate("");
      setIsDefault(false);
      setIsActive(true);
    }
  }, [open, priceBook]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      effective_date: effectiveDate || null,
      is_default: isDefault,
      is_active: isActive,
    };

    try {
      if (isEditing && priceBook) {
        await updateMutation.mutateAsync({ id: priceBook.id, ...payload });
        toast.success("Price book updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Price book created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save price book: " + errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Price Book" : "Add Price Book"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update price book details." : "Create a new price book for FTE-range pricing."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="pb-name">Name *</Label>
            <Input id="pb-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pb-desc">Description</Label>
            <Textarea id="pb-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pb-date">Effective Date</Label>
            <Input id="pb-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="pb-default" checked={isDefault} onCheckedChange={setIsDefault} />
              <Label htmlFor="pb-default" className="cursor-pointer">Default</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="pb-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="pb-active" className="cursor-pointer">Active</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
            {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : isEditing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
