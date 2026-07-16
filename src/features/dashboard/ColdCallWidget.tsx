// Daily cold-call list for Summer (V3-C). LIVE query against the
// v_cold_call_contacts view — never a daily-materialized snapshot — so it
// reflects flag changes (do_not_call / NLE / do_not_contact) the instant
// they happen. Sorted warm-first (most recently touched first) and capped.
//
// Source picker (account restructure, Summer's Q8 answer 2026-07-15): she
// curates her own call lists (Lists with contact members) and the widget
// pulls from the chosen list instead of the auto pool. "All contacts"
// keeps the original pool; the choice persists per browser like the ICP
// override. Adding a contact to any list auto-activates its account
// (trg_list_member_sales_active); removing it everywhere deactivates
// unless the account is a current customer or partner.
//
// ICP filtering (org type / state / FTE) stays config-driven and permissive
// by default (superseded in practice by her lists, kept for the auto pool).

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatName, formatRelativeDate } from "@/lib/formatters";
import { formatPhone } from "@/components/PhoneInput";

interface ColdCallRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  phone: string | null;
  state: string | null;
  account_id: string | null;
  account_name: string | null;
  industry: string | null;
  account_type: string | null;
  fte_count: number | null;
  last_activity_at: string | null;
}

// Default ICP = permissive (no extra filtering). Fill these in — or set a
// JSON "cold_call_icp" key in localStorage — once Summer defines her ICP.
interface IcpConfig {
  orgTypes: string[];
  states: string[];
  minFte: number | null;
  maxFte: number | null;
}
const COLD_CALL_ICP: IcpConfig = {
  orgTypes: [],
  states: [],
  minFte: null,
  maxFte: null,
};

function loadIcp(): IcpConfig {
  try {
    const raw = localStorage.getItem("cold_call_icp");
    if (raw) return { ...COLD_CALL_ICP, ...JSON.parse(raw) };
  } catch {
    // ignore malformed override
  }
  return COLD_CALL_ICP;
}

const LIMIT = 15;
const LIST_CHOICE_KEY = "cold_call_list_id"; // '' = auto pool

export function ColdCallWidget() {
  const [listId, setListId] = useState<string>(
    () => localStorage.getItem(LIST_CHOICE_KEY) ?? "",
  );

  // Lists that can act as a call-list source (any list with contact members).
  const { data: lists } = useQuery({
    queryKey: ["dashboard", "cold-call-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_lists")
        .select("id, name, lead_list_members!inner(contact_id)")
        .not("lead_list_members.contact_id", "is", null)
        .order("name");
      if (error) throw error;
      const seen = new Set<string>();
      return ((data ?? []) as { id: string; name: string }[]).filter((l) =>
        seen.has(l.id) ? false : (seen.add(l.id), true),
      );
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "cold-call-contacts", listId],
    queryFn: async () => {
      // List mode: the pool is exactly the contacts Summer curated onto the
      // chosen list (still through the view, so DNC/NLE flags apply).
      let memberIds: string[] | null = null;
      if (listId) {
        const { data: members, error } = await supabase
          .from("lead_list_members")
          .select("contact_id")
          .eq("list_id", listId)
          .not("contact_id", "is", null)
          .limit(1000);
        if (error) throw error;
        memberIds = (members ?? []).map((m) => m.contact_id as string);
        if (memberIds.length === 0) return [] as ColdCallRow[];
      }
      const icp = loadIcp();
      let q = supabase
        .from("v_cold_call_contacts")
        .select(
          "id, first_name, last_name, title, phone, state, account_id, account_name, industry, account_type, fte_count, last_activity_at",
        )
        // Warm-first: most recently touched at the top; never-touched last.
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(LIMIT);
      if (memberIds) {
        q = q.in("id", memberIds);
      } else {
        // "Org type" for Medcurity = the account's industry (Hospital, Clinic…).
        if (icp.orgTypes.length) q = q.in("industry", icp.orgTypes);
        if (icp.states.length) q = q.in("state", icp.states);
        if (icp.minFte != null) q = q.gte("fte_count", icp.minFte);
        if (icp.maxFte != null) q = q.lte("fte_count", icp.maxFte);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ColdCallRow[];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-primary" />
          Cold Call List
        </CardTitle>
        <Select
          value={listId || "__auto__"}
          onValueChange={(v) => {
            const next = v === "__auto__" ? "" : v;
            setListId(next);
            localStorage.setItem(LIST_CHOICE_KEY, next);
          }}
        >
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">All contacts (auto)</SelectItem>
            {(lists ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">
            No contacts to call right now.
          </p>
        ) : (
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last Touch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        to={`/contacts/${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {formatName(row.first_name ?? "", row.last_name ?? "")}
                      </Link>
                      {row.phone && (
                        <a
                          href={`tel:${row.phone}`}
                          className="block text-xs text-muted-foreground hover:text-primary"
                        >
                          {formatPhone(row.phone)}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.title ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.account_id && row.account_name ? (
                        <Link
                          to={`/accounts/${row.account_id}`}
                          className="text-primary hover:underline"
                        >
                          {row.account_name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {(row.industry ?? row.account_type) && (
                        <span className="block text-xs text-muted-foreground">
                          {row.industry ?? row.account_type}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.state ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.last_activity_at
                        ? formatRelativeDate(row.last_activity_at)
                        : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
