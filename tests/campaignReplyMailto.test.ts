import { describe, it, expect } from "vitest";
import { replySubject, mailtoRecipient } from "../src/features/playbook/reply-extract";

// ---------------------------------------------------------------------------
// Docket I38 — the Replies feed's Reply button builds a mailto: URL from
// UNTRUSTED webhook data (campaign_events.email and .payload are stored
// verbatim from Smartlead). These tests pin the two injection guards:
// mailtoRecipient's reject-then-encode posture, and replySubject's
// CRLF-strip + length cap.
// ---------------------------------------------------------------------------

describe("mailtoRecipient — recipient injection guard", () => {
  it("accepts a plausible bare address (encoded)", () => {
    expect(mailtoRecipient("jane.doe@example.com")).toBe("jane.doe%40example.com");
    expect(mailtoRecipient("  padded@example.org  ")).toBe("padded%40example.org");
  });

  it("rejects header/param injection shapes", () => {
    expect(mailtoRecipient("a@b.com?bcc=attacker@evil.com")).toBeNull();
    expect(mailtoRecipient("a@b.com&cc=x@y.com")).toBeNull();
    expect(mailtoRecipient("a@b.com,second@evil.com")).toBeNull();
    expect(mailtoRecipient("a@b.com;second@evil.com")).toBeNull();
  });

  it("rejects display-name / bracket / quote shapes", () => {
    expect(mailtoRecipient("Jane Doe <jane@example.com>")).toBeNull();
    expect(mailtoRecipient('"jane"@example.com')).toBeNull();
    expect(mailtoRecipient("jane@exa mple.com")).toBeNull();
  });

  it("rejects null, empty, and not-an-address junk", () => {
    expect(mailtoRecipient(null)).toBeNull();
    expect(mailtoRecipient("")).toBeNull();
    expect(mailtoRecipient("not-an-email")).toBeNull();
    expect(mailtoRecipient("no-tld@host")).toBeNull();
  });
});

describe("replySubject — header-safety and fallbacks", () => {
  it("prefers the payload's subject and prefixes Re:", () => {
    expect(replySubject({ subject: "Pricing question" }, "Q3 Outreach")).toBe("Re: Pricing question");
  });

  it("does not double a Re: prefix (any case)", () => {
    expect(replySubject({ subject: "Re: Pricing question" }, null)).toBe("Re: Pricing question");
    expect(replySubject({ subject: "RE: Pricing" }, null)).toBe("RE: Pricing");
  });

  it("reads the nested data.subject variants", () => {
    expect(replySubject({ data: { subject: "From data" } }, null)).toBe("Re: From data");
    expect(replySubject({ data: { email_subject: "From data 2" } }, null)).toBe("Re: From data 2");
  });

  it("strips CR/LF (mailto header injection, RFC 6068) before use", () => {
    const s = replySubject({ subject: "Hi\r\nBcc: attacker@evil.com" }, null);
    expect(s).toBe("Re: Hi Bcc: attacker@evil.com");
    expect(s).not.toMatch(/[\r\n]/);
  });

  it("caps runaway subjects so the mailto URL isn't silently dropped", () => {
    const s = replySubject({ subject: "x".repeat(5000) }, null);
    expect(s.length).toBeLessThanOrEqual(204); // "Re: " + 200-char cap
  });

  it("falls back to the campaign name, then a generic subject", () => {
    expect(replySubject({}, "Q3 Outreach")).toBe("Re: Q3 Outreach");
    expect(replySubject(null, null)).toBe("Re: your email");
    // whitespace-only subject is not a subject
    expect(replySubject({ subject: "   " }, "Q3 Outreach")).toBe("Re: Q3 Outreach");
  });
});
