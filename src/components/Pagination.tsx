import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

/**
 * Pagination control. For tables that span thousands of rows, click-by-click
 * paging is too slow — so we expose:
 *   • First / Prev / Next / Last buttons
 *   • A typed page jump ("Page __ of N", press Enter to go there)
 *   • Comma-formatted counts everywhere
 */
export function Pagination({ page, pageSize, totalCount, onPageChange }: PaginationProps) {
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalCount);
  const lastPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);

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
      <p className="text-sm text-muted-foreground">
        Showing {from.toLocaleString()}-{to.toLocaleString()} of {totalCount.toLocaleString()} result{totalCount !== 1 ? "s" : ""}
      </p>
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
