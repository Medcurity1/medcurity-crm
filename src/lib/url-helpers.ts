/**
 * Normalize a user-entered URL to an absolute URL so links open the external
 * site instead of being resolved as a path under the CRM (which 404s).
 *
 *   "example.com"        -> "https://example.com"
 *   "www.example.com/x"  -> "https://www.example.com/x"
 *   "http://example.com" -> "http://example.com"   (scheme left as-is)
 *   "mailto:a@b.com"     -> "mailto:a@b.com"        (scheme left as-is)
 *   "//cdn.example.com"  -> "https://cdn.example.com"
 *
 * Returns undefined for blank/missing input so callers can skip rendering a link.
 */
export function normalizeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = String(url).trim();
  if (!trimmed) return undefined;
  // Already has a scheme (http:, https:, mailto:, tel:, …) — leave it alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  // Protocol-relative ("//host/path") — default to https.
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}
