// Meddy — staff command center for the website chat assistant.
// Two-pane layout: conversation sidebar (left) + chat detail / idle
// illustration (right), with a History sub-tab. Ported from the Nexus
// Meddy hub onto Pulse primitives; realtime via the meddy:dashboard
// broadcast channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMeddyConversation, useMeddyConversations } from "./api";
import { useMeddyRealtime } from "./useMeddyRealtime";
import { MeddyHeader, MEDDY_PANE_CLASS } from "./MeddyShell";
import { ConversationSidebar } from "./ConversationSidebar";
import { ChatView } from "./ChatView";
import { HistoryView } from "./HistoryView";
import { MeddySweeperGame } from "@/features/meddy-sweeper/MeddySweeperGame";

export function MeddyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("conversation");
  const tab = searchParams.get("tab") === "history" ? "history" : "conversations";

  const { data: lists } = useMeddyConversations();
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const onVisitorMessage = useCallback((conversationId: string) => {
    if (conversationId === selectedIdRef.current) return;
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.add(conversationId);
      return next;
    });
  }, []);
  useMeddyRealtime({ onVisitorMessage });

  const select = useCallback(
    (id: string | null) => {
      // Push (not replace) so hardware back returns to the list instead
      // of exiting /meddy — matches SupportPage.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id) {
          next.set("conversation", id);
          next.delete("tab"); // selecting always lands on Conversations
        } else {
          next.delete("conversation");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  // Clear the unread dot when a conversation is opened.
  useEffect(() => {
    if (!selectedId) return;
    setUnreadIds((prev) => {
      if (!prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.delete(selectedId);
      return next;
    });
  }, [selectedId]);

  // Resolve the selected conversation from the lists; deep links to
  // conversations outside the 24h window fall back to a direct fetch.
  const fromLists = [
    ...(lists?.active ?? []),
    ...(lists?.recent ?? []),
    ...(lists?.saved ?? []),
  ].find((c) => c.id === selectedId);
  const { data: fetched } = useMeddyConversation(fromLists ? null : selectedId);
  const selected = fromLists ?? fetched ?? null;

  return (
    <div className={MEDDY_PANE_CLASS}>
      <MeddyHeader
        stream="website"
        rightSlot={
          <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            {(["conversations", "history"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      if (t === "history") next.set("tab", "history");
                      else next.delete("tab");
                      return next;
                    },
                    { replace: true },
                  )
                }
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-background shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {tab === "history" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HistoryView />
          </div>
        ) : (
          <>
            <div className="hidden w-[320px] shrink-0 border-r border-border md:block">
              <ConversationSidebar
                selectedId={selectedId}
                onSelect={(id) => select(id)}
                onBack={() => select(null)}
                unreadIds={unreadIds}
              />
            </div>
            {/* Mobile: sidebar and chat swap based on selection */}
            <div className={cn("w-full md:hidden", selected && "hidden")}>
              <ConversationSidebar
                selectedId={selectedId}
                onSelect={(id) => select(id)}
                onBack={() => select(null)}
                unreadIds={unreadIds}
              />
            </div>
            <div className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
              {selected ? (
                <div className="flex h-full flex-col">
                  <div className="border-b border-border px-2 py-1.5 md:hidden">
                    <Button variant="ghost" size="sm" onClick={() => select(null)}>
                      <ArrowLeft className="mr-1 h-4 w-4" />
                      Back
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <ChatView conversation={selected} />
                  </div>
                </div>
              ) : (
                <IdleState />
              )}
            </div>
          </>
        )}
      </div>

      {/* Hidden mini-game: triple-click the "Meddy" nav label to unlock. */}
      <MeddySweeperGame />
    </div>
  );
}

/** The beloved Meddy-on-phone idle illustration (Nexus parity). */
function IdleState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <img
        src="/widget/meddy-on-phone.png?v=2"
        alt=""
        loading="eager"
        className="h-24 w-auto object-contain opacity-70"
      />
      <p className="text-sm">Select a conversation to view messages</p>
    </div>
  );
}
