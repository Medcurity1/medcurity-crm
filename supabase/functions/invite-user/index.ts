// invite-user Edge Function
//
// Creates a new CRM user (auth account + user_profiles row) from the admin UI.
// Only admins can invoke this function.
//
// Deployment:
//   supabase functions deploy invite-user --project-ref baekcgdyjedgxmejbytc
//
// Environment variables (auto-set by Supabase):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Verify the caller is authenticated and is an admin ───────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Create a client with the caller's JWT to verify they're admin
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Get the caller's user ID from their JWT
    const {
      data: { user: callerUser },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Use service role to check profile (bypasses RLS issues)
    const adminCheckClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: profileError } = await adminCheckClient
      .from("user_profiles")
      .select("role")
      .eq("id", callerUser.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can create users" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Parse & validate request body ───────────────────────────────
    const { email, password, full_name, role } = await req.json();

    if (!email || !password || !full_name || !role) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: email, password, full_name, role",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!["sales", "renewals", "admin", "super_admin"].includes(role)) {
      return new Response(
        JSON.stringify({
          error: "Invalid role. Must be sales, renewals, or admin",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Create the auth user with service_role key ──────────────────
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: authUser, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Skip email verification
      });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create the user_profiles row ────────────────────────────────
    const { error: profileInsertError } = await adminClient
      .from("user_profiles")
      .insert({
        id: authUser.user.id,
        full_name,
        role,
        is_active: true,
      });

    if (profileInsertError) {
      // Clean up: delete the auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(authUser.user.id);
      return new Response(
        JSON.stringify({
          error: "Failed to create profile: " + profileInsertError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: authUser.user.id, email, full_name, role },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
