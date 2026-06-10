import { useState } from "react";
import { Palette, Package, Wrench, Send } from "lucide-react";
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

// ── Collateral ───────────────────────────────────────────────────────
function CollateralForm() {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState("");
  const [partnerOrEvent, setPartnerOrEvent] = useState("");
  const [usage, setUsage] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("medium");

  function reset() {
    setTitle("");
    setDescription("");
    setAudience("");
    setFormat("");
    setPartnerOrEvent("");
    setUsage("");
    setPriority("medium");
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
      },
      {
        onSuccess: () => {
          toast.success("Collateral request submitted. Jordan and Nathan have been notified.");
          reset();
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <FromLine />
      <div className="space-y-2">
        <Label htmlFor="c-title">What do you need? <span className="text-destructive">*</span></Label>
        <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. One-pager on phishing services" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-desc">Describe what you need <span className="text-destructive">*</span></Label>
        <Textarea id="c-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should it cover, any must-haves, references..." />
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
        <Input id="c-partner" value={partnerOrEvent} onChange={(e) => setPartnerOrEvent(e.target.value)} placeholder="Optional" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-usage">How will you use it?</Label>
        <Input id="c-usage" value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="Optional" />
      </div>
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
function ProductForm() {
  const { profile } = useAuth();
  const create = useCreateRequest();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("medium");

  function submit() {
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
      },
      {
        onSuccess: () => {
          toast.success("Product request submitted. Rachel will review it.");
          setTitle("");
          setDescription("");
          setPriority("medium");
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <FromLine />
      <div className="space-y-2">
        <Label htmlFor="p-title">Title <span className="text-destructive">*</span></Label>
        <Input id="p-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short name for the product idea or change" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-desc">Description <span className="text-destructive">*</span></Label>
        <Textarea id="p-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the idea, the problem it solves, and any detail that helps Rachel decide..." />
      </div>
      <PrioritySelect value={priority} onChange={setPriority} />
      <p className="text-xs text-muted-foreground">
        Rachel reviews each product request inside the CRM. If approved, it's filed to the product team's Jira board.
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
  const [changeType, setChangeType] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("medium");

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
      },
      {
        onSuccess: () => {
          toast.success("CRM request submitted. Jordan and Nathan have been notified.");
          setChangeType("");
          setTitle("");
          setDescription("");
          setPriority("medium");
        },
        onError: (e) => toast.error("Could not submit: " + (e as Error).message),
      },
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
        <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a 'last contacted' column to the leads list" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="r-desc">Details <span className="text-destructive">*</span></Label>
        <Textarea id="r-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the update, edit, addition, removal, or bug as clearly as you can..." />
      </div>
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
