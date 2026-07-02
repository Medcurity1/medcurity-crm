import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { Bot, Hand, PhoneOff, Undo2, Building2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  useSupportMessages,
  useTakeOverSupport,
  useHandBackSupport,
  useSendSupportMessage,
  useCloseSupport,
} from "./api";
import { displayName, systemLabel, type SupportConversation, type SupportMessage } from "./types";

// Meddy Support chat pane: transcript + control actions.
//
// Control model: assigned_to is the gate. Take Over mutes the Coach's AI
// (its status polls see isHumanTakeover=true); Hand Back clears it so the
// AI resumes in the SAME conversation — the seamless return from
// docs/meddy/ai-human-handoff-design.md.

export function SupportChatView({ conversation }: { conversation: SupportConversation }) {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: messages } = useSupportMessages(conversation.id);
  const takeOver = useTakeOverSupport();
  const handBack = useHandBackSupport();
  const sender = useSendSupportMessage();
  const closer = useCloseSupport();

  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [confirmHandBack, setConfirmHandBack] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages?.length, conversation.id]);

  const mine = conversation.assigned_to === user?.id;
  const closed = conversation.status === "closed";
  const canChat = !closed && conversation.is_human_takeover && (mine || isAdmin);

  async function doSend() {
    // Guard key-repeat / double-Enter: the button disables on isPending,
    // but the keydown path must check too or the customer gets dupes.
    if (sender.isPending) return;
    const text = draft.trim();
    if (!text) return;
    try {
      await sender.send(conversation.id, text, internal);
      setDraft("");
    } catch {
      /* toast already shown by the hook */
    }
  }

  const placeholder = closed
    ? "This chat has ended."
    : !conversation.is_human_takeover
      ? "Meddy (the AI) is handling this chat. Take over to reply as a human."
      : !mine && !isAdmin
        ? `${conversation.assigned?.full_name ?? "Another agent"} is driving this chat.`
        : internal
          ? "Internal note — the customer never sees this…"
          : "Reply to the customer…";

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{displayName(conversation)}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {conversation.customer_company && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {conversation.customer_company}
              </span>
            )}
            {conversation.customer_email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {conversation.customer_email}
              </span>
            )}
            <Badge variant="secondary" className="bg-violet-100 text-violet-700">Platform</Badge>
            {closed ? (
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">Ended</Badge>
            ) : conversation.is_human_takeover ? (
              <Badge variant="secondary" className="bg-sky-100 text-sky-700">
                {conversation.assigned?.full_name ?? "Agent"} driving
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Meddy (AI) driving</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!closed && !conversation.is_human_takeover && (
            <Button
              size="sm"
              onClick={() => takeOver.mutate({ conversationId: conversation.id })}
              disabled={takeOver.isPending}
            >
              <Hand className="mr-1 h-4 w-4" />
              Take over
            </Button>
          )}
          {!closed && conversation.is_human_takeover && (mine || isAdmin) && (
            <Button size="sm" variant="outline" onClick={() => setConfirmHandBack(true)}>
              <Undo2 className="mr-1 h-4 w-4" />
              Hand back to Meddy
            </Button>
          )}
          {!closed && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmClose(true)}>
              <PhoneOff className="mr-1 h-4 w-4" />
              End chat
            </Button>
          )}
        </div>
      </div>

      {/* ── Transcript ── */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {(messages ?? []).map((m) => (
          <SupportMessageBubble key={m.id} m={m} />
        ))}
        {(messages ?? []).length === 0 && (
          <p className="pt-8 text-center text-sm text-muted-foreground">
            No transcript yet — it syncs as the customer chats with Meddy.
          </p>
        )}
      </div>

      {/* ── Composer ── */}
      <div className="border-t px-4 py-3">
        <Textarea
          rows={2}
          value={draft}
          disabled={!canChat && !internal}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              doSend();
            }
          }}
          placeholder={placeholder}
          className={cn(internal && "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20")}
        />
        <div className="mt-2 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
            Internal note (team only)
          </label>
          <Button size="sm" onClick={doSend} disabled={(!canChat && !internal) || !draft.trim() || sender.isPending}>
            {internal ? "Add note" : "Send"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmHandBack}
        onOpenChange={setConfirmHandBack}
        title="Hand back to Meddy?"
        description="The AI resumes answering on the customer's next message, in this same conversation. You can take over again anytime."
        confirmLabel="Hand back"
        onConfirm={() => {
          handBack.handBack(conversation.id);
          setConfirmHandBack(false);
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="End this chat?"
        description="Marks the conversation closed. If the customer writes again, a fresh AI conversation continues in the same thread."
        confirmLabel="End chat"
        destructive
        onConfirm={() => {
          closer.close(conversation.id);
          setConfirmClose(false);
        }}
      />
    </div>
  );
}

export function SupportMessageBubble({ m }: { m: SupportMessage }) {
  if (m.role === "system" && m.content === "human_requested") {
    return (
      <div className="mx-auto max-w-md rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-center text-xs font-medium text-orange-700 dark:bg-orange-950/30 dark:text-orange-400">
        🖐 Customer asked for a human · {formatDateTime(m.created_at)}
      </div>
    );
  }
  if (m.role === "system") {
    return (
      <p className="text-center text-xs italic text-muted-foreground">
        {systemLabel(m)} · {formatDateTime(m.created_at)}
      </p>
    );
  }
  if (m.is_internal) {
    return (
      <div className="mx-auto max-w-lg rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        <span className="font-semibold">Team note{m.sender_name ? ` · ${m.sender_name}` : ""}:</span> {m.content}
      </div>
    );
  }
  if (m.role === "customer") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
          <p className="mt-1 text-right text-[10px] opacity-70">{formatDateTime(m.created_at)}</p>
        </div>
      </div>
    );
  }
  if (m.role === "agent") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-sky-100 px-3 py-2 text-sm text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
          <p className="text-[10px] font-semibold">{m.sender_name ?? "Agent"}</p>
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
          <p className="mt-1 text-[10px] opacity-70">{formatDateTime(m.created_at)}</p>
        </div>
      </div>
    );
  }
  // assistant — the Coach AI ("Meddy")
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
        <p className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
          <Bot className="h-3 w-3" /> Meddy
        </p>
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(m.created_at)}</p>
      </div>
    </div>
  );
}
