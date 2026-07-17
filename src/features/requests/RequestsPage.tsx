import { useRef, useState } from "react";
import { Palette, Package, Wrench, Send, Check, Plus, Paperclip, X, Bug, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  useCreateRequest,
  PRIORITY_OPTIONS,
  COLLATERAL_AUDIENCES,
  COLLATERAL_FORMATS,
  CRM_CHANGE_TYPES,
  type ProductCategory,
} from "./api";

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

function FromLine() {
  const { profile } = useAuth();
  return (
    <p className="text-xs text-muted-foreground">
      From <span className="font-medium text-foreground">{profile?.full_name ?? "you"}</span>
    </p>
  );
}

/**
 * Attachment field (ports OG Nexus's uploads): up to `maxFiles` files,
 * each capped at `maxSizeMB`. Files upload when the request is submitted.
 */
function AttachmentPicker({
  files,
  onChange,
  maxFiles = 5,
  maxSizeMB,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= maxFiles) {
        toast.error(`Up to ${maxFiles} files per request.`);
        break;
      }
      if (f.size > maxSizeMB * 1024 * 1024) {
        toast.error(`${f.name} is over the ${maxSizeMB} MB limit.`);
        continue;
      }
      next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <Label>Attachments</Label>
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => inputRef.current?.click()}
        disabled={files.length >= maxFiles}
      >
        <Paperclip className="h-3.5 w-3.5" />
        Attach files
      </Button>
      <p className="text-xs text-muted-foreground">
        Up to {maxFiles} files, {maxSizeMB} MB each. Optional.
      </p>
    </div>
  );
}

function SubmittedPanel({ onAnother }: { onAnother: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
        <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h3 className="text-lg font-semibold">Request submitted</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Thanks! The right team has been notified and will take it from here.
      </p>
      <Button variant="outline" className="mt-5 gap-2" onClick={onAnother}>
        <Plus className="h-4 w-4" /> Submit another
      </Button>
    </div>
  );
}

// ── Collateral ───────────────────────────────────────────────────────
function CollateralForm() {
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
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FromLine />
      <div className="space-y-2">
        <Label htmlFor="c-title">What do you need? <span className="text-destructive">*</span></Label>
        <Input id="c-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. One-pager on phishing services" />
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
      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Send className="h-4 w-4" />
          {create.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </div>
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
      blurb: "Something is broken. Goes straight to the product team's Jira — no approval step.",
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

function ProductForm() {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [submitted, setSubmitted] = useState(false);
  const [category, setCategory] = useState<ProductCategory | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("low");
  const [files, setFiles] = useState<File[]>([]);

  function reset() {
    setCategory("");
    setTitle("");
    setDescription("");
    setPriority("low");
    setFiles([]);
  }

  function submit() {
    if (!category) {
      toast.error("Choose Bug or Enhancement first.");
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.error("Add a title and a description.");
      return;
    }
    create.mutate(
      {
        type: "product",
        title: title.trim(),
        description: description.trim(),
        priority,
        requesterName: profile?.full_name ?? null,
        details: { category },
        files,
      },
      {
        onSuccess: (res) => {
          if (res.failedUploads.length > 0) {
            toast.warning(
              `Request submitted, but these files failed to upload: ${res.failedUploads.join(", ")}`,
            );
          } else if (res.bugFiled) {
            toast.success(
              res.bugFiled.jiraKey
                ? `Bug filed to Jira (${res.bugFiled.jiraKey}).`
                : "Bug filed to Jira.",
            );
          } else if (category === "bug") {
            toast.success("Bug submitted — the product team will file it to Jira.");
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
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FromLine />
      <ProductCategoryPicker value={category} onChange={setCategory} />
      <div className="space-y-2">
        <Label htmlFor="p-title">Title <span className="text-destructive">*</span></Label>
        <Input
          id="p-title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            category === "bug"
              ? "Short name for what's broken"
              : "Short name for the product idea or change"
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-desc">Description <span className="text-destructive">*</span></Label>
        <Textarea
          id="p-desc"
          rows={5}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            category === "bug"
              ? "What's broken, where it happens, and how to reproduce it if you can..."
              : "What's the idea, the problem it solves, and any detail that helps the reviewer decide..."
          }
        />
      </div>
      <AttachmentPicker files={files} onChange={setFiles} maxSizeMB={25} />
      <PrioritySelect value={priority} onChange={setPriority} />
      <p className="text-xs text-muted-foreground">
        {category === "bug"
          ? "Bug reports skip review and are filed straight to the product team's Jira board, attachments included. The product team approves or denies from there."
          : "Enhancements are reviewed inside the CRM. If approved, the request is filed to the product team's Jira board, attachments included."}
      </p>
      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Send className="h-4 w-4" />
          {create.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </div>
    </div>
  );
}

// ── CRM ──────────────────────────────────────────────────────────────
function CrmForm() {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [submitted, setSubmitted] = useState(false);
  const [changeType, setChangeType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("low");
  const [files, setFiles] = useState<File[]>([]);

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
        onAnother={() => {
          reset();
          setSubmitted(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FromLine />
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
        <Input id="r-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a 'last contacted' column to the leads list" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="r-desc">Details <span className="text-destructive">*</span></Label>
        <Textarea id="r-desc" rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the update, edit, addition, removal, or bug as clearly as you can..." />
      </div>
      <PrioritySelect value={priority} onChange={setPriority} />
      <AttachmentPicker files={files} onChange={setFiles} maxSizeMB={10} />
      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={create.isPending} className="gap-2">
          <Send className="h-4 w-4" />
          {create.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </div>
    </div>
  );
}

export function RequestsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Requests"
        description="Submit a request and the right person gets notified. Track progress as it's worked."
      />
      <Tabs defaultValue="collateral">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="collateral" className="gap-2">
            <Palette className="h-4 w-4" /> Collateral
          </TabsTrigger>
          <TabsTrigger value="product" className="gap-2">
            <Package className="h-4 w-4" /> Product
          </TabsTrigger>
          <TabsTrigger value="crm" className="gap-2">
            <Wrench className="h-4 w-4" /> CRM
          </TabsTrigger>
        </TabsList>
        <TabsContent value="collateral">
          <Card className="p-6">
            <CollateralForm />
          </Card>
        </TabsContent>
        <TabsContent value="product">
          <Card className="p-6">
            <ProductForm />
          </Card>
        </TabsContent>
        <TabsContent value="crm">
          <Card className="p-6">
            <CrmForm />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
