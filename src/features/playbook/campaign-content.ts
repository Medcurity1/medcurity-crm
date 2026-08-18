/**
 * Salesperson-facing campaign copy helpers.
 *
 * The editor deliberately shows friendly [[First name]]-style chips. The
 * provider syntax is generated here, at the boundary, so an operator never
 * has to learn Handlebars/Liquid or HTML to write a safe email.
 */

export const AUTHOR_TOKENS = {
  firstName: "[[First name]]",
  organization: "[[Organization]]",
  signature: "[[Signature]]",
  workPhone: "[[Work phone]]",
} as const;

const FIRST_NAME_LIQUID = "{{#if first_name}}{{first_name}}{{else}}there{{/if}}";
const COMPANY_LIQUID = "{{#if company_name}}{{company_name}}{{else}}your organization{{/if}}";

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'");
}

const SAFE_AUTHORING_TAGS = new Set(["p", "br", "a", "strong", "b", "em", "i"]);

export function hasUnsupportedRichEmailHtml(template: string): boolean {
  const tags = (template ?? "").matchAll(/<\/?\s*([a-z0-9-]+)\b[^>]*>/gi);
  for (const match of tags) {
    const tag = match[1].toLowerCase();
    const full = match[0];
    if (!SAFE_AUTHORING_TAGS.has(tag)) return true;
    if (tag === "a") {
      if (!/^<\/a\s*>$/i.test(full) && !/^<a\s+href=(["'])[^"']+\1\s*>$/i.test(full)) return true;
    } else if (!new RegExp(`^<\\/?${tag}\\s*\\/?>$`, "i").test(full)) {
      return true;
    }
  }
  return false;
}

export function templateToAuthorText(template: string): string {
  return decodeBasicEntities(template ?? "")
    .replace(/\{\{#if\s+first_name\}\}\s*\{\{\s*first_name\s*\}\}\s*\{\{else\}\}\s*there\s*\{\{\/if\}\}/gi, AUTHOR_TOKENS.firstName)
    .replace(/\{\{#if\s+company_name\}\}\s*\{\{\s*company_name\s*\}\}\s*\{\{else\}\}\s*your organization\s*\{\{\/if\}\}/gi, AUTHOR_TOKENS.organization)
    .replace(/\{\{\s*first_name\s*\}\}/gi, AUTHOR_TOKENS.firstName)
    .replace(/\{\{\s*(?:company|company_name)\s*\}\}/gi, AUTHOR_TOKENS.organization)
    .replace(/\{\{\s*sender_name\s*\}\}|%signature%/gi, AUTHOR_TOKENS.signature)
    .replace(/\{\{\s*phone\s*\}\}/gi, AUTHOR_TOKENS.workPhone)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `[${String(label).replace(/<[^>]+>/g, "")} ](${href})`.replace(" ]", "]"))
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authorInlineToHtml(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function authorTextToTemplateHtml(text: string): string {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${authorInlineToHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Convert friendly/legacy placeholders to safe Smartlead provider syntax. */
export function protectCampaignPersonalization(template: string): string {
  const blocks: string[] = [];
  return (template ?? "")
    .replace(/\{\{#if\s+(?:first_name|company_name|company)\}\}[\s\S]*?\{\{\/if\}\}/gi, (block) => {
      const sentinel = `__PULSE_LIQUID_BLOCK_${blocks.length}__`;
      blocks.push(block);
      return sentinel;
    })
    .replace(/\[\[\s*First name\s*\]\]/gi, FIRST_NAME_LIQUID)
    .replace(/\[\[\s*Organization\s*\]\]/gi, COMPANY_LIQUID)
    .replace(/\[\[\s*Signature\s*\]\]/gi, "%signature%")
    .replace(/\{\{\s*company\s*\}\}/gi, "{{company_name}}")
    .replace(/\{\{\s*sender_name\s*\}\}/gi, "%signature%")
    .replace(/\{\{\s*first_name\s*\}\}/gi, FIRST_NAME_LIQUID)
    .replace(/\{\{\s*company_name\s*\}\}/gi, COMPANY_LIQUID)
    .replace(/__PULSE_LIQUID_BLOCK_(\d+)__/g, (_match, index) => blocks[Number(index)] ?? "");
}

export function insertAuthorToken(current: string, token: string): string {
  if (!current) return token;
  return `${current}${/\s$/.test(current) ? "" : " "}${token}`;
}

export function campaignPreviewHtml(
  template: string,
  sample: { firstName?: string; organization?: string } = {},
): string {
  const preview = templateToAuthorText(template)
    .replaceAll(AUTHOR_TOKENS.firstName, sample.firstName?.trim() || "there")
    .replaceAll(AUTHOR_TOKENS.organization, sample.organization?.trim() || "your organization")
    .replaceAll(AUTHOR_TOKENS.signature, "Sender's saved signature appears here");
  return authorTextToTemplateHtml(preview);
}
