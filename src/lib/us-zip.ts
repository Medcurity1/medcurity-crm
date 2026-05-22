// ---------------------------------------------------------------
// US ZIP code → state, time zone, and country lookup
// ---------------------------------------------------------------
// Small lookup table that handles the 99% case for autofilling the
// address-related fields. We don't try to be perfect about every
// edge-case prefix (some states straddle two time zones); the goal
// is to save the rep typing and let them correct it if needed.
//
// Sources: USPS 3-digit ZIP code prefixes; IANA time-zone mapping.
// ---------------------------------------------------------------

import type { UsTimeZone } from "@/types/crm";

/**
 * Map a US ZIP3 (first three digits) to a state code. Compact tables
 * keep this readable; misses fall through to `null`.
 */
const ZIP3_TO_STATE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const ranges: Array<[number, number, string]> = [
    // Northeast
    [10, 27, "MA"],
    [28, 29, "RI"],
    [30, 38, "NH"],
    [39, 39, "ME"], // (small overlap with NH 03801; close enough)
    [40, 49, "ME"],
    [50, 59, "VT"],
    [60, 69, "CT"],
    [70, 89, "NJ"],
    [100, 149, "NY"],
    [150, 196, "PA"],
    [197, 199, "DE"],
    [200, 205, "DC"],
    [206, 219, "MD"],
    [220, 246, "VA"],
    [247, 268, "WV"],
    [270, 289, "NC"],
    [290, 299, "SC"],
    [300, 319, "GA"],
    [320, 339, "FL"],
    [341, 342, "FL"],
    [344, 349, "FL"],
    [350, 369, "AL"],
    [370, 385, "TN"],
    [386, 397, "MS"],
    [398, 399, "GA"],
    [400, 427, "KY"],
    [430, 458, "OH"],
    [459, 459, "OH"],
    [460, 479, "IN"],
    [480, 499, "MI"],
    [500, 528, "IA"],
    [530, 549, "WI"],
    [550, 567, "MN"],
    [570, 577, "SD"],
    [580, 588, "ND"],
    [590, 599, "MT"],
    [600, 629, "IL"],
    [630, 658, "MO"],
    [660, 679, "KS"],
    [680, 693, "NE"],
    [700, 714, "LA"],
    [716, 729, "AR"],
    [730, 749, "OK"],
    [750, 799, "TX"],
    [800, 816, "CO"],
    [820, 831, "WY"],
    [832, 838, "ID"],
    [840, 847, "UT"],
    [850, 865, "AZ"],
    [870, 884, "NM"],
    [889, 898, "NV"],
    [900, 961, "CA"],
    [967, 968, "HI"],
    [970, 979, "OR"],
    [980, 994, "WA"],
    [995, 999, "AK"],
  ];
  for (const [lo, hi, state] of ranges) {
    for (let i = lo; i <= hi; i++) {
      map[String(i).padStart(3, "0")] = state;
    }
  }
  return map;
})();

const STATE_TO_TIMEZONE: Record<string, UsTimeZone> = {
  // Eastern
  CT: "eastern", DE: "eastern", DC: "eastern", FL: "eastern", GA: "eastern",
  ME: "eastern", MD: "eastern", MA: "eastern", NH: "eastern", NJ: "eastern",
  NY: "eastern", NC: "eastern", OH: "eastern", PA: "eastern", RI: "eastern",
  SC: "eastern", VT: "eastern", VA: "eastern", WV: "eastern", MI: "eastern",
  IN: "eastern", KY: "eastern",
  // Central
  AL: "central", AR: "central", IL: "central", IA: "central", KS: "central",
  LA: "central", MN: "central", MS: "central", MO: "central", NE: "central",
  ND: "central", OK: "central", SD: "central", TN: "central", TX: "central",
  WI: "central",
  // Mountain
  CO: "mountain", ID: "mountain", MT: "mountain", NM: "mountain", UT: "mountain",
  WY: "mountain",
  // Arizona — most of the state doesn't observe DST. The Navajo
  // Nation does, but we don't have a finer-grained signal here.
  AZ: "arizona_no_dst",
  // Pacific
  CA: "pacific", NV: "pacific", OR: "pacific", WA: "pacific",
  // Alaska + Hawaii
  AK: "alaska",
  HI: "hawaii",
};

/**
 * Look up the US state code for a 5-digit ZIP. Returns null if the
 * zip isn't recognized as US (foreign postal codes, partial input,
 * etc.).
 */
export function zipToState(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const digits = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(digits)) return null;
  return ZIP3_TO_STATE[digits.slice(0, 3)] ?? null;
}

/**
 * Look up the IANA-style US time zone bucket for a 5-digit ZIP.
 * Returns null when no mapping is known (foreign / unknown zips).
 */
export function zipToTimeZone(
  zip: string | null | undefined,
): UsTimeZone | null {
  const state = zipToState(zip);
  if (!state) return null;
  return STATE_TO_TIMEZONE[state] ?? null;
}

/**
 * Detect whether a postal code looks like a US ZIP. Used to populate
 * the country field on autofill: "12345" or "12345-6789" → United
 * States; anything else we leave alone.
 */
export function looksLikeUsZip(zip: string | null | undefined): boolean {
  if (!zip) return false;
  return /^\d{5}(-\d{4})?$/.test(zip.trim());
}
