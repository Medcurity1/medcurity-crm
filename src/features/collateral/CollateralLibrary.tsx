// The collateral browsing surface: Jordan's v1.1 spec. ONE home: the
// admin-gated /collateral route (§2; the V1 record-tab mode is gone).
// Cards read from the collateral_items mirror; chips are generated from
// the stored values VERBATIM (§1: no CRM-side inference), so taxonomy
// changes in SharePoint never need code. All styling is .collat-* scoped
// (§0/§4): ice chips that turn navy when selected, white cards with the
// file-type glyph in an ice square, blue link actions, and the amber
// "Review due" badge mirroring the library's Needs Review cycle.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File as FileIcon,
  Pin,
  PinOff,
  Search,
  ShieldAlert,
  Clock,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCollateralItems,
  useLogCopyEvent,
  useMyCollateralPrefs,
  useSaveMyCollateralPrefs,
  useTogglePinned,
  type CollateralItem,
} from "./api";
import {
  buildChipGroups,
  filterItems,
  fileKind,
  initialSegmentSelection,
  isReviewDue,
  type Chip,
  type FileKind,
} from "./collateral-logic";

const SEND_TO_PROSPECT = "Send to Prospect";
const INTERNAL_USE = "Internal Enablement";

const KIND_ICON: Record<FileKind, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  slides: Presentation,
  sheet: FileSpreadsheet,
  image: FileImage,
  file: FileIcon,
};

// ── Chips ────────────────────────────────────────────────────────────

function ChipButton({
  chip,
  active,
  onToggle,
}: {
  chip: Chip;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={active} className="collat-chip">
      {chip.label}
    </button>
  );
}

/** §4: the SRA parent chip: one chip with a caret expanding to the
 * variants (matched on the shared "SRA — " prefix; display-only, no
 * schema change). Clicking the chip toggles the whole family. */
function FamilyChip({
  chip,
  selected,
  onChange,
}: {
  chip: Chip;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const children = chip.children ?? [];
  const parentActive = selected.includes(chip.value);
  const activeChildren = children.filter((c) => selected.includes(c.value));
  const anyActive = parentActive || activeChildren.length > 0;

  function toggleParent() {
    const cleared = selected.filter(
      (v) => v !== chip.value && !children.some((c) => c.value === v),
    );
    onChange(anyActive ? cleared : [...cleared, chip.value]);
  }

  function toggleChild(value: string) {
    // Picking a variant replaces the whole-family selection with variants.
    let next = selected.filter((v) => v !== chip.value);
    next = next.includes(value)
      ? next.filter((v) => v !== value)
      : [...next, value];
    onChange(next);
  }

  const label = parentActive
    ? `${chip.label}: all`
    : activeChildren.length
      ? `${chip.label}: ${activeChildren.map((c) => c.label).join(", ")}`
      : chip.label;

  return (
    <div className={cn("collat-chip", anyActive && "collat-chip--on")} style={{ padding: 0 }}>
      <button type="button" onClick={toggleParent} aria-pressed={anyActive} className="py-[0.28rem] pl-3 pr-1">
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${chip.label} variations`}
            className="flex items-center py-[0.28rem] pl-0.5 pr-2"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem checked={parentActive} onCheckedChange={toggleParent}>
            All {chip.label}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {children.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.value}
              checked={parentActive || selected.includes(c.value)}
              onCheckedChange={() => toggleChild(c.value)}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ChipRow({
  label,
  chips,
  selected,
  onChange,
  trailing,
}: {
  label: string;
  chips: Chip[];
  selected: string[];
  onChange: (next: string[]) => void;
  trailing?: React.ReactNode;
}) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="collat-label w-16 shrink-0">{label}</span>
      {chips.map((chip) =>
        chip.children?.length ? (
          <FamilyChip key={chip.value} chip={chip} selected={selected} onChange={onChange} />
        ) : (
          <ChipButton
            key={chip.value}
            chip={chip}
            active={selected.includes(chip.value)}
            onToggle={() =>
              onChange(
                selected.includes(chip.value)
                  ? selected.filter((v) => v !== chip.value)
                  : [...selected, chip.value],
              )
            }
          />
        ),
      )}
      {trailing}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────

function CollateralCard({ item, isAdmin }: { item: CollateralItem; isAdmin: boolean }) {
  const logCopy = useLogCopyEvent();
  const togglePin = useTogglePinned();
  const internalOnly =
    item.uses.includes(INTERNAL_USE) && !item.uses.includes(SEND_TO_PROSPECT);
  const prospectReady = item.uses.includes(SEND_TO_PROSPECT);
  const reviewDue = isReviewDue(item.last_reviewed);
  const Icon = KIND_ICON[fileKind(item.web_url || item.title)];

  function copyLink() {
    navigator.clipboard
      .writeText(item.web_url)
      .then(() => {
        toast.success("Link copied. Paste it into your email.");
        logCopy.mutate(item.id);
      })
      .catch(() => toast.error("Couldn't copy the link."));
  }

  return (
    <div className={cn("collat-card group", item.pinned && "collat-card--pinned")}>
      <div className="flex items-start gap-2.5">
        <span className="collat-icon">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 flex-1 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {item.title}
        </h3>
        {isAdmin && (
          <button
            type="button"
            className={cn(
              "collat-iconbtn shrink-0",
              !item.pinned && "opacity-0 transition-opacity group-hover:opacity-100",
            )}
            title={item.pinned ? "Unpin" : "Pin to top row"}
            onClick={() => togglePin.mutate({ id: item.id, pinned: !item.pinned })}
          >
            {item.pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Verbatim library values only (§1): empty column, no chip. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {item.asset_type && <span className="collat-tag">{item.asset_type}</span>}
        {item.products.slice(0, 3).map((p) => (
          <span key={p} className="collat-tag--muted collat-tag max-w-36 truncate">
            {p}
          </span>
        ))}
        {item.products.length > 3 && (
          <span className="collat-tag--muted collat-tag">+{item.products.length - 3}</span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {prospectReady && (
          <span className="collat-badge-prospect">
            <Send className="h-2.5 w-2.5" /> Send to Prospect
          </span>
        )}
        {internalOnly && (
          <span className="collat-badge-internal">
            <ShieldAlert className="h-2.5 w-2.5" /> Internal
          </span>
        )}
        {reviewDue && (
          <span className="collat-badge-due">
            <Clock className="h-2.5 w-2.5" /> Review due
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1 pt-3">
        <button type="button" className="collat-link" onClick={copyLink}>
          <Copy className="h-3 w-3" />
          Copy Link
        </button>
        <a className="collat-link" href={item.web_url} target="_blank" rel="noreferrer">
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="flex-1" />
        {item.owner_name && (
          <span className="collat-meta truncate max-w-28" title={`Owner: ${item.owner_name}`}>
            {item.owner_name}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Library ──────────────────────────────────────────────────────────

export function CollateralLibrary() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(
    ((profile as { role?: string } | null)?.role ?? ""),
  );

  const { data: items, isLoading, isError } = useCollateralItems();
  const { data: savedSegments } = useMyCollateralPrefs();
  const savePrefs = useSaveMyCollateralPrefs();

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [uses, setUses] = useState<string[]>([]);

  const chips = useMemo(() => buildChipGroups(items ?? []), [items]);

  // §2/§4 defaults on load: Use = Send to Prospect (the reps' common case)
  // and the rep's saved default segments: with no record context, this is
  // the only personalization they get, so it always applies. Clearable.
  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (appliedDefaults.current || !items || savedSegments === undefined) return;
    appliedDefaults.current = true;
    if (chips.uses.some((c) => c.value === SEND_TO_PROSPECT)) {
      setUses([SEND_TO_PROSPECT]);
    }
    setSegments(initialSegmentSelection(savedSegments, chips.segments));
  }, [items, savedSegments, chips]);

  const filtered = useMemo(
    () =>
      filterItems(
        items ?? [],
        { search, products, assetTypes, segments, uses },
        chips.products,
      ),
    [items, search, products, assetTypes, segments, uses, chips.products],
  );

  // Pinned row: admin-curated, unaffected by chips and search.
  const pinnedItems = useMemo(() => (items ?? []).filter((i) => i.pinned), [items]);
  const gridItems = filtered.filter((i) => !i.pinned);

  const anyFilterActive =
    !!search.trim() ||
    products.length > 0 ||
    assetTypes.length > 0 ||
    segments.length > 0 ||
    uses.length > 0;

  const segmentsDiffer =
    JSON.stringify([...segments].sort()) !==
    JSON.stringify([...(savedSegments ?? [])].sort());

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-[14px]" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="collat-meta py-4">Couldn't load collateral. It will retry automatically.</p>
    );
  }

  // §6 acceptance: an empty grid is the CORRECT state until files are
  // promoted to Current in SharePoint: say so instead of apologizing.
  if (!items?.length) {
    return (
      <div className="collat-empty">
        <span className="collat-empty-icon">
          <FileText className="h-5 w-5" />
        </span>
        <h3>The library is curated in SharePoint</h3>
        <p>
          Files marked <strong>Current</strong> in the Sales Collateral library
          appear here automatically. Drafts and files in review never show.
        </p>
        {isAdmin && (
          <p className="collat-meta">
            Nothing here yet means nothing is marked Current. Promote a file
            in SharePoint, then Sync.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search: title + every tag, combines with chips. A rep typing a
          competitor name matches battlecards that carry it in the title. */}
      <div className="relative">
        <Search className="collat-search-icon pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, product, segment, or competitor…"
          className="collat-search"
          aria-label="Search collateral"
        />
      </div>

      {/* Chip rows: filter, never group. */}
      <div className="space-y-2">
        <ChipRow label="Product" chips={chips.products} selected={products} onChange={setProducts} />
        <ChipRow label="Type" chips={chips.assetTypes} selected={assetTypes} onChange={setAssetTypes} />
        <ChipRow
          label="Segment"
          chips={chips.segments}
          selected={segments}
          onChange={setSegments}
          trailing={
            segmentsDiffer && segments.length > 0 ? (
              <button
                type="button"
                onClick={() => savePrefs.mutate(segments)}
                className="collat-link ml-1 !text-[0.7rem]"
              >
                Save as my default
              </button>
            ) : null
          }
        />
        <ChipRow label="Use" chips={chips.uses} selected={uses} onChange={setUses} />
      </div>

      {/* Pinned row: navy top edge: the platform's "these matter most". */}
      {pinnedItems.length > 0 && (
        <div className="space-y-2">
          <p className="collat-label flex items-center gap-1.5">
            <Pin className="h-3 w-3" /> Pinned
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {pinnedItems.map((item) => (
              <CollateralCard key={item.id} item={item} isAdmin={isAdmin} />
            ))}
          </div>
          <div className="collat-divider" />
        </div>
      )}

      {/* The grid. */}
      {gridItems.length === 0 ? (
        <div className="collat-empty !py-8">
          <p className="collat-meta">Nothing matches your filters.</p>
          {anyFilterActive && (
            <button
              type="button"
              className="collat-btn-secondary"
              onClick={() => {
                setSearch("");
                setProducts([]);
                setAssetTypes([]);
                setSegments([]);
                setUses([]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {gridItems.map((item) => (
            <CollateralCard key={item.id} item={item} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      <p className="collat-meta">
        {gridItems.length} of {(items ?? []).filter((i) => !i.pinned).length} assets
        {pinnedItems.length ? ` · ${pinnedItems.length} pinned` : ""}
      </p>
    </div>
  );
}
