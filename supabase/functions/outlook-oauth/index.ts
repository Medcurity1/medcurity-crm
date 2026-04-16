// outlook-oauth Edge Function
//
// Handles the Outlook (Microsoft Graph) OAuth 2.0 authorization-code flow for
// the CRM's email sync feature.
//
// Two routes:
//
//   GET /functions/v1/outlook-oauth/start?redirect_to=<crm-url>
//     Requires an authenticated Supabase JWT. Returns JSON with an
//     `authorize_url` that the frontend should navigate to.
//
//   GET /functions/v1/outlook-oauth/callback?code=<code>&state=<state>
//     Microsoft redirects the browser here with an authorization code. This
//     route exchanges the code for access + refresh tokens, identifies the
//     signed-in mailbox, upserts a row into email_sync_connections, then
//     302-redirects back to the CRM.
//
// Deployment:
//   supabase functions deploy outlook-oauth --no-verify-jwt
//
// Secrets:
//   MICROSOFT_CLIENT_ID
//   MICROSOFT_CLIENT_SECRET
//   OUTLOOK_OAUTH_REDIRECT_URI   (e.g. https://<ref>.functions.supabase.co/outlook-oauth/callback)
//   APP_BASE_URL                 (e.g. https://crm.medcurity.com)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCOPES = [
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
].join(" ");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlRedirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

/**
 * /start — generate the Microsoft authorize URL and store a state row
 * so we can recover the caller's user_id in /callback.
 */
async function handleStart(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing authorization" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify caller identity using the user's JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Invalid token" }, 401);
  }
  const userId = userData.user.id;

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const redirectUri = Deno.env.get("OUTLOOK_OAUTH_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    return json({ error: "Outlook OAuth not configured" }, 500);
  }

  // Store a one-shot state -> user_id row so the callback can find us.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const state = crypto.randomUUID();
  const { error: stateErr } = await adminClient
    .from("oauth_states")
    .insert({
      state,
      user_id: userId,
      provider: "outlook",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  if (stateErr) {
    return json(
      { error: "Failed to persist OAuth state", detail: stateErr.message },
      500
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  const authorizeUrl =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" +
    params.toString();

  return json({ authorize_url: authorizeUrl });
}

/**
 * /callback — Microsoft redirects here with ?code=... &state=...
 */
async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  // Strip any trailing slash so we don't produce //admin?... redirects
  // if APP_BASE_URL was set with a trailing slash.
  const appBase = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "") || "";

  if (error) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=${encodeURIComponent(
        error
      )}`
    );
  }
  if (!code || !state) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=missing_params`
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Look up the state we wrote in /start.
  const { data: stateRow, error: stateErr } = await adminClient
    .from("oauth_states")
    .select("*")
    .eq("state", state)
    .eq("provider", "outlook")
    .maybeSingle();
  if (stateErr || !stateRow) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=state_not_found`
    );
  }
  // Consume it.
  await adminClient.from("oauth_states").delete().eq("state", state);

  if (new Date(stateRow.expires_at) < new Date()) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=state_expired`
    );
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const redirectUri = Deno.env.get("OUTLOOK_OAUTH_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=not_configured`
    );
  }

  // Exchange the code for tokens.
  const tokenRes = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPES,
      }),
    }
  );
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error("Outlook token exchange failed:", detail);
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=token_exchange`
    );
  }
  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Look up the signed-in account's email via Graph.
  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) {
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=profile_fetch`
    );
  }
  const profile = await profileRes.json() as {
    mail?: string;
    userPrincipalName?: string;
  };
  const emailAddress = profile.mail ?? profile.userPrincipalName ?? null;

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  // Upsert the connection row for this user.
  const { error: upsertErr } = await adminClient
    .from("email_sync_connections")
    .upsert(
      {
        user_id: stateRow.user_id,
        provider: "outlook",
        email_address: emailAddress,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        token_expires_at: expiresAt,
        is_active: true,
      },
      { onConflict: "user_id,provider" }
    );
  if (upsertErr) {
    console.error("email_sync_connections upsert failed:", upsertErr.message);
    return htmlRedirect(
      `${appBase}/admin?tab=integrations&outlook=error&reason=save_failed`
    );
  }

  return htmlRedirect(
    `${appBase}/admin?tab=integrations&outlook=connected`
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Last path segment after /outlook-oauth
  const tail = url.pathname.replace(/.*\/outlook-oauth/, "");

  try {
    if (tail.startsWith("/start")) {
      return await handleStart(req);
    }
    if (tail.startsWith("/callback")) {
      return await handleCallback(req);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("outlook-oauth error:", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
