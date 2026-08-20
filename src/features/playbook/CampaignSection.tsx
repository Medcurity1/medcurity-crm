// The one collapsible-section header every Campaigns home group uses
// (Replies, Needs you, Active, Drafts, Recently ended) — a real button
// with a visible hover, a count pill, and a chevron. One treatment for
// all five groups (Aurora rebuild, Nathan 8/19).

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function CampaignSectionHeader({
  title,
  count,
  open,
  onToggle,
  icon,
  trailing,
}: {
  title: string;
  count: ReactNode;
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" className="camp-section-head" aria-expanded={open} onClick={onToggle}>
      <span className="camp-section-title">
        {icon}
        {title}
        <span className="camp-count">{count}</span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        {trailing}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </span>
    </button>
  );
}
