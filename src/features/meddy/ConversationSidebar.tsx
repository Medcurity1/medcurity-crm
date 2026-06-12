// Left column of the Meddy tab: availability toggle, search, team-online
// panel, and the Active / Recent / Saved conversation sections (Nexus
// sidebar, restyled with Pulse primitives).

import { useState } from "react";
import { ArrowLeft, ChevronRight, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeDate } from "@/lib/formatters";
import {
  useMeddyConversations,
  useMyAvailability,
  useReopenConversation,
  useSetAvailability,
  useTeamStatus,
  useToggleSave,
} from "./api";
import {
  isUrgent,
  lastMessage,
  messageCount,
  pageLabel,
  siteLabel,
  type MeddyConversation,
} from "./types";

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  unreadIds: Set<string>;
};

export function ConversationSidebar({ selectedId, onSelect, onBack, unreadIds }: Props) {
  const { data: lists, isLoading } = useMeddyConversations();
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    active: true,
    recent: true,
    saved: false, // Nexus default: saved starts collapsed
  });
  const [teamOpen, setTeamOpen] = useState(true);

  const filter = (rows: MeddyConversation[]) => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((c) => {
      const last = lastMessage(c);
      return (
        (c.visitor_name ?? "").toLowerCase().includes(s) ||
        (c.visitor_email ?? "").toLowerCase().includes(s) ||
        (last?.content ?? "").toLowerCase().includes(s)
      );
    });
  };

  const sections: Array<{
    key: "active" | "recent" | "saved";
    label: string;
    rows: MeddyConversation[];
    empty: string;
  }> = [
    {
      key: "active",
      label: "Active conversations",
      rows: filter(lists?.active ?? []),
      empty: "No active conversations",
    },
    {
      key: "recent",
      label: "Recent conversations",
      rows: filter(lists?.recent ?? []),
      empty: "No recent conversations",
    },
    {
      key: "saved",
      label: "Saved conversations",
      rows: filter(lists?.saved ?? []),
      empty: "No saved conversations",
    },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-1">
          {selectedId && (
            <button
              type="button"
              title="Back to start screen"
              onClick={onBack}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-sm font-semibold">Conversations</h2>
        </div>
        <AvailabilityToggle />
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <TeamPanel open={teamOpen} onToggle={() => setTeamOpen((v) => !v)} />

      <div className="flex-1 overflow-y-auto pb-2">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <button
                type="button"
                onClick={() =>
                  setOpenSections((s) => ({ ...s, [section.key]: !s[section.key] }))
                }
                className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    openSections[section.key] && "rotate-90",
                  )}
                />
                {section.label} ({section.rows.length})
              </button>
              {openSections[section.key] && (
                <div className="space-y-1 px-2">
                  {section.rows.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{section.empty}</p>
                  ) : (
                    section.rows.map((c) => (
                      <ConversationCard
                        key={`${section.key}-${c.id}`}
                        conversation={c}
                        sectionKey={section.key}
                        selected={c.id === selectedId}
                        unread={unreadIds.has(c.id)}
                        saved={lists?.savedIds.has(c.id) ?? false}
                        onSelect={() => onSelect(c.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Manual Available/Away toggle. Lives here next to the Conversations
 * title (Nathan's call), not in the top bar like Nexus had it. The flip
 * is optimistic (see useSetAvailability) so it reacts instantly. */
function AvailabilityToggle() {
  const { data: available = false } = useMyAvailability();
  const setAvailability = useSetAvailability();
  return (
    <button
      type="button"
      title={available ? "Click to go Away" : "Click to go Available"}
      onClick={() => setAvailability.mutate(!available)}
      className={cn(
        "flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition-all duration-150",
        "hover:shadow active:scale-95",
        available
          ? "border-green-500/60 bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:text-green-400"
          : "border-border bg-muted text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full transition-colors",
          available ? "animate-pulse bg-green-500" : "bg-muted-foreground/50",
        )}
      />
      {available ? "Available" : "Away"}
    </button>
  );
}

function TeamPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { data: team = [] } = useTeamStatus();
  const onlineCount = team.filter((m) => m.available).length;
  return (
    <div className="border-y border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        Team
        <span className="font-normal normal-case">({onlineCount} online)</span>
      </button>
      {open && (
        <div className="px-3 pb-2">
          {team.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-0.5 text-xs">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  m.available ? "bg-green-500" : "bg-muted-foreground/30",
                )}
              />
              <span className={cn("truncate", !m.available && "text-muted-foreground")}>
                {m.full_name ?? "Unknown"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationCard({
  conversation: c,
  sectionKey,
  selected,
  unread,
  saved,
  onSelect,
}: {
  conversation: MeddyConversation;
  sectionKey: "active" | "recent" | "saved";
  selected: boolean;
  unread: boolean;
  saved: boolean;
  onSelect: () => void;
}) {
  const toggleSave = useToggleSave();
  const reopen = useReopenConversation();
  const last = lastMessage(c);
  const preview = last ? last.content.slice(0, 60) : "No messages";
  // Urgent pulse only outside Recent (Nexus rule: a stale request that
  // aged into Recent stops flashing).
  const urgent = isUrgent(c) && sectionKey !== "recent";
  const page = pageLabel(c.page_url);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      className={cn(
        "relative w-full cursor-pointer rounded-md border-l-[3px] px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-l-primary bg-accent"
          : "border-l-transparent hover:border-l-primary/40 hover:bg-accent/60",
        urgent && "border-l-red-500 animate-pulse bg-red-500/10",
        !urgent && c.visitor_email && !selected && "border-l-green-500/60",
      )}
    >
      {unread && !selected && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
      )}
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium">
          {c.visitor_name || "Visitor"}
        </span>
        {c.visitor_email && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Has contact info" />
        )}
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] font-medium">
          {siteLabel(c)}
        </Badge>
        {urgent && (
          <Badge className="h-4 shrink-0 border-transparent bg-red-500 px-1 text-[9px] font-semibold text-white">
            Urgent
          </Badge>
        )}
        {c.assigned && (
          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">
            {c.assigned.full_name ?? "Agent"}
          </Badge>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>
      {page && <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{page}</p>}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{messageCount(c)} msgs</span>
        <span>{formatRelativeDate(c.updated_at)}</span>
        {c.status === "closed" && sectionKey !== "recent" && <span>ended</span>}
        {c.status === "closed" && sectionKey === "recent" && (
          <Button
            variant="outline"
            size="xs"
            className="h-4 px-1.5 text-[9px]"
            disabled={reopen.isPending}
            onClick={(e) => {
              e.stopPropagation();
              reopen.mutate({ conversationId: c.id });
            }}
          >
            Reopen
          </Button>
        )}
        <span
          role="button"
          tabIndex={0}
          title={saved ? "Unsave" : "Save"}
          className="ml-auto inline-flex"
          onClick={(e) => {
            e.stopPropagation();
            toggleSave.mutate({ conversationId: c.id, save: !saved });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              toggleSave.mutate({ conversationId: c.id, save: !saved });
            }
          }}
        >
          <Star
            className={cn(
              "h-3.5 w-3.5 transition-colors",
              saved
                ? "fill-amber-500 text-amber-500"
                : "text-muted-foreground/50 hover:text-amber-500",
            )}
          />
        </span>
      </div>
    </div>
  );
}
