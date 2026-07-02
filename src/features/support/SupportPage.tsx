import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { LifeBuoy, Hand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { MeddyHeader, MEDDY_PANE_CLASS } from "@/features/meddy/MeddyShell";
import { useSupportConversations, useSupportConversation, useSupportRealtime } from "./api";
import { SupportChatView } from "./SupportChatView";
import { displayName, isWaiting, lastPreview, messageCount, type SupportConversation } from "./types";

// Meddy Support console — the staff screen for platform (app.medcurity.com)
// Coach escalations. Reads ONLY the support_* tables: completely walled off
// from the website Meddy (/meddy), per the agreement with Joe.

export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("conversation");
  const { data: conversations, isLoading } = useSupportConversations();
  useSupportRealtime();

  const groups = useMemo(() => {
    const all = conversations ?? [];
    return {
      waiting: all.filter(isWaiting),
      active: all.filter((c) => c.status === "active" && c.is_human_takeover),
      aiHandled: all.filter(
        (c) => c.status === "active" && !c.is_human_takeover && !isWaiting(c),
      ),
      closed: all.filter((c) => c.status === "closed").slice(0, 50),
    };
  }, [conversations]);

  const fromList = (conversations ?? []).find((c) => c.id === selectedId) ?? null;
  // Deep-link fallback: a notification can point at a conversation that's
  // aged out of the top-200 list — fetch it directly so the link works.
  const { data: single } = useSupportConversation(fromList ? null : selectedId);
  const selected = fromList ?? single ?? null;

  function select(id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set("conversation", id);
    else next.delete("conversation");
    // Push (not replace) so the mobile back button returns to the list
    // instead of exiting /support.
    setParams(next);
  }

  return (
    <div className={MEDDY_PANE_CLASS}>
      <MeddyHeader stream="platform" />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {/* ── Conversation list ── */}
        <div
          className={cn(
            "w-full shrink-0 overflow-y-auto border-r bg-muted/20 md:w-80",
            selected && "hidden md:block",
          )}
        >
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (conversations ?? []).length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <LifeBuoy className="mx-auto mb-2 h-8 w-8 opacity-40" />
              No platform chats yet. They appear here as customers talk to
              Meddy inside app.medcurity.com.
            </div>
          ) : (
            <div className="space-y-4 p-3">
              <Section title="Waiting for a human" items={groups.waiting} selectedId={selectedId} onSelect={select} urgent />
              <Section title="With an agent" items={groups.active} selectedId={selectedId} onSelect={select} />
              <Section title="Meddy handling" items={groups.aiHandled} selectedId={selectedId} onSelect={select} />
              <Section title="Ended" items={groups.closed} selectedId={selectedId} onSelect={select} />
            </div>
          )}
        </div>

        {/* ── Chat pane ── */}
        <div className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
          {selected ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                className="border-b px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50 md:hidden"
                onClick={() => select(null)}
              >
                ← All conversations
              </button>
              <div className="min-h-0 flex-1">
                <SupportChatView conversation={selected} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              {/* Same Meddy-on-phone idle illustration as /meddy. */}
              <img
                src="/widget/meddy-on-phone.png?v=2"
                alt=""
                loading="eager"
                className="h-24 w-auto object-contain opacity-70"
              />
              <p className="text-sm">Select a conversation</p>
              {groups.waiting.length > 0 && (
                <p className="text-xs font-medium text-red-500">
                  {groups.waiting.length} customer{groups.waiting.length === 1 ? "" : "s"} waiting for a human
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  selectedId,
  onSelect,
  urgent = false,
}: {
  title: string;
  items: SupportConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  urgent?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={cn(
        "mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider",
        urgent ? "text-red-500" : "text-muted-foreground",
      )}>
        {title} ({items.length})
      </p>
      <div className="space-y-1.5">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60",
              selectedId === c.id && "border-primary/50 bg-muted/60",
              urgent && "border-l-4 border-l-red-500 bg-red-500/5 motion-safe:animate-pulse",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{displayName(c)}</p>
              {urgent && (
                <Badge variant="secondary" className="shrink-0 bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                  <Hand className="mr-0.5 h-3 w-3" />
                  Waiting
                </Badge>
              )}
            </div>
            {c.customer_company && (
              <p className="truncate text-xs text-muted-foreground">{c.customer_company}</p>
            )}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{lastPreview(c)}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              {formatRelativeDate(c.last_message_at ?? c.updated_at)}
              {` · ${messageCount(c)} msgs`}
              {c.is_human_takeover && c.assigned?.full_name ? ` · ${c.assigned.full_name}` : ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
