// Custom contact tags (Reports overhaul, phase 1). Org-wide tag vocabulary
// + a contacts<->tags join. Reps create tags, apply/remove them on
// contacts, and filter by them to build custom lists.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tag } from "@/types/crm";

/** The whole tag vocabulary (small; one org-wide list). */
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
  });
}

/** Tags on a single contact (for the contact detail page). */
export function useContactTags(contactId: string | undefined) {
  return useQuery({
    queryKey: ["contact-tags", contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_tags")
        .select("tag:tags(*)")
        .eq("contact_id", contactId!);
      if (error) throw error;
      // PostgREST returns the to-one embed as a single object; supabase-js
      // types it as an array, so cast through unknown.
      const rows = (data ?? []) as unknown as { tag: Tag | null }[];
      return (rows.map((r) => r.tag).filter(Boolean) as Tag[]).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    },
  });
}

/**
 * Tags for a page of contacts at once -> Map<contactId, Tag[]>. Scoped to
 * the given ids so the contacts list can render a tags column without an
 * N+1 (one query per page, mirroring the partners last-contact pattern).
 */
export function useContactTagsMap(contactIds: string[]) {
  // Stable key: sorted ids so identical pages share cache.
  const key = [...contactIds].sort().join(",");
  return useQuery({
    queryKey: ["contact-tags-map", key],
    enabled: contactIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_tags")
        .select("contact_id, tag:tags(*)")
        .in("contact_id", contactIds);
      if (error) throw error;
      const map = new Map<string, Tag[]>();
      const rows = (data ?? []) as unknown as { contact_id: string; tag: Tag | null }[];
      for (const row of rows) {
        if (!row.tag) continue;
        const list = map.get(row.contact_id) ?? [];
        list.push(row.tag);
        map.set(row.contact_id, list);
      }
      for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
      return map;
    },
  });
}

function invalidateTagViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["contact-tags"] });
  qc.invalidateQueries({ queryKey: ["contact-tags-map"] });
  // Lists filtered by tag need to refetch.
  qc.invalidateQueries({ queryKey: ["contacts"] });
}

/** Create a tag (case-insensitively unique). Returns the new/existing tag. */
export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string | null }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Tag name is required");
      const { data, error } = await supabase
        .from("tags")
        .insert({ name: trimmed, color: color ?? null })
        .select()
        .single();
      if (error) {
        // 23505 = the case-insensitive unique index; reuse the existing tag.
        if (error.code === "23505") {
          // Escape ilike wildcards so a name containing % or _ matches
          // literally (case-insensitively), not as a pattern.
          const pattern = trimmed.replace(/([\\%_])/g, "\\$1");
          const { data: existing } = await supabase
            .from("tags")
            .select("*")
            .ilike("name", pattern)
            .maybeSingle();
          if (existing) return existing as Tag;
        }
        throw error;
      }
      return data as Tag;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

/** Apply a tag to one or more contacts (idempotent). */
export function useApplyTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactIds, tagId }: { contactIds: string[]; tagId: string }) => {
      if (contactIds.length === 0) return;
      const rows = contactIds.map((contact_id) => ({ contact_id, tag_id: tagId }));
      const { error } = await supabase
        .from("contact_tags")
        .upsert(rows, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => invalidateTagViews(qc),
  });
}

/** Remove a tag from one or more contacts. */
export function useRemoveTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactIds, tagId }: { contactIds: string[]; tagId: string }) => {
      if (contactIds.length === 0) return;
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("tag_id", tagId)
        .in("contact_id", contactIds);
      if (error) throw error;
    },
    onSuccess: () => invalidateTagViews(qc),
  });
}
