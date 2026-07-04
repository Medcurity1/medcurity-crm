import { useEffect, useRef, useState, type ReactElement } from "react";
import { Sparkles, Send, Building2, User, Target, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

// Minimal, dependency-free renderer for the assistant's light markdown:
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
  return <div className="space-y-2 break-words">{blocks}</div>;
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

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
    } catch (e) {
      setMessages((m) => [...m, {
        role: "assistant",
        content: "I couldn't reach the assistant just now. Please try again in a moment.",
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Ask AI
          </SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Read-only — searches and summarizes your data, never changes it.
          </SheetDescription>
        </SheetHeader>

        {/* ── Conversation ── */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask about your accounts, contacts, deals, pipeline, renewals, or tasks — in plain English.
              </p>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try asking</p>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => send(ex)}
                    className="block w-full rounded-md border border-border bg-muted/30 px-3 py-1.5 text-left text-xs text-foreground/80 transition-colors hover:bg-muted"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                  m.role === "user"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : m.error
                      ? "rounded-bl-sm border border-red-500/40 bg-red-500/5 text-foreground"
                      : "rounded-bl-sm bg-muted text-foreground",
                )}
              >
                {m.role === "assistant" && !m.error ? (
                  <RichText text={m.content} />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.sources.slice(0, 12).map((s) => {
                      const meta = SOURCE_META[s.type];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      return (
                        <Link
                          key={`${s.type}:${s.id}`}
                          to={`${meta.path}/${s.id}`}
                          onClick={() => onOpenChange(false)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <Icon className="h-3 w-3" />
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
            <div className="flex justify-start">
              <div className="max-w-[85%] space-y-1.5 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          )}
        </div>

        {/* ── Composer ── */}
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              rows={1}
              value={prompt}
              disabled={loading}
              placeholder="Ask about your CRM…"
              spellCheck
              className="max-h-32 min-h-[42px] resize-none"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(prompt);
                }
              }}
            />
            <Button size="icon" disabled={!prompt.trim() || loading} onClick={() => send(prompt)}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
