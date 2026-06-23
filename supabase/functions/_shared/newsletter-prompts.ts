// Newsletter prompt builders + parsers, ported VERBATIM from Nexus
// server.js (the brand voice is load-bearing — do not paraphrase the
// "Don't Sound Like AI" rules or the audience profiles).
//
// Models: draft uses a Sonnet-class model with web_search; revise uses a
// Haiku-class model. Style-guide generation uses Sonnet.

export const NEWSLETTER_DRAFT_MODEL = "claude-sonnet-4-6";
export const NEWSLETTER_REVISE_MODEL = "claude-haiku-4-5-20251001";
export const NEWSLETTER_STYLE_MODEL = "claude-sonnet-4-6";

const TITLE_FONT_FAMILY = "Arial, Helvetica, sans-serif";

export function typeLabel(type: string): string {
  return type === "report" ? "Medcurity Report" : type === "partner" ? "Medcurity Partner Exclusive" : "newsletter";
}

// Defensive em-dash strip + space-before-punctuation fix (AI tells).
export const stripEm = (s: string | null): string => (s == null ? "" : String(s).replace(/—/g, ", "));
export const fixSpacing = (s: string | null): string =>
  s == null ? "" : String(s).replace(/\s+([,;:.!?])(?!\d)/g, "$1");

export interface Chrome {
  headerHtml: string;
  footerHtml: string;
  sourceCount: number;
}

/**
 * Gap-tolerant common prefix of a vs b, in a's coordinates. A plain common
 * prefix is cut short by any per-send variable bit (a tracking <link>, a date,
 * an image cache-buster). Real newsletters keep the masthead/header static but
 * sprinkle a few of these, so we resync past short divergences (up to maxGap)
 * and only stop at the first LARGE divergence (the real body). The gap bytes
 * are taken from the reference (a), which is correct for reattaching chrome.
 */
function tolerantPrefixEnd(a: string, b: string, maxGap: number): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    let found: { ai: number; bj: number } | null = null;
    for (let g = 0; g <= maxGap; g++) {
      const w = a.slice(i + g, i + g + 40);
      if (w.length < 40) break;
      const k = b.indexOf(w, j);
      if (k >= 0 && k - j <= maxGap) { found = { ai: i + g, bj: k }; break; }
    }
    if (!found) break; // big divergence => start of the editable body
    i = found.ai; j = found.bj;
  }
  return i;
}

/**
 * Recover the immutable header/footer chrome from recent same-type sends.
 * Footer = the byte-for-byte common suffix (reliable). Header = a gap-tolerant
 * common prefix vs the 2nd-most-recent send, so the recurring masthead/logo is
 * captured even though a small variable bit upstream breaks a plain prefix.
 * Pass 2-3 recent sent HTMLs (length > 5000), newest first.
 */
export function detectChrome(htmls: string[]): Chrome | null {
  const usable = htmls.filter((h) => h && h.length > 5000);
  if (usable.length < 2) return null;
  const ref = usable[0];

  // Footer: byte-common suffix across all usable sends.
  const minLen = Math.min(...usable.map((h) => h.length));
  let s = 0;
  while (s < minLen && usable.every((h) => h.charCodeAt(h.length - 1 - s) === ref.charCodeAt(ref.length - 1 - s))) {
    s++;
  }

  // Header: gap-tolerant prefix vs the next-most-recent send.
  const headerEnd = tolerantPrefixEnd(ref, usable[1], 800);

  const rawPrefix = ref.slice(0, headerEnd);
  const rawSuffix = ref.slice(ref.length - s);

  const lastClose = rawPrefix.lastIndexOf(">");
  const headerHtml = lastClose >= 0 ? rawPrefix.slice(0, lastClose + 1) : "";
  const firstOpen = rawSuffix.indexOf("<");
  const footerHtml = firstOpen >= 0 ? rawSuffix.slice(firstOpen) : "";

  if (headerHtml.length < 3000 || footerHtml.length < 500) return null;
  return { headerHtml, footerHtml, sourceCount: usable.length };
}

function audienceProfile(type: string): string {
  return type === "report"
    ? 'AUDIENCE: existing Medcurity customers, primarily small to mid-size healthcare practices (1 to 200 FTEs). They subscribe because Medcurity helps them stay compliant without it eating their day.\n' +
        'TONE: upbeat, helpful, practical, warm-but-confident. Think "trusted teammate sending the monthly note." Compliance should feel manageable, not scary.\n' +
        'FOCUS: practical compliance topics, "how to do X well," product/feature updates, useful enforcement context framed as learning (not fear-mongering), webinar/event invitations, occasional team or customer spotlight.\n' +
        'AVOID: heavy breach stories used as scare tactics, doom-and-gloom intros, fear-based CTAs. Breach roundups belong in the Partner Exclusive. The Medcurity Report should make our customers feel supported and a little more confident than when they opened the email.'
    : 'AUDIENCE: Medcurity partners, channel referrers, MSPs, consultants, and other professionals who recommend Medcurity to their own healthcare clients. They are NOT end customers; they are referral and recommendation sources.\n' +
        'TONE: industry-savvy, candid, peer-to-peer B2B. Treat the reader as a sophisticated business contact who understands risk and business cases.\n' +
        'FOCUS: breach stories and enforcement actions framed as "this is what your clients are facing," healthcare cybersecurity trends, the business case for why partners should keep recommending Medcurity, partner enablement, what is working in the channel.\n' +
        'AVOID: customer-facing how-to content that belongs in the Medcurity Report. Avoid talking down to partners; they already know the basics.';
}

const HUMAN_VOICE_RULES =
  '== HUMAN VOICE RULES (from Medcurity\'s "Don\'t Sound Like AI" guide) ==\n' +
  'Write like a confident, plain-spoken Medcurity teammate. The most important thing: do not sound like an AI assistant. The reader can tell, and AI-sounding emails get ignored.\n\n' +
  'NEVER use these AI-tell words or phrases:\n' +
  '  delve, delve into, landscape (as in "the X landscape"), navigate (as a verb beyond physical navigation), navigate the complexities, leverage, harness, robust, comprehensive, seamless, meticulous, straightforward, pivotal, crucial, vital, essential, tapestry, intricate, interplay, garner, underscore, emphasize (when "stress" or "point out" works), furthermore, moreover, utilize (always "use"), game-changing, cutting-edge, revolutionary, innovative, optimize/optimization, synergy, synergize, ecosystem, foster, bolster, showcasing, highlighting (as filler).\n\n' +
  'NEVER use these filler phrases:\n' +
  '  "It\'s worth noting that...", "When it comes to...", "It\'s important to remember that...", "In an effort to..." (use "to"), "In order to..." (use "to"), "In today\'s fast-paced world...", "With that being said...", "At the end of the day...", "In the realm of...", "Now more than ever...", "Imagine if...", "Let\'s dive in", "Let\'s explore", "Here\'s the thing".\n\n' +
  'NEVER use the negation-pivot pattern:\n' +
  '  BAD: "It\'s not just X, it\'s Y." / "This isn\'t merely X, it\'s Y." / "It\'s not about X, it\'s about Y."\n' +
  '  GOOD: just state what it IS, directly. "Send emails people actually want to read."\n\n' +
  'HEDGING: AI hedges constantly. Be specific and confident instead.\n' +
  '  BAD: "Could potentially help your team improve workflow efficiency."\n' +
  '  GOOD: "Will cut your team\'s admin time by about 30%."\n\n' +
  'TONE: be matter-of-fact. Avoid relentless positivity. Nobody is "thrilled" about compliance software. They might be "relieved it works." When everything is "incredible," nothing is. "This works" is more convincing than "This is absolutely revolutionary."\n\n' +
  'STRUCTURE: vary paragraph lengths intentionally. One short, then medium, then back to short. Do not make every paragraph the same length. Do not default to intro, three bullet points, conclusion. If you must use bullets, use two or four — not three. Often a natural paragraph beats bullets.\n\n' +
  'CLOSING LINES to AVOID at the end of any section or the whole newsletter:\n' +
  '  "Let me know if you have any questions!", "I\'d love to...", "I\'d be happy to...", "Hope that helps!", "Looking forward to hearing from you!", "Don\'t hesitate to reach out!", "Warm regards / Kind regards" (use "Thanks" or just the company name).\n\n' +
  'SETUP LINES: a single setup line at the start of a section is fine when it is specific and earns its place. Generic openers ("When it comes to", "In today\'s world") are not. Lead with the specific fact when you can.\n\n' +
  'EM DASHES: never. Use a period or a comma.\n' +
  'SEMICOLONS: avoid in body copy. A period works.\n\n';

export interface DraftPromptInput {
  type: "report" | "partner";
  styleGuide: string;
  trainingBlock: string;
  recentList: string;
  userInput: string;
  sendDateLong: string;
  sendDateIso: string;
  monthYear: string;
  chrome: Chrome | null;
  bodyReferencesBlock: string;
}

/** Returns { prompt, useSplit }. useSplit means chrome will be reattached. */
export function buildDraftPrompt(input: DraftPromptInput): { prompt: string; useSplit: boolean } {
  const label = typeLabel(input.type);
  const useSplit = !!input.chrome;

  const userPromptBase =
    'You are drafting Medcurity\'s next "' + label + '" newsletter. Scheduled send date: ' + input.sendDateLong +
    " (" + input.sendDateIso + "). Use this date wherever a date appears in the newsletter, NOT today's date.\n\n" +
    "== AUDIENCE AND TONE FOR THIS NEWSLETTER TYPE ==\n" + audienceProfile(input.type) + "\n\n" +
    "== STYLE GUIDE for " + label + " ==\n" + input.styleGuide + "\n\n" +
    "== TRAINING NOTES (apply these to topic selection and tone choices) ==\n" + input.trainingBlock + "\n\n" +
    "== RECENT NEWSLETTERS OF THIS TYPE (avoid repeating topics already covered) ==\n" + (input.recentList || "(none on file)") + "\n\n" +
    "== USER NOTES / TOPICS / EVENTS / LINKS / GRAPHICS for this edition ==\n" +
    (input.userInput || "(none provided; build a strong general edition appropriate for the cadence)") + "\n\n";

  const promptForSplit = userPromptBase +
    "== HOW THE FINAL EMAIL WILL BE ASSEMBLED ==\n" +
    "The header (logo, top chrome) and footer (share buttons, unsubscribe, address, copyright) are FIXED and will be reattached by the server. You only write the BODY content that goes between them.\n\n" +
    "== BODY STYLING REFERENCES (multiple recent sends — DRAW VARIETY FROM ACROSS THEM) ==\n" +
    "Below are the real body sections from several recent issues. They show the FULL range of visual treatments. Study all of them and VARY your section treatments. Do NOT repeat the same pattern (e.g., red accent bar with caps label) for every section. Mix across these patterns drawn from the references:\n" +
    "  - colored accent bar to the left of a label + serif title (use ONCE or twice at most)\n" +
    "  - full background-color callout boxes with white or light text\n" +
    "  - centered headlines without an accent bar\n" +
    "  - pull-quote boxes with italic text and a contrasting background\n" +
    "  - numbered or bulleted list cards\n" +
    "  - styled CTA button rows (background-color buttons with white text)\n" +
    "  - thin horizontal divider lines between sections\n" +
    "  - event/webinar callout cards with a bordered or shaded background\n" +
    "Each major section should look DIFFERENT from the section before it. Variety is required.\n\n" + input.bodyReferencesBlock + "\n\n" +
    HUMAN_VOICE_RULES +
    "== RULES ==\n" +
    "1. Write ONLY the body content sections that go between header and footer. Do NOT include <html>, <head>, <body>, the header table, or the footer table.\n" +
    "2. Body paragraphs MUST use regular font weight (font-weight: normal or 400). Use bold ONLY for inline emphasis on specific short phrases. Do NOT wrap large blocks or whole paragraphs in <strong> or <b>.\n" +
    "3. Dividers: between major content sections, include a real visual divider matching the references (a styled <table> row, an <hr>, or a thin bar). The divider MUST have at least 32px of vertical space ABOVE it and 32px BELOW it. Use margin/padding on the divider itself or the surrounding <td>/<tr>. NEVER let a button, callout box, or paragraph touch a divider with less than 32px between them.\n" +
    "4. VARY section header styles across the draft. Do NOT use the colored accent bar pattern for every section. Mix patterns as listed above. The accent bar pattern should appear at most twice in the whole body.\n" +
    "5. TITLE FONT: every heading and large title (<h1>, <h2>, styled section titles) MUST use font-family: " + TITLE_FONT_FAMILY + " in its inline style. Arial is Medcurity's standard title font. Do NOT substitute Playfair, Georgia, Bookman, Sentinel, or any serif font, even if past templates contain them (those were errors).\n" +
    "6. The SEND DATE (" + input.sendDateLong + ") must appear near the top of the body, CENTERED, in a prominent style matching how the date appears in the references.\n" +
    "7. CTAs: real styled buttons like in the references (background color, padding, white text, border-radius), not plain underlined links.\n" +
    '8. Wrap your output in a single outer <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="..."> matching the 600px wrapper width in the references.\n' +
    "9. DO NOT invent or insert new images. The only images allowed are explicit graphics the user said they will add (see rule 11).\n" +
    "10. DO NOT add decorative stock photos.\n" +
    "11. For a graphic the user will add later, drop a placeholder DIV (not an <img>):\n" +
    '    <div style="background:#f0f4ff;border:2px dashed #6b8acc;color:#3a5a99;padding:60px 20px;text-align:center;font-size:14px;border-radius:8px;margin:16px 0;font-family:Arial,sans-serif;">[GRAPHIC: describe what goes here]</div>\n' +
    "12. Honor the user notes. Incorporate events, webinars, or news mentioned.\n" +
    "13. For news stories, use web_search for current credible sources. Never invent breaches, statistics, dates, or sources. If web_search is unavailable, only use news the user provided in their notes.\n" +
    "14. Do NOT repeat topics in the recent newsletters list unless it is an obvious follow-up.\n" +
    "15. Use " + input.sendDateLong + " (or " + input.monthYear + ") as the date reference, not today.\n" +
    "16. No em dashes anywhere.\n" +
    "17. PUNCTUATION: never put a space before a comma, period, semicolon, colon, exclamation, or question mark. Punctuation hugs the word that comes before it.\n" +
    "18. The [PREVIEW] line must be a real complete sentence between 50 and 110 characters that complements (does not repeat) the subject. A single word or stub like \"Why\" is invalid.\n" +
    "19. DO NOT add a podcast section, a \"recent episodes\" / \"latest from the podcast\" block, or any recurring section the user did not ask for. The Medcurity podcast is on hiatus. Never reference it or invent episode titles, guests, dates, or links. Only include sections backed by the references, the user notes, or real web_search results. Never invent a section just to fill space.\n" +
    "20. End with exactly these three sections in this order and nothing else after:\n\n" +
    "[SUBJECT]\nyour suggested subject line\n\n" +
    "[PREVIEW]\na short preview text (50 to 110 characters) shown in the inbox preview pane\n\n" +
    "[BODY]\nthe body content HTML (header and footer NOT included)";

  const promptFromScratch = userPromptBase +
    "== STRUCTURAL TEMPLATE (none available, build from scratch using the style guide) ==\n\n" +
    HUMAN_VOICE_RULES +
    "== RULES ==\n" +
    "1. Write the COMPLETE newsletter as inline-CSS-styled HTML suitable for Mailchimp.\n" +
    "2. No invented images. Use placeholder DIVs for graphics the user will add.\n" +
    "3. Use " + input.sendDateLong + " as the date reference.\n" +
    "4. No em dashes.\n" +
    "5. DO NOT add a podcast or \"recent episodes\" section, or any section the user did not ask for. The Medcurity podcast is on hiatus; never reference it or invent episodes or links.\n" +
    "6. Titles use font-family: " + TITLE_FONT_FAMILY + ".\n" +
    "7. For news stories, use web_search for current credible sources; never invent them.\n" +
    "8. End with exactly:\n\n[SUBJECT]\nyour subject line\n\n[PREVIEW]\nshort preview text under 110 chars\n\n[HTML]\nthe full HTML";

  return { prompt: useSplit ? promptForSplit : promptFromScratch, useSplit };
}

export interface ParsedDraft {
  subject: string;
  previewText: string;
  html: string;
}

export function parseDraftResult(fullText: string, useSplit: boolean, chrome: Chrome | null): ParsedDraft {
  let subject = "";
  let previewText = "";
  let html = "";
  if (useSplit && chrome) {
    const subjMatch = fullText.match(/\[SUBJECT\]\s*([\s\S]*?)\s*\[(?:PREVIEW|BODY)\]/);
    const previewMatch = fullText.match(/\[PREVIEW\]\s*([\s\S]*?)\s*\[BODY\]/);
    const bodyMatch = fullText.match(/\[BODY\]\s*([\s\S]*)/);
    subject = subjMatch ? subjMatch[1].trim() : "";
    previewText = previewMatch ? previewMatch[1].trim() : "";
    let body = bodyMatch ? bodyMatch[1].trim() : fullText;
    body = body.replace(/^```html\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    // Clean the BODY only — the chrome is reattached byte-for-byte and must
    // stay pristine, or a later revise can't match it (chrome-split breaks
    // and revise has to regenerate the whole newsletter).
    body = fixSpacing(stripEm(body));
    const safeBody =
      '<table border="0" cellpadding="0" cellspacing="0" width="100%" align="center" style="font-weight:400;"><tr><td style="font-weight:400;font-family:Helvetica,Arial,sans-serif;color:#3a3a3a;">' +
      body + "</td></tr></table>";
    html = chrome.headerHtml + "\n" + safeBody + "\n" + chrome.footerHtml;
  } else {
    const subjMatch = fullText.match(/\[SUBJECT\]\s*([\s\S]*?)\s*\[(?:PREVIEW|HTML)\]/);
    const previewMatch = fullText.match(/\[PREVIEW\]\s*([\s\S]*?)\s*\[HTML\]/);
    const htmlMatch = fullText.match(/\[HTML\]\s*([\s\S]*)/);
    subject = subjMatch ? subjMatch[1].trim() : "";
    previewText = previewMatch ? previewMatch[1].trim() : "";
    html = htmlMatch ? htmlMatch[1].trim() : fullText;
    html = html.replace(/^```html\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    // No chrome here, so cleaning the whole thing is safe.
    html = fixSpacing(stripEm(html));
  }

  subject = fixSpacing(stripEm(subject));
  previewText = fixSpacing(stripEm(previewText));

  // Derive a preview from the body if the AI returned a stub.
  if (!previewText || previewText.length < 25 || /^\s*\S+\s*$/.test(previewText)) {
    const plain = (html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    const sentences = plain.split(/(?<=[.!?])\s+/);
    const candidate = sentences.find((s) => s.length >= 30 && s.length <= 130);
    if (candidate) previewText = candidate.replace(/\s+([,;:.!?])/g, "$1").slice(0, 110).trim();
  }
  return { subject, previewText, html };
}

export interface RevisePromptInput {
  type: string;
  styleGuide: string;
  subject: string;
  previewText: string;
  htmlContent: string;
  instruction: string;
  chrome: Chrome | null;
}

/** Returns { prompt, useChromeSplit, bodyOnly }. */
export function buildRevisePrompt(input: RevisePromptInput): { prompt: string; useChromeSplit: boolean; bodyOnly: string } {
  const label = typeLabel(input.type);
  let useChromeSplit = false;
  let bodyOnly = "";
  const c = input.chrome;
  if (c && input.htmlContent && input.htmlContent.startsWith(c.headerHtml) && input.htmlContent.endsWith(c.footerHtml)) {
    useChromeSplit = true;
    bodyOnly = input.htmlContent.slice(c.headerHtml.length, input.htmlContent.length - c.footerHtml.length);
  }

  const promptSplit =
    'You are revising the BODY content of a "' + label + '" newsletter draft. The header and footer (logo, share buttons, unsubscribe, social icons, address, copyright) are immutable and will be reattached automatically by the server. You ONLY edit the body portion shown below.\n\n' +
    "== STYLE GUIDE ==\n" + input.styleGuide + "\n\n" +
    "== CURRENT SUBJECT ==\n" + (input.subject || "") + "\n\n" +
    "== CURRENT PREVIEW TEXT ==\n" + (input.previewText || "") + "\n\n" +
    "== CURRENT BODY HTML (only this is editable) ==\n" + bodyOnly + "\n\n" +
    "== USER INSTRUCTION ==\n" + input.instruction + "\n\n" +
    "== RULES ==\n" +
    "1. Apply ONLY the requested change. Leave everything else byte-for-byte identical.\n" +
    "2. Honor the style guide.\n" +
    "3. Do not invent new images. Keep existing image URLs unchanged.\n" +
    "4. No em dashes anywhere.\n" +
    "5. End with exactly these three sections in this order and nothing else after:\n\n" +
    "[SUBJECT]\nthe (possibly updated) subject line\n\n" +
    "[PREVIEW]\nthe (possibly updated) preview text (under 110 chars)\n\n" +
    "[BODY]\nthe full body HTML with the change applied";

  const promptFull =
    'You are revising the current "' + label + '" newsletter draft based on a single user instruction.\n\n' +
    "== STYLE GUIDE ==\n" + input.styleGuide + "\n\n" +
    "== CURRENT SUBJECT ==\n" + (input.subject || "") + "\n\n" +
    "== CURRENT PREVIEW TEXT ==\n" + (input.previewText || "") + "\n\n" +
    "== CURRENT HTML ==\n" + (input.htmlContent || "") + "\n\n" +
    "== USER INSTRUCTION ==\n" + input.instruction + "\n\n" +
    "== RULES ==\n" +
    "1. Apply ONLY the requested change. Leave everything else byte-for-byte identical.\n" +
    "2. Keep header, footer, branding, layout, and inline styling intact unless the instruction directly addresses them.\n" +
    "3. Honor the style guide.\n" +
    "4. Do not invent new images. Keep existing image URLs unchanged.\n" +
    "5. No em dashes anywhere.\n" +
    "6. End with exactly these three sections in this order and nothing else after:\n\n" +
    "[SUBJECT]\nthe (possibly updated) subject line\n\n" +
    "[PREVIEW]\nthe (possibly updated) preview text (under 110 chars)\n\n" +
    "[HTML]\nthe full inline-CSS HTML newsletter with the change applied";

  return { prompt: useChromeSplit ? promptSplit : promptFull, useChromeSplit, bodyOnly };
}

export function parseReviseResult(
  fullText: string,
  useChromeSplit: boolean,
  chrome: Chrome | null,
  fallback: { subject: string; previewText: string; html: string; bodyOnly: string },
): ParsedDraft {
  let subject = fallback.subject || "";
  let previewText = fallback.previewText || "";
  let html = fallback.html || "";
  if (useChromeSplit && chrome) {
    const subjMatch = fullText.match(/\[SUBJECT\]\s*([\s\S]*?)\s*\[(?:PREVIEW|BODY)\]/);
    const previewMatch = fullText.match(/\[PREVIEW\]\s*([\s\S]*?)\s*\[BODY\]/);
    const bodyMatch = fullText.match(/\[BODY\]\s*([\s\S]*)/);
    subject = subjMatch ? subjMatch[1].trim() : subject;
    previewText = previewMatch ? previewMatch[1].trim() : previewText;
    let newBody = bodyMatch ? bodyMatch[1].trim() : fallback.bodyOnly;
    newBody = newBody.replace(/^```html\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    // Clean the BODY only; keep the reattached chrome pristine so the next
    // revise can still chrome-match it. Same pipeline as parseDraftResult
    // (stripEm THEN fixSpacing) so revised issues read identically to drafts.
    newBody = fixSpacing(stripEm(newBody));
    html = chrome.headerHtml + "\n" + newBody + "\n" + chrome.footerHtml;
  } else {
    const subjMatch = fullText.match(/\[SUBJECT\]\s*([\s\S]*?)\s*\[(?:PREVIEW|HTML)\]/);
    const previewMatch = fullText.match(/\[PREVIEW\]\s*([\s\S]*?)\s*\[HTML\]/);
    const htmlMatch = fullText.match(/\[HTML\]\s*([\s\S]*)/);
    subject = subjMatch ? subjMatch[1].trim() : subject;
    previewText = previewMatch ? previewMatch[1].trim() : previewText;
    html = htmlMatch ? htmlMatch[1].trim() : html;
    html = html.replace(/^```html\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    html = fixSpacing(stripEm(html));
  }
  subject = fixSpacing(stripEm(subject));
  previewText = fixSpacing(stripEm(previewText));
  return { subject, previewText, html };
}

/** Style-guide generation prompt from N recent sent issues of a type. */
export function buildStylePrompt(type: "report" | "partner", samples: Array<{ subject: string; plain: string }>): string {
  const label = typeLabel(type);
  const sampleBlock = samples
    .map((s, i) => "--- ISSUE " + (i + 1) + ": " + (s.subject || "(no subject)") + " ---\n" + s.plain.slice(0, 4000))
    .join("\n\n");
  return (
    'You are distilling a reusable STYLE GUIDE for Medcurity\'s "' + label + '" newsletter from its real past issues.\n\n' +
    "== AUDIENCE AND TONE ==\n" + audienceProfile(type) + "\n\n" +
    "== PAST ISSUES (plain text excerpts) ==\n" + (sampleBlock || "(none)") + "\n\n" +
    "Write a concise markdown style guide (300-600 words) covering: voice and tone, sentence and paragraph rhythm, how sections are structured, how CTAs are phrased, typography conventions, recurring section types, and topic boundaries (what belongs here vs the other newsletter). Be specific and prescriptive so another writer could match the voice. Do not invent conventions not evident in the samples. No em dashes. Output ONLY the markdown style guide, nothing else."
  );
}
