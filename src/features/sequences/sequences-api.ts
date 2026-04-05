import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Sequence, SequenceStep, SequenceEnrollment } from "@/types/crm";

// ---------------------------------------------------------------------------
// Sequences CRUD
// ---------------------------------------------------------------------------

export function useSequences() {
  return useQuery({
    queryKey: ["sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Sequence[];
    },
  });
}

export function useSequence(id: string | undefined) {
  return useQuery({
    queryKey: ["sequences", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing sequence ID");
      const { data, error } = await supabase
        .from("sequences")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Sequence;
    },
    enabled: !!id,
  });
}

export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      name: string;
      description?: string;
      steps: SequenceStep[];
      owner_user_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("sequences")
        .insert({
          name: values.name,
          description: values.description ?? null,
          steps: values.steps as unknown as Record<string, unknown>[],
          owner_user_id: values.owner_user_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Sequence;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<Sequence> & { id: string }) => {
      const payload: Record<string, unknown> = { ...values };
      if (values.steps) {
        payload.steps = values.steps as unknown as Record<string, unknown>[];
      }
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      const { data, error } = await supabase
        .from("sequences")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Sequence;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      qc.invalidateQueries({ queryKey: ["sequences", vars.id] });
    },
  });
}

export function useDeleteSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

export function useSequenceEnrollments(sequenceId: string | undefined) {
  return useQuery({
    queryKey: ["sequence-enrollments", sequenceId],
    queryFn: async () => {
      if (!sequenceId) throw new Error("Missing sequence ID");
      const { data, error } = await supabase
        .from("sequence_enrollments")
        .select(
          "*, lead:leads(id, first_name, last_name, company, phone, email), contact:contacts(id, first_name, last_name, phone, email, account:accounts(name))"
        )
        .eq("sequence_id", sequenceId)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data as unknown as SequenceEnrollment[];
    },
    enabled: !!sequenceId,
  });
}

export function useEnrollInSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      sequence_id: string;
      lead_id?: string | null;
      contact_id?: string | null;
      account_id?: string | null;
      owner_user_id?: string | null;
    }) => {
      // Calculate next_touch_at based on first step
      const { data: seq } = await supabase
        .from("sequences")
        .select("steps")
        .eq("id", values.sequence_id)
        .single();

      const steps = (seq?.steps as unknown as SequenceStep[]) ?? [];
      const firstStep = steps.find((s) => s.step_number === 1);
      const delayDays = firstStep?.delay_days ?? 0;
      const nextTouch = new Date();
      nextTouch.setDate(nextTouch.getDate() + delayDays);

      const { data, error } = await supabase
        .from("sequence_enrollments")
        .insert({
          sequence_id: values.sequence_id,
          lead_id: values.lead_id ?? null,
          contact_id: values.contact_id ?? null,
          account_id: values.account_id ?? null,
          owner_user_id: values.owner_user_id ?? null,
          current_step: 1,
          status: "active",
          next_touch_at: nextTouch.toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["sequence-enrollments", vars.sequence_id],
      });
      qc.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

export function useAdvanceEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      sequenceId: _sequenceId,
    }: {
      enrollmentId: string;
      sequenceId: string;
    }) => {
      // Get enrollment + sequence
      const { data: enrollment, error: eErr } = await supabase
        .from("sequence_enrollments")
        .select("current_step, sequence_id")
        .eq("id", enrollmentId)
        .single();
      if (eErr) throw eErr;

      const { data: seq, error: sErr } = await supabase
        .from("sequences")
        .select("steps")
        .eq("id", enrollment.sequence_id)
        .single();
      if (sErr) throw sErr;

      const steps = (seq.steps as unknown as SequenceStep[]) ?? [];
      const nextStepNum = enrollment.current_step + 1;
      const nextStep = steps.find((s) => s.step_number === nextStepNum);

      if (!nextStep) {
        // Sequence complete
        const { error } = await supabase
          .from("sequence_enrollments")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            next_touch_at: null,
          })
          .eq("id", enrollmentId);
        if (error) throw error;
      } else {
        const nextTouch = new Date();
        nextTouch.setDate(nextTouch.getDate() + nextStep.delay_days);
        const { error } = await supabase
          .from("sequence_enrollments")
          .update({
            current_step: nextStepNum,
            next_touch_at: nextTouch.toISOString(),
          })
          .eq("id", enrollmentId);
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["sequence-enrollments", vars.sequenceId],
      });
      qc.invalidateQueries({ queryKey: ["sequences"] });
    },
  });
}

export function usePauseEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      reason,
    }: {
      enrollmentId: string;
      sequenceId: string;
      reason?: string;
    }) => {
      const { error } = await supabase
        .from("sequence_enrollments")
        .update({
          status: "paused",
          paused_reason: reason ?? null,
        })
        .eq("id", enrollmentId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["sequence-enrollments", vars.sequenceId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Enrollment count per sequence (for list view)
// ---------------------------------------------------------------------------

export function useSequenceEnrollmentCounts() {
  return useQuery({
    queryKey: ["sequence-enrollment-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequence_enrollments")
        .select("sequence_id, status");
      if (error) throw error;

      const counts: Record<string, { active: number; total: number }> = {};
      for (const row of data ?? []) {
        if (!counts[row.sequence_id]) {
          counts[row.sequence_id] = { active: 0, total: 0 };
        }
        counts[row.sequence_id].total++;
        if (row.status === "active") {
          counts[row.sequence_id].active++;
        }
      }
      return counts;
    },
  });
}
