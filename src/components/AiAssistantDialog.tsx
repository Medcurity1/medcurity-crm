import { useEffect, useRef, useState, type ReactElement } from "react";
import { Sparkles, Send, Building2, User, Target, ArrowUpRight, ShieldCheck, SquarePen } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";

// Ask AI — read-only CRM assistant. Talks to the `ask-ai` edge function,
// which answers using a fixed allowlist of read-only lookups scoped to the
// caller's own permissions. It cannot change any data; these are just Q&A.

type Source = { type: string; id: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean };

const SOURCE_META: Record<string, { path: string; icon: typeof Building2 }> = {
  account: { path: "/accounts", icon: Building2 },
  contact: { path: "/contacts", icon: User },
  opportunity: { path: "/opportunities", icon: Target },
};

const EXAMPLES = [
  "Which of my open deals close in the next 30 days?",
  "Summarize the account Mallory Community Health Center",
  "How's my pipeline looking by stage?",
  "Show my warm-lead contacts I haven't touched lately",
  "What renewals are coming up in the next 60 days?",
  "How do I archive a contact?",
];

// ── Minimal, dependency-free renderer for the assistant's light markdown:
// **bold**, bullet lists, numbered lists, and paragraphs. No raw HTML.
function renderInline(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactElement[] = [];
  let bucket: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!bucket) return;
    const items = bucket.items;
    const key = `l${blocks.length}`;
    blocks.push(
      bucket.ordered ? (
        <ol key={key} className="list-decimal space-y-0.5 pl-5">
          {items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-0.5 pl-5">
          {items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ul>
      ),
    );
    bucket = null;
  };
  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    const n = line.match(/^\s*\d+\.\s+(.*)$/);
    if (b) {
      if (!bucket || bucket.ordered) { flush(); bucket = { ordered: false, items: [] }; }
      bucket.items.push(b[1]);
    } else if (n) {
      if (!bucket || !bucket.ordered) { flush(); bucket = { ordered: true, items: [] }; }
      bucket.items.push(n[1]);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      blocks.push(<p key={`p${blocks.length}`}>{renderInline(line)}</p>);
    }
  });
  flush();
  return <div className="space-y-2 break-words leading-relaxed">{blocks}</div>;
}

export function AiAssistantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // Focus the composer shortly after the panel opens (after the slide-in).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setPrompt("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ask-ai", {
        body: { question: q, messages: history },
      });
      if (error) throw error;
      if (data?.error) {
        setMessages((m) => [...m, { role: "assistant", content: data.message || "Something went wrong.", error: true }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.answer ?? "", sources: data.sources ?? [] }]);
      }
    } catch {
      setMessages((m) => [...m, {
        role: "assistant",
        content: "I couldn't reach the assistant just now. Please try again in a moment.",
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }

  const hasChat = messages.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden border-l border-violet-500/15 bg-background p-0 sm:max-w-md"
      >
        {/* Soft gradient glow behind the header — the "AI pretty" wash. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-violet-500/10 via-blue-500/[0.06] to-transparent" />

        {/* ── Header ── */}
        <SheetHeader className="relative space-y-1.5 border-b border-border/60 px-4 py-3 text-left">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shadow-sm shadow-violet-500/30">
                <Sparkles className="h-4 w-4 text-white" />
              </span>
              <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-300 dark:to-violet-300">
                Ask AI
              </span>
            </SheetTitle>
            {hasChat && (
              <button
                type="button"
                onClick={() => { setMessages([]); setPrompt(""); inputRef.current?.focus(); }}
                title="New chat"
                className="mr-8 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <SquarePen className="h-3.5 w-3.5" />
                New
              </button>
            )}
          </div>
          <SheetDescription className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Read-only. Searches and summarizes your data, never changes it.
          </SheetDescription>
        </SheetHeader>

        {/* ── Conversation ── */}
        <div ref={scrollRef} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!hasChat && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 pb-1 pt-4 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 opacity-40 blur-xl" />
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-violet-500/30">
                    <Sparkles className="h-7 w-7 text-white" />
                  </span>
                </div>
                <p className="max-w-[17rem] text-sm text-muted-foreground">
                  Ask about your accounts, contacts, deals, pipeline, renewals, or tasks in plain English.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try asking</p>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => send(ex)}
                    className="block w-full rounded-xl border border-border/60 bg-gradient-to-br from-muted/50 to-muted/10 px-3 py-2 text-left text-xs text-foreground/80 transition-all hover:border-violet-500/40 hover:from-violet-500/10 hover:to-blue-500/[0.06] hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                  m.role === "user"
                    ? "rounded-br-sm bg-gradient-to-br from-blue-500 to-violet-600 text-white"
                    : m.error
                      ? "rounded-bl-sm border border-red-500/40 bg-red-500/5 text-foreground"
                      : "rounded-bl-sm border border-border/60 bg-muted/70 text-foreground",
                )}
              >
                {m.role === "assistant" && !m.error ? (
                  <RichText text={m.content} />
                ) : (
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.sources.slice(0, 12).map((s) => {
                      const meta = SOURCE_META[s.type];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return (
                        <Link
                          key={`${s.type}:${s.id}`}
                          to={`${meta.path}/${s.id}`}
                          onClick={() => onOpenChange(false)}
                          className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-background/80 px-2 py-0.5 text-xs text-foreground/80 backdrop-blur-sm transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-foreground"
                        >
                          <Icon className="h-3 w-3 text-violet-500" />
                          <span className="max-w-[140px] truncate">{s.label || "record"}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-60" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start motion-safe:animate-in motion-safe:fade-in">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border/60 bg-muted/70 px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gradient-to-br from-blue-500 to-violet-600 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gradient-to-br from-blue-500 to-violet-600 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gradient-to-br from-blue-500 to-violet-600" />
              </div>
            </div>
          )}
        </div>

        {/* ── Composer ── */}
        <div className="border-t border-border/60 bg-background/80 p-3 backdrop-blur-sm">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-1.5 shadow-sm transition-colors focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/15">
            <Textarea
              ref={inputRef}
              rows={1}
              value={prompt}
              disabled={loading}
              placeholder="Ask about your CRM…"
              spellCheck
              className="max-h-32 min-h-[36px] resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(prompt);
                }
              }}
            />
            <Button
              size="icon"
              disabled={!prompt.trim() || loading}
              onClick={() => send(prompt)}
              className="h-8 w-8 shrink-0 border-0 bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-sm transition-all hover:from-blue-600 hover:to-violet-700 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 px-1 text-center text-[10px] text-muted-foreground/70">
            AI-generated from your live CRM data. Double-check anything important.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
