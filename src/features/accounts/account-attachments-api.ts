import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

// Documents attached to an account (proposals, partner agreements, marketing
// materials). Files live in the private 'account-attachments' bucket; the
// account_attachments table holds metadata. Mirrors the request-attachments
// plumbing but uploads immediately (the account is a live record, not a form).

const BUCKET = "account-attachments";

export interface AccountAttachment {
  id: string;
  account_id: string;
  original_filename: string;
  storage_path: string;
  mimetype: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  uploader?: { full_name: string | null } | null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
}

export function useAccountAttachments(accountId: string | undefined) {
  return useQuery({
    queryKey: ["account-attachments", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_attachments")
        .select("*, uploader:user_profiles!uploaded_by(full_name)")
        .eq("account_id", accountId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AccountAttachment[];
    },
    enabled: !!accountId,
  });
}

/**
 * Upload files to the account immediately. Best-effort per file: returns the
 * names that failed so the UI can warn without failing the whole batch. If the
 * metadata insert fails (e.g. RLS), the orphaned storage object is removed so
 * we don't leak files.
 */
export function useUploadAccountAttachments(accountId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (files: File[]): Promise<string[]> => {
      const failed: string[] = [];
      for (const f of files) {
        const path = `${accountId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFilename(f.name)}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (upErr) {
          failed.push(f.name);
          continue;
        }
        const { error: rowErr } = await supabase.from("account_attachments").insert({
          account_id: accountId,
          original_filename: f.name,
          storage_path: path,
          mimetype: f.type || null,
          size_bytes: f.size,
          uploaded_by: user?.id ?? null,
        });
        if (rowErr) {
          await supabase.storage.from(BUCKET).remove([path]);
          failed.push(f.name);
        }
      }
      return failed;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-attachments", accountId] }),
  });
}

export function useDeleteAccountAttachment(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (att: AccountAttachment) => {
      // Delete the metadata row first — but VERIFY a row was actually removed
      // before touching storage. An RLS-denied DELETE matches zero rows and
      // returns NO error, so without the .select() row-count check a
      // non-uploader would fall through and orphan-delete the file while the
      // row survives. The storage RLS also only lets the owner/admin remove
      // the object, so this is belt-and-suspenders with the policy.
      const { data: deleted, error } = await supabase
        .from("account_attachments")
        .delete()
        .eq("id", att.id)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error("You can only delete files you uploaded.");
      }
      // Storage cleanup is best-effort (the row is already gone), but don't
      // swallow a failure silently — surface it so an orphaned object is noticed.
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([att.storage_path]);
      if (rmErr) {
        console.warn("Account attachment storage cleanup failed (row deleted):", rmErr.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-attachments", accountId] }),
  });
}

/** Open a short-lived signed download URL for an attachment. */
export async function downloadAccountAttachment(att: AccountAttachment) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(att.storage_path, 3600, { download: att.original_filename });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create download link");
  }
  window.open(data.signedUrl, "_blank", "noopener");
}
