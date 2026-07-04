// ask-ai Edge Function
//
// Read-only CRM assistant. The caller's "Ask AI" question is answered by
// Claude using a FIXED ALLOWLIST of read-only tools. There is deliberately
// NO write/update/delete tool — the assistant physically cannot change data,
// no matter what it's asked. Every tool query runs under the CALLING USER's
// JWT, so row-level security bounds exactly what the AI can read (it can
// never surface more than the user already could).
//
// Defense in depth:
//   1. Structural: only read tools exist in TOOL_IMPLS. Unknown tool -> error.
//   2. RLS: all data queries use the user-scoped client (anon key + the
//      caller's Authorization header), never the service role.
//   3. Admin capability toggles: ai_settings.enabled_capabilities gates which
//      tools are offered to the model.
//   4. Rate limit + full audit log (ai_query_log), hard result caps, and a
//      bounded tool-use loop.
//
// Deployment:
//   supabase functions deploy ask-ai --project-ref baekcgdyjedgxmejbytc
//
// Env (auto-set): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Env (shared with Meddy): ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const OPP_STAGES = [
  "lead", "qualified", "proposal", "verbal_commit", "closed_won", "closed_lost",
];
const OPEN_STAGES = ["lead", "qualified", "proposal", "verbal_commit"];
const MAX_ROWS = 25; // hard cap on any list a tool returns
const MAX_TOOL_LOOPS = 6; // bounded agent loop
const DEFAULT_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001"; // known-good if the preferred model id is rejected

type Source = { type: string; id: string; label: string };
type ToolOut = { forModel: unknown; sources?: Source[] };

// ── Static "how do I" help (no DB; keeps product-help on the menu) ────
const HELP: Record<string, string> = {
  archive_contacts:
    "To archive one contact, open the contact's page and click the Archive button near the top right of the header, then confirm. To archive several at once, go to the Contacts list, check the ones you want, and click Archive in the bulk action bar that appears (admins only). Archiving hides a contact from the normal lists without deleting their data.",
  renewals:
    "Renewals are on the Renewals tab. A deal counts as a renewal when its Kind is set to renewal; upcoming ones show in the queue sorted by expected close date.",
  warm_lead:
    "Warm Lead is a contact tag. Open a contact and add the Warm Lead tag with the tag picker. You can filter for Warm Lead contacts in the Contacts list, or build a Nexus Custom Report widget with Tag set to Warm Lead.",
  create_task:
    "Create a task from the Activities tab using Create Task, or from the Activities section of any account, contact, or opportunity. You can set a due date and a priority (High, Medium, or Low).",
  pipeline:
    "The Pipeline tab is a drag-and-drop board organized by stage. The stages are Lead, Qualified, Proposal, Verbal Commit, Closed Won, and Closed Lost. Drag a deal's card between columns to change its stage.",
  nexus:
    "Nexus is the customizable dashboard and has its own tab. Click Add a Widget in the top right, choose a widget type (Today's Tasks, Current Pipeline, Custom Report, Metrics, Pinned Records, or Requests), and drag widgets to rearrange them.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: require a real user; this same client runs every tool query
  // under the user's RLS.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid or expired token" }, 401);

  // Service client — ONLY for config + rate-limit + logging. NEVER for
  // answering data questions (that all goes through userClient/RLS).
  const svc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── Config (admin-controlled capability toggles + model + rate limit)
  const { data: settings } = await svc
    .from("ai_settings")
    .select("enabled_capabilities, rate_limit_per_hour, model")
    .eq("id", true)
    .maybeSingle();
  const enabled: string[] = settings?.enabled_capabilities ?? [];
  const rateLimit: number = settings?.rate_limit_per_hour ?? 100;
  const model: string = settings?.model || DEFAULT_MODEL;

  // ── Rate limit (per user, rolling hour)
  const sinceIso = new Date(Date.now() - 3600_000).toISOString();
  const { count: recentCount } = await svc
    .from("ai_query_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", sinceIso);
  if ((recentCount ?? 0) >= rateLimit) {
    return json({ error: "rate_limited", message: "You've reached the hourly Ask AI limit. Try again shortly." }, 429);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "ai_unavailable", message: "AI is not configured." }, 503);

  // ── Body: conversation history + the new question
  let body: { messages?: Array<{ role: string; content: string }>; question?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const question = (body.question ?? "").toString().slice(0, 2000).trim();
  if (!question) return json({ error: "empty_question" }, 400);

  // Caller profile (for grounding + owner="me")
  const { data: me } = await userClient
    .from("user_profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  // Resolve an owner arg ("me" | a name) -> user_id | null (any)
  async function resolveOwner(owner?: string): Promise<string | null> {
    if (!owner) return null;
    const o = owner.trim().toLowerCase();
    if (o === "me" || o === "mine" || o === (me?.full_name ?? "").toLowerCase()) return user.id;
    const { data } = await userClient
      .from("user_profiles")
      .select("id, full_name")
      .ilike("full_name", `%${owner.trim()}%`)
      .limit(1);
    return data?.[0]?.id ?? null;
  }

  const cap = (n: unknown) => Math.min(Math.max(parseInt(String(n ?? MAX_ROWS), 10) || MAX_ROWS, 1), MAX_ROWS);

  // ── READ-ONLY TOOL IMPLEMENTATIONS (all via userClient / RLS) ───────
  const TOOL_IMPLS: Record<string, (args: Record<string, unknown>) => Promise<ToolOut>> = {
    async search_accounts(a) {
      let q = userClient.from("accounts")
        .select("id, name, customer_status, industry, billing_state, owner_user_id", { count: "exact" })
        .is("archived_at", null).limit(cap(a.limit));
      if (a.query) q = q.ilike("name", `%${String(a.query)}%`);
      if (a.customer_status) q = q.eq("customer_status", String(a.customer_status));
      if (a.state) q = q.ilike("billing_state", `%${String(a.state)}%`);
      // industry is the free-text column; industry_category is an enum and
      // can't take ILIKE without a cast, so filter on the text one.
      if (a.industry) q = q.ilike("industry", `%${String(a.industry)}%`);
      const owner = await resolveOwner(a.owner as string | undefined);
      if (owner) q = q.eq("owner_user_id", owner);
      const { data, error, count } = await q;
      if (error) return { forModel: { error: error.message } };
      return {
        forModel: { total: count ?? data?.length ?? 0, showing: data?.length ?? 0, accounts: data ?? [] },
        sources: (data ?? []).map((r: any) => ({ type: "account", id: r.id, label: r.name })),
      };
    },
    async get_account(a) {
      const id = String(a.account_id ?? "");
      const { data: acct, error } = await userClient.from("accounts")
        .select("id, name, customer_status, industry, billing_state, website, phone, owner_user_id, created_at")
        .eq("id", id).maybeSingle();
      if (error || !acct) return { forModel: { error: "account not found or not visible to you" } };
      const [{ data: la }, { count: openOpps }, { data: recent }] = await Promise.all([
        userClient.from("v_account_last_activity").select("last_activity_at").eq("account_id", id).maybeSingle(),
        userClient.from("opportunities").select("id", { count: "exact", head: true })
          .eq("account_id", id).in("stage", OPEN_STAGES).is("archived_at", null),
        userClient.from("activities").select("activity_type, subject, effective_at")
          .eq("account_id", id).is("archived_at", null).order("effective_at", { ascending: false }).limit(5),
      ]);
      return {
        forModel: { ...acct, last_activity_at: la?.last_activity_at ?? null, open_opportunities: openOpps ?? 0, recent_activities: recent ?? [] },
        sources: [{ type: "account", id: acct.id, label: acct.name }],
      };
    },
    async search_contacts(a) {
      let q = userClient.from("contacts")
        .select("id, first_name, last_name, title, email, account_id, owner_user_id, do_not_call, no_longer_employed", { count: "exact" })
        .is("archived_at", null).limit(cap(a.limit));
      if (a.query) {
        // Strip PostgREST filter metacharacters so a search term can't inject
        // extra OR-conditions into the string-built .or() clause.
        const s = String(a.query).replace(/[,()*]/g, " ").slice(0, 120);
        q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
      }
      if (typeof a.do_not_call === "boolean") q = q.eq("do_not_call", a.do_not_call);
      if (typeof a.no_longer_employed === "boolean") q = q.eq("no_longer_employed", a.no_longer_employed);
      const owner = await resolveOwner(a.owner as string | undefined);
      if (owner) q = q.eq("owner_user_id", owner);
      if (a.tag) {
        const { data: tag } = await userClient.from("tags").select("id").ilike("name", String(a.tag)).maybeSingle();
        if (!tag) return { forModel: { note: `no tag named '${a.tag}'`, results: [] } };
        const { data: links } = await userClient.from("contact_tags").select("contact_id").eq("tag_id", tag.id).limit(200);
        const ids = (links ?? []).map((l: any) => l.contact_id);
        if (!ids.length) return { forModel: { results: [] } };
        q = q.in("id", ids);
      }
      const { data, error, count } = await q;
      if (error) return { forModel: { error: error.message } };
      return {
        forModel: { total: count ?? data?.length ?? 0, showing: data?.length ?? 0, contacts: data ?? [] },
        sources: (data ?? []).map((r: any) => ({ type: "contact", id: r.id, label: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() })),
      };
    },
    async get_contact(a) {
      const { data, error } = await userClient.from("contacts")
        .select("id, first_name, last_name, title, email, phone, do_not_call, no_longer_employed, account:accounts(id,name)")
        .eq("id", String(a.contact_id ?? "")).maybeSingle();
      if (error || !data) return { forModel: { error: "contact not found or not visible to you" } };
      return { forModel: data, sources: [{ type: "contact", id: data.id, label: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() }] };
    },
    async search_opportunities(a) {
      let q = userClient.from("opportunities")
        .select("id, name, stage, amount, expected_close_date, kind, team, account_id, owner_user_id", { count: "exact" })
        .is("archived_at", null).limit(cap(a.limit));
      if (a.query) q = q.ilike("name", `%${String(a.query)}%`);
      // open_only = the four in-flight stages; else honor a single stage.
      if (a.open_only === true) q = q.in("stage", OPEN_STAGES);
      else if (a.stage && OPP_STAGES.includes(String(a.stage))) q = q.eq("stage", String(a.stage));
      if (a.team) q = q.eq("team", String(a.team));
      if (a.kind) q = q.eq("kind", String(a.kind));
      if (a.min_amount != null) q = q.gte("amount", Number(a.min_amount));
      const owner = await resolveOwner(a.owner as string | undefined);
      if (owner) q = q.eq("owner_user_id", owner);
      q = a.sort_by === "amount"
        ? q.order("amount", { ascending: false, nullsFirst: false })
        : q.order("expected_close_date", { ascending: true, nullsFirst: false });
      const { data, error, count } = await q;
      if (error) return { forModel: { error: error.message } };
      return {
        // total (from count) tells the model how many matched even when the
        // row list is capped, so it never says "only one" over a capped set.
        forModel: { total: count ?? data?.length ?? 0, showing: data?.length ?? 0, opportunities: data ?? [] },
        sources: (data ?? []).map((r: any) => ({ type: "opportunity", id: r.id, label: r.name })),
      };
    },
    async pipeline_summary(a) {
      const owner = await resolveOwner(a.owner as string | undefined);
      let q = userClient.from("opportunities").select("stage, amount")
        .in("stage", OPEN_STAGES).is("archived_at", null).limit(2000);
      if (owner) q = q.eq("owner_user_id", owner);
      const { data, error } = await q;
      if (error) return { forModel: { error: error.message } };
      const byStage: Record<string, { count: number; total: number }> = {};
      for (const r of data ?? []) {
        const s = (r as any).stage;
        byStage[s] = byStage[s] || { count: 0, total: 0 };
        byStage[s].count += 1;
        byStage[s].total += Number((r as any).amount) || 0;
      }
      return { forModel: { by_stage: byStage, truncated: (data?.length ?? 0) >= 2000 } };
    },
    async list_renewals(a) {
      // Use the same renewal_queue view the dashboard's "Renewals Due"
      // metric uses: closed-won deals whose contract_end_date is within the
      // window. count:exact returns the true total so we never undercount
      // when the row list is capped.
      const within = Math.min(Math.max(parseInt(String(a.within_days ?? 90), 10) || 90, 1), 120);
      const { data, error, count } = await userClient.from("renewal_queue")
        .select("source_opportunity_id, account_id, account_name, current_arr, contract_end_date, days_until_renewal", { count: "exact" })
        .gte("days_until_renewal", 0)
        .lte("days_until_renewal", within)
        .order("days_until_renewal", { ascending: true }).limit(MAX_ROWS);
      if (error) return { forModel: { error: error.message } };
      return {
        forModel: { total: count ?? data?.length ?? 0, showing: data?.length ?? 0, renewals: data ?? [] },
        sources: (data ?? []).map((r: any) => ({ type: "account", id: r.account_id, label: r.account_name })),
      };
    },
    async list_my_tasks(a) {
      let q = userClient.from("activities")
        .select("id, subject, due_at, priority, completed_at, account_id, contact_id, opportunity_id")
        .eq("activity_type", "task").eq("owner_user_id", user.id).is("archived_at", null).limit(MAX_ROWS);
      if (a.status === "completed") q = q.not("completed_at", "is", null);
      else q = q.is("completed_at", null);
      if (a.overdue === true) q = q.lt("due_at", new Date().toISOString());
      const { data, error } = await q.order("due_at", { ascending: true, nullsFirst: false });
      if (error) return { forModel: { error: error.message } };
      return { forModel: data };
    },
    async how_do_i(a) {
      const topic = String(a.topic ?? "").toLowerCase().replace(/[^a-z]+/g, "_");
      const hit = HELP[topic] || Object.entries(HELP).find(([k]) => topic.includes(k) || k.includes(topic))?.[1];
      return { forModel: { help: hit ?? "No specific guide for that topic. Do not invent steps or button names. Point the user to the most relevant tab and offer to look up data for them instead.", topics: Object.keys(HELP) } };
    },
  };

  // ── Anthropic tool schemas (only the enabled ones get offered) ──────
  const ALL_TOOLS: Array<{ name: string; description: string; input_schema: unknown }> = [
    { name: "search_accounts", description: "Search/filter accounts (companies). Args: query (name substring), owner ('me' or a name), customer_status (client|prospect|former_client), industry, state, limit.", input_schema: { type: "object", properties: { query: { type: "string" }, owner: { type: "string" }, customer_status: { type: "string" }, industry: { type: "string" }, state: { type: "string" }, limit: { type: "integer" } } } },
    { name: "get_account", description: "Full detail for one account by id: fields, last activity date, open opportunity count, and 5 most-recent activities.", input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } },
    { name: "search_contacts", description: "Search/filter contacts (people). Args: query (name/email), owner, tag (e.g. 'Warm Lead'), do_not_call (bool), no_longer_employed (bool), limit.", input_schema: { type: "object", properties: { query: { type: "string" }, owner: { type: "string" }, tag: { type: "string" }, do_not_call: { type: "boolean" }, no_longer_employed: { type: "boolean" }, limit: { type: "integer" } } } },
    { name: "get_contact", description: "Full detail for one contact by id, including their account.", input_schema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "search_opportunities", description: "Search/filter opportunities (deals). Args: query (name), owner, open_only (true = only in-flight deals: Lead/Qualified/Proposal/Verbal Commit), stage (a single stage if you need one specifically), team (sales|renewals), kind (new_business|renewal), min_amount, sort_by ('amount' = biggest first, or 'close_date' = soonest first, the default), limit (max 25). Returns the true total match count plus the rows. For 'top open deals by amount' set open_only=true and sort_by='amount'.", input_schema: { type: "object", properties: { query: { type: "string" }, owner: { type: "string" }, open_only: { type: "boolean" }, stage: { type: "string" }, team: { type: "string" }, kind: { type: "string" }, min_amount: { type: "number" }, sort_by: { type: "string", enum: ["amount", "close_date"] }, limit: { type: "integer" } } } },
    { name: "pipeline_summary", description: "Open-pipeline counts and total amount grouped by stage. Optional owner ('me' or a name).", input_schema: { type: "object", properties: { owner: { type: "string" } } } },
    { name: "list_renewals", description: "Upcoming customer contract renewals: closed-won deals whose contract ends within N days (default 90, max 120). This matches the Renewals tab and the dashboard's 'Renewals Due' metric. Returns the true total plus the soonest rows.", input_schema: { type: "object", properties: { within_days: { type: "integer" } } } },
    { name: "list_my_tasks", description: "The current user's tasks. Args: status ('open'|'completed', default open), overdue (bool).", input_schema: { type: "object", properties: { status: { type: "string" }, overdue: { type: "boolean" } } } },
    { name: "how_do_i", description: "Get product help for using Pulse. Arg: topic (e.g. 'archive contacts', 'renewals', 'warm lead').", input_schema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
  ];
  const tools = ALL_TOOLS.filter((t) => enabled.includes(t.name));

  const today = new Date().toISOString().slice(0, 10);
  const system = [
    "You are the Ask AI assistant inside Pulse, Medcurity's CRM. You help sales and success reps by looking things up and analyzing their data.",
    `Today is ${today}. The user is ${me?.full_name ?? "a Pulse user"} (role: ${me?.role ?? "user"}).`,
    "You are strictly read-only: you can search, summarize, count, compare, and surface records and links, but you cannot create, edit, delete, move, email, or change anything. If someone asks you to change data, say once and briefly that you can only look things up right now, then offer to find the relevant record so they can do it themselves.",
    "Only use the provided tools to get data. Never invent records, numbers, names, or ids. If a tool returns nothing, say so plainly.",
    "For 'how do I' questions, use only the steps the how_do_i tool gives you. Do not invent button names, menu paths, or steps you were not given. If there is no specific guide, say you are not certain of the exact steps and point the person to the most relevant tab.",
    "Voice: write like a helpful teammate, not a chatbot. Use plain, direct sentences. Do not use em dashes; use commas, periods, or the word 'to' instead. Skip cheerful sign-offs like 'Just let me know!'. Do not keep announcing that you are an AI. Keep formatting light: short paragraphs, with a simple bullet or numbered list only when you are actually listing items, and use bold sparingly. Show dollar amounts with a $ and commas.",
    "When you reference specific records, name them; the app turns them into clickable links from the records you retrieved.",
    "Medcurity terms: pipeline stages are Lead, Qualified, Proposal, Verbal Commit, Closed Won, Closed Lost. customer_status (client, prospect, former_client) is the real customer state. A renewal is an opportunity with kind = renewal.",
  ].join("\n");

  // ── Bounded tool-use loop ───────────────────────────────────────────
  const history = Array.isArray(body.messages)
    ? body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-8)
    : [];
  const messages: any[] = [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: question }];

  const toolsCalled: string[] = [];
  const sources: Source[] = [];
  const seen = new Set<string>();
  let answer = "";
  let activeModel = model;

  async function finishLog(ok: boolean) {
    try {
      await svc.from("ai_query_log").insert({
        user_id: user.id, question, tools_called: toolsCalled, answer_chars: answer.length, ok,
      });
    } catch { /* logging must never break the response */ }
  }

  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: activeModel, max_tokens: 1200,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          tools, messages,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("[ask-ai] anthropic error", res.status, t.slice(0, 300));
        // If the preferred model id is rejected (4xx), fall back once to the
        // known-good model and retry this turn.
        if (res.status >= 400 && res.status < 500 && activeModel !== FALLBACK_MODEL) {
          activeModel = FALLBACK_MODEL;
          continue;
        }
        await finishLog(false);
        return json({ error: "ai_error", message: "The assistant hit an error. Please try again." }, 502);
      }
      const data = await res.json();
      const content: any[] = data.content ?? [];
      // Collect any text
      for (const b of content) if (b.type === "text") answer += b.text;

      const toolUses = content.filter((b: any) => b.type === "tool_use");
      if (data.stop_reason !== "tool_use" || toolUses.length === 0) break;

      // Run each requested tool (allowlisted only) and feed results back.
      messages.push({ role: "assistant", content });
      const results: any[] = [];
      for (const tu of toolUses) {
        const impl = enabled.includes(tu.name) ? TOOL_IMPLS[tu.name] : undefined;
        if (!impl) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: "tool_not_available" }), is_error: true });
          continue;
        }
        toolsCalled.push(tu.name);
        try {
          const out = await impl((tu.input ?? {}) as Record<string, unknown>);
          for (const s of out.sources ?? []) {
            const k = `${s.type}:${s.id}`;
            if (!seen.has(k)) { seen.add(k); sources.push(s); }
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.forModel).slice(0, 12000) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: (e as Error).message }), is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      answer = ""; // keep only the final turn's prose
    }
  } catch (e) {
    console.error("[ask-ai] loop error", (e as Error).message);
    await finishLog(false);
    return json({ error: "ai_error", message: "The assistant hit an error. Please try again." }, 502);
  }

  answer = answer.trim() || "I couldn't find anything for that. Try rephrasing?";
  await finishLog(true);
  return json({ answer, sources, tools_called: toolsCalled });
});
