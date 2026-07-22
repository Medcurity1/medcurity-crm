import { describe, it, expect } from "vitest";
import {
  normalizeWebhookPayload,
} from "../supabase/functions/_shared/webhook-normalize.ts";

// ---------------------------------------------------------------------------
// Campaigns overhaul Phase 2, slice S5 — the pure payload normalizer that
// turns a Smartlead campaign-webhook body (field names vary across event
// types / API versions) into a stable shape for campaign-webhooks/index.ts.
//
// Mirrors campaignScheduling.test.ts: imports supabase/functions/_shared/
// webhook-normalize.ts directly (Deno-side, zero dependencies).
// ---------------------------------------------------------------------------

describe("normalizeWebhookPayload — field-name variants", () => {
  it("reads snake_case fields (campaign_id/to_email/event_type/event_timestamp)", () => {
    const result = normalizeWebhookPayload({
      campaign_id: 123,
      to_email: "Jane.Doe@Example.com",
      event_type: "EMAIL_SENT",
      event_timestamp: "2026-07-22T09:00:00Z",
      lead_id: 456,
    });
    expect(result).toEqual({
      type: "EMAIL_SENT",
      rawType: "EMAIL_SENT",
      smartleadCampaignId: 123,
      email: "jane.doe@example.com",
      occurredAt: "2026-07-22T09:00:00.000Z",
      replyBody: null,
      leadId: 456,
    });
  });

  it("reads camelCase fields (campaignId/leadId/eventType)", () => {
    const result = normalizeWebhookPayload({
      campaignId: 789,
      leadId: 111,
      eventType: "EMAIL_OPENED",
      email: "person@company.com",
    });
    expect(result.type).toBe("EMAIL_OPENED");
    expect(result.smartleadCampaignId).toBe(789);
    expect(result.leadId).toBe(111);
    expect(result.email).toBe("person@company.com");
  });

  it("reads lead_email as an email variant", () => {
    const result = normalizeWebhookPayload({
      campaign_id: 1,
      event_type: "EMAIL_CLICKED",
      lead_email: "clicky@example.com",
    });
    expect(result.email).toBe("clicky@example.com");
    expect(result.type).toBe("EMAIL_CLICKED");
  });

  it("reads fields nested under data/lead/campaign/to", () => {
    const result = normalizeWebhookPayload({
      data: {
        event_type: "EMAIL_BOUNCED",
        campaign: { id: 55 },
        lead: { email: "nested@example.com", id: 999 },
        timestamp: "2026-07-20T00:00:00.000Z",
      },
    });
    expect(result.type).toBe("EMAIL_BOUNCED");
    expect(result.smartleadCampaignId).toBe(55);
    expect(result.email).toBe("nested@example.com");
    expect(result.leadId).toBe(999);
    expect(result.occurredAt).toBe("2026-07-20T00:00:00.000Z");
  });

  it("reads `to.email` as a recipient-email variant", () => {
    const result = normalizeWebhookPayload({
      campaign_id: 2,
      event_type: "EMAIL_SENT",
      to: { email: "recipient@example.com" },
    });
    expect(result.email).toBe("recipient@example.com");
  });

  it("reads reply/reply_body/preview_text variants for EMAIL_REPLIED", () => {
    expect(normalizeWebhookPayload({ event_type: "EMAIL_REPLIED", reply: "Thanks, interested!" }).replyBody)
      .toBe("Thanks, interested!");
    expect(normalizeWebhookPayload({ event_type: "EMAIL_REPLIED", reply_body: "Sure, let's talk" }).replyBody)
      .toBe("Sure, let's talk");
    expect(normalizeWebhookPayload({ event_type: "EMAIL_REPLIED", preview_text: "Not interested" }).replyBody)
      .toBe("Not interested");
  });

  it("prefers the first present variant when several are supplied", () => {
    const result = normalizeWebhookPayload({
      campaign_id: 1,
      campaignId: 2,
      event_type: "EMAIL_SENT",
      to_email: "first@example.com",
      email: "second@example.com",
    });
    expect(result.smartleadCampaignId).toBe(1);
    expect(result.email).toBe("first@example.com");
  });

  it("maps loosely-formatted event type strings (spaces/dashes/case)", () => {
    expect(normalizeWebhookPayload({ event_type: "Email Unsubscribed" }).type).toBe("EMAIL_UNSUBSCRIBED");
    expect(normalizeWebhookPayload({ event_type: "email-replied" }).type).toBe("EMAIL_REPLIED");
    expect(normalizeWebhookPayload({ event_type: "unsubscribe" }).type).toBe("EMAIL_UNSUBSCRIBED");
    expect(normalizeWebhookPayload({ event_type: "bounce" }).type).toBe("EMAIL_BOUNCED");
  });

  it("parses a unix-seconds timestamp", () => {
    const result = normalizeWebhookPayload({ event_type: "EMAIL_SENT", event_timestamp: "1784800800" });
    expect(result.occurredAt).not.toBeNull();
    expect(new Date(result.occurredAt!).getFullYear()).toBeGreaterThan(2020);
  });
});

describe("normalizeWebhookPayload — junk / malformed payloads", () => {
  it("returns all-null on null input", () => {
    expect(normalizeWebhookPayload(null)).toEqual({
      type: null, rawType: null, smartleadCampaignId: null, email: null,
      occurredAt: null, replyBody: null, leadId: null,
    });
  });

  it("returns all-null on undefined input", () => {
    expect(normalizeWebhookPayload(undefined).type).toBeNull();
  });

  it("returns all-null on a primitive (string/number/boolean)", () => {
    expect(normalizeWebhookPayload("not an object").type).toBeNull();
    expect(normalizeWebhookPayload(42).smartleadCampaignId).toBeNull();
    expect(normalizeWebhookPayload(true).email).toBeNull();
  });

  it("returns all-null on an array", () => {
    expect(normalizeWebhookPayload([1, 2, 3])).toEqual({
      type: null, rawType: null, smartleadCampaignId: null, email: null,
      occurredAt: null, replyBody: null, leadId: null,
    });
  });

  it("returns an empty object's fields as null", () => {
    expect(normalizeWebhookPayload({})).toEqual({
      type: null, rawType: null, smartleadCampaignId: null, email: null,
      occurredAt: null, replyBody: null, leadId: null,
    });
  });

  it("keeps rawType even when the event type is unrecognized", () => {
    const result = normalizeWebhookPayload({ event_type: "SOME_FUTURE_EVENT" });
    expect(result.type).toBeNull();
    expect(result.rawType).toBe("SOME_FUTURE_EVENT");
  });

  it("does not throw on a garbage timestamp value", () => {
    const result = normalizeWebhookPayload({ event_type: "EMAIL_SENT", event_timestamp: "not-a-date" });
    expect(result.occurredAt).toBeNull();
  });

  it("does not throw on a garbage campaign_id / lead_id (non-numeric string)", () => {
    const result = normalizeWebhookPayload({ campaign_id: "abc", lead_id: "xyz", event_type: "EMAIL_SENT" });
    expect(result.smartleadCampaignId).toBeNull();
    expect(result.leadId).toBeNull();
  });

  it("does not throw when nested sub-objects are the wrong type", () => {
    const result = normalizeWebhookPayload({ data: "not an object", lead: 5, campaign: [1, 2] });
    expect(result).toEqual({
      type: null, rawType: null, smartleadCampaignId: null, email: null,
      occurredAt: null, replyBody: null, leadId: null,
    });
  });

  it("lowercases and trims a recipient email", () => {
    const result = normalizeWebhookPayload({ event_type: "EMAIL_SENT", email: "  Weird.Spacing@Example.COM  " });
    expect(result.email).toBe("weird.spacing@example.com");
  });
});
