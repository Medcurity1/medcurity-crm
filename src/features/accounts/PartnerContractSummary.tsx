import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountAttachments } from "./account-attachments-api";
import { formatDate } from "@/lib/formatters";

// AI summary of the partner's contract (Jordan Mayer, 2026-07-21). Lives on
// the Partner tab for partner-typed accounts. The user picks which Documents
// upload is "the contract" and generates; the summary is stored server-side
// (partner_contract_summaries, one row per account) so everyone sees the same
// summary until someone refreshes it. Deleting the source document deletes
// the summary (DB cascade).

interface SummaryRow {
  account_id: string;
  attachment_id: string;
  source_filename: string;
  summary_md: string;
  model: string;
  generated_at: string;
}

function usePartnerContractSummary(accountId: string) {
  return useQuery({
    queryKey: ["partner-contract-summary", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_contract_summaries")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      return (data as SummaryRow | null) ?? null;
    },
  });
}

export function PartnerContractSummary({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { data: summary } = usePartnerContractSummary(accountId);
  const { data: attachments } = useAccountAttachments(accountId);
  const [selectedId, setSelectedId] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  const pdfs = useMemo(
    () =>
      (attachments ?? []).filter(
        (a) =>
          (a.mimetype ?? "").toLowerCase() === "application/pdf" ||
          a.original_filename.toLowerCase().endsWith(".pdf"),
      ),
    [attachments],
  );

  // Default the picker to the current summary's source, else the newest PDF.
  const effectiveSelectedId =
    selectedId || summary?.attachment_id || pdfs[0]?.id || "";

  // A PDF uploaded after the summary was generated is a "your summary may be
  // stale" signal — surface it, let the human decide.
  const newerDocExists =
    !!summary &&
    pdfs.some(
      (a) =>
        a.id !== summary.attachment_id &&
        new Date(a.created_at) > new Date(summary.generated_at),
    );

  async function generate() {
    if (!effectiveSelectedId || generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "partner-contract-summary",
        { body: { account_id: accountId, attachment_id: effectiveSelectedId } },
      );
      if (error) {
        // FunctionsHttpError carries the response; surface the server's message.
        let message = error.message;
        try {
          const ctx = await (error as { context?: Response }).context?.json();
          if (ctx?.message) message = ctx.message;
        } catch {
          // keep the generic message
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.message ?? "Summary failed.");
      await qc.invalidateQueries({ queryKey: ["partner-contract-summary", accountId] });
      toast.success("Contract summary updated");
    } catch (e) {
      toast.error("Couldn't summarize the contract: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Partner Contract Summary
        </h3>
        {summary && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generate}
            disabled={generating || !effectiveSelectedId}
            className="gap-1.5"
          >
            <RefreshCw className={"h-3.5 w-3.5" + (generating ? " animate-spin" : "")} />
            {generating ? "Summarizing…" : "Refresh"}
          </Button>
        )}
      </div>

      {pdfs.length === 0 && !summary ? (
        <p className="text-sm text-muted-foreground">
          Upload the partner contract (PDF) in the Documents tab, then generate
          a summary here.
        </p>
      ) : (
        <>
          {summary ? (
            <>
              {newerDocExists && (
                <p className="text-xs rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1.5">
                  A newer document was uploaded after this summary — pick it
                  below and refresh if the contract changed.
                </p>
              )}
              {/* Model output is plain text by instruction, but strip any
                  markdown bold markers defensively so headings never render
                  with literal asterisks. */}
              <div className="text-sm whitespace-pre-wrap">
                {summary.summary_md.replace(/\*\*/g, "")}
              </div>
              <p className="text-xs text-muted-foreground">
                AI-generated from {summary.source_filename} ·{" "}
                {formatDate(summary.generated_at)} · verify pricing against the
                contract before quoting it.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick the contract document and generate a short summary with the
              partner's pricing specifics.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Select
              value={effectiveSelectedId}
              onValueChange={setSelectedId}
              disabled={generating || pdfs.length === 0}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Choose a document…" />
              </SelectTrigger>
              <SelectContent>
                {pdfs.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.original_filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!summary && (
              <Button
                type="button"
                size="sm"
                onClick={generate}
                disabled={generating || !effectiveSelectedId}
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generating ? "Summarizing…" : "Generate"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
