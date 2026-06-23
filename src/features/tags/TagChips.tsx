// Renders tags as colored chips, with an optional remove (x) per chip.
// Shared by the contact detail page, the contacts list column, etc.

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types/crm";

// color token -> chip classes. Keep keys in sync with TAG_COLOR_OPTIONS.
const TAG_COLORS: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
};

export const TAG_COLOR_OPTIONS = Object.keys(TAG_COLORS);

export function tagColorClass(color: string | null | undefined): string {
  return TAG_COLORS[color ?? "gray"] ?? TAG_COLORS.gray;
}

/** Just the bg-* class, for a small color dot. */
export function tagDotClass(color: string | null | undefined): string {
  return tagColorClass(color).split(" ")[0];
}

export function TagChips({
  tags,
  onRemove,
  className,
}: {
  tags: Tag[];
  onRemove?: (tag: Tag) => void;
  className?: string;
}) {
  if (!tags.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <Badge
          key={t.id}
          variant="secondary"
          className={cn("font-normal gap-1", tagColorClass(t.color))}
        >
          {t.name}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(t);
              }}
              className="hover:opacity-70"
              aria-label={`Remove tag ${t.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
    </span>
  );
}
