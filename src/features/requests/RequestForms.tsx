import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Send,
  Check,
  Plus,
  Paperclip,
  X,
  Bug,
  Sparkles,
  Loader2,
  Users,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { RequestPriority } from "@/types/crm";
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
import {
  useCreateRequest,
  classifyDraftBug,
  askClarifyingQuestions,
  type ClarifyQuestion,
  PRIORITY_OPTIONS,
  COLLATERAL_AUDIENCES,
  COLLATERAL_FORMATS,
  CRM_CHANGE_TYPES,
  type ProductCategory,
  type BugClassification,
} from "./api";
import { shouldWarnNotABug } from "./bug-warning";

/** The three request forms. Shared by RequestDialog (the only mount since the
 * Requests tab moved into the header popup — Nathan, 2026-08-04). */
export type RequestTab = "collateral" | "product" | "crm";

interface RequestFormProps {
  /** Reports whether the form holds unsubmitted user input (drives the
   * dialog's discard-on-close confirmation). Reported false on unmount. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Rendered as a "Done" button on the submitted panel (closes the dialog). */
  onDone?: () => void;
}

/** Reports dirtiness up to the dialog; clears the flag on unmount so a
 * switched-away-from form can't leave a stale "dirty" verdict behind. */
function useDirtyReport(dirty: boolean, onDirtyChange?: (d: boolean) => void) {
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: RequestPriority;
  onChange: (v: RequestPriority) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Priority</Label>
      <Select value={value} onValueChange={(v) => onChange(v as RequestPriority)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_OPTIONS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Sticky submit bar. -mx-6 is coupled to RequestDialog's scroll-body px-6
 * so the bar spans edge-to-edge; the body deliberately has NO bottom padding
 * (a negative-bottom-margin variant left a strip where scrolling content
 * peeked out under the bar — Nathan, 8/4). Fully opaque for the same reason.
 * No "From" line: it's always from the signed-in user anyway. */
function FormFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-4 flex justify-end border-t border-border bg-background px-6 py-3">
      {children}
    </div>
  );
}

/** A pasted screenshot arrives as a nameless blob (or a generic "image.png"),
 *  so several in one request would collide and read as identical in the
 *  attachment list. Stamp them so they sort and describe themselves. */
function nameForPastedImage(type: string): string {
  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 4);
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `screenshot-${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.${ext}`;
}

/** Thumbnails for image attachments. Object URLs are revoked when the file
 *  list changes so a long editing session doesn't leak blobs. */
function useImagePreviews(files: File[]): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    const made: string[] = [];
    const next: Record<number, string> = {};
    files.forEach((f, i) => {
      if (f.type.startsWith("image/")) {
        const u = URL.createObjectURL(f);
        made.push(u);
        next[i] = u;
      }
    });
    setUrls(next);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

/**
 * Attachment field (ports OG Nexus's uploads): up to `maxFiles` files, each
 * capped at `maxSizeMB`. Files upload when the request is submitted.
 *
 * Three ways in, because the old one only had the worst one: pasting (⌘V
 * straight from ⌘⇧4, no save-then-browse round trip), dragging onto the box,
 * or the file picker.
 *
 * The paste listener is on `window`, not on a focused drop zone. After taking a
 * screenshot people paste wherever their cursor happens to be — usually the
 * description box — and a paste that silently does nothing reads as "this form
 * can't take images". It only ever claims clipboard items that are actually
 * files of an image type, so pasting text anywhere is completely untouched.
 */
function AttachmentPicker({
  files,
  onChange,
  maxFiles = 5,
  maxSizeMB,
  urgeScreenshot = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB: number;
  /** Show the "a screenshot makes this much faster to fix" prompt. */
  urgeScreenshot?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const previews = useImagePreviews(files);

  // Held in a ref so the window paste listener never closes over a stale list.
  const filesRef = useRef(files);
  filesRef.current = files;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function mergeFiles(incoming: File[]) {
    const current = filesRef.current;
    const next = [...current];
    let rejectedForCount = false;
    for (const f of incoming) {
      if (next.length >= maxFiles) {
        rejectedForCount = true;
        break;
      }
      if (f.size > maxSizeMB * 1024 * 1024) {
        toast.error(`${f.name} is over the ${maxSizeMB} MB limit.`);
        continue;
      }
      next.push(f);
    }
    if (rejectedForCount) toast.error(`Up to ${maxFiles} files per request.`);
    if (next.length !== current.length) onChangeRef.current(next);
    return next.length - current.length;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    mergeFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const images: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (!f || !f.type.startsWith("image/")) continue;
        // Rename in place — see nameForPastedImage.
        images.push(
          new File([f], f.name && f.name !== "image.png" ? f.name : nameForPastedImage(f.type), {
            type: f.type,
          }),
        );
      }
      if (images.length === 0) return;
      // Only now — a paste we aren't handling must reach the field normally.
      e.preventDefault();
      const added = mergeFiles(images);
      if (added > 0) {
        toast.success(added === 1 ? "Screenshot attached" : `${added} images attached`);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // maxFiles/maxSizeMB are stable for a given form; files come from the ref.
  }, [maxFiles, maxSizeMB]);

  const full = files.length >= maxFiles;

  return (
    <div className="space-y-2">
      <Label>Attachments</Label>

      {urgeScreenshot && files.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200">
            <strong className="font-semibold">A screenshot makes this much faster to fix.</strong>{" "}
            Grab one with <kbd className="rounded border border-amber-400/50 px-1 font-mono">⌘⇧4</kbd>{" "}
            and just paste it here — no need to save the file first.
          </p>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {previews[i] ? (
                <img
                  src={previews[i]}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded border border-border object-cover"
                />
              ) : (
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {(f.size / (1024 * 1024)).toFixed(1)} MB
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onChange(files.filter((_, idx) => idx !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      <div
        onDragOver={(e) => {
          if (full) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (full) {
            toast.error(`Up to ${maxFiles} files per request.`);
            return;
          }
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-4 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
          full && "opacity-60",
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={full}
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach files
        </Button>
        <p className="text-xs text-muted-foreground">
          …or paste a screenshot, or drag files here.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Up to {maxFiles} files, {maxSizeMB} MB each. Optional.
      </p>
    </div>
  );
}

/**
 * The follow-ups a developer would otherwise have to come back and ask.
 *
 * Every one is optional and says so. The point is to catch the detail someone
 * would have happily given if anyone had asked — not to build a gate. A
 * required field here would just collect "n/a" three times, which is worse than
 * asking nothing, because it looks like an answer.
 */
function ClarifyingQuestions({
  questions,
  answers,
  onChange,
}: {
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">A couple of quick questions</p>
          <p className="text-xs text-muted-foreground">
            Answering these saves a round trip later. All optional — submit
            without them if they don&apos;t apply.
          </p>
        </div>
      </div>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <Label htmlFor={`clarify-${q.id}`} className="text-sm font-normal">
            {q.question}
          </Label>
          <Input
            id={`clarify-${q.id}`}
            maxLength={500}
            value={answers[q.id] ?? ""}
            onChange={(e) => onChange(q.id, e.target.value)}
            placeholder="Optional"
          />
        </div>
      ))}
    </div>
  );
}

function SubmittedPanel({ onAnother, onDone }: { onAnother: () => void; onDone?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
        <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h3 className="text-lg font-semibold">Request submitted</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Thanks! The right team has been notified and will take it from here.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <Button variant="outline" className="gap-2" onClick={onAnother}>
          <Plus className="h-4 w-4" /> Submit another
        </Button>
        {onDone && <Button onClick={onDone}>Done</Button>}
      </div>
    </div>
  );
}

// ── Collateral ───────────────────────────────────────────────────────
export function CollateralForm({ onDirtyChange, onDone }: RequestFormProps) {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [submitted, setSubmitted] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState("");
  const [partnerOrEvent, setPartnerOrEvent] = useState("");
  const [usage, setUsage] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("low");
  const [files, setFiles] = useState<File[]>([]);

  const dirty =
    !submitted &&
    (title.trim() !== "" ||
      description.trim() !== "" ||
      audience !== "" ||
      format !== "" ||
      partnerOrEvent.trim() !== "" ||
      usage.trim() !== "" ||
      files.length > 0);
  useDirtyReport(dirty, onDirtyChange);

  function reset() {
    setTitle("");
    setDescription("");
    setAudience("");
    setFormat("");
    setPartnerOrEvent("");
    setUsage("");
    setPriority("low");
    setFiles([]);
  }

  function submit() {
    if (!title.trim() || !description.trim()) {
      toast.error("Add a title and a description.");
      return;
    }
    create.mutate(
      {
        type: "collateral",
        title: title.trim(),
        description: description.trim(),
        priority,
        requesterName: profile?.full_name ?? null,
        details: {
          audience: audience || null,
          format: format || null,
          partner_or_event: partnerOrEvent.trim() || null,
          usage: usage.trim() || null,
        },
        files,
      },
      {
        onSuccess: (res) => {
          if (res.failedUploads.length > 0) {
            toast.warning(
              `Request submitted, but these files failed to upload: ${res.failedUploads.join(", ")}`,
            );
          } else {
            toast.success("Request submitted");
          }
          setSubmitted(true);
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
    );
  }

  if (submitted) {
    return (
      <SubmittedPanel
        onDone={onDone}
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="c-title">What do you need? <span className="text-destructive">*</span></Label>
        <Input id="c-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Billboard on I-90, budget: $0" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-desc">Describe what you need <span className="text-destructive">*</span></Label>
        <Textarea id="c-desc" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should it cover, any must-haves, references..." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Who is it for?</Label>
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger><SelectValue placeholder="Select audience" /></SelectTrigger>
            <SelectContent>
              {COLLATERAL_AUDIENCES.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Preferred format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue placeholder="Any format" /></SelectTrigger>
            <SelectContent>
              {COLLATERAL_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-partner">Specific partner or event?</Label>
        <Input id="c-partner" maxLength={200} value={partnerOrEvent} onChange={(e) => setPartnerOrEvent(e.target.value)} placeholder="Optional" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-usage">How will you use it?</Label>
        <Input id="c-usage" maxLength={200} value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="Optional" />
      </div>
      <AttachmentPicker files={files} onChange={setFiles} maxSizeMB={5} />
      <PrioritySelect value={priority} onChange={setPriority} />
      <FormFooter>
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Send className="h-4 w-4" />
          {create.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </FormFooter>
    </div>
  );
}

// ── Product ──────────────────────────────────────────────────────────

/** Bug vs Enhancement chooser — two selectable cards (Rachel, Jul 2026). */
function ProductCategoryPicker({
  value,
  onChange,
}: {
  value: ProductCategory | "";
  onChange: (v: ProductCategory) => void;
}) {
  const options: Array<{
    value: ProductCategory;
    label: string;
    blurb: string;
    icon: typeof Bug;
  }> = [
    {
      value: "bug",
      label: "Bug",
      blurb:
        "Something is broken. Only time-sensitive bugs affecting a client go straight to the dev team; everything else is reviewed first.",
      icon: Bug,
    },
    {
      value: "enhancement",
      label: "Enhancement",
      blurb: "An idea or improvement. Reviewed and approved before it's filed to Jira.",
      icon: Sparkles,
    },
  ];
  return (
    <div className="space-y-2">
      <Label>
        What kind of request is this? <span className="text-destructive">*</span>
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              value === o.value
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:bg-muted/50",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <o.icon className="h-4 w-4" /> {o.label}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{o.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Client-impact confirmation step for bug reports (MSD-957).
 *
 * Rachel asked that bugs be "gated first by client-facing or not". The people
 * filing bugs can't reliably judge that on their own, so Helm reads the actual
 * Medcurity codebase and proposes an answer — but the submitter often knows
 * something the code doesn't ("a client called me about this"), so they get the
 * final say. Deliberately shown as a confirmation, not a blank question: an
 * unanswered required field is friction, a pre-filled one you can correct is not.
 */
function ClientImpactConfirm({
  verdict,
  value,
  onChange,
}: {
  verdict: BugClassification;
  /** null when we're asking rather than confirming — see `asking` below. */
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  // If the check ran out of time (or couldn't run), we have no verdict worth
  // showing. Don't dress a guess up as an answer — ask plainly. The selection
  // still starts on "yes" (see submit()): asking honestly and defaulting safely
  // are not in conflict.
  const asking = !!verdict.timedOut;
  const changed = !asking && value !== null && value !== verdict.clientFacing;
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Is a client affected right now?</p>
          <p className="text-xs text-muted-foreground">
            {asking
              ? `${verdict.reasoning} We've started on "yes" because that's the safer answer when nobody has checked — change it only if you're sure.`
              : `We looked at the code and think the answer is ${
                  verdict.clientFacing ? "yes" : "no"
                }. ${verdict.reasoning}`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          {
            v: true,
            label: "Yes, a client is affected right now",
            hint: "Time-sensitive bugs only: goes straight to the dev team",
          },
          {
            v: false,
            label: "No, not urgent for clients",
            // When the automatic check failed, this answer is the only thing
            // standing between the report and the review queue — say so.
            hint: asking
              ? "Waits for a reviewer — nothing re-checks this automatically"
              : "Reviewed first, then queued with the dev team",
          },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              value === o.v
                ? "border-primary bg-background ring-1 ring-primary"
                : "border-border bg-background/60 hover:bg-background",
            )}
          >
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
      {changed && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Using your answer instead. It&apos;ll be noted on the ticket.
        </p>
      )}
      {asking && value === null && (
        <p className="text-xs text-muted-foreground">Pick one to submit.</p>
      )}
    </div>
  );
}

export function ProductForm({ onDirtyChange, onDone }: RequestFormProps) {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [submitted, setSubmitted] = useState(false);
  const [category, setCategory] = useState<ProductCategory | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("low");
  const [files, setFiles] = useState<File[]>([]);
  // Client-impact gate (MSD-957). `verdict` null means we haven't asked yet;
  // once set, the form shows the confirmation step and Submit actually files.
  const [verdict, setVerdict] = useState<BugClassification | null>(null);
  // Always starts on the fail-safe "yes" and no code path sets it back to null
  // — including a failed check, which asks the question openly but still leaves
  // the safe answer selected (2026-08-12; it used to blank the choice, and a
  // single click on "no" is how a client-blocking bug reached the review
  // queue). The `null` in the type and the guards that check for it are kept as
  // a backstop, not a state anything reaches on purpose.
  const [clientFacing, setClientFacing] = useState<boolean | null>(true);
  const [checking, setChecking] = useState(false);
  // MSD-999: the not-a-bug warning. `open` shows the dialog; `bypassed` means
  // the submitter saw it for THIS verdict and chose straight-to-dev anyway.
  const [notABugWarnOpen, setNotABugWarnOpen] = useState(false);
  const [notABugBypassed, setNotABugBypassed] = useState(false);
  const [noScreenshotWarnOpen, setNoScreenshotWarnOpen] = useState(false);
  const [noScreenshotBypassed, setNoScreenshotBypassed] = useState(false);
  // null = not asked yet; [] = asked and nothing was unclear (or it failed,
  // which is deliberately indistinguishable — both mean "carry on").
  const [clarifyQs, setClarifyQs] = useState<ClarifyQuestion[] | null>(null);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  const dirty =
    !submitted &&
    (category !== "" || title.trim() !== "" || description.trim() !== "" || files.length > 0);
  useDirtyReport(dirty, onDirtyChange);

  function reset() {
    setCategory("");
    setTitle("");
    setDescription("");
    setPriority("low");
    setFiles([]);
    setVerdict(null);
    setClientFacing(true);
    setChecking(false);
    setNotABugWarnOpen(false);
    setNotABugBypassed(false);
    setNoScreenshotWarnOpen(false);
    setNoScreenshotBypassed(false);
    setClarifyQs(null);
    setClarifyAnswers({});
  }

  // Editing the report after we've classified it invalidates the verdict —
  // otherwise you could get a judgement on one description and file another.
  // The not-a-bug bypass is scoped to a verdict, so it resets with it.
  //
  // Clarifying questions are deliberately NOT invalidated here. They're
  // generated from the description, so an edit can make them stale — but the
  // common edit is answering them by expanding the description, and yanking the
  // questions (and the answers typed into them) out from under someone
  // mid-sentence is far worse than a question that's since been addressed.
  // They're optional either way.
  function invalidateVerdict() {
    if (verdict) setVerdict(null);
    if (notABugBypassed) setNotABugBypassed(false);
  }

  // The submitter picked an answer on the client-impact card. Choosing the
  // straight-to-dev path when the classifier says this isn't a bug gets the
  // warning dialog instead of silently proceeding (MSD-999).
  function chooseClientFacing(v: boolean) {
    if (v && shouldWarnNotABug(verdict, true, notABugBypassed)) {
      setNotABugWarnOpen(true);
      return;
    }
    setClientFacing(v);
  }

  /**
   * The description as it will actually be filed: what they wrote, plus any
   * clarifying answers appended as a Q/A block.
   *
   * Folded in HERE rather than written back into `description` state, because
   * every edit to that field re-runs invalidateVerdict — writing to it would
   * throw away the client-impact check the moment the answers landed.
   */
  function composedDescription(): string {
    const base = description.trim();
    const answered = (clarifyQs ?? [])
      .map((q) => ({ q: q.question, a: (clarifyAnswers[q.id] ?? "").trim() }))
      .filter((x) => x.a.length > 0);
    if (answered.length === 0) return base;
    return [
      base,
      "",
      "---",
      ...answered.flatMap((x) => [`**${x.q}**`, x.a, ""]),
    ]
      .join("\n")
      .trim();
  }

  function actuallyCreate() {
    create.mutate(
      {
        type: "product",
        title: title.trim(),
        description: composedDescription(),
        priority,
        requesterName: profile?.full_name ?? null,
        details: { category },
        files,
        clientFacing: category === "bug" ? (clientFacing ?? undefined) : undefined,
        classification: category === "bug" ? (verdict ?? undefined) : undefined,
      },
      {
        onSuccess: (res) => {
          if (res.failedUploads.length > 0) {
            toast.warning(
              `Request submitted, but these files failed to upload: ${res.failedUploads.join(", ")}`,
            );
          } else if (res.bugFiled) {
            const key = res.bugFiled.jiraKey;
            toast.success(
              key
                ? `Client-impacting bug: sent straight to the dev team as ${key}.`
                : "Client-impacting bug: sent straight to the dev team.",
            );
          } else if (res.held) {
            toast.success("Bug submitted. It'll be reviewed before it goes to the dev team.");
          } else if (category === "bug") {
            toast.success("Bug submitted. The product team will file it to Jira.");
          } else {
            toast.success("Request submitted");
          }
          setSubmitted(true);
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
    );
  }

  async function submit() {
    if (!category) {
      toast.error("Choose Bug or Enhancement first.");
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.error("Add a title and a description.");
      return;
    }

    // First click, either category: ask what a developer would have to come
    // back and ask. Runs alongside the client-impact check rather than after
    // it, so a bug costs ONE pause and one spinner, not two.
    //
    // A request that was already specific gets no questions and no extra click
    // — the flow below only pauses when there is something on screen to look at.
    let freshQs: ClarifyQuestion[] = clarifyQs ?? [];
    if (clarifyQs === null) {
      setChecking(true);
      try {
        const [qs, v] = await Promise.all([
          askClarifyingQuestions({
            title: title.trim(),
            description: description.trim(),
            category,
          }),
          category === "bug" && !verdict
            ? classifyDraftBug({
                title: title.trim(),
                description: description.trim(),
                priority,
              })
            : Promise.resolve(null),
        ]);
        freshQs = qs;
        setClarifyQs(qs);
        if (v) {
          setVerdict(v);
          // See the note below on why this starts at "yes".
          setClientFacing(v.timedOut ? true : v.clientFacing);
        }
      } finally {
        setChecking(false);
      }
      // Pause only if there's something to show. An enhancement with nothing
      // unclear files on this very click, exactly as it did before.
      if (freshQs.length > 0 || category === "bug") return;
    }

    // Enhancements are otherwise unchanged — they go to the review queue.
    if (category !== "bug") {
      actuallyCreate();
      return;
    }

    // First click on a bug: get the client-impact read, then show it for
    // confirmation. Second click files. classifyDraftBug never rejects — it
    // gives up after 15s and comes back flagged as timed out.
    if (!verdict) {
      setChecking(true);
      try {
        const v = await classifyDraftBug({
          title: title.trim(),
          description: description.trim(),
          priority,
        });
        setVerdict(v);
        // A timed-out or failed check has no verdict worth presenting as an
        // answer — the card asks plainly instead of claiming to know. But the
        // selection still starts on "yes", because that is the fail-safe every
        // other layer of this system uses: an unnecessary review is cheap, a
        // missed client incident is not. On 2026-08-12 this started blank, and
        // one click on "no" sent a bug that was blocking a named client into
        // the triage queue. The submitter can still change it — they just have
        // to choose the risky answer deliberately rather than by default.
        setClientFacing(v.timedOut ? true : v.clientFacing);
      } finally {
        setChecking(false);
      }
      return;
    }

    if (category === "bug" && clientFacing === null) {
      toast.error("Let us know whether a client is affected.");
      return;
    }

    // Backstop for the pre-filled case: if "Yes" stood from the classifier's
    // own pre-fill and was never clicked, the warning still gets its moment
    // before anything files straight to dev (MSD-999).
    if (
      category === "bug" &&
      clientFacing === true &&
      shouldWarnNotABug(verdict, true, notABugBypassed)
    ) {
      setNotABugWarnOpen(true);
      return;
    }

    // Last stop before filing: a bug with no screenshot. Asked once and never
    // again for this request (noScreenshotBypassed), and it is a prompt, not a
    // gate — plenty of real bugs can't be captured in an image, and blocking
    // those would just teach people to attach something useless.
    if (category === "bug" && files.length === 0 && !noScreenshotBypassed) {
      setNoScreenshotWarnOpen(true);
      return;
    }

    actuallyCreate();
  }

  if (submitted) {
    return (
      <SubmittedPanel
        onDone={onDone}
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ProductCategoryPicker
        value={category}
        onChange={(v) => {
          setCategory(v);
          invalidateVerdict();
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="p-title">Title <span className="text-destructive">*</span></Label>
        <Input
          id="p-title"
          maxLength={200}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            invalidateVerdict();
          }}
          placeholder="e.g. Replace the office chairs with beanbags"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-desc">Description <span className="text-destructive">*</span></Label>
        <Textarea
          id="p-desc"
          rows={5}
          maxLength={4000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            invalidateVerdict();
          }}
          placeholder={
            category === "bug"
              ? "What's broken, where it happens, and how to reproduce it if you can..."
              : category === "enhancement"
                ? "What's the idea, the problem it solves, and any detail that helps the reviewer decide..."
                : "Describe what's broken or what you'd like improved..."
          }
        />
      </div>
      <ClarifyingQuestions
        questions={clarifyQs ?? []}
        answers={clarifyAnswers}
        onChange={(id, value) => setClarifyAnswers((prev) => ({ ...prev, [id]: value }))}
      />
      {/* Urged only on bugs: a screenshot is the single most useful thing a
          bug report can carry, while an enhancement is usually an idea that
          doesn't exist on screen yet. */}
      <AttachmentPicker
        files={files}
        onChange={setFiles}
        maxSizeMB={25}
        urgeScreenshot={category === "bug"}
      />
      <PrioritySelect
        value={priority}
        onChange={(v) => {
          setPriority(v);
          invalidateVerdict();
        }}
      />
      {category === "bug" && verdict && (
        <ClientImpactConfirm
          verdict={verdict}
          value={clientFacing}
          onChange={chooseClientFacing}
        />
      )}
      <AlertDialog open={notABugWarnOpen} onOpenChange={setNotABugWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This looks like a request, not a bug</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {verdict?.reasoning && (
                  <p className="rounded-md border bg-muted/50 p-3 text-sm italic">
                    &ldquo;{verdict.reasoning}&rdquo;
                  </p>
                )}
                <p>
                  <strong>
                    Only time-sensitive bugs that are affecting a client right now
                    should go straight to the dev team.
                  </strong>{" "}
                  Everything else (enhancements, new ideas, wording changes, and
                  process or workflow requests) needs to go through the reviewer
                  first, even when a client is involved.
                </p>
                <p>
                  Sending it through review doesn&apos;t bury it: the reviewer is
                  emailed right away and approves it onto the dev board.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setClientFacing(false);
                setNotABugWarnOpen(false);
              }}
            >
              Send it through review (recommended)
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={() => {
                setNotABugBypassed(true);
                setClientFacing(true);
                setNotABugWarnOpen(false);
              }}
            >
              It&apos;s a time-sensitive bug, send it straight to dev
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Asked once per request, and never a hard gate — see handleSubmit. The
          primary action is the one that goes back and adds an image, because
          that is the outcome worth a whole dialog. */}
      <AlertDialog open={noScreenshotWarnOpen} onOpenChange={setNoScreenshotWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a screenshot?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Bug reports with a screenshot get fixed noticeably faster — it
                  usually answers &ldquo;which screen?&rdquo; and &ldquo;what did
                  it actually look like?&rdquo; before anyone has to ask.
                </p>
                <p>
                  Press{" "}
                  <kbd className="rounded border px-1 font-mono text-xs">⌘⇧4</kbd>{" "}
                  to grab one, then paste it anywhere on this form. You don&apos;t
                  need to save it as a file first.
                </p>
                <p className="text-muted-foreground">
                  If there&apos;s nothing to capture, go ahead and submit — this
                  won&apos;t ask again.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setNoScreenshotBypassed(true);
                setNoScreenshotWarnOpen(false);
              }}
            >
              Let me add one
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={() => {
                // Bypass first, then submit: actuallyCreate reads the flag on
                // the next pass through handleSubmit.
                setNoScreenshotBypassed(true);
                setNoScreenshotWarnOpen(false);
                actuallyCreate();
              }}
            >
              Submit without one
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-xs text-muted-foreground">
        {category === "bug"
          ? "Only time-sensitive bugs actively affecting a client go straight to the dev team. Everything else, including anything that's really a request or enhancement, is reviewed first, then queued. Attachments come along either way."
          : category === "enhancement"
            ? "Enhancements are reviewed inside the CRM. If approved, the request is filed to the product team's Jira board, attachments included."
            : "Bugs go to the product team's Jira board; enhancements are reviewed and approved first."}
      </p>
      <FormFooter>
        <Button onClick={submit} disabled={create.isPending || checking} className="gap-2">
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {checking
            ? "Checking client impact..."
            : create.isPending
              ? "Submitting..."
              : category === "bug" && !verdict
                ? "Continue"
                : "Submit request"}
        </Button>
      </FormFooter>
    </div>
  );
}

// ── CRM ──────────────────────────────────────────────────────────────
export function CrmForm({ onDirtyChange, onDone }: RequestFormProps) {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [submitted, setSubmitted] = useState(false);
  const [changeType, setChangeType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("low");
  const [files, setFiles] = useState<File[]>([]);

  const dirty =
    !submitted &&
    (changeType !== "" || title.trim() !== "" || description.trim() !== "" || files.length > 0);
  useDirtyReport(dirty, onDirtyChange);

  function reset() {
    setChangeType("");
    setTitle("");
    setDescription("");
    setPriority("low");
    setFiles([]);
  }

  function submit() {
    if (!title.trim() || !description.trim()) {
      toast.error("Add a title and a description.");
      return;
    }
    create.mutate(
      {
        type: "crm",
        title: title.trim(),
        description: description.trim(),
        priority,
        requesterName: profile?.full_name ?? null,
        details: { change_type: changeType || null },
        files,
      },
      {
        onSuccess: (res) => {
          if (res.failedUploads.length > 0) {
            toast.warning(
              `Request submitted, but these files failed to upload: ${res.failedUploads.join(", ")}`,
            );
          } else {
            toast.success("Request submitted");
          }
          setSubmitted(true);
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
    );
  }

  if (submitted) {
    return (
      <SubmittedPanel
        onDone={onDone}
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Type of change</Label>
        <Select value={changeType} onValueChange={setChangeType}>
          <SelectTrigger><SelectValue placeholder="Update, edit, addition, removal, or bug fix" /></SelectTrigger>
          <SelectContent>
            {CRM_CHANGE_TYPES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="r-title">Summary <span className="text-destructive">*</span></Label>
        <Input id="r-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a leaderboard, but always leave me at #1" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="r-desc">Details <span className="text-destructive">*</span></Label>
        <Textarea id="r-desc" rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the update, edit, addition, removal, or bug as clearly as you can..." />
      </div>
      <PrioritySelect value={priority} onChange={setPriority} />
      <AttachmentPicker files={files} onChange={setFiles} maxSizeMB={10} />
      <FormFooter>
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Send className="h-4 w-4" />
          {create.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </FormFooter>
    </div>
  );
}
