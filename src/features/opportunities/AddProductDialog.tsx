import { useState, useEffect } from "react";
import { useProducts, useAddOpportunityProduct, useOpportunity } from "./api";
import { usePriceBooks, usePriceBookEntries } from "@/features/products/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrencyDetailed } from "@/lib/formatters";

/**
 * A row the user has staged to attach to a not-yet-created opportunity.
 * `productName` / `productCode` are snapshot at stage time so the parent
 * form can render a readable preview without refetching the product.
 */
export interface StagedOpportunityProduct {
  product_id: string;
  product_name: string;
  product_code: string | null;
  quantity: number;
  unit_price: number;
  arr_amount: number;
}

type AddProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | {
      /** Insert straight into opportunity_products for an existing opp. */
      mode?: "immediate";
      opportunityId: string;
    }
  | {
      /**
       * Stage the product in parent state; parent will flush it to the DB
       * after the opportunity itself is created. Used on the create form.
       */
      mode: "staged";
      fteRange: string | null;
      onStage: (staged: StagedOpportunityProduct) => void;
    }
);

export function AddProductDialog(props: AddProductDialogProps) {
  const { open, onOpenChange } = props;
  const isStaged = props.mode === "staged";

  const { data: products } = useProducts();
  const { data: priceBooks } = usePriceBooks();
  // Only hit useOpportunity in immediate mode — staged mode has no opp yet.
  const { data: opp } = useOpportunity(isStaged ? undefined : props.opportunityId);
  const addMutation = useAddOpportunityProduct();

  const [priceBookId, setPriceBookId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [arrAmount, setArrAmount] = useState(0);
  const [arrManuallyEdited, setArrManuallyEdited] = useState(false);
  const [priceBookPriceFilled, setPriceBookPriceFilled] = useState(false);

  const { data: priceBookEntries } = usePriceBookEntries(priceBookId || undefined);

  // Staged mode gets FTE from the caller (the OpportunityForm), since the
  // opp doesn't exist yet. Immediate mode reads it off the opp itself,
  // falling back to the linked account's FTE tier when the opp's own
  // column is null (which is common for imported opps and opps created
  // before the FTE trigger existed). Open opps stay in sync with the
  // account via a DB trigger; closed opps freeze whatever tier they had
  // at close.
  const oppFteRange = isStaged
    ? props.fteRange ?? null
    : opp?.fte_range ?? opp?.account?.fte_range ?? null;
  const activePriceBooks = priceBooks?.filter((pb) => pb.is_active) ?? [];

  // Pick the best matching price book for this opp's FTE tier. Prefer an
  // active book whose fte_range matches exactly; otherwise fall back to
  // the default book, then to any active book.
  const autoSelectedPriceBookId = (() => {
    if (!activePriceBooks.length) return "";
    if (oppFteRange) {
      const tierMatch = activePriceBooks.find((pb) => pb.fte_range === oppFteRange);
      if (tierMatch) return tierMatch.id;
    }
    const defaultBook = activePriceBooks.find((pb) => pb.is_default);
    if (defaultBook) return defaultBook.id;
    return activePriceBooks[0]?.id ?? "";
  })();

  // Reset form when dialog opens. Auto-select the tier-matching price book
  // so reps don't have to remember which book to pick.
  useEffect(() => {
    if (open) {
      setPriceBookId(autoSelectedPriceBookId);
      setProductId("");
      setQuantity(1);
      setUnitPrice(0);
      setArrAmount(0);
      setArrManuallyEdited(false);
      setPriceBookPriceFilled(false);
    }
  }, [open, autoSelectedPriceBookId]);

  // Look up price from price book entries when price book + product + fte range are available
  useEffect(() => {
    if (!priceBookId || !productId || !priceBookEntries) return;

    const matchingEntry = priceBookEntries.find(
      (e) =>
        e.product_id === productId &&
        (oppFteRange ? e.fte_range === oppFteRange : e.fte_range === null)
    );

    if (matchingEntry) {
      setUnitPrice(matchingEntry.unit_price);
      setPriceBookPriceFilled(true);
      if (!arrManuallyEdited) {
        setArrAmount(quantity * matchingEntry.unit_price);
      }
    } else {
      setPriceBookPriceFilled(false);
      // Fall back to product default_arr
      const selected = products?.find((p) => p.id === productId);
      if (selected?.default_arr != null) {
        setUnitPrice(selected.default_arr);
        if (!arrManuallyEdited) {
          setArrAmount(quantity * selected.default_arr);
        }
      }
    }
  }, [priceBookId, productId, priceBookEntries, oppFteRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill unit price from product's default_arr when product is selected (no price book)
  useEffect(() => {
    if (!productId || !products || priceBookId) return;
    const selected = products.find((p) => p.id === productId);
    if (selected?.default_arr != null) {
      setUnitPrice(selected.default_arr);
      setPriceBookPriceFilled(false);
      if (!arrManuallyEdited) {
        setArrAmount(quantity * selected.default_arr);
      }
    }
  }, [productId, products]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-calculate ARR when quantity or unit price changes (unless manually edited)
  useEffect(() => {
    if (!arrManuallyEdited) {
      setArrAmount(quantity * unitPrice);
    }
  }, [quantity, unitPrice, arrManuallyEdited]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      toast.error("Please select a product");
      return;
    }

    const selectedProduct = products?.find((p) => p.id === productId);

    if (isStaged) {
      props.onStage({
        product_id: productId,
        product_name: selectedProduct?.name ?? "",
        product_code: selectedProduct?.code ?? null,
        quantity,
        unit_price: unitPrice,
        arr_amount: arrAmount,
      });
      onOpenChange(false);
      return;
    }

    addMutation.mutate(
      {
        opportunity_id: props.opportunityId,
        product_id: productId,
        quantity,
        unit_price: unitPrice,
        arr_amount: arrAmount,
      },
      {
        onSuccess: () => {
          toast.success("Product added");
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error("Failed to add product: " + (err as Error).message);
        },
      }
    );
  }

  const selectedPriceBook = activePriceBooks.find((pb) => pb.id === priceBookId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price-book-select">Price Book</Label>
            <Select value={priceBookId || "none"} onValueChange={(v) => setPriceBookId(v === "none" ? "" : v)}>
              <SelectTrigger id="price-book-select">
                <SelectValue placeholder="Select a price book..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No price book</SelectItem>
                {activePriceBooks.map((pb) => (
                  <SelectItem key={pb.id} value={pb.id}>
                    {pb.name}{pb.is_default ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPriceBook && oppFteRange && (
              <p className="text-xs text-muted-foreground">
                Using "{selectedPriceBook.name}" for FTE range: {oppFteRange}
              </p>
            )}
            {selectedPriceBook && !oppFteRange && (
              <p className="text-xs text-amber-600">
                Opportunity has no FTE range set. Edit the opportunity to set one, or prices may not match.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-select">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="product-select">
                <SelectValue placeholder="Select a product..." />
              </SelectTrigger>
              <SelectContent>
                {products?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {priceBookPriceFilled && selectedPriceBook && (
              <p className="text-xs text-emerald-600">
                Price auto-filled from "{selectedPriceBook.name}" ({oppFteRange ?? "no FTE range"}): {formatCurrencyDetailed(unitPrice)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                // Track the raw string so the user can fully highlight and
                // retype without the control snapping to 1 mid-keystroke.
                // We still clamp to >= 1 on the parsed number used elsewhere.
                value={String(quantity)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setQuantity(1);
                    return;
                  }
                  const n = parseInt(raw, 10);
                  if (!Number.isNaN(n) && n >= 1) setQuantity(n);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-price">Unit Price ($)</Label>
              <Input
                id="unit-price"
                type="number"
                min={0}
                step="0.01"
                value={String(unitPrice)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setUnitPrice(0);
                    return;
                  }
                  const n = parseFloat(raw);
                  if (!Number.isNaN(n) && n >= 0) setUnitPrice(n);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="arr-amount">ARR Amount ($)</Label>
            <Input
              id="arr-amount"
              type="number"
              min={0}
              step="0.01"
              value={String(arrAmount)}
              onChange={(e) => {
                setArrManuallyEdited(true);
                const raw = e.target.value;
                if (raw === "") {
                  setArrAmount(0);
                  return;
                }
                const n = parseFloat(raw);
                if (!Number.isNaN(n) && n >= 0) setArrAmount(n);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Auto-calculated as Quantity x Unit Price. Edit to override.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isStaged && addMutation.isPending}>
              {isStaged ? "Add to Opportunity" : addMutation.isPending ? "Adding..." : "Add Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
