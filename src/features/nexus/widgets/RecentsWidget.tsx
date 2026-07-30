// Recents widget: the signed-in user's recently visited records, ported
// from HomePage's RecentRecordsWidget (Nexus Phase 2, docket C2). Purely
// client-side: reads useRecentRecords (localStorage key
// `crm_recent_records:<userId>`, newest first, max 10), no queries, so
// there's nothing to report to onDataUpdated and no loading/error state.
// Lead entries are filtered out exactly like HomePage does: /imports/:id
// is admin-gated and leads were retired, so a rep's legacy "lead" entry
// would be a dead link.

import type { ElementType } from "react";
import { Link } from "react-router-dom";
import { Building2, Target, Users } from "lucide-react";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
import { formatRelativeDate } from "@/lib/formatters";
import type { NexusWidgetBodyProps } from "../WidgetShell";

function recentRecordPath(r: RecentRecord): string {
  switch (r.entity) {
    case "account":
      return `/accounts/${r.id}`;
    case "contact":
      return `/contacts/${r.id}`;
    case "opportunity":
      return `/opportunities/${r.id}`;
    case "lead":
      return `/imports/${r.id}`;
  }
}

function recentRecordIcon(entity: RecentRecord["entity"]): ElementType {
  switch (entity) {
    case "account":
      return Building2;
    case "contact":
      return Users;
    case "opportunity":
      return Target;
    case "lead":
      return Users;
  }
}

export function RecentsWidget({ widget, searchQuery }: NexusWidgetBodyProps) {
  const { records } = useRecentRecords();

  // Legacy pre-retirement lead entries would 404 for non-admins, so drop
  // them, same as Home's own Recently Viewed card.
  const visitable = records.filter((r) => r.entity !== "lead");
  const preview = visitable.slice(0, widget.preview_count);

  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? preview.filter((r) => r.name.toLowerCase().includes(q))
    : preview;

  if (!visitable.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        Nothing visited yet.
      </p>
    );
  }

  if (!visible.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No rows match your filter.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {visible.map((r) => {
        const Icon = recentRecordIcon(r.entity);
        return (
          <Link
            key={`${r.entity}-${r.id}`}
            to={recentRecordPath(r)}
            className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted transition-colors"
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {r.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeDate(r.viewedAt)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
