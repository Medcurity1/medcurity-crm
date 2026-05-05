/**
 * Builds a PostgREST `or()` clause for searching person-like records
 * (leads, contacts) across multiple fields, with multi-word handling.
 *
 * Single-word queries are matched as substrings against each field
 * (current behavior). Multi-word queries ALSO match when the first
 * token appears in `first_name` and the last token appears in
 * `last_name` (and vice versa) — so "Mari Harris" finds the contact
 * whose first_name="Mari" and last_name="Harris" instead of looking
 * for the literal string "Mari Harris" in any single field. Without
 * this, typing a person's full name returned zero results unless the
 * exact concatenation happened to live in one column.
 *
 * Escapes `(`, `)`, `,`, `%` so user input can't break PostgREST's
 * `or()` parser or smuggle wildcards.
 *
 * @param query  raw search input from the user (untrimmed is fine)
 * @param fields field names to substring-match against. If both
 *               `first_name` and `last_name` are included, the
 *               multi-word permutation clauses are added.
 * @returns the or-clause string ready to pass to `query.or(...)`, or
 *          null if the query has no meaningful characters (caller
 *          should skip the filter entirely in that case).
 */
export function buildPersonSearchClause(
  query: string,
  fields: string[],
): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const escape = (s: string) => s.replace(/[(),%]/g, " ").trim();
  const fullSafe = escape(trimmed);
  if (!fullSafe) return null;

  const clauses: string[] = fields.map((f) => `${f}.ilike.%${fullSafe}%`);

  const tokens = trimmed.split(/\s+/).map(escape).filter(Boolean);
  const hasFirst = fields.includes("first_name");
  const hasLast = fields.includes("last_name");
  if (tokens.length >= 2 && hasFirst && hasLast) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    // Order doesn't matter — we cover both first/last and last/first
    // so "Harris Mari" and "Mari Harris" both work.
    clauses.push(`and(first_name.ilike.%${first}%,last_name.ilike.%${last}%)`);
    clauses.push(`and(first_name.ilike.%${last}%,last_name.ilike.%${first}%)`);
  }
  return clauses.join(",");
}
