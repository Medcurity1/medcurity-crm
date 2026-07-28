// Client-side CSV parsing for campaign recipients (ported from Nexus).
// Hand-rolled RFC-style parser (quoted fields, escaped "", CRLF), plus a
// header auto-detection map. No external deps.

import type { Recipient } from "./api";

export type RecipientField = "email" | "first_name" | "last_name" | "full_name" | "company_name" | "skip";

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
      else if (ch === "\n" || ch === "\r") {
        // Row terminator. Handles LF, CRLF, and bare-CR (old-Mac) endings.
        current.push(field.trim()); field = "";
        if (current.some((c) => c)) rows.push(current);
        current = [];
        if (ch === "\r" && text[i + 1] === "\n") i++; // consume the LF of a CRLF pair
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
  name: "full_name", full_name: "full_name", fullname: "full_name", "full name": "full_name",
  contact_name: "full_name", "contact name": "full_name",
};

export const FIELD_LABEL: Record<RecipientField, string> = {
  email: "Email",
  first_name: "First Name",
  last_name: "Last Name",
  full_name: "Full Name (split into First + Last)",
  company_name: "Company Name",
  skip: "Skip this column",
};

// --- Full-name splitting -----------------------------------------------
// A single "Name" column is common in exported lists, but campaign emails
// greet with {{first_name}} — "Hi Jane Smith," reads as a mail-merge
// blunder. The split has to survive real-world names, not just
// "First Last": honorifics ("Dr. Jane Doe"), credentials the healthcare
// audience loves ("Jane Doe, MD, PhD", "John Smith Jr."), exported
// "Last, First" ordering, middle initials, and compound last names
// ("Anna Maria van der Berg" — everything from the particle on is the
// last name, which is also what lets multi-word FIRST names survive).

const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "rev",
  "hon", "capt", "captain", "sgt", "lt", "col", "maj", "gen", "fr", "sister",
]);
// Suffix tokens that are never part of a surname: generational + the
// credential soup this audience carries. "V" is deliberately absent (too
// ambiguous with an initial); "ms"/"ma" likewise (they're honorific/name-
// shaped in other positions).
const NAME_SUFFIXES = new Set([
  "jr", "sr", "ii", "iii", "iv",
  "md", "do", "phd", "dds", "dmd", "od", "dpm", "dc", "pharmd", "psyd",
  "rn", "np", "pa", "pa-c", "lpn", "dnp", "bsn", "msn", "cnm", "crna",
  "mba", "mph", "mha", "jd", "esq", "cpa",
  "chc", "chpc", "cissp", "cisa", "cipp", "facp", "facs", "faafp",
]);
// Lowercase particles that begin a compound surname.
const SURNAME_PARTICLES = new Set([
  "van", "von", "de", "del", "della", "der", "den", "da", "di", "du",
  "la", "le", "los", "st", "saint", "santa", "bin", "al", "el", "ter", "ten",
]);

const normalizeToken = (t: string) => t.toLowerCase().replace(/\./g, "").replace(/,+$/, "");

/** Split a free-form name cell into first/last. Exported for tests. */
export function splitFullName(raw: string): { first_name?: string; last_name?: string } {
  // Comma parts: strip trailing credential groups ("Jane Doe, MD, PhD" —
  // a group counts as credentials only if EVERY token in it is one), then
  // treat a surviving two-part split as exported "Last, First" ordering.
  let parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1) {
    const tokens = parts[parts.length - 1].split(/\s+/).map(normalizeToken);
    if (tokens.every((t) => NAME_SUFFIXES.has(t))) parts = parts.slice(0, -1);
    else break;
  }
  if (parts.length === 0) return {};
  const joined = parts.length === 2 ? `${parts[1]} ${parts[0]}` : parts.join(" ");

  let tokens = joined.split(/\s+/).filter(Boolean);
  let hadHonorific = false;
  while (tokens.length > 1 && HONORIFICS.has(normalizeToken(tokens[0]))) { tokens = tokens.slice(1); hadHonorific = true; }
  // Trailing credentials strip only while a first AND last name would
  // survive — "Jane Doe MD" loses the MD, but "Hana Do" keeps her surname
  // (D.O. the credential vs Do the name).
  while (tokens.length > 2 && NAME_SUFFIXES.has(normalizeToken(tokens[tokens.length - 1]))) tokens = tokens.slice(0, -1);
  // A cell that was ONLY an honorific/credential ("Dr.") isn't a name.
  if (tokens.length === 1 && (HONORIFICS.has(normalizeToken(tokens[0])) || NAME_SUFFIXES.has(normalizeToken(tokens[0])))) return {};
  if (tokens.length === 0) return {};
  // "Dr. Smith" — an honorific followed by one word is almost always a
  // surname; better an empty first name (templates fall back to "there")
  // than greeting "Hi Smith,".
  if (tokens.length === 1) return hadHonorific ? { last_name: tokens[0] } : { first_name: tokens[0] };

  // Compound surname: the particle starts the last name, everything before
  // it (however many words) is the first name.
  for (let i = 1; i < tokens.length - 1; i++) {
    if (SURNAME_PARTICLES.has(normalizeToken(tokens[i]))) {
      return { first_name: tokens.slice(0, i).join(" "), last_name: tokens.slice(i).join(" ") };
    }
  }

  // Middle initials belong to neither side of a greeting nor a surname:
  // "Mary J. Smith" → Mary / Smith.
  const middle = tokens.slice(1, -1).filter((t) => !/^[a-z]\.?$/i.test(t));
  const first = tokens[0];
  const last = [...middle, tokens[tokens.length - 1]].join(" ");
  return { first_name: first, last_name: last };
}

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
    let fullNameCell = "";
    mapping.forEach((field, i) => {
      if (field === "skip" || field === "email") return;
      const v = (row[i] ?? "").trim();
      if (!v) return;
      if (field === "full_name") fullNameCell = v;
      else (r as unknown as Record<string, string>)[field] = v;
    });
    // A Full Name column fills first/last via the split — but never over
    // explicit First/Last columns from the same file.
    if (fullNameCell) {
      const split = splitFullName(fullNameCell);
      const rec = r as unknown as Record<string, string>;
      if (split.first_name && !rec.first_name) rec.first_name = split.first_name;
      if (split.last_name && !rec.last_name) rec.last_name = split.last_name;
    }
    recipients.push(r);
    if (recipients.length >= 10000) break;
  }
  return { recipients, skipped };
}
