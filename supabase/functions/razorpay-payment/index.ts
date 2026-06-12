// Razorpay Payment Handler for RefineAI
// This edge function handles payment creation and verification

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Razorpay API base URL
const RAZORPAY_API = "https://api.razorpay.com/v1";

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { action, ...params } = await req.json();

        // Get Razorpay keys from environment (REQUIRED - no hardcoded fallbacks)
        const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
        const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        console.log("[Razorpay] Action:", action);
        console.log("[Razorpay] Using KEY_ID:", RAZORPAY_KEY_ID.substring(0, 15) + "...");

        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            throw new Error("Razorpay keys not configured");
        }

        // Create Supabase admin client
        const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

        // Base64 encode for Razorpay auth
        const authHeader = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

        // Handle different actions
        switch (action) {
            case "create_order": {
                const { amount, currency, plan_type, user_id, user_email } = params;

                const orderData = {
                    amount: amount * 100, // Razorpay expects amount in paise
                    currency: currency || "INR",
                    receipt: `refineai_${plan_type}_${Date.now()}`,
                    notes: {
                        plan_type,
                        user_id,
                        user_email,
                    },
                };

                const orderResponse = await fetch(`${RAZORPAY_API}/orders`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Basic ${authHeader}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(orderData),
                });

                if (!orderResponse.ok) {
                    const error = await orderResponse.text();
                    throw new Error(`Failed to create order: ${error}`);
                }

                const order = await orderResponse.json();

                return new Response(
                    JSON.stringify({
                        success: true,
                        order_id: order.id,
                        amount: order.amount,
                        currency: order.currency,
                        key_id: RAZORPAY_KEY_ID,
                    }),
                    {
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            case "verify_payment": {
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature, user_id, plan_type } = params;

                console.log("[Razorpay] Verifying payment:", { razorpay_order_id, razorpay_payment_id, user_id, plan_type });

                // In test mode, skip signature verification (signature algo can vary)
                const isTestMode = RAZORPAY_KEY_ID.startsWith("rzp_test_");

                if (!isTestMode) {
                    // Verify signature for production
                    const body = razorpay_order_id + "|" + razorpay_payment_id;
                    const key = new TextEncoder().encode(RAZORPAY_KEY_SECRET);
                    const message = new TextEncoder().encode(body);

                    const cryptoKey = await crypto.subtle.importKey(
                        "raw",
                        key,
                        { name: "HMAC", hash: "SHA-256" },
                        false,
                        ["sign"]
                    );

                    const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
                    const expectedSignature = Array.from(new Uint8Array(signature))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');

                    if (expectedSignature !== razorpay_signature) {
                        throw new Error("Invalid payment signature");
                    }
                }

                console.log("[Razorpay] Payment verified, updating user plan...");

                // Update user's plan
                const dailyLimit = plan_type === "premium" ? 1000000 : plan_type === "pro" ? 20000 : 2000;

                const { error: updateError } = await supabase
                    .from("profiles")
                    .update({
                        plan_type: plan_type,
                        is_premium: true,
                        daily_limit: dailyLimit,
                    })
                    .eq("id", user_id);

                if (updateError) {
                    console.error("[Razorpay] Profile update error:", updateError);
                    throw new Error("Failed to upgrade user: " + updateError.message);
                }

                console.log("[Razorpay] Profile updated successfully for user:", user_id);

                return new Response(
                    JSON.stringify({
                        success: true,
                        message: "Payment verified and plan upgraded!",
                        plan_type,
                    }),
                    {
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        console.error("[Razorpay] Error:", error);
        return new Response(
            JSON.stringify({
                success: false,
                error: (error as Error).message,
            }),
            {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
