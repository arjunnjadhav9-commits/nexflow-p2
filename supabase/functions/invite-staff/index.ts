import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role key (has admin privileges)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the authorization header from the request
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");

    // Verify the user making the request
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { email, tenant_id, role, inviter_id } = await req.json();

    // Verify that the inviter is an owner of this tenant
    const { data: inviterRole, error: roleCheckError } = await supabaseAdmin
      .from("p2_user_roles")
      .select("role")
      .eq("user_id", inviter_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (roleCheckError || inviterRole?.role !== "owner") {
      throw new Error("Only owners can invite staff members");
    }

    // Send invite via Supabase Auth
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          tenant_id: tenant_id,
          role: role,
          invited_by: inviter_id,
        },
        redirectTo: `${Deno.env.get("SITE_URL") || "http://localhost:3000"}/index.html`,
      }
    );

    if (inviteError) {
      throw inviteError;
    }

    // Insert into p2_user_roles (will be created when user accepts invite via trigger)
    // For now, we just send the invite and the trigger handles the rest

    return new Response(
      JSON.stringify({ success: true, message: "Invite sent successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
