// Admin Settings → Meddy: quick replies CRUD, knowledge-base crawl
// controls + logs, and team Pushover key management (admin side of the
// Nexus settings; per-user keys live in My Settings → Notifications).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Pencil, Plus, RefreshCw, Smartphone, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDateTime, formatRelativeDate } from "@/lib/formatters";
import { QUICK_REPLY_CATEGORY_ORDER, staffAction, useQuickReplies } from "./api";
import type { QuickReply } from "./types";

export function MeddyAdminPanel() {
  return (
    <div className="max-w-4xl space-y-8">
      <QuickRepliesSection />
      <KnowledgeBaseSection />
      <PushoverTeamSection />
    </div>
  );
}

// ── Quick replies ─────────────────────────────────────────────────────

const EDITABLE_CATEGORIES = ["greeting", "sales", "support", "closing", "general"];

function QuickRepliesSection() {
  const { data: replies = [] } = useQuickReplies();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<QuickReply> | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);

  const save = useMutation({
    mutationFn: async (r: Partial<QuickReply>) => {
      if (!r.title?.trim() || !r.content?.trim()) throw new Error("Title and message are required");
      if (r.id) {
        const { error } = await supabase
          .from("meddy_quick_replies")
          .update({ title: r.title.trim(), content: r.content.trim(), category: r.category })
          .eq("id", r.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("meddy_quick_replies").insert({
          title: r.title.trim(),
          content: r.content.trim(),
          category: r.category ?? "general",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meddy-quick-replies"] });
      setEditing(null);
      toast.success("Quick reply saved");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meddy_quick_replies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meddy-quick-replies"] });
      setDeleting(null);
      toast.success("Quick reply deleted");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const grouped = QUICK_REPLY_CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: replies.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <section>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4" />
            Quick replies
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Canned responses agents insert with the lightning button or "/" in the Meddy chat.
            System replies (forms) can't be edited.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ category: "general" })}>
          <Plus className="mr-1 h-4 w-4" />
          Add reply
        </Button>
      </div>

      <div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {grouped.map((g) =>
          g.items.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-2.5">
              <Badge variant="outline" className="mt-0.5 h-4 shrink-0 px-1.5 text-[9px] uppercase">
                {g.category}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.content === "[FORM]" ? "Sends contact form to visitor" : r.content}
                </p>
              </div>
              {r.category !== "forms" && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-xs" title="Edit" onClick={() => setEditing(r)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Delete"
                    onClick={() => setDeleting(r)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )),
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-semibold">{editing.id ? "Edit reply" : "New reply"}</p>
          <div className="flex gap-2">
            <Input
              value={editing.title ?? ""}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="Title"
              className="h-8 w-56 text-sm"
            />
            <select
              value={editing.category ?? "general"}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              {EDITABLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Textarea
            value={editing.content ?? ""}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            placeholder="Message sent to the visitor"
            rows={3}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(editing)}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Quick Reply"
        description={`Delete "${deleting?.title}"? Agents will no longer see it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </section>
  );
}

// ── Knowledge base ────────────────────────────────────────────────────

type CrawlLog = {
  id: number;
  crawled_at: string;
  pages_discovered: number;
  pages_crawled: number;
  pages_included: number;
  content_size: number;
  estimated_tokens: number;
  errors: number;
  duration_seconds: number;
};

function KnowledgeBaseSection() {
  const qc = useQueryClient();
  const [crawling, setCrawling] = useState(false);

  const { data: kb } = useQuery({
    queryKey: ["meddy-kb-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_kb_content")
        .select("updated_at, content, manual_content")
        .eq("id", 1)
        .single();
      if (error) throw error;
      return {
        updated_at: data.updated_at as string,
        size: (data.content as string).length,
        tokens: Math.ceil((data.content as string).length / 4),
        manual_content: (data.manual_content as string | null) ?? "",
      };
    },
  });

  // Team notes (manual_content) — editable knowledge that supplements the
  // crawl and survives it. Seeded from the fetched value until the user edits.
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  useEffect(() => {
    if (kb && !notesDirty) setNotes(kb.manual_content);
  }, [kb, notesDirty]);
  const saveNotes = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("meddy_kb_content")
        .update({ manual_content: notes, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      setNotesDirty(false);
      toast.success("Meddy team notes saved");
      qc.invalidateQueries({ queryKey: ["meddy-kb-status"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { data: logs = [] } = useQuery<CrawlLog[]>({
    queryKey: ["meddy-crawl-logs"],
    refetchInterval: crawling ? 10_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_crawl_logs")
        .select("*")
        .order("crawled_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as CrawlLog[];
    },
  });

  async function crawlNow() {
    setCrawling(true);
    try {
      const { data, error } = await supabase.functions.invoke("meddy-crawl", { body: {} });
      if (error) throw error;
      if (data?.skipped) {
        toast.info("A crawl already ran in the last 10 minutes");
        setCrawling(false);
      } else {
        toast.success("Crawl started — results appear below in a few minutes");
        // keep polling logs for a while, then refresh KB status
        setTimeout(() => {
          setCrawling(false);
          qc.invalidateQueries({ queryKey: ["meddy-kb-status"] });
          qc.invalidateQueries({ queryKey: ["meddy-crawl-logs"] });
        }, 4 * 60 * 1000);
      }
    } catch (err) {
      toast.error((err as Error).message);
      setCrawling(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4" />
            Knowledge base
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What Meddy knows about medcurity.com. Recrawled nightly at 3 AM Pacific; run one
            manually after big website changes.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={crawling} onClick={crawlNow}>
          <RefreshCw className={crawling ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
          {crawling ? "Crawling…" : "Crawl now"}
        </Button>
      </div>

      {kb && (
        <p className="mt-2 text-xs text-muted-foreground">
          Current content: {kb.size.toLocaleString()} characters (~{kb.tokens.toLocaleString()}{" "}
          tokens), updated {formatRelativeDate(kb.updated_at)}.
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-right font-medium">Discovered</th>
              <th className="px-3 py-2 text-right font-medium">Crawled</th>
              <th className="px-3 py-2 text-right font-medium">Included</th>
              <th className="px-3 py-2 text-right font-medium">Size</th>
              <th className="px-3 py-2 text-right font-medium">Errors</th>
              <th className="px-3 py-2 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                  No crawls yet. The seeded knowledge base is from the last Nexus crawl.
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{formatDateTime(l.crawled_at)}</td>
                  <td className="px-3 py-2 text-right">{l.pages_discovered}</td>
                  <td className="px-3 py-2 text-right">{l.pages_crawled}</td>
                  <td className="px-3 py-2 text-right">{l.pages_included}</td>
                  <td className="px-3 py-2 text-right">{(l.content_size / 1000).toFixed(1)}k</td>
                  <td className="px-3 py-2 text-right">{l.errors}</td>
                  <td className="px-3 py-2 text-right">{l.duration_seconds}s</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 space-y-2">
        <div>
          <h4 className="text-sm font-semibold">Team notes (authoritative)</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Extra facts Meddy should know that aren't on the public website — e.g. in-app
            workflows. Meddy trusts these over the crawled site content, and they're kept
            through the nightly crawl. Put a blank line between topics.
          </p>
        </div>
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          rows={10}
          className="text-sm"
          placeholder="e.g. To approve a policy: open it, make edits, click Save, then return to the policy dashboard and click Approve. Approval records who approved it and when."
        />
        <Button
          size="sm"
          disabled={saveNotes.isPending || !notesDirty}
          onClick={() => saveNotes.mutate()}
        >
          {saveNotes.isPending ? "Saving…" : "Save team notes"}
        </Button>
      </div>
    </section>
  );
}

// ── Team Pushover keys ────────────────────────────────────────────────

function PushoverTeamSection() {
  const qc = useQueryClient();

  const { data: rows = [] } = useQuery({
    queryKey: ["meddy-pushover-team"],
    queryFn: async () => {
      const [{ data: users, error: uErr }, { data: prefRows, error: pErr }] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name"),
        supabase.from("user_notification_prefs").select("user_id, pushover_key"),
      ]);
      if (uErr) throw uErr;
      if (pErr) throw pErr;
      const keyByUser = new Map(
        (prefRows ?? []).map((r) => [r.user_id as string, r.pushover_key as string | null]),
      );
      return (users ?? []).map((u) => ({
        id: u.id as string,
        name: (u.full_name as string | null) ?? "Unknown",
        key: keyByUser.get(u.id as string) ?? null,
      }));
    },
  });

  const saveKey = useMutation({
    mutationFn: async ({ userId, key }: { userId: string; key: string }) => {
      // UPDATE only the key column so a concurrent prefs save by that user
      // is never clobbered with a stale snapshot; INSERT when no row yet.
      const { data: updated, error: updErr } = await supabase
        .from("user_notification_prefs")
        .update({ pushover_key: key.trim() || null })
        .eq("user_id", userId)
        .select("user_id");
      if (updErr) throw updErr;
      if ((updated ?? []).length === 0) {
        const { error } = await supabase
          .from("user_notification_prefs")
          .insert({ user_id: userId, pushover_key: key.trim() || null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meddy-pushover-team"] });
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      toast.success("Key saved");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Smartphone className="h-4 w-4" />
        Team phone notifications (Pushover)
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Everyone with a key gets phone pushes for human requests (and the 2-minute unanswered
        escalation). Each person needs the Pushover app; paste their user key here or have them
        set it in My Settings → Notifications.
      </p>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {rows.map((u) => (
          <PushoverUserRow
            key={u.id}
            userId={u.id}
            name={u.name}
            savedKey={u.key}
            onSave={(key) => saveKey.mutate({ userId: u.id, key })}
          />
        ))}
      </div>
    </section>
  );
}

function PushoverUserRow({
  userId,
  name,
  savedKey,
  onSave,
}: {
  userId: string;
  name: string;
  savedKey: string | null;
  onSave: (key: string) => void;
}) {
  const [value, setValue] = useState(savedKey ?? "");
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    try {
      const res = await staffAction("pushover_test", { userId });
      if (res.success) toast.success(`Test push sent to ${name}`);
      else toast.error(String(res.error ?? "Test failed"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="w-40 truncate text-sm font-medium">{name}</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="No key — no phone alerts"
        className="h-8 w-64 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={value.trim() === (savedKey ?? "")}
        onClick={() => onSave(value)}
      >
        Save
      </Button>
      <Button size="sm" variant="outline" disabled={!savedKey || testing} onClick={test}>
        {testing ? "Sending…" : "Test"}
      </Button>
      {savedKey && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
          configured
        </Badge>
      )}
    </div>
  );
}
