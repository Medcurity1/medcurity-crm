// crm-mcp Edge Function
//
// Read-only Model Context Protocol (MCP) server over Streamable HTTP.
// Exposes a tiny set of safe lookups against the Medcurity CRM (Supabase)
// for use by Cowork's `new-client` / `new-client-kickoff` skills.
//
// Spec: docs from Cowork team (2026-05-15).
//
// Authentication:
//   - Inbound (Cowork → MCP):  `key` query parameter on every request
//                              (GET and POST), compared against the
//                              MCP_CLIENT_SECRET env var. Requests with a
//                              missing or mismatched key get a 401.
//   - Outbound (MCP → Supabase): service role key, never returned to the caller.
//
// Transport: Streamable HTTP (the standard remote MCP transport).
//   - POST: JSON-RPC 2.0 envelopes (initialize / tools/list / tools/call / etc.)
//   - GET: long-lived Server-Sent Events stream (no events are pushed; we
//          just keep the connection open so the client's transport handshake
//          completes). Heartbeats every 25s to keep proxies from idling out.
//   - OPTIONS: 204 with full CORS preflight headers.
//
// Session management:
//   - If the client sends an `Mcp-Session-Id` header it is echoed back.
//   - If it doesn't, the server mints one (UUID) and returns it. Sessions
//     are not enforced or persisted — purely for client compatibility.
//
// Tools exposed (READ-ONLY ONLY):
//   - find_clients({ name })                  → top-5 fuzzy name matches
//   - get_client({ client_id })               → name + FTE range/count for one account
//   - find_client_by_pandadoc({ pandadoc_id }) → resolve a PandaDoc doc back to its
//                                               account (and FTE info)
//
// Deployment (production only — read-only, no staging instance needed):
//   supabase functions deploy crm-mcp --no-verify-jwt --project-ref igmwomnkbbsytihtvhbp
//   supabase secrets set MCP_CLIENT_SECRET="<random-32-char-string>" --project-ref igmwomnkbbsytihtvhbp
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
// Edge Functions runtime — no need to set them manually.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "find_clients",
    description:
      "Fuzzy-search the CRM for client (account) names. Returns up to 5 candidates ranked by match strength so a human can disambiguate. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Client name (or substring) to look up. Case-insensitive.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_client",
    description:
      "Fetch the minimal CRM record for a single client by ID. Returns the official name and FTE sizing fields needed for Medcurity platform setup. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: {
          type: "string",
          description: "Client UUID from a prior find_clients result.",
        },
      },
      required: ["client_id"],
    },
  },
  {
    name: "find_client_by_pandadoc",
    description:
      "Resolve a PandaDoc document ID back to its CRM client and FTE sizing fields. Use this when you already have the PandaDoc ID and want to confirm which client it belongs to. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        pandadoc_id: {
          type: "string",
          description: "PandaDoc document ID as stored in pandadoc_documents.",
        },
      },
      required: ["pandadoc_id"],
    },
  },
];

// JSON-RPC error codes
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, mcp-session-id, mcp-protocol-version",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
  sessionId?: string,
) {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
    200,
    sessionId ? { "Mcp-Session-Id": sessionId } : {},
  );
}

function rpcResult(id: unknown, result: unknown, sessionId?: string) {
  return jsonResponse(
    { jsonrpc: "2.0", id: id ?? null, result },
    200,
    sessionId ? { "Mcp-Session-Id": sessionId } : {},
  );
}

/**
 * Wrap a tool's return payload in MCP's expected `content` envelope.
 * MCP clients (incl. Claude) parse the JSON out of a single text block.
 */
function toolResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

type Supa = ReturnType<typeof createClient>;

interface AccountRow {
  id: string;
  name: string;
  fte_range: string | null;
  fte_count: number | null;
}

function accountToClient(row: AccountRow) {
  return {
    client_id: row.id,
    official_name: row.name,
    fte_range: row.fte_range,
    fte_count: row.fte_count,
  };
}

/**
 * Coarse name matching that mirrors the existing find_duplicate_accounts()
 * SQL function (no pg_trgm dependency). Buckets:
 *   exact (case-insensitive)              → 1.00
 *   db row's name CONTAINS query          → 0.70
 *   anything else returned by ILIKE       → 0.50
 * Top 5 results, archived rows excluded.
 */
async function findClients(supabase: Supa, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { results: [] };
  }

  // Escape ILIKE wildcards from user input so a literal '%' or '_'
  // doesn't blow up the match scope.
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  const { data, error } = await supabase
    .from("accounts")
    .select("id,name,fte_range,fte_count")
    .ilike("name", pattern)
    .is("archived_at", null)
    .limit(25);

  if (error) {
    console.error("find_clients query error", error);
    return { error: "lookup_failed" };
  }

  const queryLower = trimmed.toLowerCase();
  const scored = (data ?? [])
    .map((row) => {
      const rowLower = row.name.toLowerCase();
      let score = 0.5;
      if (rowLower === queryLower) score = 1.0;
      else if (rowLower.includes(queryLower)) score = 0.7;
      return {
        client_id: row.id as string,
        official_name: row.name as string,
        match_score: score,
      };
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5);

  return { results: scored };
}

async function getClient(supabase: Supa, clientId: string) {
  if (!isUuid(clientId)) {
    return { error: "invalid_client_id", client_id: clientId };
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("id,name,fte_range,fte_count")
    .eq("id", clientId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    console.error("get_client query error", error);
    return { error: "lookup_failed" };
  }
  if (!data) {
    return { error: "client_not_found", client_id: clientId };
  }
  return accountToClient(data as AccountRow);
}

async function findClientByPandadoc(supabase: Supa, pandadocId: string) {
  const trimmed = pandadocId.trim();
  if (!trimmed) {
    return { error: "invalid_pandadoc_id", pandadoc_id: pandadocId };
  }

  const { data, error } = await supabase
    .from("pandadoc_documents")
    .select(
      "pandadoc_id,account_id,account:accounts(id,name,fte_range,fte_count,archived_at)",
    )
    .eq("pandadoc_id", trimmed)
    .maybeSingle();

  if (error) {
    console.error("find_client_by_pandadoc query error", error);
    return { error: "lookup_failed" };
  }

  // Defensive: pandadoc row but no account, or account is archived.
  const account = (data?.account ?? null) as
    | (AccountRow & { archived_at: string | null })
    | null;

  if (!data || !account || account.archived_at) {
    return { error: "client_not_found", pandadoc_id: trimmed };
  }

  return accountToClient(account);
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function handleToolCall(
  supabase: Supa,
  toolName: string,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    case "find_clients": {
      const name = args?.name;
      if (typeof name !== "string") {
        return { _error: "missing_required_param", param: "name" };
      }
      return await findClients(supabase, name);
    }
    case "get_client": {
      const id = args?.client_id;
      if (typeof id !== "string") {
        return { _error: "missing_required_param", param: "client_id" };
      }
      return await getClient(supabase, id);
    }
    case "find_client_by_pandadoc": {
      const id = args?.pandadoc_id;
      if (typeof id !== "string") {
        return { _error: "missing_required_param", param: "pandadoc_id" };
      }
      return await findClientByPandadoc(supabase, id);
    }
    default:
      return { _error: "unknown_tool", tool: toolName };
  }
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

function authedSecretOrError(req: Request): {
  ok: boolean;
  response?: Response;
  expectedSecret?: string;
} {
  const expectedSecret = Deno.env.get("MCP_CLIENT_SECRET");
  if (!expectedSecret) {
    console.error("MCP_CLIENT_SECRET is not set");
    return {
      ok: false,
      response: jsonResponse({ error: "Server misconfiguration" }, 500),
    };
  }
  const url = new URL(req.url);
  const provided = (url.searchParams.get("key") ?? "").trim();
  if (!provided || provided !== expectedSecret) {
    return {
      ok: false,
      response: jsonResponse({ error: "Unauthorized" }, 401),
    };
  }
  return { ok: true, expectedSecret };
}

function sessionIdFor(req: Request, generateIfMissing: boolean): string | undefined {
  const incoming = req.headers.get("mcp-session-id");
  if (incoming) return incoming;
  if (!generateIfMissing) return undefined;
  return crypto.randomUUID();
}

/**
 * Open an SSE stream for GET requests. Per MCP Streamable HTTP spec, clients
 * can open a long-lived GET to receive server-pushed events. We don't push
 * anything (no server-initiated notifications in this MCP), but we still
 * keep the connection open so the client's handshake completes.
 */
function openSseStream(sessionId: string): Response {
  const encoder = new TextEncoder();
  let keepalive: number | undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Emit one comment line so intermediaries don't buffer waiting for data.
      controller.enqueue(encoder.encode(": connected\n\n"));
      // Send a heartbeat every 25s to keep proxies from idling us out.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // controller closed — clean up below.
          if (keepalive !== undefined) clearInterval(keepalive);
        }
      }, 25_000) as unknown as number;
    },
    cancel() {
      // Client disconnected; stop heartbeats.
      if (keepalive !== undefined) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    },
  });
}

serve(async (req) => {
  // ── OPTIONS preflight ────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" },
    });
  }

  // ── GET (SSE stream) ─────────────────────────────────────────────────
  if (req.method === "GET") {
    const auth = authedSecretOrError(req);
    if (!auth.ok) return auth.response!;
    const sid = sessionIdFor(req, true)!;
    return openSseStream(sid);
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed. Use GET, POST, or OPTIONS." },
      405,
    );
  }

  // ── POST: auth ───────────────────────────────────────────────────────
  const auth = authedSecretOrError(req);
  if (!auth.ok) return auth.response!;
  // Echo provided session id, or mint a new one for this request.
  const sessionId = sessionIdFor(req, true)!;

  // ── 2. Parse JSON-RPC envelope ───────────────────────────────────────
  let payload: {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    payload = await req.json();
  } catch {
    return rpcError(null, JSONRPC_PARSE_ERROR, "Invalid JSON payload", undefined, sessionId);
  }

  if (payload?.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    return rpcError(
      payload?.id,
      JSONRPC_INVALID_REQUEST,
      "Request must be JSON-RPC 2.0 with a string `method`.",
      undefined,
      sessionId,
    );
  }

  const { id, method, params } = payload;

  // ── 3. Lazy-init Supabase client (service role) ──────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase env vars missing");
    return rpcError(id, JSONRPC_INTERNAL_ERROR, "Server misconfiguration", undefined, sessionId);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 4. Dispatch ──────────────────────────────────────────────────────
  try {
    switch (method) {
      case "initialize":
        return rpcResult(
          id,
          {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: {
              name: "medcurity-crm-mcp",
              version: "0.1.0",
            },
          },
          sessionId,
        );

      case "notifications/initialized":
      case "notifications/cancelled":
        // MCP notifications carry no id and expect no response body.
        // Return 204 so the client knows it was accepted.
        return new Response(null, {
          status: 204,
          headers: { ...corsHeaders, "Mcp-Session-Id": sessionId },
        });

      case "ping":
        return rpcResult(id, {}, sessionId);

      case "tools/list":
        return rpcResult(id, { tools: TOOLS }, sessionId);

      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        if (typeof toolName !== "string") {
          return rpcError(
            id,
            JSONRPC_INVALID_PARAMS,
            "`params.name` is required (tool name).",
            undefined,
            sessionId,
          );
        }
        const result = await handleToolCall(supabase, toolName, toolArgs);

        // Surface unknown-tool / missing-param as JSON-RPC protocol errors.
        // Domain-level "not found" stays inside the tool result so the
        // client can show a structured error to the user.
        if (
          result &&
          typeof result === "object" &&
          "_error" in result &&
          (result as { _error: string })._error === "unknown_tool"
        ) {
          return rpcError(
            id,
            JSONRPC_METHOD_NOT_FOUND,
            `Unknown tool: ${toolName}`,
            undefined,
            sessionId,
          );
        }
        if (
          result &&
          typeof result === "object" &&
          "_error" in result &&
          (result as { _error: string })._error === "missing_required_param"
        ) {
          return rpcError(
            id,
            JSONRPC_INVALID_PARAMS,
            `Missing required parameter: ${(result as { param: string }).param}`,
            undefined,
            sessionId,
          );
        }

        return rpcResult(id, toolResult(result), sessionId);
      }

      default:
        return rpcError(
          id,
          JSONRPC_METHOD_NOT_FOUND,
          `Unsupported method: ${method}`,
          undefined,
          sessionId,
        );
    }
  } catch (err) {
    // Never leak raw error details to the client (per spec § Error handling).
    console.error("crm-mcp unhandled error", err);
    return rpcError(id, JSONRPC_INTERNAL_ERROR, "Internal server error", undefined, sessionId);
  }
});
