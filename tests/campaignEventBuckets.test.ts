import { describe, it, expect } from "vitest";
import { eventTypeBucket, touchEventBucket } from "../src/features/playbook/campaign-metrics";

// ---------------------------------------------------------------------------
// Docket I38 — the event-type classifiers behind the detail sheet's
// Engagement funnel (eventTypeBucket, mirrored by the campaign_event_counts
// SQL function) and the per-email table (touchEventBucket). The point of a
// shared matcher was that the two tables can never disagree about what
// counts as sent/open/click/reply — these tests pin that agreement and the
// precedence order (repl > click > open > sent/send).
// ---------------------------------------------------------------------------

describe("eventTypeBucket — real event-type spellings", () => {
  it("maps both reply spellings (raw webhook EMAIL_REPLY and canonical EMAIL_REPLIED)", () => {
    expect(eventTypeBucket("EMAIL_REPLY")).toBe("replied");
    expect(eventTypeBucket("EMAIL_REPLIED")).toBe("replied");
  });

  it("maps click / open / sent variants", () => {
    expect(eventTypeBucket("EMAIL_LINK_CLICK")).toBe("clicked");
    expect(eventTypeBucket("EMAIL_CLICKED")).toBe("clicked");
    expect(eventTypeBucket("EMAIL_OPEN")).toBe("opened");
    expect(eventTypeBucket("EMAIL_OPENED")).toBe("opened");
    expect(eventTypeBucket("EMAIL_SENT")).toBe("sent");
    // EMAIL_SEND-shaped types are exactly what the removed inline regex
    // chain dropped while the funnel counted them (adversarial review).
    expect(eventTypeBucket("EMAIL_SEND")).toBe("sent");
  });

  it("is case-insensitive (older rows may carry lowercased names)", () => {
    expect(eventTypeBucket("email_reply")).toBe("replied");
    expect(eventTypeBucket("Email_Open")).toBe("opened");
  });

  it("returns null for non-funnel events (bounce/unsubscribe/category)", () => {
    expect(eventTypeBucket("EMAIL_BOUNCE")).toBeNull();
    expect(eventTypeBucket("EMAIL_BOUNCED")).toBeNull();
    expect(eventTypeBucket("UNSUBSCRIBED")).toBeNull();
    expect(eventTypeBucket("LEAD_CATEGORY_UPDATED")).toBeNull();
    expect(eventTypeBucket("")).toBeNull();
  });

  it("precedence: reply beats click beats open beats sent when a name matches several", () => {
    expect(eventTypeBucket("REPLY_LINK_CLICK_OPEN_SENT")).toBe("replied");
    expect(eventTypeBucket("LINK_CLICK_OPEN_SENT")).toBe("clicked");
    expect(eventTypeBucket("OPEN_AFTER_SENT")).toBe("opened");
  });
});

describe("touchEventBucket — funnel agreement plus the bounce case", () => {
  it("adds the bounced bucket the funnel deliberately excludes", () => {
    expect(touchEventBucket("EMAIL_BOUNCE")).toBe("bounced");
    expect(touchEventBucket("EMAIL_BOUNCED")).toBe("bounced");
    expect(touchEventBucket("email_hard_bounce")).toBe("bounced");
  });

  it("bounce wins even when the name also matches a funnel word", () => {
    // A hypothetical "BOUNCE_AFTER_OPEN" must count as a bounce in the
    // per-email table, not inflate opens.
    expect(touchEventBucket("BOUNCE_AFTER_OPEN")).toBe("bounced");
  });

  it("agrees with eventTypeBucket on every funnel type", () => {
    for (const t of [
      "EMAIL_SENT", "EMAIL_SEND", "EMAIL_OPEN", "EMAIL_OPENED",
      "EMAIL_LINK_CLICK", "EMAIL_CLICKED", "EMAIL_REPLY", "EMAIL_REPLIED",
    ]) {
      expect(touchEventBucket(t)).toBe(eventTypeBucket(t));
    }
  });

  it("returns null for events neither table counts", () => {
    expect(touchEventBucket("UNSUBSCRIBED")).toBeNull();
    expect(touchEventBucket("LEAD_CATEGORY_UPDATED")).toBeNull();
  });
});
