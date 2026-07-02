import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Paperclip, Upload, Download, Trash2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/formatters";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useAccountAttachments,
  useUploadAccountAttachments,
  useDeleteAccountAttachment,
  downloadAccountAttachment,
  type AccountAttachment,
} from "./account-attachments-api";

const MAX_MB = 25;

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AccountAttachments({ accountId }: { accountId: string }) {
  const { data: attachments, isLoading } = useAccountAttachments(accountId);
  const upload = useUploadAccountAttachments(accountId);
  const del = useDeleteAccountAttachment(accountId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountAttachment | null>(null);
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  // Only the uploader (or an admin) may delete a file — matches the RLS, so the
  // button never appears where the action would just error.
  const canDelete = (att: AccountAttachment) => att.uploaded_by === user?.id || isAdmin;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const tooBig = files.filter((f) => f.size > MAX_MB * 1024 * 1024);
    const ok = files.filter((f) => f.size <= MAX_MB * 1024 * 1024);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
    if (tooBig.length) {
      toast.error(`Skipped (over ${MAX_MB} MB): ${tooBig.map((f) => f.name).join(", ")}`);
    }
    if (ok.length === 0) return;
    try {
      const failed = await upload.mutateAsync(ok);
      if (failed.length) {
        toast.warning(`Failed to upload: ${failed.join(", ")}`);
      } else {
        toast.success(ok.length === 1 ? "File uploaded" : `${ok.length} files uploaded`);
      }
    } catch (e) {
      toast.error("Upload failed: " + (e as Error).message);
    }
  }

  function confirmDelete() {
    const att = deleteTarget;
    if (!att) return;
    setDeleteTarget(null);
    del.mutate(att, {
      onSuccess: () => toast.success("File deleted"),
      onError: (e) => toast.error("Couldn't delete: " + (e as Error).message),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> Attachments
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="gap-1.5"
        >
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !attachments || attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload proposals, signed agreements, or partner materials (up to {MAX_MB} MB each).
          </p>
        ) : (
          <ul className="divide-y">
            {attachments.map((att) => (
              <li key={att.id} className="flex items-center gap-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() =>
                      downloadAccountAttachment(att).catch((e) => toast.error((e as Error).message))
                    }
                    className="block truncate text-left text-sm font-medium text-primary hover:underline"
                    title={att.original_filename}
                  >
                    {att.original_filename}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(att.size_bytes)}
                    {att.size_bytes ? " · " : ""}
                    {att.uploader?.full_name ?? "Unknown"} · {formatDate(att.created_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                  title="Download"
                  onClick={() =>
                    downloadAccountAttachment(att).catch((e) => toast.error((e as Error).message))
                  }
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canDelete(att) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => setDeleteTarget(att)}
                    disabled={del.isPending && del.variables?.id === att.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Pulse-styled 2-click delete confirmation (not the browser confirm). */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.original_filename}” will be permanently removed from
              this account. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
