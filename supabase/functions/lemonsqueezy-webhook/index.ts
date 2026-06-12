import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const payload = await req.json();
        const eventName = payload.meta.event_name;
        const data = payload.data;

        console.log(`[LemonSqueezy] Event received: ${eventName}`);

        // Initialize Supabase admin client
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        if (eventName === "order_created" || eventName === "subscription_created") {
            const attributes = data.attributes;

            // Lemon Squeezy sends custom data in custom_data or passthrough
            let customData = attributes.custom_data || {};
            // If customData is a string (legacy), try to parse it
            if (typeof customData === 'string') {
                try { customData = JSON.parse(customData); } catch (e) { customData = {}; }
            }

            // 1. Get User - Try ID first, then Email fallback
            let userId = customData.user_id || attributes.passthrough || customData[0];
            const userEmail = (attributes.user_email || attributes.customer_email || "").toLowerCase();

            let targetUser = userId;
            if (!targetUser && userEmail) {
                console.log(`[LemonSqueezy] Searching by email fallback: ${userEmail}`);
                const { data: userData } = await supabase
                    .from("profiles")
                    .select("id")
                    .eq("email", userEmail)
                    .single();
                if (userData) targetUser = userData.id;
            }

            if (!targetUser) {
                console.error("[LemonSqueezy] User focus failed (No ID or Email match)");
                return new Response(JSON.stringify({ error: "User not found" }), { status: 400 });
            }

            // 2. Determine Plan Type (Check both variant, product name, and Price)
            const vName = (attributes.variant_name || "").toLowerCase();
            const pName = (attributes.product_name || "").toLowerCase();
            const total = attributes.total || 0; // Amount paid in cents
            const variantText = vName + " " + pName;

            console.log(`[LemonSqueezy] Order Details: Name="${variantText}" | Total=${total}`);

            // If they paid > $0, it MUST be at least pro
            let planType = "free";
            if (total > 0) {
                planType = variantText.includes("premium") ? "premium" : "pro";
            } else if (variantText.includes("premium")) {
                planType = "premium";
            } else if (variantText.includes("pro")) {
                planType = "pro";
            }

            const dailyLimit = planType === "premium" ? 1000000 :
                planType === "pro" ? 20000 : 2000;

            console.log(`[LemonSqueezy] Upgrading ${targetUser} to ${planType} (${dailyLimit} words)`);

            const { error: updateError } = await supabase
                .from("profiles")
                .update({
                    plan_type: planType,
                    is_premium: planType !== "free",
                    daily_limit: dailyLimit,
                })
                .eq("id", targetUser);

            if (updateError) {
                throw updateError;
            }

            console.log(`[LemonSqueezy] Successfully upgraded user ${targetUser} to ${planType}`);
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("[LemonSqueezy] Webhook error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
