import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // --- AUTH VERIFICATION ---
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
            const supabase = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                { global: { headers: { Authorization: authHeader } } }
            );
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                return new Response(JSON.stringify({ error: 'Unauthorized. Please log in.' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
        }

        const { messages, action } = await req.json();

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error('Invalid request: messages array is required.');
        }

        const GROQ_KEY = Deno.env.get('GROQ_API_KEY');
        const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
        const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY');

        let response;
        let errorMsg = '';

        // 1. Try Groq (Primary)
        if (GROQ_KEY) {
            try {
                response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: messages
                    })
                });

                if (response.status === 200) {
                    const data = await response.json();
                    return new Response(JSON.stringify(data), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                errorMsg = `Groq Error: ${response.status}`;
            } catch (e) {
                errorMsg = `Groq Failed: ${(e as Error).message}`;
            }
        }

        // 2. Try Gemini (Backup)
        if (GEMINI_KEY) {
            try {
                const geminiContent = messages.map((m: any) => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    parts: [{ text: m.content }]
                }));

                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: geminiContent })
                });

                if (response.status === 200) {
                    const rawData = await response.json();

                    // Safe extraction with null checks
                    const candidate = rawData?.candidates?.[0];
                    const text = candidate?.content?.parts?.[0]?.text;

                    if (!text) {
                        const blockReason = rawData?.promptFeedback?.blockReason || candidate?.finishReason || 'unknown';
                        throw new Error(`Gemini returned no content (reason: ${blockReason})`);
                    }

                    const normalized = {
                        choices: [{
                            message: { content: text }
                        }]
                    };
                    return new Response(JSON.stringify(normalized), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                errorMsg += ` | Gemini Error: ${response.status}`;
            } catch (e) {
                errorMsg += ` | Gemini Failed: ${(e as Error).message}`;
            }
        }

        // 3. Try OpenRouter (Last resort)
        if (OPENROUTER_KEY) {
            try {
                const openRouterModel = Deno.env.get('OPENROUTER_MODEL') || "meta-llama/llama-3.3-70b-instruct";
                response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${OPENROUTER_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: openRouterModel,
                        messages: messages
                    })
                });

                if (response.status === 200) {
                    const data = await response.json();
                    return new Response(JSON.stringify(data), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                errorMsg += ` | OpenRouter Error: ${response.status}`;
            } catch (e) {
                errorMsg += ` | OpenRouter Failed: ${(e as Error).message}`;
            }
        }

        throw new Error(`All AI providers failed. ${errorMsg}`);

    } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
