import { useState, useEffect } from "react";
import { useProducts, useAddOpportunityProduct } from "./api";
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

interface AddProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
}

export function AddProductDialog({ open, onOpenChange, opportunityId }: AddProductDialogProps) {
  const { data: products } = useProducts();
  const addMutation = useAddOpportunityProduct();

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [arrAmount, setArrAmount] = useState(0);
  const [arrManuallyEdited, setArrManuallyEdited] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setProductId("");
      setQuantity(1);
      setUnitPrice(0);
      setArrAmount(0);
      setArrManuallyEdited(false);
    }
  }, [open]);

  // Pre-fill unit price from product's default_arr when product is selected
  useEffect(() => {
    if (!productId || !products) return;
    const selected = products.find((p) => p.id === productId);
    if (selected?.default_arr != null) {
      setUnitPrice(selected.default_arr);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
