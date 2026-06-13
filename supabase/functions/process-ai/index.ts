import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getCorsHeaders(req: Request) {
    const origin = req.headers.get("Origin") || "";
    const isAllowedOrigin = origin.startsWith("chrome-extension://") || 
                            origin.includes("localhost") || 
                            origin.includes("127.0.0.1");
    return {
        'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'null',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}

function getInputWordCount(messages: any[]): number {
    let inputWordCount = 0;
    const fullPromptText = messages.map((m: any) => m.content || "").join(" ");
    
    const userTextMatch = fullPromptText.match(/<user_text>([\s\S]*?)<\/user_text>/);
    const emailContextMatch = fullPromptText.match(/<email_context>([\s\S]*?)<\/email_context>/);
    const convHistoryMatch = fullPromptText.match(/<conversation_history>([\s\S]*?)<\/conversation_history>/);
    
    if (userTextMatch) {
        inputWordCount = userTextMatch[1].split(/\s+/).filter((w: string) => w.length > 0).length;
    } else if (emailContextMatch) {
        inputWordCount = emailContextMatch[1].split(/\s+/).filter((w: string) => w.length > 0).length;
    } else if (convHistoryMatch) {
        inputWordCount = convHistoryMatch[1].split(/\s+/).filter((w: string) => w.length > 0).length;
    } else {
        inputWordCount = Math.min(200, fullPromptText.split(/\s+/).filter((w: string) => w.length > 0).length);
    }
    return inputWordCount;
}

serve(async (req) => {
    const corsHeaders = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // --- MANDATORY AUTH VERIFICATION ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Unauthorized. Authentication required.' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

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

        // --- SERVER-SIDE QUOTA ENFORCEMENT ---
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('words_used, daily_limit, last_reset_date, plan_type')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'User profile not found' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Check if daily reset is needed (server time, UTC)
        const today = new Date().toISOString().split('T')[0];
        let currentWordsUsed = profile.words_used;
        
        if (profile.last_reset_date !== today) {
            // Reset the counter
            const { error: resetError } = await supabase
                .from('profiles')
                .update({ words_used: 0, last_reset_date: today })
                .eq('id', user.id);
            
            if (!resetError) {
                currentWordsUsed = 0;
            }
        }

        // Enforce quota - reject if over limit
        if (currentWordsUsed >= profile.daily_limit) {
            return new Response(JSON.stringify({ 
                error: 'Daily word limit reached',
                words_used: currentWordsUsed,
                daily_limit: profile.daily_limit,
                plan_type: profile.plan_type
            }), {
                status: 429,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { messages, action } = await req.json();

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            throw new Error('Invalid request: messages array is required.');
        }

        const inputWordCount = getInputWordCount(messages);

        const GROQ_KEY = Deno.env.get('GROQ_API_KEY');
        const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
        const ZAI_KEY = Deno.env.get('ZAI_API_KEY');
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
                    
                    // Calculate word count and atomically increment
                    const responseText = data.choices?.[0]?.message?.content || '';
                    const responseWordCount = responseText.split(/\s+/).filter((w: string) => w.length > 0).length;
                    const totalWordsToAdd = inputWordCount + responseWordCount;
                    
                    // Atomic increment - no race conditions
                    await supabase.rpc('increment_words_used', { 
                        user_id: user.id, 
                        words_to_add: totalWordsToAdd 
                    });
                    
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
                    
                    // Calculate word count and atomically increment
                    const responseWordCount = text.split(/\s+/).filter((w: string) => w.length > 0).length;
                    const totalWordsToAdd = inputWordCount + responseWordCount;
                    
                    // Atomic increment - no race conditions
                    await supabase.rpc('increment_words_used', { 
                        user_id: user.id, 
                        words_to_add: totalWordsToAdd 
                    });
                    
                    return new Response(JSON.stringify(normalized), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                errorMsg += ` | Gemini Error: ${response.status}`;
            } catch (e) {
                errorMsg += ` | Gemini Failed: ${(e as Error).message}`;
            }
        }

        // 3. Try Z.ai (Backup 2)
        if (ZAI_KEY) {
            try {
                const zaiModel = Deno.env.get('ZAI_MODEL') || "glm-5.1";
                response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${ZAI_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: zaiModel,
                        messages: messages
                    })
                });

                if (response.status === 200) {
                    const data = await response.json();
                    
                    // Calculate word count and atomically increment
                    const responseText = data.choices?.[0]?.message?.content || '';
                    const responseWordCount = responseText.split(/\s+/).filter((w: string) => w.length > 0).length;
                    const totalWordsToAdd = inputWordCount + responseWordCount;
                    
                    // Atomic increment - no race conditions
                    await supabase.rpc('increment_words_used', { 
                        user_id: user.id, 
                        words_to_add: totalWordsToAdd 
                    });
                    
                    return new Response(JSON.stringify(data), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                errorMsg += ` | Z.ai Error: ${response.status}`;
            } catch (e) {
                errorMsg += ` | Z.ai Failed: ${(e as Error).message}`;
            }
        }

        // 4. Try OpenRouter (Last resort)
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
                    
                    // Calculate word count and atomically increment
                    const responseText = data.choices?.[0]?.message?.content || '';
                    const responseWordCount = responseText.split(/\s+/).filter((w: string) => w.length > 0).length;
                    const totalWordsToAdd = inputWordCount + responseWordCount;
                    
                    // Atomic increment - no race conditions
                    await supabase.rpc('increment_words_used', { 
                        user_id: user.id, 
                        words_to_add: totalWordsToAdd 
                    });
                    
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
