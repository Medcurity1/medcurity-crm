import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/QueryError";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  SUPPORT_HISTORY_PAGE_SIZE,
  useSupportHistory,
  useSupportMessages,
  useSupportStats,
  type SupportHistoryFilter,
} from "./api";
import { SupportMessageBubble } from "./SupportChatView";
import { displayName, messageCount, type SupportConversation } from "./types";

const FILTERS: Array<{ key: SupportHistoryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "human", label: "Human Requested" },
  { key: "ended", label: "Ended" },
  { key: "open", label: "Open" },
];

export function SupportHistoryView() {
  const [filter, setFilter] = useState<SupportHistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: stats } = useSupportStats();
  const { data: rows = [], isLoading, isError, isFetching, refetch } =
    useSupportHistory(filter, search, page);

  useEffect(() => {
    setPage(0);
    setExpandedId(null);
  }, [filter, search]);

  return (
    <div className="space-y-4 overflow-y-auto p-3 sm:p-4">
      <div>
        <h2 className="text-sm font-semibold">Platform Conversation History</h2>
        <p className="text-xs text-muted-foreground">
          Every conversation handed from app.medcurity.com to the support team.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="Conversations" value={stats?.conversations} accent="border-t-primary" />
        <StatCard label="Messages" value={stats?.messages} accent="border-t-sky-500" />
        <StatCard label="Human Requests" value={stats?.humanRequests} accent="border-t-orange-500" />
        <StatCard label="Takeovers" value={stats?.takeovers} accent="border-t-violet-500" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, or organization..."
          aria-label="Search platform conversation history"
          className="h-9 w-full text-sm sm:w-72"
        />
        <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === item.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
        ) : isError ? (
          <QueryError
            compact
            message="Couldn't load platform conversation history."
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">No matching platform conversations</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another filter or search.</p>
          </div>
        ) : (
          rows.map((conversation) => (
            <HistoryRow
              key={conversation.id}
              conversation={conversation}
              expanded={expandedId === conversation.id}
              onToggle={() =>
                setExpandedId(expandedId === conversation.id ? null : conversation.id)
              }
            />
          ))
        )}
      </div>

      {!isLoading && !isError && (page > 0 || rows.length === SUPPORT_HISTORY_PAGE_SIZE) && (
        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < SUPPORT_HISTORY_PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value?: number; accent: string }) {
  return (
    <div className={cn("rounded-lg border border-t-2 bg-card p-3", accent)}>
      <p className="text-xl font-bold">{value ?? "—"}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function HistoryRow({
  conversation,
  expanded,
  onToggle,
}: {
  conversation: SupportConversation;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-3 py-2 text-left text-xs hover:bg-accent/60 sm:grid-cols-[6rem_minmax(0,1fr)_auto_auto_auto]"
      >
        <span className="text-muted-foreground">{formatDate(conversation.created_at)}</span>
        <span className="truncate font-medium">{displayName(conversation)}</span>
        <Badge variant="secondary" className="row-span-2 shrink-0 sm:row-span-1">
          {conversation.status === "closed" ? "Ended" : "Open"}
        </Badge>
        <span className="col-start-2 truncate text-[11px] text-muted-foreground sm:col-auto">
          {conversation.customer_company || "Platform customer"}
        </span>
        <span className="hidden shrink-0 text-muted-foreground sm:block">
          {messageCount(conversation)} msgs
        </span>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && <HistoryDetail conversation={conversation} />}
    </div>
  );
}

function HistoryDetail({ conversation }: { conversation: SupportConversation }) {
  const { data: messages = [], isLoading, isError, refetch, isFetching } =
    useSupportMessages(conversation.id);
  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Started {formatDateTime(conversation.created_at)}</span>
        {conversation.human_requested_at && <span>Human requested {formatDateTime(conversation.human_requested_at)}</span>}
        {conversation.closed_at && <span>Ended {formatDateTime(conversation.closed_at)}</span>}
      </div>
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-8 w-3/4" /><Skeleton className="ml-auto h-8 w-2/3" /></div>
      ) : isError ? (
        <QueryError compact message="Couldn't load this transcript." onRetry={() => refetch()} isRetrying={isFetching} />
      ) : messages.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">No transcript was synchronized.</p>
      ) : (
        <div className="space-y-2">{messages.map((message) => <SupportMessageBubble key={message.id} m={message} />)}</div>
      )}
    </div>
  );
}
