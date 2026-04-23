import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface SortState {
  column: string | null;
  direction: "asc" | "desc";
}

/**
 * Clickable table column header with a sort caret. Cycles through
 * asc → desc → cleared (same column), or jumps to asc (new column).
 *
 * Usage:
 *   const [sort, setSort] = useState<SortState>({ column: "name", direction: "asc" });
 *   <SortableHeader column="name" sort={sort} onSort={setSort}>Name</SortableHeader>
 *
 * Then pipe `sort` into your useQuery hook so it re-runs server-side
 * sorting via PostgREST `.order()`.
 */
export function SortableHeader({
  column,
  sort,
  onSort,
  children,
  className,
  align = "left",
}: {
  column: string;
  sort: SortState;
  onSort: (next: SortState) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const active = sort.column === column;
  const Icon = active
    ? sort.direction === "asc"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;

  function handleClick() {
    if (!active) {
      onSort({ column, direction: "asc" });
    } else if (sort.direction === "asc") {
      onSort({ column, direction: "desc" });
    } else {
      onSort({ column: null, direction: "asc" });
    }
  }

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1 font-medium text-left hover:text-foreground transition-colors",
          active ? "text-foreground" : "text-muted-foreground",
          align === "right" && "justify-end w-full",
          align === "center" && "justify-center w-full"
        )}
      >
        {children}
        <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}
