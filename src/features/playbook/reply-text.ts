/**
 * Turn a raw provider reply body into the short, readable message an operator
 * actually needs. Smartlead may send full Outlook/Gmail HTML including the
 * sender's signature, the quoted conversation, CID images, and tracking
 * pixels. React safely escapes that value, but displaying the escaped markup
 * is still unusable.
 *
 * Keep this file in sync with
 * supabase/functions/_shared/reply-text.ts. The browser and Edge Function
 * cannot share a program root, so tests exercise both twins with the same
 * fixtures.
 */

const DEFAULT_MAX_LENGTH = 1600;
const MAX_INPUT_SCAN_LENGTH = 32_000;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  const decodeCodePoint = (code: number, fallback: string): string =>
    Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : fallback;
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return decodeCodePoint(code, full);
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return decodeCodePoint(code, full);
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function earliestIndex(value: string, patterns: RegExp[]): number {
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match && (earliest < 0 || match.index < earliest)) earliest = match.index;
  }
  return earliest;
}

/** Readable, new-message-only reply text. Null means no useful body. */
export function normalizeReplyText(
  input: string | null | undefined,
  maxLength = DEFAULT_MAX_LENGTH,
): string | null {
  if (!input?.trim()) return null;

  // Webhook bodies are attacker-controlled. Clamp before any HTML/quote
  // regex work so a very large crafted reply cannot monopolize the Edge
  // Function CPU budget. The final user-facing value is capped much lower.
  let value = input.slice(0, MAX_INPUT_SCAN_LENGTH).replace(/\r\n?/g, "\n").trim();

  // Cut provider-specific quoted-thread/signature blocks before stripping
  // tags. These markers are much more reliable while attributes still exist.
  const htmlCut = earliestIndex(value, [
    /<blockquote\b/i,
    /<div\b[^>]*(?:id|class)=["'][^"']*(?:gmail_quote|yahoo_quoted|divRplyFwdMsg|ms-outlook-signature|signature)[^"']*["'][^>]*>/i,
    /<table\b[^>]*(?:id|class)=["'][^"']*(?:signature|msoSignature)[^"']*["'][^>]*>/i,
  ]);
  if (htmlCut >= 0) value = value.slice(0, htmlCut);

  value = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");

  value = decodeHtmlEntities(value)
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Plain-text clients quote threads without helpful HTML wrappers.
  const textCut = earliestIndex(value, [
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^From:\s+.+$/im,
    /^On\s+.+\s+wrote:\s*$/im,
    /^_{5,}$/m,
    /^--\s*$/m,
  ]);
  if (textCut > 0) value = value.slice(0, textCut).trim();

  if (!value) return null;
  const safeLimit = Math.max(80, maxLength);
  return value.length > safeLimit
    ? `${value.slice(0, safeLimit - 1).trimEnd()}…`
    : value;
}
