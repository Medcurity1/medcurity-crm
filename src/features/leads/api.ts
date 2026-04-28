import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Lead } from "@/types/crm";

interface LeadFilters {
  search?: string;
  status?: string | string[];
  source?: string | string[];
  qualification?: string | string[];
  ownerId?: string | "mine";
  rating?: string | string[];
  industryCategory?: string | string[];
  verified?: "true" | "false";
  /** Include converted leads (default: false — they're hidden Salesforce-style). */
  includeConverted?: boolean;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function useLeads(filters?: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const sortCol = filters?.sortColumn ?? "created_at";
      const sortAsc = (filters?.sortDirection ?? (filters?.sortColumn ? "asc" : "desc")) === "asc";
      let query = supabase
        .from("leads")
        // 'estimated' uses Postgres pg_class reltuples instead of a
        // full COUNT(*) — orders of magnitude faster on a 30k-row table
        // and accurate enough for pagination controls. Falls back to
        // an exact count only when the estimate is below ~1000.
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "estimated" })
        .is("archived_at", null)
        .order(sortCol, { ascending: sortAsc, nullsFirst: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        query = query.or(
          `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,company.ilike.%${filters.search}%,email.ilike.%${filters.search}%,industry.ilike.%${filters.search}%`
        );
      }
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          if (filters.status.length > 0) query = query.in("status", filters.status);
        } else {
          query = query.eq("status", filters.status);
        }
      }
      if (filters?.source) {
        if (Array.isArray(filters.source)) {
          if (filters.source.length > 0) query = query.in("source", filters.source);
        } else {
          query = query.eq("source", filters.source);
        }
      }
      if (filters?.qualification) {
        if (Array.isArray(filters.qualification)) {
          if (filters.qualification.length > 0) query = query.in("qualification", filters.qualification);
        } else {
          query = query.eq("qualification", filters.qualification);
        }
      }
      if (filters?.ownerId && filters.ownerId !== "mine") {
        query = query.eq("owner_user_id", filters.ownerId);
      } else if (filters?.ownerId === "mine") {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user?.id) query = query.eq("owner_user_id", userData.user.id);
      }
      if (filters?.rating) {
        if (Array.isArray(filters.rating)) {
          if (filters.rating.length > 0) query = query.in("rating", filters.rating);
        } else {
          query = query.eq("rating", filters.rating);
        }
      }
      if (filters?.industryCategory) {
        if (Array.isArray(filters.industryCategory)) {
          if (filters.industryCategory.length > 0)
            query = query.in("industry_category", filters.industryCategory);
        } else {
          query = query.eq("industry_category", filters.industryCategory);
        }
      }
      if (filters?.verified === "true") query = query.eq("verified", true);
      else if (filters?.verified === "false") query = query.eq("verified", false);

      // Hide converted leads by default — they're tombstones with
      // pointers to the contact/account that took over. Reps still
      // need them findable, just not in the working list.
      if (!filters?.includeConverted) {
        query = query.is("converted_at", null);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Lead[], count: count ?? 0 };
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ["leads", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing lead ID");
      const { data, error } = await supabase
        .from("leads")
        .select("*, owner:user_profiles!owner_user_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Lead;
    },
    enabled: !!id,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Lead>) => {
      const { data, error } = await supabase
        .from("leads")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Lead> & { id: string }) => {
      const { data, error } = await supabase
        .from("leads")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads", vars.id] });
    },
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      const promises = ids.map((id) =>
        supabase.from("leads").update({ owner_user_id }).eq("id", id)
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      // Delete in batches of 50
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("leads").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "leads",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

interface ConvertLeadInput {
  leadId: string;
  accountName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  industry: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  leadSource: string | null;
  createOpportunity: boolean;
  opportunityName?: string;
  opportunityAmount?: number;
  opportunityStage?: string;
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConvertLeadInput) => {
      // 1. Create account
      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .insert({
          name: input.accountName,
          industry: input.industry,
          website: input.website,
          billing_street: input.street,
          billing_city: input.city,
          billing_state: input.state,
          billing_zip: input.zip,
          billing_country: input.country,
        })
        .select()
        .single();
      if (accountError) throw accountError;

      // 2. Create contact
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          account_id: account.id,
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          title: input.title,
          is_primary: true,
          lead_source: input.leadSource ?? null,
          original_lead_id: input.leadId,
        })
        .select()
        .single();
      if (contactError) throw contactError;

      // 3. Optionally create opportunity
      let opportunity = null;
      if (input.createOpportunity && input.opportunityName) {
        const { data: opp, error: oppError } = await supabase
          .from("opportunities")
          .insert({
            account_id: account.id,
            primary_contact_id: contact.id,
            name: input.opportunityName,
            amount: input.opportunityAmount ?? 0,
            stage: input.opportunityStage ?? "details_analysis",
            team: "sales",
            kind: "new_business",
          })
          .select()
          .single();
        if (oppError) throw oppError;
        opportunity = opp;
      }

      // 4. Update lead as converted
      const { error: updateError } = await supabase
        .from("leads")
        .update({
          status: "converted",
          converted_at: new Date().toISOString(),
          converted_account_id: account.id,
          converted_contact_id: contact.id,
          converted_opportunity_id: opportunity?.id ?? null,
        })
        .eq("id", input.leadId);
      if (updateError) throw updateError;

      return { account, contact, opportunity };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}
