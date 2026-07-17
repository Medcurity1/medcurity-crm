import { useState } from "react";
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Loader2, UserCheck, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { parseCsv } from "@/features/playbook/csv";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types/crm";
import { TagPicker } from "@/features/tags/TagPicker";
import { tagColorClass } from "@/features/tags/TagChips";
import {
  useCountPromotable,
  useBulkPromoteImports,
  resolveLeadIdsByEmail,
  type PromotePreview,
  type BulkPromoteResult,
} from "./api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Promotion is heavy per row (dedup + account match/create + contact insert),
// so keep batches small. Preview is a cheap count, so it can go wider.
// Sized down 2026-07-17 after Jordan's 13k file hit statement timeouts:
// with migration 20260717000006's indexed dedup each call is subsecond,
// but smaller chunks keep every call far from the 8s limit regardless.
const PROMOTE_CHUNK = 150;
const PREVIEW_CHUNK = 1000;

interface ParsedFile {
  fileName: string;
  rowCount: number;
  /** Final lead ids to work: explicit ID column ∪ ids resolved from emails. */
  ids: string[];
  emailCount: number;
  emailMatched: number;
}

// Accepts an "ID" column, an "Email" column, or both (same ergonomics as
// Bulk Archive From File — Jordan's clean lists come back keyed by email).
function extractIdsAndEmails(text: string): { ids: string[]; emails: string[]; rowCount: number } | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === "id");
  const emailCol = header.findIndex(
    (h) => h === "email" || h === "e-mail" || h === "email_address",
  );
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const r of rows.slice(1)) {
    if (idCol >= 0) {
      const id = (r[idCol] ?? "").trim();
      if (UUID_RE.test(id)) ids.add(id.toLowerCase());
    }
    if (emailCol >= 0) {
      const e = (r[emailCol] ?? "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) emails.add(e);
    }
  }
  return { ids: [...ids], emails: [...emails], rowCount: rows.length - 1 };
}

function chunk(ids: string[], n: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

export function BulkPromoteFromFile({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchTags, setBatchTags] = useState<Tag[]>([]);
  const countPromotable = useCountPromotable();
  const promote = useBulkPromoteImports();

  function reset() {
    setParsed(null);
    setPreview(null);
    setParseError(null);
    setConfirmOpen(false);
    setProgress(null);
    setBatchTags([]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setPreview(null);
    setParsed(null);
    try {
      const text = await file.text();
      const p = extractIdsAndEmails(text);
      if (!p || (p.ids.length === 0 && p.emails.length === 0)) {
        setParseError(
          "Couldn't find any lead IDs or emails in that file. Expected an 'ID' or 'Email' column.",
        );
        return;
      }
      // Emails → lead ids server-side, merged with any explicit ids.
      let emailMatched = 0;
      const ids = new Set(p.ids);
      if (p.emails.length > 0) {
        setRunning(true);
        try {
          const resolved = await resolveLeadIdsByEmail(p.emails);
          emailMatched = resolved.length;
          for (const id of resolved) ids.add(id);
        } finally {
          setRunning(false);
        }
      }
      if (ids.size === 0) {
        setParseError(
          "None of the emails in that file matched an existing lead (and no ID column was present).",
        );
        return;
      }
      setParsed({
        fileName: file.name,
        rowCount: p.rowCount,
        ids: [...ids],
        emailCount: p.emails.length,
        emailMatched,
      });
    } catch (err) {
      setRunning(false);
      setParseError("Failed to read the file: " + (err as Error).message);
    }
  }

  async function runPreview() {
    if (!parsed) return;
    const batches = chunk(parsed.ids, PREVIEW_CHUNK);
    const agg: PromotePreview = { matched: 0, promotable: 0, already_done: 0, already_contact: 0 };
    setRunning(true);
    setProgress({ done: 0, total: parsed.ids.length });
    try {
      let done = 0;
      for (const b of batches) {
        const r = await countPromotable.mutateAsync(b);
        agg.matched += r.matched;
        agg.promotable += r.promotable;
        agg.already_done += r.already_done;
        agg.already_contact += r.already_contact;
        done += b.length;
        setProgress({ done, total: parsed.ids.length });
      }
      setPreview(agg);
    } catch (err) {
      toast.error("Preview failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function runPromote() {
    if (!parsed) return;
    const batches = chunk(parsed.ids, PROMOTE_CHUNK);
    const agg: BulkPromoteResult = {
      promoted: 0,
      skipped_duplicate: 0,
      skipped_ambiguous: 0,
      skipped_other: 0,
      errors: 0,
      last_error: null,
    };
    setRunning(true);
    setProgress({ done: 0, total: parsed.ids.length });
    try {
      let done = 0;
      const tagIds = batchTags.map((t) => t.id);
      for (const b of batches) {
        const r = await promote.mutateAsync({ ids: b, tagIds });
        agg.promoted += r.promoted;
        agg.skipped_duplicate += r.skipped_duplicate;
        agg.skipped_ambiguous += r.skipped_ambiguous;
        agg.skipped_other += r.skipped_other;
        agg.errors += r.errors;
        if (r.last_error) agg.last_error = r.last_error;
        done += b.length;
        setProgress({ done, total: parsed.ids.length });
      }
      toast.success(
        `Promoted ${agg.promoted.toLocaleString()} to contacts` +
          (agg.skipped_duplicate ? ` · ${agg.skipped_duplicate.toLocaleString()} already contacts` : "") +
          (agg.errors ? ` · ${agg.errors.toLocaleString()} errors` : ""),
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error("Promote failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          onOpenChange(o);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-600" /> Bulk promote from file
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a verified <span className="font-medium">"good"</span> list (e.g. a MillionVerifier OK
              export). We match its rows to your existing leads by <span className="font-medium">ID or
              email</span> and promote them to{" "}
              <span className="font-medium">Contacts</span> — matching or creating an account, and skipping
              anyone who's already a contact. Nothing happens until you review the preview and confirm.
            </p>

            <div className="space-y-2">
              <Label htmlFor="bulk-promote-file">CSV file</Label>
              <Input id="bulk-promote-file" type="file" accept=".csv,text/csv" onChange={onFile} />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {parseError}
              </div>
            )}

            {parsed && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="font-medium truncate">{parsed.fileName}</div>
                <div className="text-muted-foreground">
                  {parsed.rowCount.toLocaleString()} rows · {parsed.ids.length.toLocaleString()} leads matched
                  {parsed.emailCount > 0 && (
                    <> · {parsed.emailMatched.toLocaleString()} of {parsed.emailCount.toLocaleString()} emails found</>
                  )}
                </div>
              </div>
            )}

            {parsed && (
              <div className="space-y-2">
                <Label>Tag the new contacts (recommended)</Label>
                <p className="text-xs text-muted-foreground">
                  Every contact this run creates gets these tags — so the batch stays
                  filterable later (e.g. "Jordan Clean Jul 2026").
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {batchTags.map((t) => (
                    <Badge key={t.id} className={cn("gap-1 border-transparent", tagColorClass(t.color))}>
                      {t.name}
                      <button
                        type="button"
                        onClick={() => setBatchTags((prev) => prev.filter((x) => x.id !== t.id))}
                        className="opacity-70 hover:opacity-100"
                        aria-label={`Remove ${t.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <TagPicker
                    appliedTagIds={batchTags.map((t) => t.id)}
                    onPick={(tag) =>
                      setBatchTags((prev) =>
                        prev.some((x) => x.id === tag.id) ? prev : [...prev, tag],
                      )
                    }
                  />
                </div>
              </div>
            )}

            {preview && (
              <div className="rounded-md border border-emerald-300/50 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
                <div className="font-semibold text-emerald-800 dark:text-emerald-200">Preview</div>
                <div className="text-emerald-900/80 dark:text-emerald-100/80">
                  <span className="font-semibold">{preview.promotable.toLocaleString()}</span> will be promoted
                  to contacts
                  {preview.already_contact > 0 && (
                    <> · {preview.already_contact.toLocaleString()} already contacts</>
                  )}
                  {preview.already_done > 0 && (
                    <> · {preview.already_done.toLocaleString()} already converted/archived</>
                  )}
                </div>
                {preview.promotable === 0 && (
                  <div className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                    Nothing to promote — none of these matched a promotable lead.
                  </div>
                )}
              </div>
            )}
          </div>

          {running && progress && (
            <div className="text-xs text-muted-foreground">
              Working… {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
            </div>
          )}
          <DialogFooter className="gap-2">
            {parsed && (
              <Button variant="outline" onClick={runPreview} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {preview ? "Re-check" : "Preview matches"}
              </Button>
            )}
            {preview && preview.promotable > 0 && (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={running}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Promote {preview.promotable.toLocaleString()} to contacts
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Promote ${preview?.promotable.toLocaleString() ?? 0} leads to contacts?`}
        description="Each becomes a Contact (with a matched or newly-created Account). Anyone already a contact is skipped. This runs immediately and can't be bulk-undone."
        confirmLabel="Promote them"
        onConfirm={runPromote}
      />
    </>
  );
}
