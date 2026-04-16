import { useState } from "react";
import { Plus, Trash2, ChevronDown, Package } from "lucide-react";
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  usePriceBooks,
  useCreatePriceBook,
  useUpdatePriceBook,
  usePriceBookEntries,
  useCreatePriceBookEntry,
  useDeletePriceBookEntry,
} from "./api";
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
import { toast } from "sonner";
import type { Product, PriceBook } from "@/types/crm";

const FTE_RANGES = ["1-20", "21-50", "51-100", "101-250", "251-500", "501+"] as const;

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

  return (
    <div>
      <PageHeader
        title="Products & Price Books"
        description="Manage your product catalog and pricing"
      />

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="price_books">Price Books</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <ProductsTab isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="price_books" className="mt-4">
          <PriceBooksTab isAdmin={isAdmin} />
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
  const { data: products, isLoading } = useProducts(showInactive);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  function openNew() {
    setEditingProduct(null);
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setDialogOpen(true);
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

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
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
        </div>
        {isAdmin && (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
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
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Pricing Model</TableHead>
                <TableHead className="text-right">Default ARR</TableHead>
                <TableHead className="text-center">Active</TableHead>
                {isAdmin && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">{product.code}</TableCell>
                  <TableCell className="text-muted-foreground">{product.product_family ?? "\u2014"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {PRICING_MODELS.find((m) => m.value === product.pricing_model)?.label ?? product.pricing_model ?? "Per FTE"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {product.default_arr != null ? formatCurrencyDetailed(product.default_arr) : "\u2014"}
                  </TableCell>
                  <TableCell className="text-center">
                    {product.is_active ? (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700">Inactive</Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
      />
    </>
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

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [family, setFamily] = useState("");
  const [category, setCategory] = useState("");
  const [pricingModel, setPricingModel] = useState("per_fte");
  const [defaultArr, setDefaultArr] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Reset form when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      if (product) {
        setName(product.name);
        setCode(product.code);
        setFamily(product.product_family ?? "");
        setCategory(product.category ?? "");
        setPricingModel(product.pricing_model ?? "per_fte");
        setDefaultArr(product.default_arr != null ? String(product.default_arr) : "");
        setDescription(product.description ?? "");
        setIsActive(product.is_active);
      } else {
        setName("");
        setCode("");
        setFamily("");
        setCategory("");
        setPricingModel("per_fte");
        setDefaultArr("");
        setDescription("");
        setIsActive(true);
      }
    }
    onOpenChange(v);
  };

  async function handleSave() {
    if (!name.trim() || !code.trim()) {
      toast.error("Name and Code are required");
      return;
    }

    const payload = {
      name: name.trim(),
      code: code.trim(),
      product_family: family.trim() || null,
      category: category.trim() || null,
      pricing_model: pricingModel,
      default_arr: defaultArr ? Number(defaultArr) : null,
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
      toast.error("Failed to save product: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              <Label htmlFor="prod-family">Family</Label>
              <Input id="prod-family" value={family} onChange={(e) => setFamily(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-category">Category</Label>
              <Input id="prod-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="prod-arr">Default ARR</Label>
              <Input id="prod-arr" type="number" step="0.01" value={defaultArr} onChange={(e) => setDefaultArr(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prod-desc">Description</Label>
            <Textarea id="prod-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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

function PriceBooksTab({ isAdmin }: { isAdmin: boolean }) {
  const { data: priceBooks, isLoading } = usePriceBooks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPb, setEditingPb] = useState<PriceBook | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          <PriceBookEntriesSection priceBookId={priceBook.id} isAdmin={isAdmin} />
        </CardContent>
      )}
    </Card>
  );
}

/* ──────────────────────────────────────────────
   Price Book Entries Section (within expanded card)
   ────────────────────────────────────────────── */

function PriceBookEntriesSection({
  priceBookId,
  isAdmin,
}: {
  priceBookId: string;
  isAdmin: boolean;
}) {
  const { data: entries, isLoading } = usePriceBookEntries(priceBookId);
  const { data: products } = useProducts();
  const createEntry = useCreatePriceBookEntry();
  const deleteEntry = useDeletePriceBookEntry();
  const [showAdd, setShowAdd] = useState(false);
  const [newProductId, setNewProductId] = useState("");
  const [newFteRange, setNewFteRange] = useState("");
  const [newUnitPrice, setNewUnitPrice] = useState("");

  async function handleAddEntry() {
    if (!newProductId || !newUnitPrice) {
      toast.error("Product and unit price are required");
      return;
    }
    try {
      await createEntry.mutateAsync({
        price_book_id: priceBookId,
        product_id: newProductId,
        fte_range: newFteRange || null,
        unit_price: Number(newUnitPrice),
      });
      toast.success("Entry added");
      setShowAdd(false);
      setNewProductId("");
      setNewFteRange("");
      setNewUnitPrice("");
    } catch (err) {
      toast.error("Failed to add entry: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteEntry(entryId: string) {
    try {
      await deleteEntry.mutateAsync({ id: entryId, priceBookId });
      toast.success("Entry removed");
    } catch (err) {
      toast.error("Failed to remove entry: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  return (
    <div>
      {isAdmin && (
        <div className="flex justify-end mb-2">
          <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Entry
          </Button>
        </div>
      )}

      {showAdd && (
        <div className="border rounded-lg p-3 mb-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Product</Label>
              <Select value={newProductId} onValueChange={setNewProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">FTE Range</Label>
              <Select
                value={newFteRange || "all_ranges"}
                onValueChange={(v) => setNewFteRange(v === "all_ranges" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All ranges" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_ranges">All ranges</SelectItem>
                  {FTE_RANGES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unit Price</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={newUnitPrice}
                  onChange={(e) => setNewUnitPrice(e.target.value)}
                />
                <Button size="sm" onClick={handleAddEntry} disabled={createEntry.isPending}>
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!entries?.length ? (
        <p className="text-sm text-muted-foreground py-2">No pricing entries yet.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>FTE Range</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.product?.name ?? entry.product_id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.fte_range ?? "All"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrencyDetailed(entry.unit_price)}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteEntry(entry.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
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

  const handleOpenChange = (v: boolean) => {
    if (v) {
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
    }
    onOpenChange(v);
  };

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
      toast.error("Failed to save price book: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
