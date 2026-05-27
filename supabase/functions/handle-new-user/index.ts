import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * This function is triggered when a new user signs up or accepts an invite.
 * It checks if the user has tenant_id in metadata (from invite) and creates
 * appropriate entries in p2_user_roles.
 *
 * Set this up as a Supabase Auth webhook:
 * Settings > Auth > URL Configuration > Webhook
 * Events: user.created
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload = await req.json();
    const { record } = payload;

    // Check if this is a new user signup
    if (record && record.id) {
      const userId = record.id;
      const userMetadata = record.raw_user_meta_data || {};

      // Check if user was invited (has tenant_id in metadata)
      if (userMetadata.tenant_id) {
        const tenantId = userMetadata.tenant_id;
        const role = userMetadata.role || "staff";
        const invitedBy = userMetadata.invited_by;

        // Insert into p2_user_roles
        const { error: insertError } = await supabaseAdmin
          .from("p2_user_roles")
          .insert({
            user_id: userId,
            tenant_id: tenantId,
            role: role,
            invited_by: invitedBy,
          });

        if (insertError) {
          console.error("Error inserting user role:", insertError);
          throw insertError;
        }

        console.log(`Staff user ${userId} added to tenant ${tenantId} with role ${role}`);
      } else {
        // New owner signup - check if they have tenant_id
        // This should be set during registration
        console.log(`New owner signup: ${userId}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in handle-new-user:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
