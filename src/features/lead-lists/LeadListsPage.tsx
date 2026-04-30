import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ListChecks,
  Plus,
  Trash2,
  UserPlus,
  PlayCircle,
  ArrowLeft,
  Filter,
  Sparkles,
  Pencil,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { MultiSelect } from "@/components/MultiSelect";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import {
  useLeadLists,
  useCreateLeadList,
  useUpdateLeadList,
  useDeleteLeadList,
  useLeadListMembers,
  useLeadListMemberCount,
  useRemoveFromList,
  useSmartListLeads,
  useLeadsByFilter,
  useBulkAddToList,
  type LeadListFilterConfig,
} from "./lead-lists-api";
import { useUpdateLead } from "@/features/leads/api";
import { useSequences, useEnrollInSequence } from "@/features/sequences/sequences-api";
import { useUsers } from "@/features/accounts/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDate } from "@/lib/formatters";
import type { LeadList, LeadListMember, Lead } from "@/types/crm";

// ---------------------------------------------------------------------------
// Filter option lists — kept here (duplicated from LeadsList) on purpose so
// the lead-lists feature has no import-time coupling to the Leads page.
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
  { value: "converted", label: "Converted" },
];

const SOURCE_OPTIONS = [
  { value: "cold_call", label: "Cold Call" },
  { value: "conference", label: "Conference" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "mql", label: "MQL" },
  { value: "partner", label: "Partner" },
  { value: "podcast", label: "Podcast" },
  { value: "referral", label: "Referral" },
  { value: "social_media", label: "Social Media" },
  { value: "trade_show", label: "Trade Show" },
  { value: "webinar", label: "Webinar" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

const QUALIFICATION_OPTIONS = [
  { value: "unqualified", label: "Unqualified" },
  { value: "mql", label: "MQL" },
];

const RATING_OPTIONS = [
  { value: "hot", label: "🔥 Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "❄️ Cold" },
];

const INDUSTRY_OPTIONS = [
  { value: "behavioral_health", label: "Behavioral Health" },
  { value: "dental", label: "Dental" },
  { value: "fqhc", label: "FQHC" },
  { value: "healthcare_consulting", label: "Healthcare Consulting" },
  { value: "healthcare_it_vendor", label: "Healthcare IT Vendor" },
  { value: "home_health", label: "Home Health" },
  { value: "hospice", label: "Hospice" },
  { value: "hospital", label: "Hospital" },
  { value: "imaging_center", label: "Imaging Center" },
  { value: "insurance_payer", label: "Insurance / Payer" },
  { value: "lab_services", label: "Lab Services" },
  { value: "long_term_care", label: "Long-Term Care" },
  { value: "managed_service_provider", label: "Managed Service Provider" },
  { value: "medical_group", label: "Medical Group" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "public_health_agency", label: "Public Health Agency" },
  { value: "rural_health_clinic", label: "Rural Health Clinic" },
  { value: "skilled_nursing", label: "Skilled Nursing" },
  { value: "specialty_clinic", label: "Specialty Clinic" },
  { value: "telemedicine", label: "Telemedicine" },
  { value: "tribal_health", label: "Tribal Health" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "other_healthcare", label: "Other Healthcare" },
  { value: "other", label: "Other" },
];

// ---------------------------------------------------------------------------
// Filter form — used in both Create and Edit dialogs for smart lists.
// ---------------------------------------------------------------------------

function FilterForm({
  value,
  onChange,
}: {
  value: LeadListFilterConfig;
  onChange: (next: LeadListFilterConfig) => void;
}) {
  const { data: users } = useUsers();

  function update<K extends keyof LeadListFilterConfig>(
    key: K,
    v: LeadListFilterConfig[K],
  ) {
    const next = { ...value };
    // Drop empty arrays / falsy keys so filter_config stays compact and
    // the smart-list query short-circuits cleanly.
    if (Array.isArray(v) ? v.length === 0 : v === undefined || v === "") {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Leads matching ALL of these criteria will appear in the list.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Status</Label>
          <MultiSelect
            value={value.status ?? []}
            onChange={(v) => update("status", v)}
            placeholder="Any status"
            options={STATUS_OPTIONS}
          />
        </div>
        <div>
          <Label className="text-xs">Qualification</Label>
          <MultiSelect
            value={value.qualification ?? []}
            onChange={(v) => update("qualification", v)}
            placeholder="Any qualification"
            options={QUALIFICATION_OPTIONS}
          />
        </div>
        <div>
          <Label className="text-xs">Source</Label>
          <MultiSelect
            value={value.source ?? []}
            onChange={(v) => update("source", v)}
            placeholder="Any source"
            options={SOURCE_OPTIONS}
          />
        </div>
        <div>
          <Label className="text-xs">Rating</Label>
          <MultiSelect
            value={value.rating ?? []}
            onChange={(v) => update("rating", v)}
            placeholder="Any rating"
            options={RATING_OPTIONS}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Industry</Label>
          <MultiSelect
            value={value.industry_category ?? []}
            onChange={(v) => update("industry_category", v)}
            placeholder="Any industry"
            options={INDUSTRY_OPTIONS}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Owner</Label>
          <MultiSelect
            value={value.owner_user_id ?? []}
            onChange={(v) => update("owner_user_id", v)}
            placeholder="Any owner"
            options={(users ?? []).map((u) => ({
              value: u.id,
              label: u.full_name ?? "Unknown",
            }))}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Search (name / email / company)</Label>
          <Input
            value={value.search ?? ""}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Optional keyword"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Marketing opt-out</Label>
          <Select
            value={
              typeof value.do_not_market_to === "boolean"
                ? value.do_not_market_to
                  ? "true"
                  : "false"
                : "any"
            }
            onValueChange={(v) =>
              update(
                "do_not_market_to",
                v === "any" ? undefined : v === "true",
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="false">Marketable only</SelectItem>
              <SelectItem value="true">Opted out only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create list dialog — supports static and smart lists.
// ---------------------------------------------------------------------------

function CreateListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { profile } = useAuth();
  const createMutation = useCreateLeadList();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"static" | "smart">("static");
  const [filters, setFilters] = useState<LeadListFilterConfig>({});

  function reset() {
    setName("");
    setDescription("");
    setType("static");
    setFilters({});
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        owner_user_id: profile!.id,
        is_dynamic: type === "smart",
        // Static lists store a null filter_config — no need to keep
        // around criteria the user toggled away from.
        filter_config: type === "smart" ? filters : null,
      });
      toast.success(type === "smart" ? "Smart list created" : "List created");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create list");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Lead List</DialogTitle>
          <DialogDescription>
            Static lists are manually curated. Smart lists update automatically as leads change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("static")}
              className={`border rounded-lg p-3 text-left transition-colors ${
                type === "static"
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <ListChecks className="h-4 w-4" /> Static
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Manually add specific leads.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setType("smart")}
              className={`border rounded-lg p-3 text-left transition-colors ${
                type === "smart"
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <Sparkles className="h-4 w-4" /> Smart
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-includes leads matching your criteria.
              </p>
            </button>
          </div>
          <div>
            <Label htmlFor="list-name">Name</Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Hot MQLs in Behavioral Health"
            />
          </div>
          <div>
            <Label htmlFor="list-desc">Description</Label>
            <Textarea
              id="list-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
            />
          </div>
          {type === "smart" && (
            <div className="border-t pt-4">
              <FilterForm value={filters} onChange={setFilters} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create List"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit smart-list filters dialog
// ---------------------------------------------------------------------------

function EditFiltersDialog({
  open,
  onOpenChange,
  list,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  list: LeadList;
}) {
  const updateMutation = useUpdateLeadList();
  const initial = (list.filter_config ?? {}) as LeadListFilterConfig;
  const [filters, setFilters] = useState<LeadListFilterConfig>(initial);

  async function handleSave() {
    try {
      await updateMutation.mutateAsync({ id: list.id, filter_config: filters });
      toast.success("Filters updated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to update filters");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setFilters((list.filter_config ?? {}) as LeadListFilterConfig);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Smart List Filters</DialogTitle>
          <DialogDescription>
            Leads matching ALL these criteria appear in the list.
          </DialogDescription>
        </DialogHeader>
        <FilterForm value={filters} onChange={setFilters} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Filters"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add leads dialog (static lists only). Filter-driven bulk picker — uses
// the same FilterForm facets as smart lists, plus a free-text search,
// plus checkboxes so the user can add many at once. Replaces the prior
// 1-at-a-time search-only flow that the sales team couldn't actually use.
// ---------------------------------------------------------------------------

function AddLeadsDialog({
  open,
  onOpenChange,
  listId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listId: string;
}) {
  const [filters, setFilters] = useState<LeadListFilterConfig>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkAdd = useBulkAddToList();

  // Run the query whenever the dialog is open so users get immediate
  // results — no need to type before seeing leads. The 200-row cap on
  // the API hook keeps this safe for the full table.
  const { data: leads, isLoading } = useLeadsByFilter(filters, open);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!leads) return;
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }

  async function handleAdd() {
    if (!selected.size) return;
    try {
      const res = await bulkAdd.mutateAsync({
        list_id: listId,
        lead_ids: Array.from(selected),
      });
      toast.success(
        res.added > 0
          ? `Added ${res.added} lead${res.added === 1 ? "" : "s"}`
          : "No new leads to add (all already in list)",
      );
      setSelected(new Set());
      setFilters({});
      onOpenChange(false);
    } catch {
      toast.error("Failed to add leads");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(new Set());
          setFilters({});
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Leads to List</DialogTitle>
          <DialogDescription>
            Filter the leads database, then check the rows you want to add.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FilterForm value={filters} onChange={setFilters} />

          <div className="border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !leads || !leads.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No leads match the current filters.
              </p>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={
                            leads.length > 0 && selected.size === leads.length
                          }
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow
                        key={lead.id}
                        className="cursor-pointer"
                        onClick={() => toggle(lead.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(lead.id)}
                            onCheckedChange={() => toggle(lead.id)}
                            aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {lead.first_name} {lead.last_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {lead.company ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {lead.email ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {lead.status ?? "—"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {leads?.length ?? 0} matching · {selected.size} selected
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!selected.size || bulkAdd.isPending}
          >
            <Plus className="h-4 w-4 mr-2" />
            {bulkAdd.isPending
              ? "Adding..."
              : `Add ${selected.size || ""} Lead${selected.size === 1 ? "" : "s"}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Enroll in sequence dialog
// ---------------------------------------------------------------------------

function EnrollSequenceDialog({
  open,
  onOpenChange,
  leadIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
}) {
  const { data: sequences } = useSequences();
  const enrollMutation = useEnrollInSequence();
  const { profile } = useAuth();

  async function handleEnroll(sequenceId: string) {
    let count = 0;
    for (const id of leadIds) {
      try {
        await enrollMutation.mutateAsync({
          sequence_id: sequenceId,
          lead_id: id,
          contact_id: null,
          owner_user_id: profile?.id ?? null,
        });
        count++;
      } catch {
        // Skip duplicates / RLS misses
      }
    }
    toast.success(`Enrolled ${count} lead(s) in sequence`);
    onOpenChange(false);
  }

  const activeSequences = (sequences ?? []).filter((s) => s.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll in Sequence</DialogTitle>
          <DialogDescription>
            Enroll all {leadIds.length} lead(s) in a sales sequence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {!activeSequences.length ? (
            <p className="text-sm text-muted-foreground">
              No active sequences. Create one first.
            </p>
          ) : (
            activeSequences.map((seq) => (
              <Button
                key={seq.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleEnroll(seq.id)}
                disabled={enrollMutation.isPending}
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                {seq.name} ({seq.steps.length} steps)
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Inline-editable cell — wraps a Select that fires a lead update on change.
// Mirrors the inline-edit pattern used in EditableField on detail pages,
// scaled down for table cells where there's no room for a save/cancel UI.
// ---------------------------------------------------------------------------

function InlineSelectCell({
  leadId,
  field,
  value,
  options,
  placeholder,
}: {
  leadId: string;
  field: keyof Lead;
  value: string | null | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const updateMutation = useUpdateLead();
  return (
    <Select
      value={value ?? "__unset__"}
      onValueChange={(v) => {
        const patch = { [field]: v === "__unset__" ? null : v } as Partial<Lead>;
        updateMutation.mutate(
          { id: leadId, ...patch },
          {
            onSuccess: () => {
              toast.success("Updated");
              // useUpdateLead only invalidates ["leads"]; the lead-lists
              // detail view reads from ["smart-list-leads"] or
              // ["lead-list-members"], so refresh those too — otherwise
              // the row keeps showing the old value until a remount.
              qc.invalidateQueries({ queryKey: ["smart-list-leads"] });
              qc.invalidateQueries({ queryKey: ["lead-list-members"] });
            },
            onError: () => toast.error("Update failed"),
          },
        );
      }}
      disabled={updateMutation.isPending}
    >
      <SelectTrigger
        className="h-8 text-xs border-transparent hover:border-input -ml-2 px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        <SelectItem value="__unset__">—</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// List detail view — branches on is_dynamic.
// ---------------------------------------------------------------------------

function ListDetailView({
  list,
  onBack,
}: {
  list: LeadList;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { data: staticMembers, isLoading: staticLoading } = useLeadListMembers(
    list.is_dynamic ? undefined : list.id,
  );
  const { data: smartLeads, isLoading: smartLoading } = useSmartListLeads(
    list.is_dynamic ? list.id : undefined,
    list.filter_config as LeadListFilterConfig | null | undefined,
  );
  const { data: users } = useUsers();
  const removeMutation = useRemoveFromList();
  const [showAddLeads, setShowAddLeads] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showEditFilters, setShowEditFilters] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Normalize both branches into a unified Lead-like row so the table
  // body is one code path. Static rows go through .lead (or .contact),
  // smart rows are leads directly.
  type Row = {
    rowKey: string;
    lead: Lead | null;
    isContact: boolean;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    contactCompany?: string;
    memberId?: string; // for static row removal
  };

  const baseRows: Row[] = list.is_dynamic
    ? (smartLeads ?? []).map((l) => ({
        rowKey: l.id,
        lead: l,
        isContact: false,
      }))
    : (staticMembers ?? []).map((m: LeadListMember) => {
        if (m.lead) {
          return {
            rowKey: m.id,
            lead: m.lead as Lead,
            isContact: false,
            memberId: m.id,
          };
        }
        // Contact members — keep showing them, no inline edit.
        return {
          rowKey: m.id,
          lead: null,
          isContact: true,
          contactName: `${m.contact?.first_name ?? ""} ${m.contact?.last_name ?? ""}`.trim(),
          contactEmail: m.contact?.email ?? "",
          contactPhone: m.contact?.phone ?? "",
          contactCompany: m.contact?.account?.name ?? "",
          memberId: m.id,
        };
      });

  // Resolve a row's sort field. Pulled into a helper so the comparator
  // can stay flat. `name` synthesizes "first last" so the sort matches
  // what the user sees in the cell.
  function rowField(r: Row, col: string): string {
    if (r.isContact) {
      switch (col) {
        case "name": return (r.contactName ?? "").toLowerCase();
        case "company": return (r.contactCompany ?? "").toLowerCase();
        case "email": return (r.contactEmail ?? "").toLowerCase();
        case "phone": return r.contactPhone ?? "";
        default: return "";
      }
    }
    const l = r.lead;
    if (!l) return "";
    switch (col) {
      case "name":
        return `${l.last_name ?? ""} ${l.first_name ?? ""}`.toLowerCase();
      case "company": return (l.company ?? "").toLowerCase();
      case "status": return l.status ?? "";
      case "qualification": return l.qualification ?? "";
      case "rating": return l.rating ?? "";
      case "owner": {
        const u = (users ?? []).find((u) => u.id === l.owner_user_id);
        return (u?.full_name ?? "").toLowerCase();
      }
      case "email": return (l.email ?? "").toLowerCase();
      case "phone": return l.phone ?? "";
      default: return "";
    }
  }

  const rows = useMemo(() => {
    if (!sort.column) return baseRows;
    const col = sort.column;
    const dir = sort.direction === "asc" ? 1 : -1;
    // Stable sort via slice + localeCompare; empty strings sort last on asc
    // by collation, which is acceptable here.
    return [...baseRows].sort((a, b) => {
      const av = rowField(a, col);
      const bv = rowField(b, col);
      if (av === bv) return 0;
      if (av === "") return 1;
      if (bv === "") return -1;
      return av.localeCompare(bv) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, sort, users]);

  const isLoading = list.is_dynamic ? smartLoading : staticLoading;
  const leadIds = rows.map((r) => r.lead?.id).filter((v): v is string => !!v);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            {list.is_dynamic ? (
              <Sparkles className="h-4 w-4 text-primary" />
            ) : (
              <ListChecks className="h-4 w-4 text-primary" />
            )}
            {list.name}
            <Badge variant="outline" className="ml-1 text-[10px]">
              {list.is_dynamic ? "Smart" : "Static"}
            </Badge>
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {rows.length} {rows.length === 1 ? "lead" : "leads"}
            </span>
          </h2>
          {list.description && (
            <p className="text-sm text-muted-foreground">
              {list.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowEnroll(true)}
            disabled={!leadIds.length}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Enroll in Sequence
          </Button>
          {list.is_dynamic ? (
            <Button onClick={() => setShowEditFilters(true)}>
              <Filter className="h-4 w-4 mr-2" />
              Edit Filters
            </Button>
          ) : (
            <Button onClick={() => setShowAddLeads(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Leads
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState
          icon={list.is_dynamic ? Filter : UserPlus}
          title={list.is_dynamic ? "No leads match" : "No members yet"}
          description={
            list.is_dynamic
              ? "Adjust the filters to widen the criteria."
              : "Add leads to this list."
          }
        />
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="name" sort={sort} onSort={setSort}>Name</SortableHeader>
                <SortableHeader column="company" sort={sort} onSort={setSort}>Company</SortableHeader>
                <SortableHeader column="status" sort={sort} onSort={setSort}>Status</SortableHeader>
                <SortableHeader column="qualification" sort={sort} onSort={setSort}>Qualification</SortableHeader>
                <SortableHeader column="rating" sort={sort} onSort={setSort}>Rating</SortableHeader>
                <SortableHeader column="owner" sort={sort} onSort={setSort}>Owner</SortableHeader>
                <SortableHeader column="email" sort={sort} onSort={setSort}>Email</SortableHeader>
                <SortableHeader column="phone" sort={sort} onSort={setSort}>Phone</SortableHeader>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.rowKey}
                  className={r.lead ? "cursor-pointer" : undefined}
                  onClick={() => {
                    if (r.lead) navigate(`/leads/${r.lead.id}`);
                  }}
                >
                  <TableCell className="font-medium">
                    {r.lead ? (
                      <Link
                        to={`/leads/${r.lead.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {`${r.lead.first_name ?? ""} ${r.lead.last_name ?? ""}`.trim() || "Unnamed"}
                      </Link>
                    ) : (
                      r.contactName || "Unknown"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(r.isContact ? r.contactCompany : r.lead?.company) || "—"}
                  </TableCell>
                  <TableCell>
                    {r.lead ? (
                      <InlineSelectCell
                        leadId={r.lead.id}
                        field="status"
                        value={r.lead.status}
                        options={STATUS_OPTIONS}
                      />
                    ) : (
                      <Badge variant="outline">contact</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.lead ? (
                      <InlineSelectCell
                        leadId={r.lead.id}
                        field="qualification"
                        value={r.lead.qualification}
                        options={QUALIFICATION_OPTIONS}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {r.lead ? (
                      <InlineSelectCell
                        leadId={r.lead.id}
                        field="rating"
                        value={r.lead.rating}
                        options={RATING_OPTIONS}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {r.lead ? (
                      <InlineSelectCell
                        leadId={r.lead.id}
                        field="owner_user_id"
                        value={r.lead.owner_user_id}
                        options={(users ?? []).map((u) => ({
                          value: u.id,
                          label: u.full_name ?? "Unknown",
                        }))}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(r.isContact ? r.contactEmail : r.lead?.email) || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(r.isContact ? r.contactPhone : r.lead?.phone) || "—"}
                  </TableCell>
                  <TableCell>
                    {/* Smart lists don't have explicit membership, so
                        the only action is exclude-via-filter. We hide
                        the trash icon for smart rows. */}
                    {!list.is_dynamic && r.memberId ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          removeMutation.mutate(
                            { memberId: r.memberId!, listId: list.id },
                            {
                              onSuccess: () => toast.success("Removed from list"),
                            }
                          );
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddLeadsDialog
        open={showAddLeads}
        onOpenChange={setShowAddLeads}
        listId={list.id}
      />

      <EditFiltersDialog
        open={showEditFilters}
        onOpenChange={setShowEditFilters}
        list={list}
      />

      <EnrollSequenceDialog
        open={showEnroll}
        onOpenChange={setShowEnroll}
        leadIds={leadIds}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — list of lists.
// ---------------------------------------------------------------------------

export function LeadListsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedList, setSelectedList] = useState<LeadList | null>(null);
  const { data: lists, isLoading } = useLeadLists();
  const { data: memberCounts } = useLeadListMemberCount();
  const deleteMutation = useDeleteLeadList();

  if (selectedList) {
    // Re-resolve the latest list (e.g. after edit-filters mutation
    // invalidates ["lead-lists"]) so the detail view always reflects
    // the current filter_config without forcing a back-and-forth.
    const fresh =
      (lists ?? []).find((l) => l.id === selectedList.id) ?? selectedList;
    return <ListDetailView list={fresh} onBack={() => setSelectedList(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Lists"
        description="Build static lists for outreach or smart lists that update as your data changes."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create List
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : !lists?.length ? (
        <EmptyState
          icon={ListChecks}
          title="No lead lists yet"
          description="Create your first list to organize leads for outreach."
          action={{
            label: "Create List",
            onClick: () => setShowCreate(true),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedList(list)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {list.is_dynamic ? (
                      <Sparkles className="h-5 w-5 text-primary shrink-0" />
                    ) : (
                      <ListChecks className="h-5 w-5 text-primary shrink-0" />
                    )}
                    {list.name}
                  </CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {list.is_dynamic ? "Smart" : "Static"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${list.name}"? This cannot be undone.`)) return;
                        deleteMutation.mutate(list.id, {
                          onSuccess: () => toast.success("List deleted"),
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {list.description && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {list.description}
                  </p>
                )}
                <div className="flex gap-4 text-sm text-muted-foreground">
                  {!list.is_dynamic && (
                    <span>{memberCounts?.[list.id] ?? 0} members</span>
                  )}
                  {list.is_dynamic && (
                    <span className="inline-flex items-center gap-1">
                      <Pencil className="h-3 w-3" /> auto-updating
                    </span>
                  )}
                  <span>Created {formatDate(list.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateListDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
