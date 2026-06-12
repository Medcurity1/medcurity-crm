// meddy-crawl Edge Function — refreshes Meddy's knowledge base from
// medcurity.com. Ports the Nexus crawler verbatim (server.js:5950-6100;
// captured in PULSE-GAME-PLAN/meddy-port/09-supplements.md §4):
// priority-ordered BFS, 100-page / depth-4 cap, per-page 800-char
// excerpts packed into a ~10K-token document, written to the single
// meddy_kb_content row + a meddy_crawl_logs entry.
//
// Trigger: Admin UI "Crawl now" button, or the meddy-daily GitHub
// Actions cron (3 AM Pacific). The crawl runs in the background via
// EdgeRuntime.waitUntil; callers poll meddy_crawl_logs for the result.
// A 10-minute cooldown makes anon-triggered runs abuse-resistant.
//
// Deploy: supabase functions deploy meddy-crawl

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ── Constants (verbatim) ──────────────────────────────────────────────
const SKIP_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|mp4|mp3|wav|avi|mov|zip|tar|gz|css|js|woff|woff2|ttf|eot)$/i;
const SKIP_DOMAINS = ["app.medcurity.com", "training.medcurity.com"];
const PRIORITY_PATTERNS = [
  /hipaa-compliance-solutions/i,
  /security-risk-analysis|sra/i,
  /network-security|nva/i,
  /training/i,
  /vendor-management/i,
  /small-practice/i,
  /^\/$/,
  /about|team|company/i,
  /resources|blog/i,
  /contact/i,
];
const MAX_DEPTH = 4;
const MAX_PAGES = 100;
const DELAY_MS = 350; // Nexus used 1000ms; trimmed to fit edge wall-clock
const TIMEOUT_MS = 10000;
const MAX_TOKENS = 10000;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS_CRAWL = MAX_TOKENS * CHARS_PER_TOKEN;

function normalizeUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.hostname !== "medcurity.com" && u.hostname !== "www.medcurity.com") return null;
    if (SKIP_DOMAINS.includes(u.hostname)) return null;
    if (SKIP_EXTENSIONS.test(u.pathname)) return null;
    u.hash = "";
    u.search = "";
    let normalized = u.origin + u.pathname;
    if (!normalized.endsWith("/")) normalized += "/";
    return normalized;
  } catch {
    return null;
  }
}

async function fetchCrawlPage(
  url: string,
): Promise<{ html?: string; error?: string; url: string }> {
  try {
    // AbortSignal.timeout covers the BODY read too — a server that sends
    // headers then stalls the body can't hang the crawl loop.
    const res = await fetch(url, {
      headers: { "User-Agent": "MeddyCrawler/1.0 (Medcurity chatbot knowledge updater)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { error: `HTTP ${res.status}`, url };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      await res.body?.cancel();
      return { error: "Not HTML", url };
    }
    // Redirected off-site?
    if (!normalizeUrl(res.url ?? url)) {
      await res.body?.cancel();
      return { error: "Redirect to external", url };
    }
    return { html: await res.text(), url };
  } catch (e) {
    const name = (e as Error).name;
    const msg = name === "AbortError" || name === "TimeoutError" ? "Timeout" : (e as Error).message;
    return { error: msg, url };
  }
}

function extractContent(html: string, url: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return { title: "Untitled", content: "", links: [] as string[], url };

  let title =
    doc.querySelector("title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    "Untitled";
  title = title.replace(/\s*[|-]\s*Medcurity.*$/i, "").trim() || title;

  for (const sel of [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "iframe",
    "noscript",
    ".cookie-banner",
    ".nav",
    ".menu",
    ".sidebar",
    ".widget",
    "form",
  ]) {
    doc.querySelectorAll(sel).forEach((el) => (el as unknown as { remove(): void }).remove());
  }

  let content = "";
  doc
    .querySelectorAll("main, article, .content, .entry-content, .page-content, [role=main]")
    .forEach((el) => {
      content += (el.textContent ?? "") + "\n";
    });
  if (!content.trim()) content = doc.querySelector("body")?.textContent ?? "";
  content = content
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();

  const links: string[] = [];
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = (a as unknown as { getAttribute(n: string): string | null }).getAttribute("href");
    if (!href) return;
    try {
      const fullUrl = href.startsWith("http") ? href : new URL(href, url).href;
      const normalized = normalizeUrl(fullUrl);
      if (normalized) links.push(normalized);
    } catch {
      // unparseable href — skip
    }
  });

  return { title, content, links, url };
}

function getCrawlPriority(url: string): number {
  const pathname = new URL(url).pathname;
  for (let i = 0; i < PRIORITY_PATTERNS.length; i++) {
    if (PRIORITY_PATTERNS[i].test(pathname)) return i;
  }
  return PRIORITY_PATTERNS.length;
}

// Hard wall-clock budget: finish packing + logging well before the edge
// runtime's background-task kill (worst case 100 pages of slow fetches
// would otherwise exceed it and lose the whole crawl).
const CRAWL_BUDGET_MS = 240_000;

async function doCrawl(logId: number) {
  const startTime = Date.now();
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [
    { url: "https://medcurity.com/", depth: 0 },
  ];
  const pages: Array<{ url: string; title: string; content: string; priority: number }> = [];
  const errors: Array<{ url: string; error: string }> = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    if (Date.now() - startTime > CRAWL_BUDGET_MS) {
      errors.push({ url: "(crawl)", error: "Stopped at time budget" });
      break;
    }
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    if (item.depth > MAX_DEPTH) continue;
    visited.add(item.url);

    const result = await fetchCrawlPage(item.url);
    if (result.error) {
      errors.push({ url: item.url, error: result.error });
      continue;
    }

    const extracted = extractContent(result.html!, item.url);
    if (extracted.content.length > 50) {
      pages.push({
        url: item.url,
        title: extracted.title,
        content: extracted.content,
        priority: getCrawlPriority(item.url),
      });
    }
    for (const link of extracted.links) {
      if (!visited.has(link) && !queue.some((q) => q.url === link)) {
        queue.push({ url: link, depth: item.depth + 1 });
      }
    }
    if (queue.length > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  pages.sort((a, b) => a.priority - b.priority);

  // Pack into the token budget (verbatim packing rules).
  let output = "";
  let totalChars = 0;
  const includedPages: Array<{ url: string; title: string; truncated: boolean }> = [];
  for (const page of pages) {
    const header = "\n=== " + page.title + " (" + page.url + ") ===\n";
    let pageContent = page.content;
    if (pageContent.length > 800) {
      pageContent = pageContent.substring(0, 800).replace(/\s\S*$/, "") + "...";
    }
    const entry = header + pageContent + "\n";
    if (totalChars + entry.length > MAX_CHARS_CRAWL) {
      const summary = header + pageContent.split(/[.!?]\s/)[0] + ".\n";
      if (totalChars + summary.length <= MAX_CHARS_CRAWL) {
        output += summary;
        totalChars += summary.length;
        includedPages.push({ url: page.url, title: page.title, truncated: true });
      }
    } else {
      output += entry;
      totalChars += entry.length;
      includedPages.push({ url: page.url, title: page.title, truncated: false });
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const sitemap = {
    lastCrawl: new Date().toISOString(),
    pagesDiscovered: visited.size,
    pagesCrawled: pages.length,
    pagesIncluded: includedPages.length,
    errors: errors.length,
    contentSize: output.length,
    estimatedTokens: Math.ceil(output.length / CHARS_PER_TOKEN),
    urls: Array.from(visited).sort(),
    included: includedPages,
    crawlErrors: errors,
  };

  // Only replace the KB when the crawl actually produced content — an
  // outage shouldn't blank Meddy's brain.
  if (output.trim().length > 500) {
    await svc
      .from("meddy_kb_content")
      .update({ content: output.trim(), sitemap, updated_at: new Date().toISOString() })
      .eq("id", 1);
  }

  await svc
    .from("meddy_crawl_logs")
    .update({
      pages_discovered: visited.size,
      pages_crawled: pages.length,
      pages_included: includedPages.length,
      content_size: output.length,
      estimated_tokens: sitemap.estimatedTokens,
      errors: errors.length,
      error_details: errors,
      duration_seconds: Math.round(elapsed * 10) / 10,
    })
    .eq("id", logId);

  console.log(
    `[crawler] Complete in ${elapsed.toFixed(1)}s. Discovered: ${visited.size}, ` +
      `Crawled: ${pages.length}, Included: ${includedPages.length}, ` +
      `Content: ${output.length} chars (~${sitemap.estimatedTokens} tokens), Errors: ${errors.length}`,
  );
  return sitemap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  // Cooldown: skip if a crawl ran OR STARTED in the last 10 minutes. The
  // log row is inserted up-front (zeros, filled in on completion), so
  // concurrent triggers see it immediately — this is the abuse control
  // for the anon-invocable endpoint.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await svc
    .from("meddy_crawl_logs")
    .select("id")
    .gte("crawled_at", tenMinAgo)
    .limit(1);
  if ((recent ?? []).length > 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "crawled recently" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  const { data: logRow, error: logErr } = await svc
    .from("meddy_crawl_logs")
    .insert({})
    .select("id")
    .single();
  if (logErr || !logRow) {
    return new Response(JSON.stringify({ error: "could not start crawl" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const work = doCrawl(logRow.id).catch((e) => console.error("[crawler] failed:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return new Response(JSON.stringify({ ok: true, started: true }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
