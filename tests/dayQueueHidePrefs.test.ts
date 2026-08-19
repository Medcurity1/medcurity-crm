import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ASK_TO_HIDE_EVERY,
  DAY_QUEUE_CATEGORIES,
  canHideCategory,
  categoryLabel,
  categoryOf,
  hidePromptCopy,
  nextFourAmPacific,
  shouldAskToHide,
  stopCategoryLabel,
} from "@/features/nexus/day-queue";

const EM_DASH = "\u2014";

const srcFiles = [
  "src/features/nexus/day-queue.ts",
  "src/features/nexus/day-queue-api.ts",
  "src/features/nexus/DayQueueHideDialog.tsx",
  "src/features/nexus/DayQueueTuneList.tsx",
  "src/features/nexus/Briefing.tsx",
].map((rel) => ({
  rel,
  text: fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8"),
}));

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");
const LATEST_MIGRATION = "20260819010000_day_queue_hide_prefs.sql";
const PRIOR_QUEUE = "20260805030000_renewal_nudges_to_assessor.sql";

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").toLowerCase();
}

function latestRepDayQueueMigration(): { file: string; sql: string; raw: string } {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  let latest: { file: string; sql: string; raw: string } | null = null;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (/create(?:\s+or\s+replace)?\s+function\s+public\.rep_day_queue/i.test(raw)) {
      latest = { file, sql: stripSqlComments(raw), raw };
    }
  }
  if (!latest) throw new Error("rep_day_queue is missing from migrations");
  return latest;
}

describe("third Not today prompt", () => {
  it("asks on the third dismissal, not the first or second", () => {
    expect(shouldAskToHide(1)).toBe(false);
    expect(shouldAskToHide(2)).toBe(false);
    expect(shouldAskToHide(3)).toBe(true);
    expect(ASK_TO_HIDE_EVERY).toBe(3);
  });

  it("asks again on later thirds so a dismissed dialog is not the last chance", () => {
    expect(shouldAskToHide(6)).toBe(true);
    expect(shouldAskToHide(4)).toBe(false);
    expect(shouldAskToHide(0)).toBe(false);
    expect(shouldAskToHide(3.5)).toBe(false);
  });
});

describe("category identity", () => {
  it("prefers the server category so product requests stay distinct from CRM requests", () => {
    expect(categoryOf({ kind: "request", category: "request:product" })).toBe(
      "request:product",
    );
    expect(categoryOf({ kind: "request", category: "request:crm" })).toBe("request:crm");
  });

  it("falls back to kind when the category column is absent", () => {
    expect(categoryOf({ kind: "task" })).toBe("task");
    expect(categoryOf({ kind: "request" })).toBe("request");
  });

  it("labels product requests as their own category", () => {
    expect(categoryLabel("request:product")).toBe("Product requests");
    expect(stopCategoryLabel("request:product")).toBe("Stop product requests");
  });
});

describe("one dismissal must never suppress all task reminders", () => {
  it("refuses to hide the task category", () => {
    expect(canHideCategory("task")).toBe(false);
    expect(DAY_QUEUE_CATEGORIES.find((c) => c.id === "task")?.hideable).toBe(false);
  });

  it("still allows hiding one product-request category", () => {
    expect(canHideCategory("request:product")).toBe(true);
    expect(canHideCategory("request:crm")).toBe(true);
    expect(canHideCategory("reply")).toBe(true);
  });

  it("rejects wildcards that would swallow every reminder", () => {
    expect(canHideCategory("*")).toBe(false);
    expect(canHideCategory("%")).toBe(false);
    expect(canHideCategory("all")).toBe(false);
    expect(canHideCategory("")).toBe(false);
  });

  it("omits a category-hide choice on a regular task", () => {
    const copy = hidePromptCopy({ kind: "task", category: "task", title: "Call Pat" });
    expect(copy.stopCategoryLabel).toBeNull();
    expect(copy.stopItemLabel).toBe("Stop this reminder");
    expect(copy.keepLabel).toBe("Keep showing it");
  });

  it("offers a product-request category hide without mentioning tasks", () => {
    const copy = hidePromptCopy({
      kind: "request",
      category: "request:product",
      title: "Add Security Monitoring",
    });
    expect(copy.stopCategoryLabel).toBe("Stop product requests");
    expect(copy.hint).toMatch(/Requests/);
    expect(copy.stopCategoryLabel?.toLowerCase()).not.toContain("task");
    expect(JSON.stringify(copy)).not.toContain("all task");
  });
});

describe("user-visible copy", () => {
  it("keeps prompt language short and dash-free", () => {
    const copy = hidePromptCopy({
      kind: "request",
      category: "request:product",
    });
    const visible = [copy.title, copy.body, copy.hint, copy.stopItemLabel, copy.stopCategoryLabel, copy.keepLabel]
      .filter(Boolean)
      .join(" ");
    expect(visible).not.toContain(EM_DASH);
    expect(copy.title).toBe("Stop seeing this?");
    expect(copy.body.split(" ").length).toBeLessThan(12);
  });

  it("does not put em dashes in new Your Day UI copy", () => {
    const uiFiles = srcFiles.filter((f) =>
      /day-queue\.ts$|DayQueueHideDialog|DayQueueTuneList/.test(f.rel),
    );
    for (const { rel, text } of uiFiles) {
      const withoutComments = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(withoutComments, rel).not.toContain(EM_DASH);
    }
  });
});

describe("nextFourAmPacific", () => {
  function pacificParts(at: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
    };
  }

  it("returns 4:00 Pacific on the following calendar day", () => {
    const now = new Date("2026-08-18T17:00:00.000Z"); // 10:00 PDT
    const next = nextFourAmPacific(now);
    const got = pacificParts(next);
    expect(got).toEqual({ year: 2026, month: 8, day: 19, hour: 4, minute: 0 });
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("still lands on 4:00 Pacific across the spring-forward night", () => {
    const now = new Date("2026-03-07T20:00:00.000Z"); // 12:00 PST
    const next = nextFourAmPacific(now);
    const got = pacificParts(next);
    expect(got.hour).toBe(4);
    expect(got.minute).toBe(0);
    expect(got.day).toBe(8);
  });
});

describe("day_queue hide-prefs migration", () => {
  const latest = latestRepDayQueueMigration();
  const migration = stripSqlComments(
    fs.readFileSync(path.join(MIGRATIONS_DIR, LATEST_MIGRATION), "utf8"),
  );
  const prior = fs.readFileSync(path.join(MIGRATIONS_DIR, PRIOR_QUEUE), "utf8");

  it("re-emits the latest queue function, not an older body", () => {
    expect(latest.file).toBe(LATEST_MIGRATION);
    expect(latest.sql).toMatch(/security\s+invoker/);
    expect(latest.sql).not.toMatch(/security\s+definer/);
    expect(latest.raw).toContain("coalesce(o.assigned_assessor_id, o.owner_user_id)");
    expect(latest.raw).toContain("requests_waiting");
    expect(latest.raw).toContain("'request:' || r.type::text");
    expect(prior).toContain("coalesce(o.assigned_assessor_id, o.owner_user_id)");
    expect(prior).toContain("requests_waiting");
  });

  it("filters hidden items and categories by exact key, never LIKE", () => {
    expect(latest.sql).toContain("day_queue_item_state");
    expect(latest.sql).toContain("day_queue_hidden_categories");
    expect(latest.raw).toMatch(/cat\.category = u\.category/);
    expect(latest.raw).toMatch(/hid\.item_key = u\.item_key/);
    const filterBlock = latest.raw.slice(latest.raw.indexOf("day_queue_hidden_categories"));
    expect(filterBlock).not.toMatch(/cat\.category\s+like/i);
    expect(filterBlock).not.toMatch(/hid\.item_key\s+like/i);
  });

  it("counts dismissals atomically per user and item", () => {
    expect(migration).toMatch(/dismiss_count\s*=\s*s\.dismiss_count\s*\+\s*1/);
    expect(migration).toMatch(/on conflict \(user_id, item_key\) do update/);
    expect(migration).toMatch(/primary key \(user_id, item_key\)/);
  });

  it("blocks hiding the task category at the database", () => {
    expect(migration).toContain("category <> 'task'");
    expect(migration.toLowerCase()).toContain("task reminders stay on your list");
    expect(migration).toMatch(/v_cat = 'task'/);
  });

  it("is own-row RLS, invoker, and closed to anon", () => {
    expect(migration).toMatch(/enable row level security/);
    expect(migration).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    expect(migration).toMatch(/revoke all on public\.day_queue_item_state from public, anon/);
    expect(migration).toMatch(
      /revoke all on public\.day_queue_hidden_categories from public, anon/,
    );
    expect(migration).toMatch(/revoke all on function public\.day_queue_not_today/);
    expect(migration).toMatch(/revoke all on function public\.rep_day_queue/);
    expect(migration).toMatch(/grant execute on function public\.rep_day_queue\(int\) to authenticated/);
  });

  it("does not restate the renewal generator (avoids drifting D15)", () => {
    expect(migration).not.toContain("generate_upcoming_renewals_unsafe");
  });
});

describe("frontend wiring", () => {
  const briefing = srcFiles.find((f) => f.rel.endsWith("Briefing.tsx"))!.text;
  const api = srcFiles.find((f) => f.rel.endsWith("day-queue-api.ts"))!.text;
  const dialog = srcFiles.find((f) => f.rel.endsWith("DayQueueHideDialog.tsx"))!.text;
  const tune = srcFiles.find((f) => f.rel.endsWith("DayQueueTuneList.tsx"))!.text;

  it("sends Not today through the atomic RPC, not a raw snooze-only write", () => {
    expect(api).toContain('supabase.rpc("day_queue_not_today"');
    expect(api).not.toMatch(/from\("day_queue_snoozes"\)\.upsert/);
  });

  it("opens the hide dialog only after the counted snooze asks", () => {
    expect(briefing).toContain("result.ask_to_hide");
    expect(briefing).toContain("DayQueueHideDialog");
    expect(dialog).toContain("copy.stopItemLabel");
    expect(dialog).toContain("copy.stopCategoryLabel");
    expect(dialog).toContain("copy.keepLabel");
  });

  it("exposes Tune your list and a restore path for hidden reminders", () => {
    expect(briefing).toContain("DayQueueTuneList");
    expect(tune).toContain("Tune your list");
    expect(tune).toContain("Show again");
    expect(tune).toContain("Always stays on");
    expect(tune).toContain("DAY_QUEUE_CATEGORIES");
  });

  it("never lets the client hide every task reminder", () => {
    expect(api).toContain('throw new Error("Task reminders stay on your list")');
    expect(tune).toContain("Always stays on");
    expect(dialog).not.toContain("Stop tasks");
  });
});
