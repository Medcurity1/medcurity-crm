import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  /**
   * When provided, a "Rows" selector is shown so the user can change how
   * many records load per page. Omit it to keep the control hidden
   * (back-compatible with pages that use a fixed page size).
   */
  onPageSizeChange?: (size: number) => void;
  /** Page-size options offered in the selector. */
  pageSizeOptions?: number[];
}

// 200 is the ceiling on purpose: a literal "show all" would try to render
// tens of thousands of rows (accounts/leads), which freezes the browser.
// 200 covers a rep's full working list while staying snappy.
const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

/**
 * Pagination control. For tables that span thousands of rows, click-by-click
 * paging is too slow — so we expose:
 *   • First / Prev / Next / Last buttons
 *   • A typed page jump ("Page __ of N", press Enter to go there)
 *   • Comma-formatted counts everywhere
 */
export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalCount);
  const lastPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);

  // Always include the current pageSize as an option so the selector can
  // reflect a value passed in from a URL even if it's off the default list.
  const options = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  // Local input state so user can type a multi-digit page number
  // before we commit it (typing "2" then "5" shouldn't snap to page 2).
  const [jumpInput, setJumpInput] = useState(String(page + 1));
  useEffect(() => {
    setJumpInput(String(page + 1));
  }, [page]);

  if (totalCount <= 0) return null;

  function commitJump() {
    const parsed = parseInt(jumpInput, 10);
    if (isNaN(parsed)) {
      setJumpInput(String(page + 1));
      return;
    }
    const target = Math.max(0, Math.min(lastPage, parsed - 1));
    if (target !== page) onPageChange(target);
    else setJumpInput(String(page + 1));
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Showing {from.toLocaleString()}-{to.toLocaleString()} of {totalCount.toLocaleString()} result{totalCount !== 1 ? "s" : ""}
        </p>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(0)}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <div className="flex items-center gap-1.5 px-2 text-sm text-muted-foreground">
          <span>Page</span>
          <Input
            type="number"
            min={1}
            max={lastPage + 1}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onBlur={commitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitJump();
            }}
            // Wide enough for up to 5-digit page numbers (i.e. 5 digit total
            // pages = 100k+ pages = 2.5M rows at default page size).
            className="h-8 w-16 text-center"
          />
          <span>of {(lastPage + 1).toLocaleString()}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(lastPage)}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
