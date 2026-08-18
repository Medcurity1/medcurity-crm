import { describe, expect, it } from "vitest";
import { normalizeReplyText as normalizeClient } from "../src/features/playbook/reply-text";
import { normalizeReplyText as normalizeServer } from "../supabase/functions/_shared/reply-text";

const normalizeBoth = (input: string | null) => [normalizeClient(input), normalizeServer(input)];

describe("campaign reply text normalization", () => {
  it("keeps only the new Outlook reply", () => {
    const raw = `<!doctype html><html><head><style>.x{color:red}</style></head><body>
      <div>QA stop test &amp; please call me.</div>
      <div class="ms-outlook-signature"><b>Nathan Gellatly</b><img src="cid:photo"></div>
      <div id="divRplyFwdMsg">From: Summer Hume</div><blockquote>Original campaign</blockquote>
    </body></html>`;
    expect(normalizeBoth(raw)).toEqual([
      "QA stop test & please call me.",
      "QA stop test & please call me.",
    ]);
  });

  it("removes Gmail quoted history and tracking images", () => {
    const raw = `<div>Interested.<br>Can we talk Friday?</div>
      <img alt="line" src="https://open.sleadtrack.com/image.png">
      <div class="gmail_quote">On Tue, Summer wrote:<blockquote>Old copy</blockquote></div>`;
    expect(normalizeBoth(raw)).toEqual([
      "Interested.\nCan we talk Friday?",
      "Interested.\nCan we talk Friday?",
    ]);
  });

  it("cuts a plain-text forwarded thread", () => {
    const raw = "No thanks.\r\n\r\n-----Original Message-----\r\nFrom: Summer Hume\r\nOld copy";
    expect(normalizeBoth(raw)).toEqual(["No thanks.", "No thanks."]);
  });

  it("preserves ordinary text and returns null for empty markup", () => {
    expect(normalizeBoth("  A normal reply  ")).toEqual(["A normal reply", "A normal reply"]);
    expect(normalizeBoth("<html><head><style>x</style></head><body><img src='x'></body></html>"))
      .toEqual([null, null]);
  });

  it("caps exceptionally long replies", () => {
    const long = `<p>${"a".repeat(200)}</p>`;
    expect(normalizeClient(long, 80)).toBe(`${"a".repeat(79)}…`);
    expect(normalizeServer(long, 80)).toBe(`${"a".repeat(79)}…`);
  });

  it("does not crash on invalid numeric entities", () => {
    const raw = "Still interested &#999999999; &#xD800; &#0;";
    expect(normalizeBoth(raw)).toEqual([raw, raw]);
  });

  it("keeps encoded markup as text for output layers to escape", () => {
    const raw = "Please review &lt;img src=x onerror=alert(1)&gt;";
    expect(normalizeBoth(raw)).toEqual([
      "Please review <img src=x onerror=alert(1)>",
      "Please review <img src=x onerror=alert(1)>",
    ]);
  });
});
