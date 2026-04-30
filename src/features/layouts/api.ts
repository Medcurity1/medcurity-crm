import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  LayoutEntity,
  PageLayout,
  PageLayoutField,
  PageLayoutSection,
  PageLayoutSectionWithFields,
  ResolvedPageLayout,
} from "./types";

/**
 * Fetch a single resolved layout (sections + fields, ordered) for an entity.
 * Defaults to the layout named 'standard'. Cached aggressively — layouts
 * change rarely and every Detail/Form page reads them.
 */
export function usePageLayout(entity: LayoutEntity, name: string = "standard") {
  return useQuery({
    queryKey: ["page_layout", entity, name],
    queryFn: async (): Promise<ResolvedPageLayout | null> => {
      const { data: layout, error: lErr } = await supabase
        .from("page_layouts")
        .select("*")
        .eq("entity", entity)
        .eq("name", name)
        .maybeSingle();
      if (lErr) throw lErr;
      if (!layout) return null;

      const { data: sections, error: sErr } = await supabase
        .from("page_layout_sections")
        .select("*")
        .eq("layout_id", layout.id)
        .order("sort_order", { ascending: true });
      if (sErr) throw sErr;

      const sectionIds = (sections ?? []).map((s) => s.id);
      const { data: fields, error: fErr } = sectionIds.length
        ? await supabase
            .from("page_layout_fields")
            .select("*")
            .in("section_id", sectionIds)
            .order("sort_order", { ascending: true })
        : { data: [] as PageLayoutField[], error: null };
      if (fErr) throw fErr;

      const byS: Record<string, PageLayoutField[]> = {};
      for (const f of (fields ?? []) as PageLayoutField[]) {
        (byS[f.section_id] ??= []).push(f);
      }

      const resolved: ResolvedPageLayout = {
        ...(layout as PageLayout),
        sections: ((sections ?? []) as PageLayoutSection[]).map(
          (s): PageLayoutSectionWithFields => ({ ...s, fields: byS[s.id] ?? [] })
        ),
      };
      return resolved;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Convenience hook for non-layout-driven forms: returns a Map of field_key →
 * help_text for an entity's standard layout, so a hand-coded form can wire
 * `<HelpTooltip text={helpMap.get('discount')} />` next to its labels and
 * pick up any admin-edited help text without becoming fully layout-driven.
 *
 * Returns an empty map until the layout loads (so labels render immediately).
 */
export function useFieldHelpMap(entity: LayoutEntity, name: string = "standard") {
  const { data } = usePageLayout(entity, name);
  const map = new Map<string, string>();
  if (data) {
    for (const section of data.sections) {
      for (const field of section.fields) {
        if (field.help_text && field.help_text.trim()) {
          map.set(field.field_key, field.help_text.trim());
        }
      }
    }
  }
  return map;
}

/** List all layouts (for the admin Object Manager → Layouts tab). */
export function usePageLayouts() {
  return useQuery({
    queryKey: ["page_layouts_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("page_layouts")
        .select("*")
        .order("entity", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PageLayout[];
    },
    staleTime: 60 * 1000,
  });
}

// ---------------------------------------------------------------------
// Mutations (admin only — RLS enforces this on the database, but we
// also avoid firing the request client-side when we already know the
// user lacks permission to keep the network panel clean).
// ---------------------------------------------------------------------

export function useUpdatePageLayoutSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          PageLayoutSection,
          "title" | "sort_order" | "collapsed_by_default" | "detail_only" | "form_only"
        >
      >;
    }) => {
      const { data, error } = await supabase
        .from("page_layout_sections")
        .update(input.patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as PageLayoutSection;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["page_layout"] });
      qc.invalidateQueries({ queryKey: ["page_layouts_all"] });
    },
  });
}

export function useCreatePageLayoutSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      layout_id: string;
      title: string;
      sort_order: number;
      collapsed_by_default?: boolean;
      detail_only?: boolean;
      form_only?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("page_layout_sections")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as PageLayoutSection;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page_layout"] }),
  });
}

export function useDeletePageLayoutSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("page_layout_sections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page_layout"] }),
  });
}

export function useUpdatePageLayoutField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          PageLayoutField,
          | "section_id"
          | "sort_order"
          | "width"
          | "read_only_on_form"
          | "hide_on_form"
          | "hide_on_detail"
          | "admin_only_on_form"
          | "required_override"
          | "label_override"
          | "help_text"
        >
      >;
    }) => {
      const { data, error } = await supabase
        .from("page_layout_fields")
        .update(input.patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as PageLayoutField;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page_layout"] }),
  });
}

export function useCreatePageLayoutField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      section_id: string;
      field_key: string;
      sort_order: number;
      width?: PageLayoutField["width"];
    }) => {
      const { data, error } = await supabase
        .from("page_layout_fields")
        .insert({ width: "half", ...input })
        .select()
        .single();
      if (error) throw error;
      return data as PageLayoutField;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page_layout"] }),
  });
}

export function useDeletePageLayoutField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("page_layout_fields").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page_layout"] }),
  });
}
