// The collateral browsing surface: Jordan's v1.1 spec + v1.2 design
// tweaks (2026-08-11 docx). ONE home: the /collateral route — open to
// every signed-in user since v1.2 change 7 (the tab is read-only and
// shows only admin-promoted Current assets). Cards read from the
// collateral_items mirror; chips are generated from the stored values
// VERBATIM (§1: no CRM-side inference), so taxonomy changes in
// SharePoint never need code. All styling is .collat-* scoped (§0).
//
// v1.2 highlights carried by this file:
//   1/12  titles = extension-stripped FILENAME, 3-line clamp, full
//         filename tooltip
//   2     filter rows with fewer than two distinct values (across the
//         synced set) don't render — and a hidden row's selection is inert
//   3     freshness meta line + amber "Review due" / "Not reviewed"
//   4     NO default Use filter on load (supersedes v1.1 §4.8)
//   5     sort control (Recently reviewed default)
//   6     Copy Link toast: bottom-centre, ~3s auto-dismiss, closable
//   9     condensed density toggle, persisted per user
//   10    rep-appropriate empty state, no curation copy
//   11    tokenized order-independent search
//   13    one generically-driven Use pill per card
//   14    image assets render their own artwork as the thumbnail

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
  LayoutGrid,
  Pin,
  PinOff,
  Rows3,
  Search,
  ShieldAlert,
  Clock,
  Send,
  Tag,
  UserCheck,
  X,
} from "lucide-react";
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
  useSaveMyDensity,
  useTogglePinned,
  type CollateralDensity,
  type CollateralItem,
} from "./api";
import {
  activeRowSelection,
  buildChipGroups,
  DEFAULT_SORT,
  displayTitle,
  distinctChipValueCount,
  filterItems,
  fileKind,
  formatReviewDate,
  initialSegmentSelection,
  primaryUse,
  reviewState,
  SORT_OPTIONS,
  sortItems,
  thumbnailUrl,
  usePillKind,
  type Chip,
  type CollateralSort,
  type FileKind,
} from "./collateral-logic";

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
  // v1.2 change 2: a row backed by fewer than two distinct values across
  // the SYNCED SET cannot filter anything — hide it entirely. It comes
  // back on its own once the library carries a second value.
  if (distinctChipValueCount(chips) < 2) return null;
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

// ── Pills ────────────────────────────────────────────────────────────

/** v1.2 change 13: the pill is driven from the value, never a hard-coded
 * list. Known values keep their colors; anything new renders with the
 * neutral default style instead of disappearing. */
function UsePill({ value }: { value: string }) {
  const kind = usePillKind(value);
  const Icon =
    kind === "prospect" ? Send
    : kind === "customer" ? UserCheck
    : kind === "internal" ? ShieldAlert
    : Tag;
  const className =
    kind === "prospect" ? "collat-badge-prospect"
    : kind === "customer" ? "collat-badge-customer"
    : kind === "internal" ? "collat-badge-internal"
    : "collat-badge-generic";
  // "Internal Enablement" keeps its v1.1 shorthand; everything else
  // renders the library's value verbatim.
  const label = kind === "internal" ? "Internal" : value;
  return (
    <span className={className}>
      <Icon className="h-2.5 w-2.5" /> {label}
    </span>
  );
}

// ── Card ─────────────────────────────────────────────────────────────

function CollateralCard({
  item,
  isAdmin,
  dense,
  onNotify,
}: {
  item: CollateralItem;
  isAdmin: boolean;
  dense: boolean;
  onNotify: (message: string) => void;
}) {
  const logCopy = useLogCopyEvent();
  const togglePin = useTogglePinned();
  const review = reviewState(item.last_reviewed);
  const use = primaryUse(item.uses);
  // Title first: since v1.2 the title IS the SharePoint filename, while
  // web_url for Office files is a Doc.aspx viewer link whose "extension"
  // parses as aspx.
  const Icon = KIND_ICON[fileKind(item.title || item.web_url)];

  // v1.2 change 14: image assets show their own artwork. The <img> loads
  // the stored SharePoint web_url through the rep's existing SharePoint
  // session (the same auth the Open link uses); if the browser can't
  // fetch it, the card falls back to the file-type glyph. A failure is
  // forgotten when the URL changes (sync refresh) so it can retry.
  const thumb = dense ? null : thumbnailUrl(item);
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => setThumbFailed(false), [item.web_url]);
  const showThumb = !!thumb && !thumbFailed;

  function copyLink() {
    navigator.clipboard
      .writeText(item.web_url)
      .then(() => {
        onNotify("Link copied. Paste it into your email.");
        logCopy.mutate(item.id);
      })
      .catch(() => onNotify("Couldn't copy the link."));
  }

  return (
    <div
      className={cn(
        "collat-card group",
        item.pinned && "collat-card--pinned",
        dense && "collat-card--dense",
      )}
    >
      {showThumb && (
        <div className="collat-thumb">
          <img
            src={thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbFailed(true)}
          />
        </div>
      )}
      <div className="flex items-start gap-2.5">
        {!showThumb && (
          <span className="collat-icon">
            <Icon className="h-4 w-4" />
          </span>
        )}
        {/* v1.2 changes 1 + 12: extension-stripped filename, three lines
            before truncating, full filename on hover. */}
        <h3
          title={item.title}
          className="min-w-0 flex-1 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden"
        >
          {displayTitle(item.title)}
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

      {/* Verbatim library values only (§1): empty column, no chip. Hidden
          in condensed view — that's a titles-only scanning layout. */}
      {!dense && (item.asset_type || item.products.length > 0) && (
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
      )}

      {/* Use pill (comfortable only) + review warning. The amber warning
          survives condensed view on purpose: it's a warning, not a tag —
          hiding it would let a rep send stale material unflagged. */}
      {((!dense && use) || review !== "reviewed") && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {!dense && use && <UsePill value={use} />}
          {review === "due" && (
            <span className="collat-badge-due">
              <Clock className="h-2.5 w-2.5" /> Review due
            </span>
          )}
          {review === "never" && (
            <span className="collat-badge-due">
              <Clock className="h-2.5 w-2.5" /> Not reviewed
            </span>
          )}
        </div>
      )}

      {/* v1.2 change 3: freshness on the card. */}
      {!dense && review !== "never" && item.last_reviewed && (
        <p className="collat-meta mt-1.5">Reviewed {formatReviewDate(item.last_reviewed)}</p>
      )}

      <div className={cn("mt-auto flex items-center gap-1", dense ? "pt-2" : "pt-3")}>
        <button type="button" className="collat-link" onClick={copyLink}>
          <Copy className="h-3 w-3" />
          Copy Link
        </button>
        <a className="collat-link" href={item.web_url} target="_blank" rel="noreferrer">
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="flex-1" />
        {!dense && item.owner_name && (
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
  const { data: prefs } = useMyCollateralPrefs();
  const savePrefs = useSaveMyCollateralPrefs();
  const saveDensity = useSaveMyDensity();

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [uses, setUses] = useState<string[]>([]);
  const [sort, setSort] = useState<CollateralSort>(DEFAULT_SORT);
  const [density, setDensity] = useState<CollateralDensity>("comfortable");
  // Choices made before the saved prefs resolve must win over them: the
  // adoption effect below skips anything the user already touched.
  const densityTouched = useRef(false);
  const segmentsTouched = useRef(false);

  const chips = useMemo(() => buildChipGroups(items ?? []), [items]);

  // Defaults on load. v1.2 change 4 REMOVED the v1.1 "Use = Send to
  // Prospect" default: a fresh load shows every Current asset. The
  // per-user saved segment preference is unaffected and still applies.
  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (appliedDefaults.current || !items || !prefs) return;
    appliedDefaults.current = true;
    if (!segmentsTouched.current) {
      setSegments(initialSegmentSelection(prefs.default_segments, chips.segments));
    }
    // v1.2 change 9: density persists per user.
    if (!densityTouched.current) setDensity(prefs.density);
  }, [items, prefs, chips]);

  function pickSegments(next: string[]) {
    segmentsTouched.current = true;
    setSegments(next);
  }

  function pickDensity(next: CollateralDensity) {
    densityTouched.current = true;
    setDensity(next);
    saveDensity.mutate({ density: next });
  }

  // v1.2 change 6: the Copy Link confirmation lives at bottom-centre,
  // clear of the search field, auto-dismisses after ~3s, and can be
  // closed by hand. Route-scoped on purpose — the global toaster (used by
  // every other page) stays exactly as it is.
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimer = useRef<number | null>(null);
  function showCopyToast(message: string) {
    setCopyToast(message);
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    copyToastTimer.current = window.setTimeout(() => setCopyToast(null), 3000);
  }
  function closeCopyToast() {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    setCopyToast(null);
  }
  useEffect(
    () => () => {
      if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    },
    [],
  );

  // Change 2's flip side: a row that doesn't render must not filter.
  // Selections held by hidden rows (a saved segment default on a
  // single-value set, or a set that shrank on re-sync) are inert.
  const filtered = useMemo(
    () =>
      filterItems(
        items ?? [],
        {
          search,
          products: activeRowSelection(chips.products, products),
          assetTypes: activeRowSelection(chips.assetTypes, assetTypes),
          segments: activeRowSelection(chips.segments, segments),
          uses: activeRowSelection(chips.uses, uses),
        },
        chips.products,
      ),
    [items, search, products, assetTypes, segments, uses, chips],
  );

  // Pinned row: admin-curated, unaffected by chips, search, and sort.
  const pinnedItems = useMemo(() => (items ?? []).filter((i) => i.pinned), [items]);
  const gridItems = useMemo(
    () => sortItems(filtered.filter((i) => !i.pinned), sort),
    [filtered, sort],
  );

  const anyFilterActive =
    !!search.trim() ||
    products.length > 0 ||
    assetTypes.length > 0 ||
    segments.length > 0 ||
    uses.length > 0;

  const segmentsDiffer =
    JSON.stringify([...segments].sort()) !==
    JSON.stringify([...(prefs?.default_segments ?? [])].sort());

  const gridClass = density === "condensed"
    ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
    : "grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4";

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

  // v1.2 change 10: rep-appropriate empty state — no SharePoint process
  // copy anywhere on the page (acceptance check: unqualified, so admins
  // get the same copy; the Sync button and docs carry the curation story).
  if (!items?.length) {
    return (
      <div className="collat-empty">
        <span className="collat-empty-icon">
          <FileText className="h-5 w-5" />
        </span>
        <h3>No collateral matches yet</h3>
        <p>
          Ask an admin to add what you need using <strong>Request collateral</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search: title + every tag, combines with chips. v1.2 change 11:
          word tokens, any order, partial match. */}
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

      {/* Chip rows: filter, never group. Rows with one distinct value
          across the synced set hide themselves (change 2). */}
      <div className="space-y-2">
        <ChipRow label="Product" chips={chips.products} selected={products} onChange={setProducts} />
        <ChipRow label="Type" chips={chips.assetTypes} selected={assetTypes} onChange={setAssetTypes} />
        <ChipRow
          label="Segment"
          chips={chips.segments}
          selected={segments}
          onChange={pickSegments}
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

      {/* Results toolbar (changes 5 + 9): sort + density. Always rendered
          while the library has assets — hiding it on a zero-match filter
          would strand a rep in condensed view with no way back. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="collat-label" htmlFor="collat-sort">
            Sort
          </label>
          <div className="collat-select-wrap">
            <select
              id="collat-sort"
              className="collat-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as CollateralSort)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="collat-select-caret h-3.5 w-3.5" />
          </div>
          <div className="collat-density" role="group" aria-label="Card density">
            <button
              type="button"
              aria-pressed={density === "comfortable"}
              title="Comfortable view"
              onClick={() => pickDensity("comfortable")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-pressed={density === "condensed"}
              title="Condensed view"
              onClick={() => pickDensity("condensed")}
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

      {/* Pinned row: navy top edge: the platform's "these matter most". */}
      {pinnedItems.length > 0 && (
        <div className="space-y-2">
          <p className="collat-label flex items-center gap-1.5">
            <Pin className="h-3 w-3" /> Pinned
          </p>
          <div className={gridClass}>
            {pinnedItems.map((item) => (
              <CollateralCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                dense={density === "condensed"}
                onNotify={showCopyToast}
              />
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
                pickSegments([]);
                setUses([]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={gridClass}>
          {gridItems.map((item) => (
            <CollateralCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              dense={density === "condensed"}
              onNotify={showCopyToast}
            />
          ))}
        </div>
      )}

      <p className="collat-meta">
        {gridItems.length} of {(items ?? []).filter((i) => !i.pinned).length} assets
        {pinnedItems.length ? ` · ${pinnedItems.length} pinned` : ""}
      </p>

      {/* v1.2 change 6: the Copy Link confirmation. */}
      {copyToast && (
        <div className="collat-toast" role="status">
          <span>{copyToast}</span>
          <button type="button" aria-label="Dismiss notification" onClick={closeCopyToast}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
