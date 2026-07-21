import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/formatters";

// AI blurb of the partner's contract (Jordan Mayer 7/21, redesigned per
// Nathan same day): a thin banner between the account header cards and the
// related tabs on partner-typed accounts. Fully automatic — the
// partner-contract-summary edge function re-evaluates whenever a document is
// added or removed (wired in account-attachments-api): newest attached
// contract wins, non-contracts are ignored, no contract → no banner. There
// is deliberately no manual generate/refresh UI.

interface SummaryRow {
  account_id: string;
  attachment_id: string;
  source_filename: string;
  summary_md: string;
  model: string;
  generated_at: string;
}

export function usePartnerContractSummary(accountId: string | undefined) {
  return useQuery({
    queryKey: ["partner-contract-summary", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_contract_summaries")
        .select("*")
        .eq("account_id", accountId!)
        .maybeSingle();
      if (error) throw error;
      return (data as SummaryRow | null) ?? null;
    },
    enabled: !!accountId,
  });
}

export function PartnerContractBanner({ accountId }: { accountId: string }) {
  const { data: summary } = usePartnerContractSummary(accountId);

  // Automatic feature: nothing to show, show nothing (no empty-state chrome).
  if (!summary) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-primary/25 bg-gradient-to-r from-primary/[0.08] via-violet-500/[0.06] to-transparent px-4 py-2.5 mt-2">
      {/* soft glow accent in the corner, pure decoration */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
      />
      <div className="flex items-start gap-2.5">
        <Sparkles className="h-4 w-4 mt-[3px] shrink-0 text-primary" />
        {/* At-a-glance fragment strip (Nathan 7/21): the model returns one
            short fragment per line; render them dot-separated in small text.
            No how-it-was-made caption — the AI styling says it all. */}
        <p
          className="min-w-0 text-[13px] leading-relaxed"
          title={`From ${summary.source_filename} · ${formatDate(summary.generated_at)}`}
        >
          {summary.summary_md
            .replace(/\*\*/g, "")
            .split(/\n+/)
            .map((f) => f.replace(/^[-•\s]+/, "").trim())
            .filter(Boolean)
            .map((f, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && <span className="mx-2 opacity-70">·</span>}
                <span className="whitespace-normal">{f}</span>
              </span>
            ))}
        </p>
      </div>
    </div>
  );
}
