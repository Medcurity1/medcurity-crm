import { useState, useEffect } from "react";
import { useProducts, useAddOpportunityProduct, useOpportunity } from "./api";
import { usePriceBooks, usePriceBookEntries } from "@/features/products/api";
import { useAccount } from "@/features/accounts/api";
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

interface AddProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
}

export function AddProductDialog({ open, onOpenChange, opportunityId }: AddProductDialogProps) {
  const { data: products } = useProducts();
  const { data: priceBooks } = usePriceBooks();
  const { data: opp } = useOpportunity(opportunityId);
  const { data: account } = useAccount(opp?.account_id);
  const addMutation = useAddOpportunityProduct();

  const [priceBookId, setPriceBookId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [arrAmount, setArrAmount] = useState(0);
  const [arrManuallyEdited, setArrManuallyEdited] = useState(false);
  const [priceBookPriceFilled, setPriceBookPriceFilled] = useState(false);

  const { data: priceBookEntries } = usePriceBookEntries(priceBookId || undefined);

  const accountFteRange = account?.fte_range ?? null;
  const activePriceBooks = priceBooks?.filter((pb) => pb.is_active) ?? [];

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setPriceBookId("");
      setProductId("");
      setQuantity(1);
      setUnitPrice(0);
      setArrAmount(0);
      setArrManuallyEdited(false);
      setPriceBookPriceFilled(false);
    }
  }, [open]);

  // Look up price from price book entries when price book + product + fte range are available
  useEffect(() => {
    if (!priceBookId || !productId || !priceBookEntries) return;

    const matchingEntry = priceBookEntries.find(
      (e) =>
        e.product_id === productId &&
        (accountFteRange ? e.fte_range === accountFteRange : e.fte_range === null)
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
  }, [priceBookId, productId, priceBookEntries, accountFteRange]); // eslint-disable-line react-hooks/exhaustive-deps

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

    addMutation.mutate(
      {
        opportunity_id: opportunityId,
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
      <DialogContent className="sm:max-w-md">
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
            {selectedPriceBook && accountFteRange && (
              <p className="text-xs text-muted-foreground">
                Using "{selectedPriceBook.name}" for FTE range: {accountFteRange}
              </p>
            )}
            {selectedPriceBook && !accountFteRange && (
              <p className="text-xs text-amber-600">
                Account has no FTE range set. Prices may not match.
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
                Price auto-filled from "{selectedPriceBook.name}" ({accountFteRange ?? "no FTE range"}): {formatCurrencyDetailed(unitPrice)}
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
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-price">Unit Price ($)</Label>
              <Input
                id="unit-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
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
              value={arrAmount}
              onChange={(e) => {
                setArrManuallyEdited(true);
                setArrAmount(parseFloat(e.target.value) || 0);
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
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? "Adding..." : "Add Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
