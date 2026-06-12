/**
 * RefineAI — Shared Configuration
 * Single source of truth for all constants, limits, and prompts.
 * Imported by: sidepanel.html (before sidepanel.js and auth-service.js)
 */

window.REFINE_CONFIG = Object.freeze({

    // ─── Plan Limits ───
    PLANS: {
        free: { name: 'Free', daily_limit: 2000, badge_class: 'free' },
        pro: { name: 'Pro', daily_limit: 20000, badge_class: 'pro' },
        premium: { name: 'Premium', daily_limit: 1000000, badge_class: 'premium' }
    },

    DEFAULT_DAILY_LIMIT: 2000,

    // ─── Supported Platforms (Smart Reply) ───
    PLATFORMS: {
        whatsapp: { match: 'whatsapp.com', label: 'WhatsApp', replyStyle: 'short, emoji-friendly, casual' },
        linkedin: { match: 'linkedin.com', label: 'LinkedIn', replyStyle: 'professional with proper greeting' },
        gmail: { match: 'mail.google.com', label: 'Gmail', replyStyle: 'structured email with greeting and signoff' },
        gchat: { match: 'chat.google.com', label: 'Google Chat', replyStyle: 'short, casual, to-the-point' },
        slack: { match: 'slack.com', label: 'Slack', replyStyle: 'casual, concise, may use emojis' }
    },

    // ─── Writing Engine ───
    SYSTEM_RULES: `You are a human writing expert and editor.
Core rules:
- Always sound natural and human-written (no robotic/generic/AI-like phrasing)
- Improve clarity, grammar, and flow while keeping meaning unchanged
- Avoid filler words and over-polishing
- Do not add new information
- Prioritize readability and clarity over complexity
- Return ONLY the final text, no explanations, no headings, no emojis.`,

    INTENTS: {
        rewrite: "Rewrite the text to improve clarity, grammar, and flow while keeping meaning exactly the same.",
        rephrase: "Rephrase the text using different wording while keeping the same meaning and tone.",
        grammar: "Fix all grammar, spelling, and punctuation errors. Return ONLY the corrected text, maintaining the original voice.",
        shorten: "Shorten the text while preserving key meaning and important details. Remove redundancy without losing intent.",
        expand: "Expand the text with natural details. Avoid sounding artificial.",
        tone: (t) => `Adjust the tone of the text to be ${t} without changing meaning.`
    },

    TONE_HINTS: {
        Formal: "Polite, structured, and using neutral vocabulary.",
        Informal: "Conversational, friendly, and using shorter sentences.",
        Professional: "Clear, confident, and avoiding slang."
    },

    // ─── Persona Sanitization ───
    SANITIZE_REGEX: /ignore\s*(previous\s*)?rules|as\s*ai|system\s*(prompt|message)?|assistant|ignore\s*(all\s*)?instructions|you\s*are\s*now|forget\s*(everything|instructions)|act\s*as|pretend\s*to\s*be|new\s*instructions|override|jailbreak|do\s*anything\s*now|\[\s*system\s*\]|\[\s*assistant\s*\]/gi,

    PERSONA_MAX_LENGTH: 300,

    // ─── Limit Check Multiplier (input × this = estimated total cost) ───
    LIMIT_MULTIPLIER: 2.5,

    // ─── Cache Settings ───
    CACHE_MAX_ENTRIES: 50,
    CACHE_TTL_MS: 3600000, // 1 hour

    // ─── Version ───
    VERSION: '1.2'
});
