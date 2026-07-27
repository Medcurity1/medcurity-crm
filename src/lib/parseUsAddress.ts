/**
 * Parse a pasted full US address into its parts (Summer's request, 2026-07-27:
 * "paste once and the system knows and fills it out for me").
 *
 * Handles the shapes people actually copy out of emails / Google / websites:
 *   "123 Main St, Spokane, WA 99201"
 *   "123 Main St Suite 4, Spokane, WA 99201-1234"
 *   "123 Main St\nSpokane, WA 99201"          (multiline)
 *   "123 Main St, Spokane, Washington 99201"  (full state name)
 *   "123 Main St, Spokane, WA 99201, USA"     (trailing country)
 *
 * Returns null unless the parse is CONFIDENT (a real state + zip at the end,
 * with something left over for the street), so a normal one-line street paste
 * is never mangled. State normalizes to the 2-letter code and country to
 * "United States" — the formats the CRM data already uses.
 */

const STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC",
};

const STATE_CODES = new Set(Object.values(STATE_BY_NAME));

const COUNTRY_TOKENS = new Set([
  "usa", "us", "u.s.", "u.s.a.", "united states", "united states of america",
]);

export interface ParsedUsAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  /** Set only when the paste carried a country token. */
  country?: string;
}

export function parseUsAddress(raw: string): ParsedUsAddress | null {
  if (!raw) return null;
  // Normalize newlines to comma separators, collapse whitespace.
  const text = raw.replace(/[\r\n]+/g, ", ").replace(/\s+/g, " ").trim();
  if (text.length < 8) return null;

  // Split into comma segments and strip a trailing country token if present.
  const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
  let hasCountry = false;
  while (
    segments.length > 0 &&
    COUNTRY_TOKENS.has(segments[segments.length - 1].toLowerCase())
  ) {
    segments.pop();
    hasCountry = true;
  }
  if (segments.length < 2) return null; // a bare street — leave the paste alone

  // The tail segment(s) must end in "<state> <zip>", or "<state>, <zip>".
  // Pull the zip first.
  let tail = segments[segments.length - 1];
  let zip = "";
  const zipMatch = tail.match(/(\d{5}(?:-\d{4})?)$/);
  if (zipMatch) {
    zip = zipMatch[1];
    tail = tail.slice(0, zipMatch.index).trim().replace(/,$/, "").trim();
  } else {
    return null; // no zip at the end → not confident
  }

  // Resolve the state from what's left of the tail (2-letter code or name).
  let state = "";
  let cityFromTail = "";
  if (tail) {
    const code = tail.toUpperCase();
    if (tail.length === 2 && STATE_CODES.has(code)) {
      state = code;
    } else if (STATE_BY_NAME[tail.toLowerCase()]) {
      state = STATE_BY_NAME[tail.toLowerCase()];
    } else {
      // Tail may be "Spokane WA" (city + state, no comma between them).
      const m = tail.match(/^(.*?)[ ]([A-Za-z]{2}|[A-Za-z .]{4,})$/);
      if (m) {
        const cand = m[2].trim();
        const candCode = cand.toUpperCase();
        if (cand.length === 2 && STATE_CODES.has(candCode)) {
          state = candCode;
          cityFromTail = m[1].trim().replace(/,$/, "");
        } else if (STATE_BY_NAME[cand.toLowerCase()]) {
          state = STATE_BY_NAME[cand.toLowerCase()];
          cityFromTail = m[1].trim().replace(/,$/, "");
        }
      }
    }
  }
  if (!state) return null; // zip without a recognizable state → not confident

  // City: from the tail if it carried one, else the previous segment.
  const remaining = segments.slice(0, -1);
  let city = cityFromTail;
  if (!city) {
    if (remaining.length === 0) return null;
    city = remaining.pop()!;
  }
  // Street: everything left, rejoined (keeps "Suite 4" style segments).
  const street = remaining.join(", ").trim();
  if (!street || !city) return null;
  // A street that is purely a number, or a city containing digits, means the
  // segmentation went somewhere weird — bail rather than fill nonsense.
  if (/^\d+$/.test(street) || /\d/.test(city)) return null;

  const parsed: ParsedUsAddress = { street, city, state, zip };
  if (hasCountry) parsed.country = "United States";
  return parsed;
}
