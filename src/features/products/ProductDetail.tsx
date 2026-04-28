import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Cloud, User, Package } from "lucide-react";
import {
  useProduct,
  useUpdateProduct,
  useDeleteProduct,
  useArchiveProduct,
  useUnarchiveProduct,
  useProductReferences,
  useEntriesForProduct,
  useProductFamilies,
  usePriceBooks,
  useSetPriceBookEntryPrice,
} from "./api";
import { DeleteProductDialog } from "./DeleteProductDialog";
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
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const archiveMutation = useArchiveProduct();
  const unarchiveMutation = useUnarchiveProduct();

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

  async function handleArchive(reason: string | null) {
    if (!product) return;
    try {
      await archiveMutation.mutateAsync({ id: product.id, reason });
      toast.success(`Archived "${product.name}"`);
      setConfirmDelete(false);
    } catch (err) {
      toast.error("Failed to archive: " + errorMessage(err));
    }
  }

  async function handleUnarchive() {
    if (!product) return;
    try {
      await unarchiveMutation.mutateAsync(product.id);
      toast.success(`Unarchived "${product.name}"`);
    } catch (err) {
      toast.error("Failed: " + errorMessage(err));
    }
  }

  async function handleDelete(cascade: boolean) {
    if (!product) return;
    try {
      await deleteMutation.mutateAsync({ id: product.id, cascade });
      toast.success(`Deleted "${product.name}"`);
      navigate("/products");
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.toLowerCase().includes("foreign") || msg.toLowerCase().includes("violates")) {
        toast.error("Can't delete — product is on an opportunity. Use Archive instead.");
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
            {product.archived_at ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnarchive}
                disabled={unarchiveMutation.isPending}
              >
                Unarchive
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
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
              {product.archived_at && (
                <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                  Archived
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
          <TabsTrigger value="related">Related</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
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
                {product.has_flat_price && (
                  <Field
                    label="Flat Price"
                    value={
                      product.default_arr != null
                        ? formatCurrencyDetailed(product.default_arr)
                        : "Enabled (no price set)"
                    }
                  />
                )}
              </div>

              {product.description && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Description
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{product.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pricing — now front and center on the Details tab so admins
              don't have to dig into Related to find prices, and can edit
              them inline. */}
          {!product.has_flat_price && isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pricing</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Per-tier prices. Empty cell = product hidden from the
                  picker for that tier. Saves on blur.
                </p>
              </CardHeader>
              <CardContent>
                <ProductPricingMatrix productId={product.id} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="related" className="mt-4 space-y-4">
          <ProductOpportunitiesCard productId={product.id} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <Field
                  label="Salesforce ID"
                  value={
                    <span className="font-mono text-xs">
                      {product.sf_id ?? "\u2014 (created in CRM)"}
                    </span>
                  }
                />
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
      <DeleteProductDialog
        product={confirmDelete ? product : null}
        isAdmin={isAdmin}
        onClose={() => setConfirmDelete(false)}
        onArchive={handleArchive}
        onDelete={handleDelete}
        isPending={deleteMutation.isPending || archiveMutation.isPending}
      />
    </div>
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
  const [shortName, setShortName] = useState("");
  const [family, setFamily] = useState<string>("");
  const [pricingModel, setPricingModel] = useState("per_fte");
  const [hasFlatPrice, setHasFlatPrice] = useState(false);
  const [defaultArr, setDefaultArr] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name ?? "");
    setCode(product.code ?? "");
    setShortName((product as { short_name?: string | null }).short_name ?? "");
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
        short_name: shortName.trim() || null,
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
          <DialogDescription>
            Update product details. Per-FTE prices are edited directly on the product detail page below.
          </DialogDescription>
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

          <div className="space-y-2">
            <Label htmlFor="ed-short">Short Name (abbreviation)</Label>
            <Input
              id="ed-short"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder='e.g. "SRA", "CO Training", "Remote Services"'
            />
            <p className="text-xs text-muted-foreground">
              Used when auto-naming opportunities. If blank, the product code is used.
            </p>
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

/* ──────────────────────────────────────────────
   Pricing matrix: rows = price books, cols = FTE
   tier (or "flat" when no tier), cells = unit
   prices. Empty cell = no entry (won't show up in
   the picker). Saves on blur. Idempotent — uses
   the upsert/delete behavior of useSetPriceBookEntryPrice.
   ────────────────────────────────────────────── */

const FTE_TIERS = [
  "1-20",
  "21-50",
  "51-100",
  "101-250",
  "251-500",
  "501-750",
  "751-1000",
  "1001-1500",
  "1501-2000",
  "2001-5000",
  "5001-10000",
];

function ProductPricingMatrix({ productId }: { productId: string }) {
  const { data: priceBooks, isLoading: booksLoading } = usePriceBooks();
  const { data: entries, isLoading: entriesLoading } = useEntriesForProduct(productId);
  const setPriceMutation = useSetPriceBookEntryPrice();

  // Local edit buffer so each cell can be typed in without firing a
  // mutation per keystroke. Keyed by `${book_id}::${fte_range_or_null}`.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function cellKey(bookId: string, fte: string | null) {
    return `${bookId}::${fte ?? ""}`;
  }

  function existingEntry(bookId: string, fte: string | null) {
    return (entries ?? []).find(
      (e) => e.price_book_id === bookId && (e.fte_range ?? null) === fte,
    );
  }

  function getCellValue(bookId: string, fte: string | null): string {
    const k = cellKey(bookId, fte);
    if (k in drafts) return drafts[k];
    const e = existingEntry(bookId, fte);
    return e ? String(e.unit_price) : "";
  }

  async function commitCell(bookId: string, fte: string | null) {
    const k = cellKey(bookId, fte);
    if (!(k in drafts)) return;
    const raw = drafts[k].trim();
    const e = existingEntry(bookId, fte);
    // Empty → delete row (clear the price); also matches Brayden's
    // Small Practice request: deleting an entry removes the product
    // from that tier in the picker.
    const next = raw === "" ? null : Number(raw);
    if (raw !== "" && (next === null || Number.isNaN(next as number) || (next as number) < 0)) {
      // Bad input — bail without firing the mutation. The cell still
      // shows the draft value so the user can correct.
      return;
    }
    if ((next ?? null) === (e ? Number(e.unit_price) : null)) {
      // No-op — drop the draft.
      setDrafts((prev) => {
        const out = { ...prev };
        delete out[k];
        return out;
      });
      return;
    }
    try {
      await setPriceMutation.mutateAsync({
        price_book_id: bookId,
        product_id: productId,
        fte_range: fte,
        unit_price: next,
        existing_entry_id: e?.id ?? null,
      });
      setDrafts((prev) => {
        const out = { ...prev };
        delete out[k];
        return out;
      });
    } catch (err) {
      toast.error("Failed to save price: " + errorMessage(err));
    }
  }

  if (booksLoading || entriesLoading) {
    return (
      <div className="space-y-2">
        <Label>Pricing by Price Book and FTE Tier</Label>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const activeBooks = (priceBooks ?? []).filter((b) => b.is_active);
  if (activeBooks.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Pricing by Price Book and FTE Tier</Label>
        <p className="text-xs text-muted-foreground">
          No active price books. Create one in the Price Books admin section first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Pricing by Price Book and FTE Tier</Label>
        <span className="text-xs text-muted-foreground">
          Empty cell = product hidden from picker for that tier. Saves on blur.
        </span>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left p-2 sticky left-0 bg-muted/40 z-10 min-w-[160px]">
                Price Book
              </th>
              <th className="text-right p-2 min-w-[90px]">Flat</th>
              {FTE_TIERS.map((t) => (
                <th key={t} className="text-right p-2 min-w-[90px]">{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeBooks.map((book) => (
              <tr key={book.id} className="border-t">
                <td className="p-2 font-medium sticky left-0 bg-background z-10">
                  {book.name}
                  {book.is_default && (
                    <Badge variant="secondary" className="ml-2 text-[9px]">
                      default
                    </Badge>
                  )}
                </td>
                {[null, ...FTE_TIERS].map((fte) => (
                  <td key={fte ?? "flat"} className="p-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="—"
                      className="h-7 text-xs text-right px-1"
                      value={getCellValue(book.id, fte)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDrafts((prev) => ({
                          ...prev,
                          [cellKey(book.id, fte)]: v,
                        }));
                      }}
                      onBlur={() => commitCell(book.id, fte)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Related Opportunities (on Related tab)
   ────────────────────────────────────────────── */

function ProductOpportunitiesCard({ productId }: { productId: string }) {
  const { data: refs, isLoading } = useProductReferences(productId);
  const opportunities = refs?.opportunities ?? [];

  // Dedupe: a product can appear on the same opp via multiple line
  // items (different price-book tiers). Sum them up.
  const oppRows = (() => {
    const m = new Map<
      string,
      {
        id: string;
        name: string;
        stage: string;
        accountName: string | null;
        totalArr: number;
        lines: number;
      }
    >();
    for (const line of opportunities) {
      const opp = line.opportunity;
      if (!opp) continue;
      const existing = m.get(opp.id);
      if (existing) {
        existing.totalArr += Number(line.arr_amount) || 0;
        existing.lines += 1;
      } else {
        m.set(opp.id, {
          id: opp.id,
          name: opp.name,
          stage: opp.stage,
          accountName: opp.account?.name ?? null,
          totalArr: Number(line.arr_amount) || 0,
          lines: 1,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.totalArr - a.totalArr);
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Opportunities {oppRows.length > 0 ? `(${oppRows.length})` : ""}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every opportunity that has this product on its line items. Pricing on
          existing opps is preserved if you archive or remove from a price book.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : !oppRows.length ? (
          <p className="text-sm text-muted-foreground py-2">
            Not on any opportunity yet.
          </p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">ARR (this product)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oppRows.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        to={`/opportunities/${o.id}`}
                        className="hover:underline"
                      >
                        {o.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.accountName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize text-xs">
                        {o.stage.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrencyDetailed(o.totalArr)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
