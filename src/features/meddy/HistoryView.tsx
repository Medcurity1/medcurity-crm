// History sub-tab: all-time conversation archive with stats, the leads
// panel, filter pills, search, and expandable transcript rows (ports the
// Nexus History tab).

import { useState } from "react";
import { ChevronRight, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { MessageBubble } from "./ChatView";
import {
  useHideLead,
  useMeddyHistory,
  useMeddyMessages,
  useMeddyStats,
  useMeddyUrlHistory,
  useSavedIds,
  useToggleSave,
  type HistoryFilter,
} from "./api";
import { lastMessage, messageCount, type MeddyConversation } from "./types";

const FILTERS: Array<{ key: HistoryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "contact", label: "Has Contact Info" },
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "takeover", label: "Human Takeover" },
  { key: "saved", label: "Saved" },
];

export function HistoryView() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leadsOpen, setLeadsOpen] = useState(false);

  const { data: stats } = useMeddyStats();
  const { data: rows = [], isLoading } = useMeddyHistory(filter, search);
  const { data: savedIds = new Set<string>() } = useSavedIds();
  const { data: leads = [] } = useMeddyHistory("contact", "");

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <div>
        <h3 className="text-sm font-semibold">Conversation History</h3>
        {stats && (
          <p className="text-xs text-muted-foreground">
            {stats.conversations} total conversations | {stats.leads} leads captured
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Conversations" value={stats?.conversations} accent="border-t-primary" />
        <StatCard label="Messages" value={stats?.messages} accent="border-t-sky-500" />
        <StatCard label="Leads Captured" value={stats?.leads} accent="border-t-green-500" />
        <StatCard label="Human Takeovers" value={stats?.takeovers} accent="border-t-violet-500" />
      </div>

      {/* Leads panel */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setLeadsOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", leadsOpen && "rotate-90")} />
          Leads ({leads.length})
        </button>
        {leadsOpen && (
          <div className="border-t border-border px-3 py-2">
            {leads.length === 0 ? (
              <p className="py-1 text-xs text-muted-foreground">No leads captured yet.</p>
            ) : (
              leads.slice(0, 20).map((c) => <LeadRow key={c.id} conversation={c} isAdmin={isAdmin} />)
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search messages, contacts..."
          className="h-8 w-64 text-sm"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {isLoading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No conversation history yet.
          </p>
        ) : (
          rows.map((c) => (
            <HistoryRow
              key={c.id}
              conversation={c}
              saved={savedIds.has(c.id)}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | undefined;
  accent: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border border-t-2 bg-card p-3", accent)}>
      <p className="text-xl font-bold">{value ?? "—"}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function LeadRow({
  conversation: c,
  isAdmin,
}: {
  conversation: MeddyConversation;
  isAdmin: boolean;
}) {
  const hideLead = useHideLead();
  const [confirmHide, setConfirmHide] = useState(false);
  const leadName = c.visitor_name || c.visitor_email || "Unknown";
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
      <span className="font-medium">{leadName}</span>
      <span className="text-muted-foreground">{c.visitor_email}</span>
      {c.visitor_phone && <span className="text-muted-foreground">{c.visitor_phone}</span>}
      <span className="ml-auto text-muted-foreground">{formatDate(c.created_at)}</span>
      {isAdmin && (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Hide lead"
            onClick={() => setConfirmHide(true)}
          >
            <X className="h-3 w-3" />
          </Button>
          <ConfirmDialog
            open={confirmHide}
            onOpenChange={setConfirmHide}
            title="Hide Lead"
            description={`Hide ${leadName} from the leads list? The conversation itself is kept.`}
            confirmLabel="Hide"
            onConfirm={() => {
              hideLead.mutate({ conversationId: c.id });
              setConfirmHide(false);
            }}
          />
        </>
      )}
    </div>
  );
}

function HistoryRow({
  conversation: c,
  saved,
  expanded,
  onToggle,
}: {
  conversation: MeddyConversation;
  saved: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const toggleSave = useToggleSave();
  const last = lastMessage(c);
  const title = c.visitor_name || (last ? last.content.slice(0, 40) : "Visitor");

  return (
    <div className="rounded-md border border-border">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === "Enter" && onToggle()}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-accent/60"
      >
        <span
          role="button"
          tabIndex={0}
          title={saved ? "Unsave" : "Save"}
          className="inline-flex"
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
              "h-3.5 w-3.5",
              saved ? "fill-amber-500 text-amber-500" : "text-muted-foreground/50 hover:text-amber-500",
            )}
          />
        </span>
        <span className="w-24 shrink-0 text-muted-foreground">{formatDate(c.created_at)}</span>
        <span className="truncate font-medium">{title}</span>
        <span className="shrink-0 text-muted-foreground">{messageCount(c)} msgs</span>
        {c.is_human_takeover && (
          <Badge className="h-4 shrink-0 border-transparent bg-sky-500 px-1.5 text-[9px] text-white">
            Human
          </Badge>
        )}
        {c.visitor_email && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Has contact info" />
        )}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </div>
      {expanded && <HistoryDetail conversation={c} />}
    </div>
  );
}

function HistoryDetail({ conversation: c }: { conversation: MeddyConversation }) {
  const { data: messages = [], isLoading } = useMeddyMessages(c.id);
  const { data: urls = [] } = useMeddyUrlHistory(c.id);

  return (
    <div className="space-y-2 border-t border-border bg-muted/20 px-3 py-3">
      {(c.visitor_email || c.visitor_phone) && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs">
          <span className="font-semibold text-green-700 dark:text-green-400">Contact: </span>
          {[c.visitor_name, c.visitor_email, c.visitor_phone, c.visitor_company]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {urls.length > 0 && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
          <p className="mb-1 font-semibold text-sky-700 dark:text-sky-300">Pages Visited</p>
          {urls.map((u) => (
            <div key={u.id} className="flex items-baseline gap-2 py-0.5">
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatDateTime(u.created_at)}
              </span>
              <span className="truncate">{u.page_url}</span>
            </div>
          ))}
        </div>
      )}
      {isLoading ? (
        <p className="py-2 text-center text-xs text-muted-foreground">Loading transcript…</p>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  );
}
