// Client-side CSV parsing for campaign recipients (ported from Nexus).
// Hand-rolled RFC-style parser (quoted fields, escaped "", CRLF), plus a
// header auto-detection map. No external deps.

import type { Recipient } from "./api";

export type RecipientField = "email" | "first_name" | "last_name" | "company_name" | "skip";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { current.push(field.trim()); field = ""; }
      else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(field.trim()); field = "";
        if (current.some((c) => c)) rows.push(current);
        current = [];
        if (ch === "\r") i++;
      } else field += ch;
    }
  }
  current.push(field.trim());
  if (current.some((c) => c)) rows.push(current);
  return rows;
}

const HEADER_MAP: Record<string, RecipientField> = {
  email: "email", "e-mail": "email", email_address: "email", emailaddress: "email",
  first_name: "first_name", firstname: "first_name", "first name": "first_name", fname: "first_name", given_name: "first_name",
  last_name: "last_name", lastname: "last_name", "last name": "last_name", lname: "last_name", surname: "last_name", family_name: "last_name",
  company: "company_name", company_name: "company_name", companyname: "company_name", organization: "company_name", org: "company_name",
  name: "first_name",
};

export const FIELD_LABEL: Record<RecipientField, string> = {
  email: "Email",
  first_name: "First Name",
  last_name: "Last Name",
  company_name: "Company Name",
  skip: "Skip this column",
};

/** Best-guess field for a header cell. */
export function guessField(header: string): RecipientField {
  return HEADER_MAP[header.trim().toLowerCase()] ?? "skip";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Build recipients from parsed data rows + a per-column mapping. Dedups + validates. */
export function rowsToRecipients(
  dataRows: string[][],
  mapping: RecipientField[],
): { recipients: Recipient[]; skipped: number } {
  const emailCol = mapping.indexOf("email");
  if (emailCol < 0) return { recipients: [], skipped: 0 };
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const row of dataRows) {
    const email = (row[emailCol] ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) { skipped++; continue; }
    seen.add(email);
    const r: Recipient = { email };
    mapping.forEach((field, i) => {
      if (field === "skip" || field === "email") return;
      const v = (row[i] ?? "").trim();
      if (v) (r as unknown as Record<string, string>)[field] = v;
    });
    recipients.push(r);
    if (recipients.length >= 10000) break;
  }
  return { recipients, skipped };
}
