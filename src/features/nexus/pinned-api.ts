// Pinned Records data (jordan-v4-spec §9) — shared by the widget body
// (rows with key fields + stale highlighting) and the builder panel
// (names for the reorderable pinned list).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatName,
  formatRelativeDate,
  stageLabel,
  customerStatusLabel,
} from "@/lib/formatters";
import type { CustomerStatus, OpportunityStage } from "@/types/crm";
import { fetchLastActivityMap } from "./report-engine";
import type { PinnedRecordRef, PinnedRecordType } from "./types";

export const STALE_DAYS = 14;

export interface PinnedRecordInfo {
  type: PinnedRecordType;
  id: string;
  name: string;
  href: string;
  /** Key field per spec: contact → last activity; account → status +
   *  ACV; opportunity → stage + amount. */
  keyText: string;
  /** 14+ days since last touch/update (contacts + opportunities only). */
  stale: boolean;
}

function isStale(lastTouch: string | null): boolean {
  if (!lastTouch) return true; // never touched = needs attention
  return Date.now() - new Date(lastTouch).getTime() >= STALE_DAYS * 86_400_000;
}

/** Latest of two ISO timestamps (either may be null). */
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Resolve pinned refs into display rows, preserving the config's order.
 * Archived / deleted records silently drop out (their pin is stale by
 * definition and RLS may hide them anyway).
 */
export function usePinnedRecordInfos(records: PinnedRecordRef[]) {
  const key = records.map((r) => `${r.type}:${r.id}`).join(",");
  return useQuery({
    queryKey: ["nexus-widget-data", "pinned_records", key],
    queryFn: async (): Promise<PinnedRecordInfo[]> => {
      const byType = (t: PinnedRecordType) =>
        records.filter((r) => r.type === t).map((r) => r.id);
      const contactIds = byType("contact");
      const accountIds = byType("account");
      const oppIds = byType("opportunity");

      const infos = new Map<string, PinnedRecordInfo>();

      if (contactIds.length) {
        const [{ data, error }, lastActivity] = await Promise.all([
          supabase
            .from("contacts")
            .select("id, first_name, last_name, updated_at")
            .in("id", contactIds)
            .is("archived_at", null),
          fetchLastActivityMap("contact_id", contactIds),
        ]);
        if (error) throw error;
        for (const c of (data ?? []) as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          updated_at: string;
        }[]) {
          const la = lastActivity.get(c.id) ?? null;
          infos.set(`contact:${c.id}`, {
            type: "contact",
            id: c.id,
            name: formatName(c.first_name ?? "", c.last_name ?? "") || "Contact",
            href: `/contacts/${c.id}`,
            keyText: la ? `Last activity ${formatRelativeDate(la)}` : "No activity yet",
            stale: isStale(latest(la, c.updated_at)),
          });
        }
      }

      if (accountIds.length) {
        const { data, error } = await supabase
          .from("accounts")
          .select("id, name, customer_status, acv")
          .in("id", accountIds)
          .is("archived_at", null);
        if (error) throw error;
        for (const a of (data ?? []) as {
          id: string;
          name: string;
          customer_status: CustomerStatus | null;
          acv: number | null;
        }[]) {
          const parts = [
            a.customer_status ? customerStatusLabel(a.customer_status) : null,
            a.acv != null ? `${formatCurrency(Number(a.acv))} ACV` : null,
          ].filter(Boolean);
          infos.set(`account:${a.id}`, {
            type: "account",
            id: a.id,
            name: a.name,
            href: `/accounts/${a.id}`,
            keyText: parts.length ? parts.join(" · ") : "—",
            // Spec §9 flags stale CONTACTS and OPPORTUNITIES only.
            stale: false,
          });
        }
      }

      if (oppIds.length) {
        const [{ data, error }, lastActivity] = await Promise.all([
          supabase
            .from("opportunities")
            .select("id, name, stage, amount, updated_at")
            .in("id", oppIds)
            .is("archived_at", null),
          fetchLastActivityMap("opportunity_id", oppIds),
        ]);
        if (error) throw error;
        for (const o of (data ?? []) as {
          id: string;
          name: string;
          stage: OpportunityStage;
          amount: number | null;
          updated_at: string;
        }[]) {
          const la = lastActivity.get(o.id) ?? null;
          infos.set(`opportunity:${o.id}`, {
            type: "opportunity",
            id: o.id,
            name: o.name,
            href: `/opportunities/${o.id}`,
            keyText: `${stageLabel(o.stage)} · ${formatCurrency(Number(o.amount ?? 0))}`,
            stale: isStale(latest(la, o.updated_at)),
          });
        }
      }

      // Preserve the config's manual order (array order = display order).
      return records
        .map((r) => infos.get(`${r.type}:${r.id}`))
        .filter((i): i is PinnedRecordInfo => !!i);
    },
    enabled: true,
  });
}

// ── Builder search ───────────────────────────────────────────────────

export interface PinSearchResult {
  type: PinnedRecordType;
  id: string;
  name: string;
  detail: string | null;
}

/** Mixed-type name search for the builder's pin picker (5 per type). */
export async function searchPinnableRecords(term: string): Promise<PinSearchResult[]> {
  const safe = term.replace(/[(),%]/g, " ").trim();
  if (!safe) return [];

  const [contacts, accounts, opps] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_name, last_name, account:accounts!account_id(name)")
      .is("archived_at", null)
      .is("import_status", null)
      .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%`)
      .limit(5),
    supabase
      .from("accounts")
      .select("id, name")
      .is("archived_at", null)
      .ilike("name", `%${safe}%`)
      .limit(5),
    supabase
      .from("opportunities")
      .select("id, name, account:accounts!account_id(name)")
      .is("archived_at", null)
      .ilike("name", `%${safe}%`)
      .limit(5),
  ]);
  if (contacts.error) throw contacts.error;
  if (accounts.error) throw accounts.error;
  if (opps.error) throw opps.error;

  const results: PinSearchResult[] = [];
  for (const c of (contacts.data ?? []) as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    account: { name: string } | null;
  }[]) {
    results.push({
      type: "contact",
      id: c.id,
      name: formatName(c.first_name ?? "", c.last_name ?? "") || "Contact",
      detail: c.account?.name ?? null,
    });
  }
  for (const a of (accounts.data ?? []) as { id: string; name: string }[]) {
    results.push({ type: "account", id: a.id, name: a.name, detail: null });
  }
  for (const o of (opps.data ?? []) as unknown as {
    id: string;
    name: string;
    account: { name: string } | null;
  }[]) {
    results.push({
      type: "opportunity",
      id: o.id,
      name: o.name,
      detail: o.account?.name ?? null,
    });
  }
  return results;
}
