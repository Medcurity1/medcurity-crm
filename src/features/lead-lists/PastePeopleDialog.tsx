import { useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, FileUp, UserCheck2, UserX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import type { LeadList } from "@/types/crm";
import { useBulkAddContactsToList } from "./lead-lists-api";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

interface Matched {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

/** Item 7 (strategic shape): paste emails or drop a CSV, Pulse matches
 * them to existing contacts, shows exactly who it found and who it
 * didn't, and only then adds the matches to THIS list. No blind imports,
 * no contact creation — this is a matcher, not an uploader. */
export function PastePeopleDialog({
  open,
  onOpenChange,
  list,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  list: LeadList;
}) {
  const [text, setText] = useState("");
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState<Matched[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bulkAdd = useBulkAddContactsToList();
  const qc = useQueryClient();

  const reset = () => {
    setText("");
    setMatched(null);
    setUnmatched([]);
  };

  const runMatch = async () => {
    const emails = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
    if (!emails.length) {
      toast.info("No email addresses found in that text");
      return;
    }
    setMatching(true);
    try {
      // Emails are matched case-insensitively in chunks (PostgREST URL caps).
      const found: Matched[] = [];
      for (let i = 0; i < emails.length; i += 100) {
        const chunk = emails.slice(i, i + 100);
        const orExpr = chunk.map((e) => `email.ilike.${e.replace(/[(),]/g, "")}`).join(",");
        const { data, error } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, email")
          .or(orExpr);
        if (error) throw error;
        found.push(...((data ?? []) as Matched[]));
      }
      const foundEmails = new Set(found.map((c) => (c.email ?? "").toLowerCase()));
      setMatched(found);
      setUnmatched(emails.filter((e) => !foundEmails.has(e)));
    } catch (e) {
      toast.error("Matching failed: " + (e as Error).message);
    } finally {
      setMatching(false);
    }
  };

  const addAll = async () => {
    if (!matched?.length) return;
    const ids = [...new Set(matched.map((m) => m.id))];
    try {
      await bulkAdd.mutateAsync({ list_id: list.id, contact_ids: ids });
      if (list.is_dynamic) {
        // Hybrid smart list: a manual add also clears any sticky removals.
        await supabase
          .from("lead_list_exclusions")
          .delete()
          .eq("list_id", list.id)
          .in("contact_id", ids);
        qc.invalidateQueries({ queryKey: ["smart-list-members"] });
        qc.invalidateQueries({ queryKey: ["list-exclusions", list.id] });
        qc.invalidateQueries({ queryKey: ["nexus-widget-data", "list"] });
      }
      toast.success(`Added ${ids.length} ${ids.length === 1 ? "person" : "people"} to ${list.name}`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const content = await f.text();
    setText((prev) => (prev ? prev + "\n" : "") + content);
    setMatched(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste people into {list.name}</DialogTitle>
          <DialogDescription>
            Paste emails or drop in a CSV. Matches against existing contacts only.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          placeholder={"jane@clinic.org, mark@hospital.com\nor paste a whole spreadsheet column"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMatched(null);
          }}
          rows={5}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />

        {matched && (
          <div className="space-y-2 rounded-xl border p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <UserCheck2 className="h-4 w-4 text-emerald-500" />
              {matched.length} matched
            </p>
            {matched.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {matched
                  .slice(0, 8)
                  .map((m) => `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.email)
                  .join(", ")}
                {matched.length > 8 ? ` and ${matched.length - 8} more` : ""}
              </p>
            )}
            {unmatched.length > 0 && (
              <>
                <p className="flex items-center gap-1.5 font-medium">
                  <UserX2 className="h-4 w-4 text-amber-500" />
                  {unmatched.length} not in the CRM
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {unmatched.slice(0, 6).join(", ")}
                  {unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ""}
                </p>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-4 w-4 mr-1.5" />
            Add a file
          </Button>
          {matched === null ? (
            <Button type="button" disabled={matching || !text.trim()} onClick={runMatch}>
              <ClipboardPaste className="h-4 w-4 mr-1.5" />
              {matching ? "Matching…" : "Match people"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!matched.length || bulkAdd.isPending}
              onClick={addAll}
            >
              {bulkAdd.isPending
                ? "Adding…"
                : `Add ${matched.length} to the list`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
