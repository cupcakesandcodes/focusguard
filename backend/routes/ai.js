const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ── Model: Gemini 2.0 Flash Lite (Fast and Efficient) ──
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── In-memory result cache: videoId → { result, cachedAt } ──
// Key: SHA-1-like string of "goal|videoTitle|channel"
// Cached results expire after 7 days
const resultCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCacheKey(goal, videoTitle, videoChannel = '', userJustification = '') {
    // Normalize so minor differences don't bypass cache
    const normalized = [goal, videoTitle, videoChannel, userJustification]
        .map(s => s.toLowerCase().trim())
        .join('|');
    return Buffer.from(normalized).toString('base64').slice(0, 64);
}

function getCached(key) {
    const entry = resultCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        resultCache.delete(key);
        return null;
    }
    return entry.result;
}

// Trim cache if it grows too large (>5000 entries)
function pruneCache() {
    if (resultCache.size > 5000) {
        const now = Date.now();
        for (const [key, val] of resultCache) {
            if (now - val.cachedAt > CACHE_TTL_MS) resultCache.delete(key);
        }
    }
}

// ── Daily scan limit ──
const DAILY_AI_LIMIT = parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 150;

// ─────────────────────────────────────────
// Keyword-based check (FREE — no auth)
// ─────────────────────────────────────────
router.post('/check-keyword', async (req, res) => {
    try {
        const { goal, videoTitle, videoDescription } = req.body;

        if (!goal || !videoTitle) {
            return res.status(400).json({ error: 'Goal and video title required' });
        }

        const stopWords = new Set(['and', 'for', 'the', 'with', 'how', 'to', 'in', 'on', 'at', 'a', 'an', 'of', 'is', 'it']);
        const goalKeywords = goal
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .split(' ')
            .filter(w => w.length >= 2 && !stopWords.has(w));

        const videoContext = `${videoTitle} ${videoDescription || ''}`.toLowerCase();
        const matchedKeywords = goalKeywords.filter(kw => videoContext.includes(kw));
        const isRelevant = matchedKeywords.length > 0;

        res.json({
            isRelevant,
            method: 'keyword',
            confidence: isRelevant ? Math.min(0.4 + matchedKeywords.length * 0.1, 0.75) : 0.25
        });
    } catch (error) {
        console.error('Keyword check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────
// AI-based check (PREMIUM — requires auth)
// Uses Gemini 2.0 Flash Lite + result caching
// ─────────────────────────────────────────
router.post('/check-ai', authMiddleware, async (req, res) => {
    try {
        const { goal, videoTitle, videoDescription, videoChannel, userJustification } = req.body;

        if (!goal || (!videoTitle && !videoDescription)) {
            return res.status(400).json({ error: 'Goal and page context required' });
        }

        const user = req.user;
        const profile = req.profile; // set by authMiddleware

        // ── Check subscription ──
        if (profile.subscription_tier !== 'premium' || profile.subscription_status !== 'active') {
            return res.status(403).json({
                error: 'AI Monitor requires a Premium subscription',
                upgradeUrl: process.env.PRICING_PAGE_URL || '/pricing'
            });
        }

        // ── Check daily limit ──
        const lastReset = new Date(profile.usage_ai_last_reset);
        const now = new Date();
        const isNewDay = now.toDateString() !== lastReset.toDateString();
        const todayCount = isNewDay ? 0 : profile.usage_ai_checks_today;

        if (todayCount >= DAILY_AI_LIMIT) {
            return res.status(429).json({
                error: `Daily AI scan limit reached (${DAILY_AI_LIMIT}/day). Resets at midnight.`,
                limit: DAILY_AI_LIMIT,
                used: todayCount,
                resetsAt: new Date(now.setHours(24, 0, 0, 0)).toISOString()
            });
        }

        // ── Check cache ──
        const cacheKey = getCacheKey(goal, videoTitle, videoChannel || '', userJustification || '');
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                method: 'ai',
                fromCache: true,
                remainingScans: DAILY_AI_LIMIT - todayCount
            });
        }

        // ── Call Gemini ──
        const url = req.body.url || '';

        let prompt = `You are a focus assistant for a productivity extension. Determine if this web page is relevant to the user's goal.

User's Goal: "${goal}"

Page Info:
- Title: ${videoTitle}
- Site/Channel: ${videoChannel || 'N/A'}
- URL: ${url}
- Description/Content: ${(videoDescription || '').slice(0, 500)}`;

        if (userJustification) {
            prompt += `
            
The user was previously blocked from this page, but they submitted a justification for why they need it:
User's Justification: "${userJustification}"

Evaluate their justification considering their goal and the page content. If their reasoning relates to research, learning, productivity, or work, you MUST allow it (isRelevant: true). FocusGuard should stay out of the way of legitimate work. Only block if the justification is clearly unrelated or an attempt to bypass the monitor for entertainment.`;
        } else {
            prompt += `
            
IMPORTANT RULES:
1. Use the URL as a strong signal. developer.mozilla.org, docs.*, github.com, stackoverflow.com, npmjs.com, w3schools.com, official docs, tutorials = highly likely relevant.
2. AI Tools (chatgpt.com, openai.com, claude.ai, gemini.google.com, perplexity.ai) = Almost always relevant for productivity and research goals. Mark as relevant.
3. Search engine results (google.com/search, bing.com) = relevant if the query relates to the goal.
4. Be VERY LENIENT with documentation, reference, and learning sites. If the goal is technical, research-based, or work-related, lean heavily toward relevant.
5. Only mark NOT relevant if the page is clearly unrelated entertainment/social content (gaming, sports, movies) for a non-matching goal.`;
        }

        prompt += `

Reply ONLY with a JSON object, no markdown, no code fences:
{"isRelevant": true/false, "confidence": 0.0-1.0, "reasoning": "one short sentence explaining why"}`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        // Parse — handle both raw JSON and code-fenced JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Invalid AI response format');

        const aiResult = JSON.parse(jsonMatch[0]);

        // ── Store in cache ──
        pruneCache();
        resultCache.set(cacheKey, { result: aiResult, cachedAt: Date.now() });

        // ── Increment usage in Supabase ──
        const { supabase } = require('../supabase');
        await supabase
            .from('profiles')
            .update({
                usage_ai_checks_today: isNewDay ? 1 : todayCount + 1,
                usage_ai_checks_total: profile.usage_ai_checks_total + 1,
                usage_ai_last_reset: isNewDay ? now.toISOString() : profile.usage_ai_last_reset
            })
            .eq('id', user.id);

        res.json({
            ...aiResult,
            method: 'ai',
            fromCache: false,
            remainingScans: DAILY_AI_LIMIT - todayCount - 1
        });

    } catch (error) {
        console.error('AI check error:', error.message);
        console.error('AI check stack:', error.stack);
        res.status(500).json({ error: 'AI analysis failed. Please try again.', detail: error.message });
    }
});

// ─────────────────────────────────────────
// Usage stats (PREMIUM)
// ─────────────────────────────────────────
router.get('/usage', authMiddleware, async (req, res) => {
    const profile = req.user.profile;
    const lastReset = new Date(profile.usage_ai_last_reset);
    const now = new Date();
    const isNewDay = now.toDateString() !== lastReset.toDateString();

    res.json({
        today: isNewDay ? 0 : profile.usage_ai_checks_today,
        total: profile.usage_ai_checks_total,
        limit: DAILY_AI_LIMIT,
        remaining: DAILY_AI_LIMIT - (isNewDay ? 0 : profile.usage_ai_checks_today),
        cacheSize: resultCache.size
    });
});

module.exports = router;
