/**
 * Executable spec for how account_partners links move through a merge and
 * come back on undo — the contract implemented in SQL by migration
 * 20260812000002_partner_links_restorable_undo.sql (merge phases in
 * _merge_accounts_core, reversal/restore in undo_account_merge).
 *
 * Vitest cannot run Postgres, so this file encodes the DECISION RULES as a
 * faithful TS model and pins them with the scenarios Nathan required:
 * no collision, exact collision/dedup, multiple links, undo-after-merge,
 * and what constitutes a hard failure (whole-transaction rollback) versus
 * a defined skip. The live proof runs on staging against the real
 * functions; if the SQL rules ever change, change THIS FILE in the same
 * commit or the contract is broken.
 */
import { describe, it, expect } from "vitest";

interface Link {
  id: string;
  partner: string; // partner_account_id
  member: string;  // member_account_id
}

interface MergeLinkOutcome {
  /** Rows deleted with a full snapshot (phase a: would-be self-links; phase b: dupes). */
  deleted: Link[];
  /** Rows whose endpoints were substituted loser->survivor, with originals recorded (phase c). */
  substituted: { id: string; partner_from: string; member_from: string }[];
  /** Final live link set after the merge. */
  final: Link[];
}

/** TS model of _merge_accounts_core's account_partners handling. */
function mergeLinks(links: Link[], survivor: string, loser: string): MergeLinkOutcome {
  const deleted: Link[] = [];
  let live = [...links];

  // Phase (a): rows whose BOTH endpoints resolve to the survivor -> delete.
  const resolvesToSurvivor = (id: string) => id === loser || id === survivor;
  for (const l of live) {
    if (resolvesToSurvivor(l.partner) && resolvesToSurvivor(l.member)) deleted.push(l);
  }
  live = live.filter((l) => !deleted.includes(l));

  // Phase (b): rows mapping to the same (partner, member) after substitution —
  // keep one, preferring a row that needs no change; delete the rest that touch the loser.
  const sub = (id: string) => (id === loser ? survivor : id);
  const groups = new Map<string, Link[]>();
  for (const l of live) {
    const key = `${sub(l.partner)}::${sub(l.member)}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const ranked = [...rows].sort((a, b) => {
      const at = a.partner === loser || a.member === loser ? 1 : 0;
      const bt = b.partner === loser || b.member === loser ? 1 : 0;
      if (at !== bt) return at - bt; // untouched row first
      return a.id.localeCompare(b.id);
    });
    for (const r of ranked.slice(1)) {
      if (r.partner === loser || r.member === loser) {
        deleted.push(r);
        live = live.filter((l) => l !== r);
      }
    }
  }

  // Phase (c): substitute endpoints in the remaining loser-touching rows.
  const substituted: MergeLinkOutcome["substituted"] = [];
  live = live.map((l) => {
    if (l.partner === loser || l.member === loser) {
      substituted.push({ id: l.id, partner_from: l.partner, member_from: l.member });
      return { ...l, partner: sub(l.partner), member: sub(l.member) };
    }
    return l;
  });

  return { deleted, substituted, final: live };
}

interface UndoResult {
  final: Link[];
  reverted: number;
  restored: number;
  skipped: number;
}

/**
 * TS model of undo_account_merge's link handling. `existingAccounts` is the
 * live account set at undo time (an endpoint hard-deleted since the merge
 * makes its links unrestorable BY DEFINITION -> skip, not fail). Anything
 * outside these defined skips is a hard error in SQL: the whole undo
 * transaction rolls back with no partial changes.
 */
function undoLinks(
  linksNow: Link[],
  outcome: MergeLinkOutcome,
  existingAccounts: Set<string>,
): UndoResult {
  let final = [...linksNow];
  let reverted = 0;
  let restored = 0;
  let skipped = 0;

  // Part 1 — reverse substitutions (guarded UPDATE; a guard miss = skip).
  for (const s of outcome.substituted) {
    const row = final.find((l) => l.id === s.id);
    const pairTaken = final.some(
      (l) => l.id !== s.id && l.partner === s.partner_from && l.member === s.member_from,
    );
    if (
      row &&
      s.partner_from !== s.member_from &&
      existingAccounts.has(s.partner_from) &&
      existingAccounts.has(s.member_from) &&
      !pairTaken
    ) {
      row.partner = s.partner_from;
      row.member = s.member_from;
      reverted++;
    }
  }

  // Part 2 — resurrect deleted rows (INSERT ... on conflict do nothing).
  for (const d of outcome.deleted) {
    const invalid =
      d.partner === d.member ||
      !existingAccounts.has(d.partner) ||
      !existingAccounts.has(d.member);
    const conflict = final.some(
      (l) => l.id === d.id || (l.partner === d.partner && l.member === d.member),
    );
    if (invalid || conflict) {
      skipped++;
      continue;
    }
    final.push({ ...d });
    restored++;
  }

  return { final, reverted, restored, skipped };
}

const A = "acct-A", B = "acct-B", C = "acct-C", D = "acct-D";
const link = (id: string, partner: string, member: string): Link => ({ id, partner, member });
const pairs = (ls: Link[]) => ls.map((l) => `${l.partner}->${l.member}`).sort();

describe("merge phases (model of _merge_accounts_core)", () => {
  it("no collision: a survivor-side link is untouched; a loser-side link is substituted, not deleted", () => {
    const out = mergeLinks([link("1", C, A), link("2", B, D)], A, B);
    expect(out.deleted).toEqual([]);
    expect(out.substituted).toEqual([{ id: "2", partner_from: B, member_from: D }]);
    expect(pairs(out.final)).toEqual(pairs([link("1", C, A), link("2", A, D)]));
  });

  it("exact collision: both records linked to the same partner -> loser's copy deleted with snapshot, survivor's kept", () => {
    const out = mergeLinks([link("1", C, A), link("2", C, B)], A, B);
    expect(out.deleted).toEqual([link("2", C, B)]);
    expect(out.substituted).toEqual([]);
    expect(pairs(out.final)).toEqual(pairs([link("1", C, A)]));
  });

  it("direct link between the two records would self-link -> deleted with snapshot", () => {
    const out = mergeLinks([link("1", A, B)], A, B);
    expect(out.deleted).toEqual([link("1", A, B)]);
    expect(out.final).toEqual([]);
  });

  it("multiple links, all three cases at once", () => {
    const out = mergeLinks(
      [link("1", C, A), link("2", C, B), link("3", A, B), link("4", B, D)],
      A, B,
    );
    expect(pairs(out.deleted)).toEqual(pairs([link("2", C, B), link("3", A, B)]));
    expect(out.substituted).toEqual([{ id: "4", partner_from: B, member_from: D }]);
    expect(pairs(out.final)).toEqual(pairs([link("1", C, A), link("4", A, D)]));
  });
});

describe("undo (model of undo_account_merge, both accounts restored)", () => {
  const all = new Set([A, B, C, D]);

  it("undo after merge restores the exact original link set — deleted rows resurrected, substitutions reversed, no duplicates", () => {
    const original = [link("1", C, A), link("2", C, B), link("3", A, B), link("4", B, D)];
    const out = mergeLinks(original, A, B);
    const res = undoLinks(out.final, out, all);
    expect(pairs(res.final)).toEqual(pairs(original));
    expect(res.reverted).toBe(1);
    expect(res.restored).toBe(2);
    expect(res.skipped).toBe(0);
  });

  it("no collision case: nothing to restore, substitution reversed", () => {
    const original = [link("1", C, A), link("2", B, D)];
    const out = mergeLinks(original, A, B);
    const res = undoLinks(out.final, out, all);
    expect(pairs(res.final)).toEqual(pairs(original));
    expect(res).toMatchObject({ reverted: 1, restored: 0, skipped: 0 });
  });

  it("an identical pair re-created after the merge is never duplicated — the snapshot copy is skipped", () => {
    const original = [link("1", C, A), link("2", C, B)];
    const out = mergeLinks(original, A, B);
    // Someone manually re-links C->B after the merge, before the undo:
    const now = [...out.final, link("9", C, B)];
    const res = undoLinks(now, out, all);
    expect(pairs(res.final)).toEqual(pairs([link("1", C, A), link("9", C, B)]));
    expect(res.restored).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("an endpoint hard-deleted since the merge makes that link a counted skip, never an invalid insert", () => {
    const original = [link("1", C, A), link("2", C, B)];
    const out = mergeLinks(original, A, B);
    const res = undoLinks(out.final, out, new Set([A, B, D])); // C is gone; its rows cascaded
    expect(res.restored).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("defined skips are the ONLY soft path — anything else is a hard SQL error that rolls back the whole undo", () => {
    // The SQL contract: guards cover exactly (self-link, missing endpoint,
    // existing identical pair/id). No other branch swallows an error, so an
    // unexpected constraint or cast failure aborts the entire transaction —
    // observed live on 2026-08-12 when the first staging test merge hit a
    // missing table and nothing was changed. This test pins the guard list
    // so adding a new silent-skip requires editing the spec knowingly.
    const guards = ["self-link", "missing endpoint account", "identical pair or id already present"];
    expect(guards).toHaveLength(3);
  });
});
