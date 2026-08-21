import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_DELIVERY_SETTINGS,
  deliveryDaysLabel,
  deliverySummary,
  normalizeDeliverySettings,
} from "../src/features/playbook/delivery-settings";

describe("campaign delivery settings", () => {
  it("gives a normal user a complete weekday business-hours preset", () => {
    expect(deliverySummary(DEFAULT_DELIVERY_SETTINGS)).toBe("Weekdays, 9am–5pm Pacific time");
    expect(DEFAULT_DELIVERY_SETTINGS).toMatchObject({
      campaignDailyVolume: 25,
      messageSpacingMinutes: 15,
      timezone: "America/Los_Angeles",
    });
  });

  it("keeps cadence concepts separate and clamps unsafe numeric input", () => {
    expect(normalizeDeliverySettings({ campaignDailyVolume: 999, messageSpacingMinutes: 0 })).toMatchObject({
      campaignDailyVolume: 500,
      messageSpacingMinutes: 15,
    });
  });

  it("describes custom sending days plainly", () => {
    expect(deliveryDaysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(deliveryDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });
});

describe("campaign delivery and inbox UI contracts", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("uses pressed-state day pills and keeps the editor contained with bottom actions", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toContain('aria-label="Campaign sending days"');
    expect(wizard).toContain('className="camp-pill h-9 min-w-12 justify-center border"');
    expect(wizard).toContain("Use these delivery settings");
    expect(wizard).toContain("Nothing is saved to Smartlead from this editor.");
    expect(wizard).toContain("const [autoStart, setAutoStart] = useState(true)");
    expect(wizard).toContain('AlertDialogContent className="camp-scope camp-shell');
  });

  it("does not rewrite controlled HTML on every keystroke", () => {
    const inbox = read("src/features/playbook/InboxHealthDialog.tsx");
    const editor = inbox.slice(inbox.indexOf("function VisualSignatureEditor"), inbox.indexOf("export function InboxHealthDialog"));
    expect(editor).toContain("editorRef.current.innerHTML");
    expect(editor).toContain("onInput={(event) => onChange(event.currentTarget.innerHTML)}");
    expect(editor).not.toContain("dangerouslySetInnerHTML");
    expect(inbox).toContain("its API does not provide a signature-image upload endpoint");
  });

  it("maps factual warmup state and supports scoped mailbox limit updates", () => {
    const inbox = read("src/features/playbook/InboxHealthDialog.tsx");
    const edge = read("supabase/functions/playbook-smartlead/index.ts");
    expect(inbox).toContain('label: "Warmup off"');
    expect(inbox).toContain('label: "Warmup unknown"');
    expect(inbox).not.toContain('label: "Warming well"');
    expect(edge).toContain("max_email_per_day: limit");
    expect(edge).toContain('action === "update-email-account-daily-limit"');
  });
});
