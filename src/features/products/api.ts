import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product, PriceBook, PriceBookEntry, ProductFamily, UserProfile } from "@/types/crm";

// ─── Single Product (for detail page) ────────────────────

export function useProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ["product", productId],
    queryFn: async () => {
      if (!productId) throw new Error("Missing product id");
      const { data, error } = await supabase
        .from("products")
        .select(
          "*, creator:user_profiles!products_created_by_fkey(id, full_name), updater:user_profiles!products_updated_by_fkey(id, full_name)"
        )
        .eq("id", productId)
        .single();
      if (error) throw error;
      return data as Product & {
        creator: Pick<UserProfile, "id" | "full_name"> | null;
        updater: Pick<UserProfile, "id" | "full_name"> | null;
      };
    },
    enabled: !!productId,
  });
}

// ─── Products ────────────────────────────────────────────

export function useProducts(
  options: { includeInactive?: boolean; includeArchived?: boolean } | boolean = false
) {
  // Back-compat: callers used to pass a bare boolean for includeInactive.
  const opts =
    typeof options === "boolean"
      ? { includeInactive: options, includeArchived: false }
      : { includeInactive: false, includeArchived: false, ...options };
  return useQuery({
    queryKey: ["products", opts],
    queryFn: async () => {
      let query = supabase.from("products").select("*").order("name");
      if (!opts.includeInactive) {
        query = query.eq("is_active", true);
      }
      if (!opts.includeArchived) {
        // Note: RLS already hides archived rows from non-admins. This
        // filter ensures admins see only active products in the default
        // pickers without changing their backend role.
        query = query.is("archived_at", null);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Product[];
    },
  });
}

// Returns the opportunities and price-book entries that reference the
// given product. Used by the delete dialog to decide between "real
// delete" and "archive", and to surface which records are affected.
export function useProductReferences(productId: string | undefined) {
  return useQuery({
    queryKey: ["product_references", productId],
    queryFn: async () => {
      if (!productId) throw new Error("Missing product id");
      const [oppRes, entryRes] = await Promise.all([
        // Pull the opp rows (limited to a reasonable preview) so we can
        // show stage / amount / name in the delete dialog.
        supabase
          .from("opportunity_products")
          .select(
            "id, quantity, unit_price, arr_amount, opportunity:opportunities!opportunity_id(id, name, stage, account_id, account:accounts!account_id(id, name))"
          )
          .eq("product_id", productId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("price_book_entries")
          .select("id", { count: "exact", head: true })
          .eq("product_id", productId),
      ]);
      if (oppRes.error) throw oppRes.error;
      if (entryRes.error) throw entryRes.error;
      type OppLine = {
        id: string;
        quantity: number;
        unit_price: number;
        arr_amount: number;
        opportunity:
          | {
              id: string;
              name: string;
              stage: string;
              account: { id: string; name: string } | null;
            }
          | null;
      };
      // Normalize PostgREST join shape: foreign-key joins come back as
      // single-element arrays even though the relationship is 1:1, so
      // unwrap them.
      type RawLine = {
        id: string;
        quantity: number;
        unit_price: number;
        arr_amount: number;
        opportunity:
          | { id: string; name: string; stage: string; account: { id: string; name: string }[] | null }
          | { id: string; name: string; stage: string; account: { id: string; name: string }[] | null }[]
          | null;
      };
      const opps: OppLine[] = ((oppRes.data ?? []) as RawLine[]).map((row) => {
        const oppArr = Array.isArray(row.opportunity) ? row.opportunity[0] : row.opportunity;
        const accountRaw = oppArr ? (Array.isArray(oppArr.account) ? oppArr.account[0] : oppArr.account) : null;
        const account = accountRaw && !Array.isArray(accountRaw) ? accountRaw : null;
        return {
          id: row.id,
          quantity: row.quantity,
          unit_price: row.unit_price,
          arr_amount: row.arr_amount,
          opportunity: oppArr
            ? {
                id: oppArr.id,
                name: oppArr.name,
                stage: oppArr.stage,
                account,
              }
            : null,
        };
      });
      return {
        opportunityCount: opps.length,
        entryCount: entryRes.count ?? 0,
        opportunities: opps,
      };
    },
    enabled: !!productId,
  });
}

export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; reason?: string | null }) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("not signed in");
      const { data, error } = await supabase
        .from("products")
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          archive_reason: vars.reason ?? null,
          is_active: false,
        })
        .eq("id", vars.id)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product"] });
    },
  });
}

export function useUnarchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("products")
        .update({
          archived_at: null,
          archived_by: null,
          archive_reason: null,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product"] });
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Product>) => {
      const { data, error } = await supabase
        .from("products")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Product> & { id: string }) => {
      const { data, error } = await supabase
        .from("products")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Product;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: string | { id: string; cascade: boolean }) => {
      const id = typeof vars === "string" ? vars : vars.id;
      const cascade = typeof vars === "string" ? false : vars.cascade;

      // Optionally remove all price-book entries first so the FK
      // constraint doesn't block the product delete.
      if (cascade) {
        const { error: entriesErr } = await supabase
          .from("price_book_entries")
          .delete()
          .eq("product_id", id);
        if (entriesErr) throw entriesErr;
      }

      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["price_book_entries"] });
      qc.invalidateQueries({ queryKey: ["price_book_entries_by_product"] });
    },
  });
}

// Fetch all price-book entries that reference a single product, joined
// with the parent price book name so we can show "this product appears
// in these price books at these prices" on a detail/expanded view.
export function useEntriesForProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ["price_book_entries_by_product", productId],
    queryFn: async () => {
      if (!productId) throw new Error("Missing product id");
      const { data, error } = await supabase
        .from("price_book_entries")
        .select("*, price_book:price_books!price_book_id(id, name, is_active, is_default)")
        .eq("product_id", productId)
        .order("fte_range");
      if (error) throw error;
      return data as Array<PriceBookEntry & { price_book: { id: string; name: string; is_active: boolean; is_default: boolean } | null }>;
    },
    enabled: !!productId,
  });
}

// ─── Price Books ─────────────────────────────────────────

export function usePriceBooks() {
  return useQuery({
    queryKey: ["price_books"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_books")
        .select("*");
      if (error) throw error;
      // Sort by FTE tier ascending, then any books without an fte_range
      // (e.g. "Standard Price Book") fall to the bottom.
      const list = data as PriceBook[];
      return [...list].sort((a, b) => {
        const aFte = parseFteRange(a.fte_range, a.name);
        const bFte = parseFteRange(b.fte_range, b.name);
        if (aFte === null && bFte === null) return a.name.localeCompare(b.name);
        if (aFte === null) return 1;
        if (bFte === null) return -1;
        return aFte - bFte;
      });
    },
  });
}

// Returns the lower bound of a price book's FTE tier. First tries the
// fte_range column; if null (not populated for some imported books or
// manually-created ones), falls back to extracting from the name itself
// (e.g. "1-20 Pricebook" → 1). null only when truly unparseable so we
// can sort flat-rate books like "Standard Price Book" to the bottom.
function parseFteRange(s: string | null, name?: string): number | null {
  if (s) {
    const m = s.match(/^(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  if (name) {
    const m = name.match(/(\d+)\s*-\s*\d+|(\d+)\s*\+/);
    if (m) return parseInt(m[1] ?? m[2], 10);
  }
  return null;
}

export function useDeletePriceBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; cascade: boolean }) => {
      // Optionally clear all entries first so the FK doesn't block.
      if (vars.cascade) {
        const { error: entriesErr } = await supabase
          .from("price_book_entries")
          .delete()
          .eq("price_book_id", vars.id);
        if (entriesErr) throw entriesErr;
      }
      const { error } = await supabase.from("price_books").delete().eq("id", vars.id);
      if (error) throw error;
      return vars.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_books"] });
      qc.invalidateQueries({ queryKey: ["price_book_entries"] });
    },
  });
}

// Count entries on a single price book — used by the delete dialog
// to warn before cascading.
export function usePriceBookEntryCount(priceBookId: string | undefined) {
  return useQuery({
    queryKey: ["price_book_entry_count", priceBookId],
    queryFn: async () => {
      if (!priceBookId) throw new Error("Missing price book id");
      const { count, error } = await supabase
        .from("price_book_entries")
        .select("id", { count: "exact", head: true })
        .eq("price_book_id", priceBookId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!priceBookId,
  });
}

export function useCreatePriceBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<PriceBook>) => {
      const { data, error } = await supabase
        .from("price_books")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBook;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_books"] });
    },
  });
}

export function useUpdatePriceBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<PriceBook> & { id: string }) => {
      const { data, error } = await supabase
        .from("price_books")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBook;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price_books"] });
    },
  });
}

// ─── Price Book Entries ──────────────────────────────────

export function usePriceBookEntries(priceBookId: string | undefined) {
  return useQuery({
    queryKey: ["price_book_entries", priceBookId],
    queryFn: async () => {
      if (!priceBookId) throw new Error("Missing price book ID");
      const { data, error } = await supabase
        .from("price_book_entries")
        .select("*, product:products!product_id(id, name, code)")
        .eq("price_book_id", priceBookId)
        .order("fte_range");
      if (error) throw error;
      return data as PriceBookEntry[];
    },
    enabled: !!priceBookId,
  });
}

export function useCreatePriceBookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      price_book_id: string;
      product_id: string;
      fte_range: string | null;
      unit_price: number;
    }) => {
      const { data, error } = await supabase
        .from("price_book_entries")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as PriceBookEntry;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["price_book_entries", vars.price_book_id] });
    },
  });
}

// Set the unit price for a (price_book, product, fte_range) combo.
// Inserts when missing, updates when present, deletes when price is
// cleared (null/empty). Used by the matrix editor in PriceBookCard so
// admins don't need to click "Add Entry" + select product for every row.
export function useSetPriceBookEntryPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      price_book_id: string;
      product_id: string;
      fte_range: string | null;
      unit_price: number | null;
      existing_entry_id?: string | null;
    }) => {
      // Clear → delete
      if (vars.unit_price === null) {
        if (!vars.existing_entry_id) return null;
        const { error } = await supabase
          .from("price_book_entries")
          .delete()
          .eq("id", vars.existing_entry_id);
        if (error) throw error;
        return null;
      }

      // Existing → update price
      if (vars.existing_entry_id) {
        const { data, error } = await supabase
          .from("price_book_entries")
          .update({ unit_price: vars.unit_price })
          .eq("id", vars.existing_entry_id)
          .select()
          .single();
        if (error) throw error;
        return data as PriceBookEntry;
      }

      // New → insert
      const { data, error } = await supabase
        .from("price_book_entries")
        .insert({
          price_book_id: vars.price_book_id,
          product_id: vars.product_id,
          fte_range: vars.fte_range,
          unit_price: vars.unit_price,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PriceBookEntry;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["price_book_entries", vars.price_book_id] });
      qc.invalidateQueries({ queryKey: ["price_book_entries_by_product", vars.product_id] });
    },
  });
}

export function useDeletePriceBookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, priceBookId }: { id: string; priceBookId: string }) => {
      const { error } = await supabase
        .from("price_book_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return priceBookId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["price_book_entries", vars.priceBookId] });
    },
  });
}

// ─── Product Families ────────────────────────────────────

export function useProductFamilies() {
  return useQuery({
    queryKey: ["product_families"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_families")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as ProductFamily[];
    },
  });
}

export function useCreateProductFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("product_families")
        .insert({ name: name.trim() })
        .select()
        .single();
      if (error) throw error;
      return data as ProductFamily;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_families"] }),
  });
}

export function useDeleteProductFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_families")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_families"] }),
  });
}
