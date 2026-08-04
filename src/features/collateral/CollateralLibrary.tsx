// The collateral browsing surface (Jordan's spec, items 2-9). One
// component, two homes: the /collateral page and the Collateral tab on
// contact + deal records (compact mode). Cards read from collateral_items;
// chips are generated from the data so taxonomy changes never need code.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCollateralItems,
  useLogCopyEvent,
  useMyCollateralPrefs,
  useSaveMyCollateralPrefs,
  useTogglePinned,
  useArchiveCollateralItem,
  type CollateralItem,
} from "./api";
import {
  buildChipGroups,
  filterItems,
  initialSegmentSelection,
  type Chip,
} from "./collateral-logic";

const SEND_TO_PROSPECT = "Send to Prospect";
const INTERNAL_USE = "Internal Enablement";

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
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      {chip.label}
    </button>
  );
}

/** Item 4: a product family collapses into one chip with a variant menu.
 * Clicking the chip toggles the whole family; the chevron picks variants. */
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
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-full border text-xs font-medium transition-colors",
        anyActive
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={toggleParent}
        aria-pressed={anyActive}
        className="py-1 pl-3 pr-1.5"
      >
        {label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${chip.label} variations`}
            className={cn(
              "flex items-center border-l py-1 pl-1 pr-2",
              anyActive ? "border-primary-foreground/30" : "border-border",
            )}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={parentActive}
            onCheckedChange={toggleParent}
          >
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
      <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {chips.map((chip) =>
        chip.children?.length ? (
          <FamilyChip
            key={chip.value}
            chip={chip}
            selected={selected}
            onChange={onChange}
          />
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

function CollateralCard({
  item,
  isAdmin,
  compact,
  onEdit,
}: {
  item: CollateralItem;
  isAdmin: boolean;
  compact: boolean;
  onEdit?: (item: CollateralItem) => void;
}) {
  const logCopy = useLogCopyEvent();
  const togglePin = useTogglePinned();
  const archive = useArchiveCollateralItem();
  const internalOnly =
    item.uses.includes(INTERNAL_USE) && !item.uses.includes(SEND_TO_PROSPECT);

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
    <div className="group relative flex flex-col rounded-xl border bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/[0.06]">
          <FileText className="h-3.5 w-3.5 text-sky-500" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {item.title}
        </p>
        {item.pinned && (
          <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {item.asset_type && (
          <Badge className="border-transparent bg-sky-500/15 text-[10px] text-sky-600 dark:text-sky-400">
            {item.asset_type}
          </Badge>
        )}
        {item.products.slice(0, compact ? 2 : 3).map((p) => (
          <Badge
            key={p}
            variant="outline"
            className="max-w-36 truncate text-[10px] text-muted-foreground"
          >
            {p}
          </Badge>
        ))}
        {item.products.length > (compact ? 2 : 3) && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            +{item.products.length - (compact ? 2 : 3)}
          </Badge>
        )}
        {internalOnly && (
          <Badge className="gap-1 border-transparent bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-3 w-3" /> Internal
          </Badge>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 pt-0.5">
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" onClick={copyLink}>
          <Copy className="h-3 w-3" />
          Copy Link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          asChild
        >
          <a href={item.web_url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
        </Button>
        <span className="flex-1" />
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label="Manage asset"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => togglePin.mutate({ id: item.id, pinned: !item.pinned })}
              >
                <Pin className="mr-2 h-3.5 w-3.5" />
                {item.pinned ? "Unpin" : "Pin to top row"}
              </DropdownMenuItem>
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(item)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => archive.mutate(item.id)}
              >
                <Archive className="mr-2 h-3.5 w-3.5" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ── Library ──────────────────────────────────────────────────────────

export interface CollateralLibraryProps {
  /** Record-tab mode: tighter grid, no pinned header text tweaks. */
  compact?: boolean;
  /** Admin add/edit dialog opener (page provides it). */
  onEdit?: (item: CollateralItem) => void;
}

export function CollateralLibrary({ compact = false, onEdit }: CollateralLibraryProps) {
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

  // Item 5: default the Use chip to Send to Prospect — the fastest action
  // is the safe one. Item 7: the rep's saved segments preselect. Applied
  // once when data + prefs land; the rep can clear anything after.
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

  // Item 8: the pinned row ignores chips and search entirely.
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
      <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
        {Array.from({ length: compact ? 4 : 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Couldn't load collateral. It will retry automatically.
      </p>
    );
  }

  if (!items?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">No collateral yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {isAdmin
            ? "Add assets by hand or connect the SharePoint sync, and they'll show up here as cards."
            : "Assets are being loaded. Check back soon."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search (item 2): title + every tag, combines with chips. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search collateral by name or tag..."
          className="h-9 pl-9"
        />
      </div>

      {/* Chip rows (item 3): filter, never group. */}
      <div className="space-y-2">
        <ChipRow label="Product" chips={chips.products} selected={products} onChange={setProducts} />
        <ChipRow label="Type" chips={chips.assetTypes} selected={assetTypes} onChange={setAssetTypes} />
        <ChipRow
          label="Segment"
          chips={chips.segments}
          selected={segments}
          onChange={setSegments}
          trailing={
            !compact && segmentsDiffer && segments.length > 0 ? (
              <button
                type="button"
                onClick={() => savePrefs.mutate(segments)}
                className="ml-1 flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Check className="h-3 w-3" />
                Save as my default
              </button>
            ) : null
          }
        />
        <ChipRow label="Use" chips={chips.uses} selected={uses} onChange={setUses} />
      </div>

      {/* Pinned row (item 8): admin-curated, unaffected by filters. */}
      {pinnedItems.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="h-3 w-3" /> Pinned
          </p>
          <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
            {pinnedItems.map((item) => (
              <CollateralCard key={item.id} item={item} isAdmin={isAdmin} compact={compact} onEdit={onEdit} />
            ))}
          </div>
          <div className="border-t border-dashed" />
        </div>
      )}

      {/* The grid. */}
      {gridItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing matches your filters.</p>
          {anyFilterActive && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearch("");
                setProducts([]);
                setAssetTypes([]);
                setSegments([]);
                setUses([]);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
          {gridItems.map((item) => (
            <CollateralCard key={item.id} item={item} isAdmin={isAdmin} compact={compact} onEdit={onEdit} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {gridItems.length} of {(items ?? []).filter((i) => !i.pinned).length} assets
        {pinnedItems.length ? ` · ${pinnedItems.length} pinned` : ""}
      </p>
    </div>
  );
}
