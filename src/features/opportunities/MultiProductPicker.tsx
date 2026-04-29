import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ChevronDown, ChevronRight, Search, Loader2 } from "lucide-react";
import {
  useProducts,
  useAddOpportunityProductsBulk,
  useOpportunity,
} from "./api";
import { usePriceBooks, usePriceBookEntries } from "@/features/products/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrencyDetailed, employeesToFteRange } from "@/lib/formatters";

/** Fetch fresh FTE-relevant fields for an account when picker opens.
 *  Used by the picker to avoid stale opp.account snapshots. */
function useFreshAccount(accountId: string | null) {
  return useQuery({
    queryKey: ["picker-account-fte", accountId],
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from("accounts")
        .select("id, fte_range, fte_count, employees")
        .eq("id", accountId)
        .single();
      if (error) throw error;
      return data as {
        id: string;
        fte_range: string | null;
        fte_count: number | null;
        employees: number | null;
      };
    },
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

/** A row staged for an opp that doesn't exist yet (create form). */
export interface StagedOpportunityProduct {
  product_id: string;
  product_name: string;
  product_code: string | null;
  /** Short abbreviation used by opp auto-naming (e.g. "SRA", "Remote Services"). */
  product_short_name?: string | null;
  quantity: number;
  unit_price: number;
  arr_amount: number;
  discount_percent: number;
  discount_type?: "percent" | "amount";
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | {
      mode?: "immediate";
      opportunityId: string;
    }
  | {
      mode: "staged";
      /** Best-effort FTE range from the form. May be null if the user
       *  hasn't filled it in yet — picker will fall back to looking up
       *  the account directly. */
      fteRange: string | null;
      /** The account being created against. Lets the picker look up
       *  fte_count / fte_range / employees directly, so a missing
       *  FTE range on the form doesn't break price book auto-pick. */
      accountId?: string | null;
      onStage: (rows: StagedOpportunityProduct[]) => void;
    }
);

interface PickedRow {
  product_id: string;
  product_name: string;
  product_code: string | null;
  product_short_name: string | null;
  product_family: string | null;
  quantity: number;
  unit_price: number;
  unit_price_source: "price_book" | "default" | "manual";
  discount_percent: number;
  discount_type: "percent" | "amount";
}

/**
 * Multi-select product picker.
 *
 * Workflow:
 *   1. Pick a price book (auto-selected by FTE tier).
 *   2. Tick boxes next to any products you want — across families.
 *   3. Each tick adds a row at the bottom with auto-priced unit_price,
 *      qty=1, and a discount_percent input.
 *   4. Adjust qty / price / discount in the staging table.
 *   5. Click "Add N Products" — single bulk insert.
 *
 * Auto-pricing pulls from the matching price_book_entry by
 * (price_book_id, product_id, fte_range). Falls back to product
 * default_arr if no entry exists.
 */
export function MultiProductPicker(props: Props) {
  const { open, onOpenChange } = props;
  const isStaged = props.mode === "staged";

  const { data: products } = useProducts();
  const { data: priceBooks } = usePriceBooks();
  const { data: opp } = useOpportunity(isStaged ? undefined : props.opportunityId);
  const bulkMutation = useAddOpportunityProductsBulk();

  const [priceBookId, setPriceBookId] = useState("");
  const [picked, setPicked] = useState<PickedRow[]>([]);
  const [search, setSearch] = useState("");
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());

  const { data: priceBookEntries } = usePriceBookEntries(priceBookId || undefined);

  // Resolve FTE range. Priority order:
  //   1. opp.fte_range          — explicitly set on the opp (preferred,
  //      stays frozen at close so closed deals price the same as when
  //      they were sold)
  //   2. opp.account.fte_range  — current account-level snapshot
  //   3. derive from fte_count or employees on either side
  //
  // The third bucket matters for accounts imported from SF where only
  // the raw count came over (fte_range was a SF formula field that
  // didn't survive the import).
  //
  // For freshness on NEW opps that haven't snapshotted FTE yet, also
  // re-fetch the account directly so we always have the latest FTE
  // even if the opp record hasn't been refreshed in cache.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oppAcct = opp?.account as any;
  const accountIdForFresh = isStaged
    ? props.accountId ?? null
    : (opp?.account_id as string | undefined) ?? null;
  const { data: freshAccount } = useFreshAccount(accountIdForFresh);

  // Resolve FTE range with three behaviors based on mode:
  //
  // 1. STAGED mode (create form): use what the user typed, then fall
  //    back to current account.
  // 2. IMMEDIATE mode + CLOSED opp: use the opp's frozen snapshot.
  //    Closed deals stay priced at whatever they sold for, even if
  //    account FTE has since changed.
  // 3. IMMEDIATE mode + OPEN opp: use CURRENT account FTE so reps
  //    see live pricing as they work the deal. Falls back to the
  //    snapshot if account FTE is missing.
  //
  // This addresses the UTN scenario where the opp was created at
  // 51-100 but the account's been corrected to 1-20 — open opps
  // should follow the current account, not the stale snapshot.
  const isClosedOpp =
    !isStaged &&
    (opp?.stage === "closed_won" || opp?.stage === "closed_lost");

  const oppFteRange = isStaged
    ? props.fteRange
      || freshAccount?.fte_range
      || employeesToFteRange(freshAccount?.fte_count ?? freshAccount?.employees ?? null)
      || null
    : isClosedOpp
      ? // Closed: snapshot wins (price book frozen at close time).
        opp?.fte_range
        || oppAcct?.fte_range
        || freshAccount?.fte_range
        || employeesToFteRange(
            opp?.fte_count
              ?? oppAcct?.fte_count
              ?? oppAcct?.employees
              ?? freshAccount?.fte_count
              ?? freshAccount?.employees
              ?? null
          )
        || null
      : // Open: current account FTE wins so live changes flow through.
        freshAccount?.fte_range
        || employeesToFteRange(freshAccount?.fte_count ?? freshAccount?.employees ?? null)
        || oppAcct?.fte_range
        || employeesToFteRange(oppAcct?.fte_count ?? oppAcct?.employees ?? null)
        || opp?.fte_range
        || employeesToFteRange(opp?.fte_count ?? null)
        || null;

  const activePriceBooks = useMemo(
    () => priceBooks?.filter((pb) => pb.is_active) ?? [],
    [priceBooks],
  );

  // Auto-select the matching price book for the opp's FTE tier.
  // Three-tier match (most-specific → most-permissive):
  //   1. exact fte_range column match (e.g. "51-100" === "51-100")
  //   2. price book name starts with the tier ("51-100 Price Book")
  //   3. price book name CONTAINS the tier anywhere ("Medcurity 51-100 SKUs")
  // If none match, fall back to default → first active.
  const autoSelectedPriceBookId = useMemo(() => {
    if (!activePriceBooks.length) return "";
    const norm = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, "").toLowerCase();
    if (oppFteRange) {
      const target = norm(oppFteRange);
      const colMatch = activePriceBooks.find((pb) => norm(pb.fte_range) === target);
      if (colMatch) return colMatch.id;
      const nameStartsMatch = activePriceBooks.find((pb) => {
        const t = norm(pb.name.split(/\s+/)[0]);
        return t === target;
      });
      if (nameStartsMatch) return nameStartsMatch.id;
      // Fuzzy contains-match on the name (handles "Medcurity 51-100 SKUs"
      // or any variation that includes the tier somewhere)
      const nameContainsMatch = activePriceBooks.find((pb) =>
        norm(pb.name).includes(target),
      );
      if (nameContainsMatch) return nameContainsMatch.id;
    }
    const def = activePriceBooks.find((pb) => pb.is_default);
    return def?.id ?? activePriceBooks[0]?.id ?? "";
  }, [activePriceBooks, oppFteRange]);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setPriceBookId(autoSelectedPriceBookId);
      setPicked([]);
      setSearch("");
      setCollapsedFamilies(new Set());
    }
  }, [open, autoSelectedPriceBookId]);

  // Look up unit_price for a product against the current price book + FTE.
  function lookupUnitPrice(productId: string): {
    price: number;
    source: PickedRow["unit_price_source"];
  } {
    // Normalize FTE range strings so "51-100", "51 - 100", "51_100" all
    // match the same price book entry. The price book auto-select uses
    // the same norm() — keep them consistent.
    const norm = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, "").replace(/_/g, "-").toLowerCase();
    const targetFte = norm(oppFteRange);

    if (priceBookEntries) {
      // 1. Try exact (normalized) FTE-range match for this product
      let entry = priceBookEntries.find(
        (e) =>
          e.product_id === productId &&
          targetFte &&
          norm(e.fte_range) === targetFte,
      );
      // 2. Fall back to a price book entry with NO fte_range (flat
      //    pricing for this product)
      if (!entry) {
        entry = priceBookEntries.find(
          (e) => e.product_id === productId && (e.fte_range == null || e.fte_range === ""),
        );
      }
      // 3. Last resort within the price book: any entry for this product
      //    (handles books that have only one tier configured)
      if (!entry) {
        entry = priceBookEntries.find((e) => e.product_id === productId);
      }
      if (entry && Number(entry.unit_price) > 0) {
        return { price: Number(entry.unit_price), source: "price_book" };
      }
    }
    const product = products?.find((p) => p.id === productId);
    if (product?.default_arr != null && Number(product.default_arr) > 0) {
      return { price: Number(product.default_arr), source: "default" };
    }
    return { price: 0, source: "manual" };
  }

  // Re-price all picked rows when price book or entries change. Skip rows
  // the user has manually overridden (source=manual).
  useEffect(() => {
    if (picked.length === 0) return;
    setPicked((prev) =>
      prev.map((row) => {
        if (row.unit_price_source === "manual") return row;
        const { price, source } = lookupUnitPrice(row.product_id);
        return { ...row, unit_price: price, unit_price_source: source };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceBookId, priceBookEntries]);

  // Group products by family.
  const grouped = useMemo(() => {
    const m = new Map<string, NonNullable<typeof products>>();
    const list = (products ?? []).filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.product_family ?? "").toLowerCase().includes(q)
      );
    });
    for (const p of list) {
      const family = p.product_family || "Uncategorized";
      const arr = m.get(family) ?? [];
      arr.push(p);
      m.set(family, arr);
    }
    // Sort families alphabetically; products within each by name.
    const sortedFamilies = Array.from(m.keys()).sort();
    return new Map(
      sortedFamilies.map((f) => [f, [...(m.get(f) ?? [])].sort((a, b) => a.name.localeCompare(b.name))]),
    );
  }, [products, search]);

  const pickedById = useMemo(
    () => new Map(picked.map((p) => [p.product_id, p])),
    [picked],
  );

  function togglePick(product: NonNullable<typeof products>[number]) {
    if (pickedById.has(product.id)) {
      setPicked((prev) => prev.filter((p) => p.product_id !== product.id));
      return;
    }
    const { price, source } = lookupUnitPrice(product.id);
    // Guardrail: if the product has no price for the current FTE tier
    // (source === "manual" means lookupUnitPrice fell through every
    // pricebook fallback), the user is probably adding a tier-specific
    // SKU to the wrong-sized opportunity. Prompt before staging.
    // Example case Brayden flagged: "Small Practice" is 1-20 FTE only;
    // adding it to a 51-100 opp should pop a confirm.
    if (source === "manual" && oppFteRange) {
      const ok = window.confirm(
        `"${product.name}" has no price configured for the ${oppFteRange} FTE tier. ` +
          `Check the FTE Range / Employees on the account and try again — ` +
          `or click OK to add it at $0 and price it manually.`,
      );
      if (!ok) return;
    }
    setPicked((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        product_code: product.code,
        // short_name comes from products.short_name (added in
        // migration 20260427000005). Used for opp auto-naming.
        product_short_name: (product as { short_name?: string | null }).short_name ?? null,
        product_family: product.product_family,
        quantity: 1,
        unit_price: price,
        unit_price_source: source,
        discount_percent: 0,
        discount_type: "percent",
      },
    ]);
  }

  function updatePicked(productId: string, patch: Partial<PickedRow>) {
    setPicked((prev) =>
      prev.map((p) => (p.product_id === productId ? { ...p, ...patch } : p)),
    );
  }

  function toggleFamily(family: string) {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  const subtotal = picked.reduce((s, r) => {
    const lineTotal = r.discount_type === "amount"
      ? Math.max(0, r.quantity * r.unit_price - r.discount_percent)
      : r.quantity * r.unit_price * (1 - r.discount_percent / 100);
    return s + lineTotal;
  }, 0);

  async function handleAdd() {
    if (picked.length === 0) {
      toast.error("Pick at least one product");
      return;
    }
    const rows = picked.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      product_code: r.product_code,
      product_short_name: r.product_short_name,
      quantity: r.quantity,
      unit_price: r.unit_price,
      arr_amount: r.discount_type === "amount"
        ? Math.max(0, r.quantity * r.unit_price - r.discount_percent)
        : r.quantity * r.unit_price * (1 - r.discount_percent / 100),
      discount_percent: r.discount_percent,
      discount_type: r.discount_type,
    }));

    if (isStaged) {
      props.onStage(rows);
      onOpenChange(false);
      return;
    }

    try {
      await bulkMutation.mutateAsync({
        opportunity_id: props.opportunityId,
        rows,
      });
      toast.success(`Added ${rows.length} product${rows.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  const selectedPriceBook = activePriceBooks.find((pb) => pb.id === priceBookId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Add Products</DialogTitle>
          <DialogDescription>
            Pick any combination of products. Prices auto-fill from the matching
            price book for this opportunity's FTE tier.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="picker-price-book">Price Book</Label>
              <Select
                value={priceBookId || "none"}
                onValueChange={(v) => setPriceBookId(v === "none" ? "" : v)}
              >
                <SelectTrigger id="picker-price-book">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No price book</SelectItem>
                  {activePriceBooks.map((pb) => (
                    <SelectItem key={pb.id} value={pb.id}>
                      {pb.name}
                      {pb.is_default ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="picker-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="picker-search"
                  placeholder="Filter by name, code, family"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          {selectedPriceBook && oppFteRange && selectedPriceBook.id === autoSelectedPriceBookId && !selectedPriceBook.is_default && (
            <p className="text-xs text-muted-foreground">
              Pricing from "{selectedPriceBook.name}" for FTE range:{" "}
              <span className="font-medium">{oppFteRange}</span>
            </p>
          )}
          {oppFteRange && selectedPriceBook?.is_default && (
            <p className="text-xs text-amber-600">
              FTE range <span className="font-medium">{oppFteRange}</span> set,
              but no matching price book found. Falling back to default. Check
              that an active price book has fte_range or name matching the tier.
            </p>
          )}
          {!oppFteRange && (
            <p className="text-xs text-amber-600">
              No FTE range on opportunity or account. Set FTE Count or FTE
              Range to enable tier-based pricing.
            </p>
          )}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-auto border-t">
          {Array.from(grouped.entries()).map(([family, list]) => {
            const collapsed = collapsedFamilies.has(family);
            return (
              <div key={family} className="border-b">
                <button
                  type="button"
                  onClick={() => toggleFamily(family)}
                  className="w-full flex items-center gap-2 px-6 py-2 bg-muted/40 hover:bg-muted text-left text-sm"
                >
                  {collapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  <span className="font-semibold">{family}</span>
                  <Badge variant="secondary" className="ml-2">
                    {list.length}
                  </Badge>
                </button>
                {!collapsed && (
                  <div className="divide-y">
                    {list.map((p) => {
                      const isPicked = pickedById.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 px-6 py-2 hover:bg-muted/30 cursor-pointer"
                        >
                          <Checkbox
                            checked={isPicked}
                            onCheckedChange={() => togglePick(p)}
                          />
                          <div className="flex-1 text-sm">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.code}
                              {p.description ? ` · ${p.description}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Picked staging table */}
        {picked.length > 0 && (
          <div className="border-t bg-muted/20 px-6 py-3 max-h-64 overflow-y-auto overflow-x-hidden">
            <p className="text-xs font-medium mb-2">
              {picked.length} product{picked.length === 1 ? "" : "s"} staged
            </p>
            <table className="w-full text-xs table-fixed">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left pb-1">Product</th>
                  <th className="text-right pb-1 w-14">Qty</th>
                  <th className="text-right pb-1 w-20">Unit $</th>
                  <th className="text-right pb-1 w-28">Discount</th>
                  <th className="text-right pb-1 w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {picked.map((row) => {
                  const total = row.discount_type === "amount"
                    ? Math.max(0, row.quantity * row.unit_price - row.discount_percent)
                    : row.quantity * row.unit_price * (1 - row.discount_percent / 100);
                  return (
                    <tr key={row.product_id} className="border-t border-border/50">
                      <td className="py-1 pr-2">
                        <div className="font-medium">{row.product_name}</div>
                        <div className="text-muted-foreground text-[10px]">
                          {row.product_code} · {row.product_family || "—"}
                        </div>
                      </td>
                      <td className="py-1 text-right">
                        <Input
                          type="number"
                          min={1}
                          className="h-7 text-xs text-right px-1"
                          value={String(row.quantity)}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            if (!Number.isNaN(n) && n >= 1)
                              updatePicked(row.product_id, { quantity: n });
                          }}
                        />
                      </td>
                      <td className="py-1 text-right">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-7 text-xs text-right px-1"
                          value={String(row.unit_price)}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            if (!Number.isNaN(n) && n >= 0)
                              updatePicked(row.product_id, {
                                unit_price: n,
                                unit_price_source: "manual",
                              });
                          }}
                        />
                      </td>
                      <td className="py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <select
                            value={row.discount_type}
                            onChange={(e) => updatePicked(row.product_id, { discount_type: e.target.value as "percent" | "amount" })}
                            className="h-7 border rounded text-xs px-1 bg-background"
                          >
                            <option value="percent">%</option>
                            <option value="amount">$</option>
                          </select>
                          <Input
                            type="number"
                            min={0}
                            max={row.discount_type === "percent" ? 100 : undefined}
                            step={row.discount_type === "percent" ? "1" : "0.01"}
                            className="h-7 text-xs text-right px-1 w-16"
                            value={String(row.discount_percent)}
                            onChange={(e) => {
                              const n = parseFloat(e.target.value);
                              if (!Number.isNaN(n) && n >= 0)
                                updatePicked(row.product_id, { discount_percent: n });
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-1 text-right font-medium">
                        {formatCurrencyDetailed(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border/70">
                <tr>
                  <td colSpan={4} className="pt-2 pr-2 text-right font-semibold">
                    Subtotal
                  </td>
                  <td className="pt-2 text-right font-bold">
                    {formatCurrencyDetailed(subtotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <DialogFooter className="px-6 pb-6 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={picked.length === 0 || bulkMutation.isPending}>
            {bulkMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Adding…
              </>
            ) : (
              `Add ${picked.length || ""} Product${picked.length === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
