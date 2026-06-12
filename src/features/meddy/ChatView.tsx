// Right pane of the Meddy tab: the conversation detail. Ports the Nexus
// chat view (takeover/join/end/reopen, whisper, quick replies, typing
// indicators, URL trail) onto Pulse primitives.
//
// Takeover is intentionally one-way (Nexus design): there is no
// hand-back-to-AI; "release" is End Chat / Reopen.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Link2,
  MapPin,
  Send,
  User,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/formatters";
import {
  QUICK_REPLY_CATEGORY_ORDER,
  useCloseConversation,
  useConvAgents,
  useJoinConversation,
  useMeddyMessages,
  useMeddyUrlHistory,
  useQuickReplies,
  useReopenConversation,
  useSendStaffMessage,
  useTakeover,
} from "./api";
import { siteLabel, type MeddyConversation, type MeddyMessage } from "./types";

type Props = {
  conversation: MeddyConversation;
};

export function ChatView({ conversation: c }: Props) {
  const { user, profile } = useAuth();
  const { data: messages = [] } = useMeddyMessages(c.id);
  const { data: agents = [] } = useConvAgents(c.id);
  const { data: urlTrail = [] } = useMeddyUrlHistory(c.id);

  const takeover = useTakeover();
  const join = useJoinConversation();
  const close = useCloseConversation();
  const reopen = useReopenConversation();
  const sendMessage = useSendStaffMessage();

  const [input, setInput] = useState("");
  const [whisper, setWhisper] = useState(false);
  const [confirm, setConfirm] = useState<"takeover" | "join" | "end" | null>(null);
  const [urlTrailOpen, setUrlTrailOpen] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const isClosed = c.status === "closed";
  const isMember = !!user && agents.includes(user.id);
  const canChat = isMember && c.is_human_takeover && !isClosed;

  // Input gating (Nexus placeholders, verbatim).
  const placeholder = isClosed
    ? "Conversation closed — click Reopen to resume"
    : !c.is_human_takeover
      ? "Take over to reply manually"
      : !isMember
        ? "Join this conversation to reply"
        : whisper
          ? "Team note (not visible to visitor)..."
          : "Type a message... (/ for quick replies)";

  // Auto-scroll to the newest message.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, c.id, visitorTyping]);

  // Reset transient state when switching conversations.
  useEffect(() => {
    setInput("");
    setWhisper(false);
    setQuickOpen(false);
    setUrlTrailOpen(false);
    setVisitorTyping(false);
  }, [c.id]);

  // Per-conversation channel: visitor typing in, employee typing out.
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingSentRef = useRef(false);
  const employeeTypingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const channel = supabase.channel(`meddy:conv:${c.visitor_id}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "visitor-typing" }, () => {
        setVisitorTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setVisitorTyping(false), 5000);
      })
      .on("broadcast", { event: "visitor-stop-typing" }, () => setVisitorTyping(false))
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      // Reset employee-typing state so a conversation switch can't suppress
      // the indicator on the new channel or fire a stale stop on the old one.
      if (employeeTypingStopRef.current) clearTimeout(employeeTypingStopRef.current);
      employeeTypingStopRef.current = null;
      typingSentRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [c.visitor_id]);
  function emitEmployeeTyping() {
    if (!canChat || whisper) return;
    const ch = channelRef.current;
    if (!ch) return;
    if (!typingSentRef.current) {
      typingSentRef.current = true;
      ch.send({
        type: "broadcast",
        event: "employee-typing",
        payload: { name: profile?.full_name ?? "Agent" },
      });
    }
    if (employeeTypingStopRef.current) clearTimeout(employeeTypingStopRef.current);
    employeeTypingStopRef.current = setTimeout(() => {
      typingSentRef.current = false;
      ch.send({ type: "broadcast", event: "employee-stop-typing", payload: {} });
    }, 5000);
  }

  function doSend(content?: string) {
    const text = (content ?? input).trim();
    if (!text || !canChat) return;
    sendMessage.mutate({ conversationId: c.id, content: text, isInternal: whisper });
    if (!content) setInput("");
    setQuickOpen(false);
    if (typingSentRef.current) {
      typingSentRef.current = false;
      channelRef.current?.send({
        type: "broadcast",
        event: "employee-stop-typing",
        payload: {},
      });
    }
  }

  const latestUrl = urlTrail.length > 0 ? urlTrail[urlTrail.length - 1].page_url : c.page_url;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{c.visitor_name || "Visitor"}</h3>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {siteLabel(c)}
          </Badge>
          {c.buying_intent_alerted && (
            <Badge className="h-4 border-transparent bg-amber-500 px-1.5 text-[10px] text-white">
              Buying intent
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!isClosed && !c.assigned_to && (
              <Button size="sm" variant="destructive" onClick={() => setConfirm("takeover")}>
                Take Over
              </Button>
            )}
            {!isClosed && c.assigned_to && !isMember && (
              <Button size="sm" variant="destructive" onClick={() => setConfirm("join")}>
                Join Conversation
              </Button>
            )}
            {!isClosed && (
              <Button size="sm" variant="outline" onClick={() => setConfirm("end")}>
                End Chat
              </Button>
            )}
            {isClosed && (
              <Button
                size="sm"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate({ conversationId: c.id })}
              >
                Reopen
              </Button>
            )}
          </div>
        </div>
        {(c.visitor_email || c.visitor_phone) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[c.visitor_email, c.visitor_phone].filter(Boolean).join(" · ")}
          </p>
        )}
        {latestUrl && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setUrlTrailOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Show page history"
            >
              <MapPin className="h-3 w-3" />
              <span className="max-w-[420px] truncate">{simplifyUrl(latestUrl)}</span>
              {urlTrail.length > 1 && (
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", urlTrailOpen && "rotate-180")}
                />
              )}
            </button>
            {urlTrailOpen && urlTrail.length > 0 && (
              <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                {urlTrail.map((u) => (
                  <div key={u.id} className="flex items-baseline gap-2 py-0.5">
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatDateTime(u.created_at)}
                    </span>
                    <span className="truncate">{simplifyUrl(u.page_url)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Takeover bar ───────────────────────────────────────── */}
      {c.is_human_takeover && !isClosed && (
        <div className="flex items-center gap-2 border-b border-border bg-sky-500/10 px-4 py-1.5 text-xs text-sky-700 dark:text-sky-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          {c.assigned_to === user?.id
            ? "You are handling this conversation"
            : `${c.assigned?.full_name ?? "An agent"} is handling this conversation`}
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {(c.visitor_email || c.visitor_phone) && (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs">
            <p className="font-semibold text-green-700 dark:text-green-400">Contact Info</p>
            <p className="mt-0.5 text-muted-foreground">
              {[c.visitor_name, c.visitor_email, c.visitor_phone, c.visitor_company]
                .filter(Boolean)
                .join(" · ")}
              {c.crm_contact_id && (
                <a
                  href={`/contacts/${c.crm_contact_id}`}
                  className="ml-2 inline-flex items-center gap-1 text-green-700 underline dark:text-green-400"
                >
                  <Link2 className="h-3 w-3" />
                  CRM contact
                </a>
              )}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {visitorTyping && (
          <div className="flex items-center gap-1 px-1 text-xs italic text-muted-foreground">
            Visitor is typing
            <span className="animate-bounce">.</span>
            <span className="animate-bounce [animation-delay:120ms]">.</span>
            <span className="animate-bounce [animation-delay:240ms]">.</span>
          </div>
        )}
      </div>

      {/* ── Input area ─────────────────────────────────────────── */}
      <div className="border-t border-border p-3">
        {canChat && (
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWhisper(false)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                !whisper
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Visitor
            </button>
            <button
              type="button"
              onClick={() => setWhisper(true)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                whisper
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Team only
            </button>
          </div>
        )}
        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            {quickOpen && (
              <QuickRepliesMenu
                onPick={(content) => {
                  if (content === "[FORM]") {
                    doSend("[FORM]");
                  } else {
                    setInput((v) => (v.startsWith("/") ? content : v + content));
                    setQuickOpen(false);
                  }
                }}
                onClose={() => setQuickOpen(false)}
              />
            )}
            <textarea
              value={input}
              disabled={!canChat}
              placeholder={placeholder}
              rows={2}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                if (v === "/") setQuickOpen(true);
                emitEmployeeTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  doSend();
                }
                if (e.key === "Escape") setQuickOpen(false);
              }}
              className={cn(
                "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30",
                whisper && "border-amber-500/60 bg-amber-500/5",
              )}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            title="Quick replies"
            disabled={!canChat}
            onClick={() => setQuickOpen((v) => !v)}
          >
            <Zap className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            title="Send"
            disabled={!canChat || !input.trim() || sendMessage.isPending}
            onClick={() => doSend()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Confirm dialogs (Nexus copy, verbatim) ─────────────── */}
      <ConfirmDialog
        open={confirm === "takeover"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Take Over Conversation"
        description="The AI will stop responding and you'll handle this conversation directly. Continue?"
        confirmLabel="Take Over"
        onConfirm={() => {
          takeover.mutate({ conversationId: c.id });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "join"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Join Conversation"
        description="Join this conversation? The visitor and other agents will be notified."
        confirmLabel="Join"
        onConfirm={() => {
          join.mutate({ conversationId: c.id });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "end"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="End Conversation"
        description="Are you sure you want to end this conversation?"
        confirmLabel="End Chat"
        destructive
        onConfirm={() => {
          close.mutate({ conversationId: c.id });
          setConfirm(null);
        }}
      />
    </div>
  );
}

/** Message bubble — ports meddyMessageHTML's role/sender_type branching. */
export function MessageBubble({ message: m }: { message: MeddyMessage }) {
  const time = formatDateTime(m.created_at);

  if (m.sender_type === "human_request_alert") {
    return (
      <div className="rounded-md border border-orange-400/40 bg-orange-500/10 px-4 py-2 text-center text-xs font-semibold text-orange-600 dark:text-orange-400">
        {m.content}
        <div className="mt-0.5 text-[10px] font-normal opacity-70">{time}</div>
      </div>
    );
  }
  if (m.is_internal || m.sender_type === "internal") {
    return (
      <div className="ml-0 mr-auto max-w-[80%] rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
        <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          <span className="rounded bg-amber-500/20 px-1 py-px uppercase tracking-wide">
            Team note
          </span>
          {m.sender_name ?? "Agent"}
        </p>
        <p className="whitespace-pre-wrap">{m.content}</p>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">{time}</p>
      </div>
    );
  }
  if (m.role === "visitor" || m.sender_type === "visitor") {
    return (
      <div className="ml-auto mr-0 max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
        <p className="mb-0.5 text-[10px] font-semibold opacity-80">Visitor</p>
        <p className="whitespace-pre-wrap">{m.content}</p>
        <p className="mt-1 text-right text-[10px] opacity-70">{time}</p>
      </div>
    );
  }
  if (m.role === "human" || m.sender_type === "employee") {
    return (
      <div className="ml-0 mr-auto max-w-[80%] rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
        <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
          <User className="h-3 w-3" />
          {m.sender_name ?? "Medcurity Team"}
        </p>
        <p className="whitespace-pre-wrap">{m.content}</p>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">{time}</p>
      </div>
    );
  }
  if (m.sender_type === "system") {
    return (
      <p className="px-4 py-1 text-center text-xs italic text-muted-foreground">{m.content}</p>
    );
  }
  return (
    <div className="ml-0 mr-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
        <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-px text-sky-700 dark:text-sky-300">
          <Bot className="h-3 w-3" />
          AI
        </span>
        Meddy
      </p>
      <p className="whitespace-pre-wrap">{m.content}</p>
      <p className="mt-1 text-right text-[10px] text-muted-foreground">{time}</p>
    </div>
  );
}

function QuickRepliesMenu({
  onPick,
  onClose,
}: {
  onPick: (content: string) => void;
  onClose: () => void;
}) {
  const { data: replies = [] } = useQuickReplies();
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matched = replies.filter(
      (r) =>
        !f || r.title.toLowerCase().includes(f) || r.content.toLowerCase().includes(f),
    );
    return QUICK_REPLY_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: matched.filter((r) => r.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [replies, filter]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-80 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
      <Input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Filter replies..."
        className="mb-2 h-7 text-xs"
      />
      {grouped.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">No matching replies</p>
      )}
      {grouped.map((g) => (
        <div key={g.category} className="mb-1">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {g.category}
          </p>
          {g.items.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.content)}
              className={cn(
                "w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
                r.category === "forms" && "border border-dashed border-primary/40",
              )}
            >
              <span className="font-medium">{r.title}</span>
              <span className="mt-0.5 block truncate text-muted-foreground">
                {r.content === "[FORM]" ? "Sends contact form to visitor" : r.content}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Compact page label with the App:/Main: prefix (Nexus meddySimplifyUrl). */
function simplifyUrl(url: string): string {
  try {
    const u = new URL(url);
    const prefix = u.hostname.startsWith("app.") ? "App:" : "Main:";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${prefix} ${path}${u.search ? u.search : ""}`;
  } catch {
    return url;
  }
}
