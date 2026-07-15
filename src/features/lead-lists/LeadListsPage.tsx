import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ListChecks,
  Plus,
  Trash2,
  UserPlus,
  ArrowLeft,
  Filter,
  Sparkles,
  Pencil,
  ChevronDown,
  ChevronRight,
  Download,
  Columns3,
  Mail,
  Phone,
  X,
  FolderInput,
  Search,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { MultiSelect } from "@/components/MultiSelect";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { US_STATES } from "@/lib/us-states";
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
  useSearchContactsForList,
  useBulkAddContactsToList,
  useMoveContactMember,
  type LeadListFilterConfig,
} from "./lead-lists-api";
import { useUpdateLead, useBulkUpdateOwner } from "@/features/leads/api";
import { useUsers } from "@/features/accounts/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
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
  // mql removed (Joe): Source is a CHANNEL; MQL is a qualification stage.
  { value: "cold_call", label: "Cold Call" },
  { value: "conference", label: "Conference" },
  { value: "email_campaign", label: "Email Campaign" },
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

const TIME_ZONE_OPTIONS = [
  { value: "eastern", label: "Eastern" },
  { value: "central", label: "Central" },
  { value: "mountain", label: "Mountain" },
  { value: "pacific", label: "Pacific" },
  { value: "alaska", label: "Alaska" },
  { value: "hawaii", label: "Hawaii" },
  { value: "arizona_no_dst", label: "Arizona (no DST)" },
];

const BUSINESS_TAG_OPTIONS = [
  { value: "decision_maker", label: "Decision Maker" },
  { value: "influencer", label: "Influencer" },
  { value: "economic_buyer", label: "Economic Buyer" },
  { value: "technical_buyer", label: "Technical Buyer" },
  { value: "champion", label: "Champion" },
  { value: "detractor", label: "Detractor" },
  { value: "end_user", label: "End User" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "executive_sponsor", label: "Executive Sponsor" },
  { value: "other", label: "Other" },
];

const CREDENTIAL_OPTIONS = [
  { value: "md", label: "MD" }, { value: "do", label: "DO" },
  { value: "rn", label: "RN" }, { value: "lpn", label: "LPN" },
  { value: "np", label: "NP" }, { value: "pa", label: "PA" },
  { value: "chc", label: "CHC" }, { value: "chps", label: "CHPS" },
  { value: "chpc", label: "CHPC" }, { value: "hipaa_certified", label: "HIPAA Certified" },
  { value: "ceo", label: "CEO" }, { value: "cfo", label: "CFO" },
  { value: "coo", label: "COO" }, { value: "cio", label: "CIO" },
  { value: "cto", label: "CTO" }, { value: "ciso", label: "CISO" },
  { value: "cmo", label: "CMO" },
  { value: "it_director", label: "IT Director" },
  { value: "practice_manager", label: "Practice Manager" },
  { value: "office_manager", label: "Office Manager" },
  { value: "compliance_officer", label: "Compliance Officer" },
  { value: "privacy_officer", label: "Privacy Officer" },
  { value: "security_officer", label: "Security Officer" },
  { value: "other", label: "Other" },
];

const LEAD_TYPE_OPTIONS = [
  { value: "inbound_website", label: "Inbound — Website" },
  { value: "inbound_referral", label: "Inbound — Referral" },
  { value: "outbound_cold", label: "Outbound — Cold" },
  { value: "purchased_list", label: "Purchased List" },
  { value: "conference", label: "Conference" },
  { value: "webinar", label: "Webinar" },
  { value: "partner", label: "Partner" },
  { value: "existing_customer_expansion", label: "Existing Customer Expansion" },
  { value: "other", label: "Other" },
];

const COUNTRY_OPTIONS = [
  { value: "United States", label: "United States" },
  { value: "Canada", label: "Canada" },
  { value: "Other", label: "Other" },
];

const STATE_OPTIONS = US_STATES.map((s) => ({ value: s.code, label: s.name }));

// All sortable / displayable columns. Used by the column chooser, the
// CSV exporter, and the SortableHeader bindings. Ordering here is the
// default left-to-right column order in the table.
type ColumnKey =
  | "name" | "company" | "title" | "email" | "phone" | "status"
  | "qualification" | "rating" | "owner" | "source" | "industry"
  | "state" | "city" | "employees" | "score" | "last_activity"
  | "created_at";

const ALL_COLUMNS: { key: ColumnKey; label: string; sortable?: boolean }[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "company", label: "Company", sortable: true },
  { key: "title", label: "Title", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "phone", label: "Phone", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "qualification", label: "Qualification", sortable: true },
  { key: "rating", label: "Rating", sortable: true },
  { key: "owner", label: "Owner", sortable: true },
  { key: "source", label: "Source", sortable: true },
  { key: "industry", label: "Industry", sortable: true },
  { key: "state", label: "State", sortable: true },
  { key: "city", label: "City", sortable: true },
  { key: "employees", label: "Employees", sortable: true },
  { key: "score", label: "Score", sortable: true },
  { key: "last_activity", label: "Last Contacted", sortable: true },
  { key: "created_at", label: "Created", sortable: true },
];

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  "name", "company", "title", "status", "qualification", "rating",
  "owner", "email", "phone", "state", "last_activity",
];

const COLUMNS_LS_KEY = "lead_list_visible_columns_v1";

function loadVisibleColumns(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COLUMNS_LS_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMNS;
    const known = new Set(ALL_COLUMNS.map((c) => c.key));
    const filtered = parsed.filter((k): k is ColumnKey =>
      typeof k === "string" && known.has(k as ColumnKey),
    );
    return filtered.length ? filtered : DEFAULT_VISIBLE_COLUMNS;
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
}

// ---------------------------------------------------------------------------
// Filter form — used in Create / Edit / AddLeads dialogs. Sections are
// collapsible so the surface area stays manageable.
// ---------------------------------------------------------------------------

function FilterSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border rounded-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-muted/50"
      >
        {title}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

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
    // Drop empty/falsy/undefined keys so filter_config stays compact and
    // the smart-list query short-circuits cleanly.
    const isEmpty =
      v === undefined ||
      v === "" ||
      v === null ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "number" && Number.isNaN(v));
    if (isEmpty) {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  }

  // Helper to render a "Yes / No / Any" tri-state selector.
  function triState(
    key: keyof LeadListFilterConfig,
    label: string,
  ) {
    const current = value[key];
    return (
      <div>
        <Label className="text-xs">{label}</Label>
        <Select
          value={
            typeof current === "boolean" ? (current ? "true" : "false") : "any"
          }
          onValueChange={(v) =>
            update(
              key,
              v === "any" ? undefined : (v === "true" as unknown as LeadListFilterConfig[typeof key]),
            )
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Leads matching ALL of these criteria will appear in the list.
      </p>

      <FilterSection title="Categorical" defaultOpen>
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
          <div>
            <Label className="text-xs">Lead type</Label>
            <MultiSelect
              value={value.type ?? []}
              onChange={(v) => update("type", v)}
              placeholder="Any type"
              options={LEAD_TYPE_OPTIONS}
            />
          </div>
          <div>
            <Label className="text-xs">Business tag</Label>
            <MultiSelect
              value={value.business_relationship_tag ?? []}
              onChange={(v) => update("business_relationship_tag", v)}
              placeholder="Any tag"
              options={BUSINESS_TAG_OPTIONS}
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Geographic">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">State</Label>
            <MultiSelect
              value={value.state ?? []}
              onChange={(v) => update("state", v)}
              placeholder="Any state"
              options={STATE_OPTIONS}
            />
          </div>
          <div>
            <Label className="text-xs">City contains</Label>
            <Input
              value={value.city ?? ""}
              onChange={(e) => update("city", e.target.value || undefined)}
              placeholder="e.g. Seattle"
            />
          </div>
          <div>
            <Label className="text-xs">Zip starts with</Label>
            <Input
              value={value.zip_prefix ?? ""}
              onChange={(e) => update("zip_prefix", e.target.value || undefined)}
              placeholder="e.g. 981"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Country</Label>
            <MultiSelect
              value={value.country ?? []}
              onChange={(v) => update("country", v)}
              placeholder="Any country"
              options={COUNTRY_OPTIONS}
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Firmographic">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Employees min</Label>
            <Input
              type="number"
              min={0}
              value={value.employees_min ?? ""}
              onChange={(e) =>
                update("employees_min", e.target.value === "" ? undefined : Number(e.target.value))
              }
              placeholder="0"
            />
          </div>
          <div>
            <Label className="text-xs">Employees max</Label>
            <Input
              type="number"
              min={0}
              value={value.employees_max ?? ""}
              onChange={(e) =>
                update("employees_max", e.target.value === "" ? undefined : Number(e.target.value))
              }
              placeholder="∞"
            />
          </div>
          <div>
            <Label className="text-xs">Annual revenue min ($)</Label>
            <Input
              type="number"
              min={0}
              value={value.annual_revenue_min ?? ""}
              onChange={(e) =>
                update("annual_revenue_min", e.target.value === "" ? undefined : Number(e.target.value))
              }
              placeholder="0"
            />
          </div>
          <div>
            <Label className="text-xs">Annual revenue max ($)</Label>
            <Input
              type="number"
              min={0}
              value={value.annual_revenue_max ?? ""}
              onChange={(e) =>
                update("annual_revenue_max", e.target.value === "" ? undefined : Number(e.target.value))
              }
              placeholder="∞"
            />
          </div>
          <div>
            <Label className="text-xs">Score min</Label>
            <Input
              type="number"
              value={value.score_min ?? ""}
              onChange={(e) =>
                update("score_min", e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </div>
          <div>
            <Label className="text-xs">Score max</Label>
            <Input
              type="number"
              value={value.score_max ?? ""}
              onChange={(e) =>
                update("score_max", e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Engagement">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Created on/after</Label>
            <Input
              type="date"
              value={value.created_after ?? ""}
              onChange={(e) => update("created_after", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label className="text-xs">Created on/before</Label>
            <Input
              type="date"
              value={value.created_before ?? ""}
              onChange={(e) => update("created_before", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label className="text-xs">MQL'd on/after</Label>
            <Input
              type="date"
              value={value.mql_after ?? ""}
              onChange={(e) => update("mql_after", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label className="text-xs">MQL'd on/before</Label>
            <Input
              type="date"
              value={value.mql_before ?? ""}
              onChange={(e) => update("mql_before", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label className="text-xs">Last contacted on/after</Label>
            <Input
              type="date"
              value={value.last_activity_after ?? ""}
              onChange={(e) => update("last_activity_after", e.target.value || undefined)}
            />
          </div>
          <div>
            <Label className="text-xs">Last contacted on/before</Label>
            <Input
              type="date"
              value={value.last_activity_before ?? ""}
              onChange={(e) => update("last_activity_before", e.target.value || undefined)}
            />
          </div>
          {triState("exclude_in_other_lists", "Exclude leads already on other lists")}
        </div>
      </FilterSection>

      <FilterSection title="Identity & flags">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Time zone</Label>
            <MultiSelect
              value={value.time_zone ?? []}
              onChange={(v) => update("time_zone", v)}
              placeholder="Any time zone"
              options={TIME_ZONE_OPTIONS}
            />
          </div>
          <div>
            <Label className="text-xs">Credential</Label>
            <MultiSelect
              value={value.credential ?? []}
              onChange={(v) => update("credential", v)}
              placeholder="Any credential"
              options={CREDENTIAL_OPTIONS}
            />
          </div>
          {triState("has_email", "Has email")}
          {triState("has_phone", "Has phone")}
          {triState("has_linkedin", "Has LinkedIn")}
          {triState("priority_lead", "Priority lead")}
          {triState("cold_lead", "Cold lead")}
          {triState("do_not_market_to", "Marketing opt-out")}
          {triState("do_not_contact", "Do not contact")}
        </div>
      </FilterSection>

      <FilterSection title="Search">
        <Label className="text-xs">Free-text (name / email / company / title / phone)</Label>
        <Input
          value={value.search ?? ""}
          onChange={(e) => update("search", e.target.value)}
          placeholder="Optional keyword"
        />
      </FilterSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create list dialog — supports static and smart lists.
// ---------------------------------------------------------------------------

export function CreateListDialog({
  open,
  onOpenChange,
  initialFilters,
  initialName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When opened from "Save filter as smart list", pre-populates filters. */
  initialFilters?: LeadListFilterConfig | null;
  initialName?: string;
}) {
  const { profile } = useAuth();
  const createMutation = useCreateLeadList();
  const [name, setName] = useState(initialName ?? "");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"static" | "smart">(
    initialFilters ? "smart" : "static",
  );
  const [filters, setFilters] = useState<LeadListFilterConfig>(initialFilters ?? {});

  // Re-sync internal state when the dialog re-opens with different
  // seed values (e.g. user opens via "Save filter" twice with different
  // /leads filters).
  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setDescription("");
      setType(initialFilters ? "smart" : "static");
      setFilters(initialFilters ?? {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
// Add leads dialog (static lists only). Filter-driven bulk picker.
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

  const { data: leads, isLoading } = useLeadsByFilter(filters, open, listId);

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                      <TableHead>State</TableHead>
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
                          {lead.state ?? "—"}
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
// Add contacts dialog (static lists only). Search-driven picker — contacts
// already on the list are excluded from results by the search hook.
// ---------------------------------------------------------------------------

function AddContactsDialog({
  open,
  onOpenChange,
  listId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listId: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkAdd = useBulkAddContactsToList();
  const { data: results, isLoading } = useSearchContactsForList(
    open ? search : "",
    listId,
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setSearch("");
    setSelected(new Set());
  }

  async function handleAdd() {
    if (!selected.size) return;
    try {
      const res = await bulkAdd.mutateAsync({
        list_id: listId,
        contact_ids: Array.from(selected),
      });
      const skipped = res.requested - res.added;
      toast.success(
        res.added > 0
          ? `Added ${res.added} contact${res.added === 1 ? "" : "s"}${
              skipped > 0 ? ` (${skipped} already on list)` : ""
            }`
          : "No new contacts to add (all already on list)",
      );
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to add contacts");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Contacts to List</DialogTitle>
          <DialogDescription>
            Search contacts by name or email, then check the ones to add.
            Contacts already on this list are hidden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="pl-9"
              autoFocus
            />
          </div>

          <div className="border rounded-lg overflow-hidden">
            {search.length < 2 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Type at least 2 characters to search.
              </p>
            ) : isLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !results?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No matching contacts (or they're all on this list already).
              </p>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[40px]" />
                      <TableHead>Name</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Title</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((c) => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => toggle(c.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(c.id)}
                            onCheckedChange={() => toggle(c.id)}
                            aria-label={`Select ${c.first_name} ${c.last_name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.account?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.title ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            {selected.size} selected
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
              : `Add ${selected.size || ""} Contact${selected.size === 1 ? "" : "s"}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Move contact member dialog — insert on the target list + remove here.
// ---------------------------------------------------------------------------

function MoveContactMemberDialog({
  member,
  onOpenChange,
  fromListId,
}: {
  /** Null = closed. */
  member: { memberId: string; contactId: string; name: string } | null;
  onOpenChange: (o: boolean) => void;
  fromListId: string;
}) {
  const { data: lists } = useLeadLists();
  const moveMutation = useMoveContactMember();
  const targets = (lists ?? [])
    .filter((l) => !l.is_dynamic && l.id !== fromListId)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function handlePick(toListId: string, toName: string) {
    if (!member) return;
    const name = member.name || "Contact";
    try {
      const res = await moveMutation.mutateAsync({
        memberId: member.memberId,
        fromListId,
        toListId,
        contactId: member.contactId,
      });
      toast.success(
        res.alreadyInTarget
          ? `${name} was already on "${toName}" — removed from this list`
          : `Moved ${name} to "${toName}"`,
      );
      onOpenChange(false);
    } catch {
      toast.error("Failed to move contact");
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move {member?.name || "contact"} to…</DialogTitle>
          <DialogDescription>
            Pick the destination list. The contact is removed from this list
            once added there.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {!targets.length ? (
            <p className="text-sm text-muted-foreground">
              No other static lists to move to. Create one first.
            </p>
          ) : (
            targets.map((l) => (
              <Button
                key={l.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => handlePick(l.id, l.name)}
                disabled={moveMutation.isPending}
              >
                <ListChecks className="h-4 w-4 mr-2" />
                {l.name}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Choose-list dialog — used by /leads bulk action ("Add to list…") and by
// the in-list bulk action ("Copy to another list…"). Static lists only.
// ---------------------------------------------------------------------------

export function ChooseListDialog({
  open,
  onOpenChange,
  leadIds,
  excludeListId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  excludeListId?: string;
}) {
  const { data: lists } = useLeadLists();
  const bulkAdd = useBulkAddToList();
  const staticLists = (lists ?? []).filter(
    (l) => !l.is_dynamic && l.id !== excludeListId,
  );

  async function handlePick(listId: string) {
    if (!leadIds.length) return;
    try {
      const res = await bulkAdd.mutateAsync({ list_id: listId, lead_ids: leadIds });
      toast.success(
        res.added > 0
          ? `Added ${res.added} lead${res.added === 1 ? "" : "s"}`
          : "No new leads to add (all already in list)",
      );
      onOpenChange(false);
    } catch {
      toast.error("Failed to add to list");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add {leadIds.length} lead(s) to a list</DialogTitle>
          <DialogDescription>
            Pick a static list. Smart lists update automatically and can't be
            added to manually.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {!staticLists.length ? (
            <p className="text-sm text-muted-foreground">
              No static lists yet. Create one from the Lead Lists page first.
            </p>
          ) : (
            staticLists.map((l) => (
              <Button
                key={l.id}
                variant="outline"
                className="w-full justify-start"
                onClick={() => handlePick(l.id)}
                disabled={bulkAdd.isPending}
              >
                <ListChecks className="h-4 w-4 mr-2" />
                {l.name}
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
// Column-chooser popover
// ---------------------------------------------------------------------------

function ColumnChooser({
  visible,
  onChange,
}: {
  visible: ColumnKey[];
  onChange: (next: ColumnKey[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {ALL_COLUMNS.map((c) => {
            const isOn = visible.includes(c.key);
            return (
              <label
                key={c.key}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded"
              >
                <Checkbox
                  checked={isOn}
                  onCheckedChange={() => {
                    if (isOn) {
                      onChange(visible.filter((k) => k !== c.key));
                    } else {
                      // Preserve the canonical ALL_COLUMNS order so re-enabling
                      // a column doesn't shuffle it to the end.
                      const next = ALL_COLUMNS.map((x) => x.key).filter(
                        (k) => visible.includes(k) || k === c.key,
                      );
                      onChange(next);
                    }
                  }}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// CSV exporter — purely client-side. Quotes every field, RFC-4180-ish.
// ---------------------------------------------------------------------------

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportRowsToCSV(rows: Array<Record<string, unknown>>, filename: string) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  const header = Object.keys(rows[0]);
  const lines = [
    header.map(csvEscape).join(","),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// List detail view — branches on is_dynamic.
// ---------------------------------------------------------------------------

type EnrichedLead = Lead & {
  last_activity_at?: string | null;
};

function ListDetailView({
  list,
  onBack,
}: {
  list: LeadList;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: staticMembers, isLoading: staticLoading } = useLeadListMembers(
    list.is_dynamic ? undefined : list.id,
  );
  const { data: smartLeads, isLoading: smartLoading } = useSmartListLeads(
    list.is_dynamic ? list.id : undefined,
    list.filter_config as LeadListFilterConfig | null | undefined,
  );
  const { data: users } = useUsers();
  const removeMutation = useRemoveFromList();
  const bulkOwner = useBulkUpdateOwner();
  const updateLead = useUpdateLead();

  const [showAddLeads, setShowAddLeads] = useState(false);
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [showEditFilters, setShowEditFilters] = useState(false);
  const [showCopyToList, setShowCopyToList] = useState(false);
  const [moveMember, setMoveMember] = useState<{
    memberId: string;
    contactId: string;
    name: string;
  } | null>(null);

  // Sort + quick-filter live in the URL so that a Back-to-list breadcrumb
  // from a lead detail page restores them exactly.
  const sortColumn = searchParams.get("sort");
  const sortDir =
    (searchParams.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc";
  const sort: SortState = { column: sortColumn, direction: sortDir };
  function setSort(next: SortState) {
    const live = new URLSearchParams(window.location.search);
    if (!next.column) {
      live.delete("sort");
      live.delete("dir");
    } else {
      live.set("sort", next.column);
      live.set("dir", next.direction);
    }
    setSearchParams(live, { replace: true });
  }

  const quickQuery = searchParams.get("q") ?? "";
  function setQuickQuery(v: string) {
    const live = new URLSearchParams(window.location.search);
    if (v) live.set("q", v);
    else live.delete("q");
    setSearchParams(live, { replace: true });
  }

  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(loadVisibleColumns);
  useEffect(() => {
    localStorage.setItem(COLUMNS_LS_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Restore scroll position when returning from a detail page. Keyed by
  // list id so switching lists doesn't carry stale scroll.
  useEffect(() => {
    const key = `lead_list_scroll_${list.id}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved, 10);
      if (!isNaN(y)) window.scrollTo(0, y);
    }
    return () => {
      sessionStorage.setItem(key, String(window.scrollY));
    };
  }, [list.id]);

  // Normalize both branches into a unified row shape.
  type Row = {
    rowKey: string;
    lead: EnrichedLead | null;
    isContact: boolean;
    contactId?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    contactCompany?: string;
    memberId?: string;
  };

  const baseRows: Row[] = list.is_dynamic
    ? (smartLeads ?? []).map((l) => ({
        rowKey: l.id,
        lead: l as EnrichedLead,
        isContact: false,
      }))
    : (staticMembers ?? []).map((m: LeadListMember) => {
        if (m.lead) {
          return {
            rowKey: m.id,
            lead: m.lead as EnrichedLead,
            isContact: false,
            memberId: m.id,
          };
        }
        return {
          rowKey: m.id,
          lead: null,
          isContact: true,
          contactId: m.contact_id ?? m.contact?.id,
          contactName: `${m.contact?.first_name ?? ""} ${m.contact?.last_name ?? ""}`.trim(),
          contactEmail: m.contact?.email ?? "",
          contactPhone: m.contact?.phone ?? "",
          contactCompany: m.contact?.account?.name ?? "",
          memberId: m.id,
        };
      });

  // Quick-filter (in-detail search box) — applies on top of the smart-list
  // filter or the static membership.
  const filteredRows = useMemo(() => {
    if (!quickQuery.trim()) return baseRows;
    const q = quickQuery.trim().toLowerCase();
    return baseRows.filter((r) => {
      const fields = r.isContact
        ? [r.contactName, r.contactCompany, r.contactEmail]
        : [
            r.lead?.first_name, r.lead?.last_name, r.lead?.company,
            r.lead?.email, r.lead?.title, r.lead?.phone,
          ];
      return fields.some((f) => (f ?? "").toLowerCase().includes(q));
    });
  }, [baseRows, quickQuery]);

  function rowField(r: Row, col: string): string | number {
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
      case "title": return (l.title ?? "").toLowerCase();
      case "status": return l.status ?? "";
      case "qualification": return l.qualification ?? "";
      case "rating": return l.rating ?? "";
      case "owner": {
        const u = (users ?? []).find((u) => u.id === l.owner_user_id);
        return (u?.full_name ?? "").toLowerCase();
      }
      case "source": return l.source ?? "";
      case "industry": return l.industry_category ?? "";
      case "state": return l.state ?? "";
      case "city": return (l.city ?? "").toLowerCase();
      case "employees": return l.employees ?? -1;
      case "score": return l.score ?? -1;
      case "last_activity": return l.last_activity_at ?? "";
      case "created_at": return l.created_at ?? "";
      case "email": return (l.email ?? "").toLowerCase();
      case "phone": return l.phone ?? "";
      default: return "";
    }
  }

  const rows = useMemo(() => {
    if (!sort.column) return filteredRows;
    const col = sort.column;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = rowField(a, col);
      const bv = rowField(b, col);
      if (av === bv) return 0;
      if (av === "" || av === -1) return 1;
      if (bv === "" || bv === -1) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sort, users]);

  const isLoading = list.is_dynamic ? smartLoading : staticLoading;
  const leadIds = rows.map((r) => r.lead?.id).filter((v): v is string => !!v);
  const selectedIds = Array.from(selected).filter((id) => leadIds.includes(id));
  const allChecked =
    !!leadIds.length && leadIds.every((id) => selected.has(id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allChecked) {
      setSelected((prev) => {
        const next = new Set(prev);
        leadIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        leadIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function isColumnVisible(k: ColumnKey) {
    return visibleColumns.includes(k);
  }

  // CSV export uses the currently visible columns + filtered/sorted rows.
  function handleExport() {
    const cols = visibleColumns;
    const csvRows = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const k of cols) {
        const col = ALL_COLUMNS.find((c) => c.key === k)!;
        const v = rowField(r, k);
        out[col.label] = typeof v === "number" && v < 0 ? "" : v;
      }
      return out;
    });
    const date = new Date().toISOString().slice(0, 10);
    exportRowsToCSV(csvRows, `${list.name.replace(/\s+/g, "_")}_${date}.csv`);
  }

  async function handleBulkAssignOwner(userId: string) {
    if (!selectedIds.length) return;
    await bulkOwner.mutateAsync({ ids: selectedIds, owner_user_id: userId });
    toast.success(`Assigned ${selectedIds.length} lead(s)`);
    setSelected(new Set());
  }

  async function handleBulkSetStatus(status: string) {
    if (!selectedIds.length) return;
    let count = 0;
    for (const id of selectedIds) {
      try {
        await updateLead.mutateAsync({ id, status: status as Lead["status"] });
        count++;
      } catch { /* skip RLS-blocked rows */ }
    }
    toast.success(`Updated status on ${count} lead(s)`);
    setSelected(new Set());
  }

  async function handleBulkOptOut() {
    if (!selectedIds.length) return;
    if (!confirm(`Mark ${selectedIds.length} lead(s) as do-not-market? This is reversible per-lead.`)) return;
    let count = 0;
    for (const id of selectedIds) {
      try {
        await updateLead.mutateAsync({ id, do_not_market_to: true });
        count++;
      } catch { /* skip */ }
    }
    toast.success(`Marked ${count} lead(s)`);
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to lists
        </Button>
        <div className="flex-1 min-w-[300px]">
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
              {quickQuery && ` (filtered from ${baseRows.length})`}
            </span>
          </h2>
          {list.description && (
            <p className="text-sm text-muted-foreground">
              {list.description}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder="Quick filter…"
            className="w-48"
          />
          <ColumnChooser visible={visibleColumns} onChange={setVisibleColumns} />
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          {list.is_dynamic ? (
            <Button onClick={() => setShowEditFilters(true)}>
              <Filter className="h-4 w-4 mr-2" />
              Edit Filters
            </Button>
          ) : (
            <>
              <Button onClick={() => setShowAddLeads(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Leads
              </Button>
              <Button variant="outline" onClick={() => setShowAddContacts(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Contacts
              </Button>
            </>
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
          title={
            list.is_dynamic
              ? "No leads match"
              : baseRows.length === 0
                ? "No leads in this list yet"
                : "No leads match the quick filter"
          }
          description={
            list.is_dynamic
              ? "Adjust the filters to widen the criteria."
              : baseRows.length === 0
                ? "Click \"Add Leads\" to start filling this list."
                : "Clear the quick filter or add more leads."
          }
          action={
            !list.is_dynamic && baseRows.length === 0
              ? { label: "Add Leads", onClick: () => setShowAddLeads(true) }
              : undefined
          }
        />
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                {ALL_COLUMNS.filter((c) => isColumnVisible(c.key)).map((c) => (
                  c.sortable ? (
                    <SortableHeader
                      key={c.key}
                      column={c.key}
                      sort={sort}
                      onSort={setSort}
                    >
                      {c.label}
                    </SortableHeader>
                  ) : (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  )
                ))}
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.rowKey}
                  className={cn(r.lead && "cursor-pointer")}
                  onClick={() => {
                    if (r.lead) {
                      navigate(
                        `/leads/${r.lead.id}?from=list:${list.id}`,
                      );
                    }
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {r.lead && (
                      <Checkbox
                        checked={selected.has(r.lead.id)}
                        onCheckedChange={() => toggleSelect(r.lead!.id)}
                        aria-label="Select row"
                      />
                    )}
                  </TableCell>
                  {ALL_COLUMNS.filter((c) => isColumnVisible(c.key)).map((c) => (
                    <TableCell
                      key={c.key}
                      className={
                        ["name", "title", "company", "email"].includes(c.key)
                          ? ""
                          : "text-muted-foreground"
                      }
                    >
                      {renderCell(c.key, r, users ?? [])}
                    </TableCell>
                  ))}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {!list.is_dynamic && r.memberId ? (
                      <div className="flex items-center">
                        {r.isContact && r.contactId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Move to another list"
                            onClick={() =>
                              setMoveMember({
                                memberId: r.memberId!,
                                contactId: r.contactId!,
                                name: r.contactName ?? "",
                              })
                            }
                          >
                            <FolderInput className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          title="Remove from list"
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
                      </div>
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

      <AddContactsDialog
        open={showAddContacts}
        onOpenChange={setShowAddContacts}
        listId={list.id}
      />

      <MoveContactMemberDialog
        member={moveMember}
        onOpenChange={(o) => {
          if (!o) setMoveMember(null);
        }}
        fromListId={list.id}
      />

      <EditFiltersDialog
        open={showEditFilters}
        onOpenChange={setShowEditFilters}
        list={list}
      />


      <ChooseListDialog
        open={showCopyToList}
        onOpenChange={setShowCopyToList}
        leadIds={selectedIds}
        excludeListId={list.id}
      />

      {/* Bulk-action toolbar — only shown when rows are selected. */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Select onValueChange={handleBulkAssignOwner}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Assign owner…" />
            </SelectTrigger>
            <SelectContent>
              {(users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name ?? "Unnamed"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={handleBulkSetStatus}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowCopyToList(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add to list…
          </Button>
          <Button variant="outline" size="sm" onClick={handleBulkOptOut}>
            Mark do-not-market
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelected(new Set())}
            className="ml-auto"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// Cell renderer for a given column. Pulled out of the JSX so the table
// loop stays compact and the renderer can branch on column key cleanly.
function renderCell(
  col: ColumnKey,
  r: { lead: EnrichedLead | null; isContact: boolean; contactName?: string; contactEmail?: string; contactPhone?: string; contactCompany?: string },
  users: Array<{ id: string; full_name: string | null }>,
) {
  if (r.isContact) {
    switch (col) {
      case "name": return r.contactName || "Unknown";
      case "company": return r.contactCompany || "—";
      case "email": return r.contactEmail || "—";
      case "phone": return r.contactPhone || "—";
      default: return <Badge variant="outline" className="text-[10px]">contact</Badge>;
    }
  }
  const l = r.lead;
  if (!l) return "—";
  switch (col) {
    case "name":
      return (
        <Link
          to={`/leads/${l.id}`}
          className="text-primary hover:underline font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {`${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed"}
        </Link>
      );
    case "company": return l.company || "—";
    case "title": return l.title || "—";
    case "email":
      return l.email ? (
        <a
          href={`mailto:${l.email}`}
          className="hover:underline inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Mail className="h-3 w-3 opacity-50" />
          {l.email}
        </a>
      ) : "—";
    case "phone":
      return l.phone ? (
        <a
          href={`tel:${l.phone}`}
          className="hover:underline inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="h-3 w-3 opacity-50" />
          {l.phone}
        </a>
      ) : "—";
    case "status":
      return (
        <InlineSelectCell
          leadId={l.id}
          field="status"
          value={l.status}
          options={STATUS_OPTIONS}
        />
      );
    case "qualification":
      return (
        <InlineSelectCell
          leadId={l.id}
          field="qualification"
          value={l.qualification}
          options={QUALIFICATION_OPTIONS}
        />
      );
    case "rating":
      return (
        <InlineSelectCell
          leadId={l.id}
          field="rating"
          value={l.rating}
          options={RATING_OPTIONS}
        />
      );
    case "owner":
      return (
        <InlineSelectCell
          leadId={l.id}
          field="owner_user_id"
          value={l.owner_user_id}
          options={users.map((u) => ({
            value: u.id,
            label: u.full_name ?? "Unknown",
          }))}
        />
      );
    case "source": return l.source ? l.source.replace(/_/g, " ") : "—";
    case "industry": return l.industry_category ? l.industry_category.replace(/_/g, " ") : "—";
    case "state": return l.state || "—";
    case "city": return l.city || "—";
    case "employees": return l.employees != null ? l.employees.toLocaleString() : "—";
    case "score": return l.score != null ? l.score : "—";
    case "last_activity":
      return l.last_activity_at ? formatDate(l.last_activity_at) : (
        <span className="text-xs italic">never</span>
      );
    case "created_at": return formatDate(l.created_at);
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// Main page — list of lists, with URL-driven selection.
// ---------------------------------------------------------------------------

export function LeadListsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [seedFilters, setSeedFilters] = useState<LeadListFilterConfig | null>(null);
  const [seedName, setSeedName] = useState<string>("");
  const { data: lists, isLoading } = useLeadLists();
  const { data: memberCounts } = useLeadListMemberCount();
  const deleteMutation = useDeleteLeadList();

  // selectedListId lives in the URL so navigating to a lead detail and
  // hitting "Back to list" returns to the same view (with sort + quick
  // filter intact since those are also URL-driven).
  const selectedListId = searchParams.get("list");
  const selectedList = (lists ?? []).find((l) => l.id === selectedListId);

  function selectList(id: string | null) {
    const live = new URLSearchParams(window.location.search);
    if (id) live.set("list", id);
    else {
      // Clear list-scoped state when leaving a list.
      live.delete("list");
      live.delete("sort");
      live.delete("dir");
      live.delete("q");
    }
    setSearchParams(live, { replace: true });
  }

  if (selectedList) {
    return (
      <ListDetailView
        list={selectedList}
        onBack={() => selectList(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Lists"
        description="Build static lists for outreach or smart lists that update as your data changes."
        actions={
          <Button onClick={() => { setSeedFilters(null); setSeedName(""); setShowCreate(true); }}>
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
            onClick: () => { setSeedFilters(null); setSeedName(""); setShowCreate(true); },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => selectList(list.id)}
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

      <CreateListDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        initialFilters={seedFilters}
        initialName={seedName}
      />
    </div>
  );
}
