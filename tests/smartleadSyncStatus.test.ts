import { describe, it, expect } from "vitest";
import {
  resolveSyncedStatus,
  firstNumber,
  extractDailyLimit,
} from "../supabase/functions/_shared/smartlead-sync.ts";

// ---------------------------------------------------------------------------
// Docket I38 — Deno-side sync helpers, extracted from playbook-smartlead/
// index.ts into _shared/smartlead-sync.ts (same vitest-importable treatment
// webhook-normalize.ts got; mirrors campaignScheduling.test.ts's import
// style). resolveSyncedStatus is the guard that keeps a Smartlead sync from
// silently re-arming a stopped campaign; extractDailyLimit is the
// never-fabricate-a-0 inbox limit reader.
// ---------------------------------------------------------------------------

describe("resolveSyncedStatus — terminal-status regression guard", () => {
  it("keeps the current status when Smartlead's status didn't map (null)", () => {
    expect(resolveSyncedStatus("active", null)).toBe("active");
    expect(resolveSyncedStatus("stopped", null)).toBe("stopped");
  });

  it("never regresses stopped/completed back to draft or active", () => {
    expect(resolveSyncedStatus("stopped", "draft")).toBe("stopped");
    expect(resolveSyncedStatus("stopped", "active")).toBe("stopped");
    expect(resolveSyncedStatus("completed", "draft")).toBe("completed");
    expect(resolveSyncedStatus("completed", "active")).toBe("completed");
  });

  it("allows terminal-to-terminal moves (Smartlead is the source of truth between them)", () => {
    expect(resolveSyncedStatus("stopped", "completed")).toBe("completed");
    expect(resolveSyncedStatus("completed", "stopped")).toBe("stopped");
  });

  it("mirrors Smartlead for non-terminal rows, including backwards pause/resume", () => {
    expect(resolveSyncedStatus("draft", "active")).toBe("active");
    expect(resolveSyncedStatus("active", "paused")).toBe("paused");
    expect(resolveSyncedStatus("paused", "active")).toBe("active");
    expect(resolveSyncedStatus("active", "draft")).toBe("draft");
    expect(resolveSyncedStatus("active", "completed")).toBe("completed");
  });

  it("allows paused → draft/active (paused is not terminal)", () => {
    expect(resolveSyncedStatus("paused", "draft")).toBe("draft");
  });
});

describe("firstNumber — first numeric-looking candidate", () => {
  it("returns the first parseable value, skipping null/undefined", () => {
    expect(firstNumber(null, undefined, "42", 7)).toBe(42);
    expect(firstNumber(7, "42")).toBe(7);
  });

  it("strips a trailing % (Smartlead rate strings like '45.2%')", () => {
    expect(firstNumber("45.2%")).toBe(45.2);
  });

  it("returns null when nothing parses", () => {
    expect(firstNumber()).toBeNull();
    expect(firstNumber(null, "lots", "N/A")).toBeNull();
  });

  it("accepts 0 as a real value (it is numeric, just not a limit — see extractDailyLimit)", () => {
    expect(firstNumber(0)).toBe(0);
  });
});

describe("extractDailyLimit — never fabricate a 0/day cap", () => {
  it("reads each plausible field-name variant", () => {
    expect(extractDailyLimit({ message_per_day: 50 })).toBe(50);
    expect(extractDailyLimit({ daily_sent_limit: "30" })).toBe(30);
    expect(extractDailyLimit({ max_email_per_day: 25 })).toBe(25);
    expect(extractDailyLimit({ daily_limit: 40 })).toBe(40);
    expect(extractDailyLimit({ warmup_details: { total_warmup_per_day: 15 } })).toBe(15);
  });

  it("prefers the earlier field when several are present", () => {
    expect(extractDailyLimit({ message_per_day: 50, daily_limit: 99 })).toBe(50);
  });

  it("returns null — not 0 — when nothing matches, so the UI says 'limit unknown'", () => {
    expect(extractDailyLimit({})).toBeNull();
    expect(extractDailyLimit({ unrelated: "field" })).toBeNull();
  });

  it("treats a 0 or negative limit as unknown (a real 0/day cap is implausible)", () => {
    expect(extractDailyLimit({ message_per_day: 0 })).toBeNull();
    expect(extractDailyLimit({ message_per_day: -5 })).toBeNull();
  });

  it("ignores a non-object warmup_details", () => {
    expect(extractDailyLimit({ warmup_details: "off" })).toBeNull();
  });
});
