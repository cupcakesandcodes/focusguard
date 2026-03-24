const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ── Model: Gemini 3.1 Flash Lite (with thinking disabled for speed) ──
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 100,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }
    }
});

// ── In-memory result cache: videoId → { result, cachedAt } ──
// Key: SHA-1-like string of "goal|videoTitle|channel"
// Cached results expire after 7 days
const resultCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCacheKey(goal, videoTitle, videoChannel = '', videoDescription = '', userJustification = '') {
    const SCAN_SPEC = 'v9'; // V9: Precise YouTube DOM extraction (watch/search/home)
    const normalized = [SCAN_SPEC, goal, videoTitle, videoChannel, videoDescription, userJustification]
        .map(s => (s || '').toLowerCase().trim())
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

/* 
// ─────────────────────────────────────────
// Keyword-based check (LEGACY — Disabled)
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
*/

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
        const cacheKey = getCacheKey(goal, videoTitle, videoChannel || '', videoDescription || '', userJustification || '');
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                method: 'ai',
                fromCache: true,
                remainingScans: DAILY_AI_LIMIT - todayCount
            });
        }

        // ── Call Gemini AI ──
        const url = req.body.url || '';
        const content = (videoDescription || '').slice(0, 500);

        let prompt;
        if (userJustification) {
            prompt = `Goal: "${goal}". User was blocked but justifies: "${userJustification}". Page: "${videoTitle}" (${url}). Content snippet: ${content}. If justification relates to learning, research, or work, allow it. JSON: {"isRelevant":bool,"confidence":number,"reasoning":"brief"}`;
        } else {
            prompt = `Goal: "${goal}". Page: "${videoTitle}" (${url}). Context: ${content}.
Instructions: Is this page relevant to the goal?
1. **Relevance Logic**: Allow any content that is a logical sub-topic, prerequisite, supporting tool, or professional reference related to the user's goal.
2. **Professional Tolerance**: Be lenient toward technical documentation, educational tutorials, and professional search results. FocusGuard should only block clear "mindless distractions" that have NO plausible link to the goal.
3. **Broad vs Specific**: If the goal is a specific topic, ignore broad/generic social feeds unless they are specifically filtered for that topic.
4. **Primary vs Supporting**: Avoid blocking content simply because it isn't an *exact* match. If the content supports the user's progress toward the goal (even indirectly), allow it.
JSON ONLY: {"isRelevant":bool,"confidence":number,"reasoning":"brief"}`;
        }

        const timerId = `GEMINI-${Date.now()}`;
        console.time(timerId);
        const result = await model.generateContent(prompt);
        const aiResult = JSON.parse(result.response.text());
        console.timeEnd(timerId);

        // ── Store in cache ──
        pruneCache();
        resultCache.set(cacheKey, { result: aiResult, cachedAt: Date.now() });

        // ── Respond IMMEDIATELY ──
        res.json({
            ...aiResult,
            method: 'ai',
            fromCache: false,
            remainingScans: DAILY_AI_LIMIT - todayCount - 1
        });

        // ── Increment usage in Supabase (don't await, let it run in background) ──
        const { supabase } = require('../supabase');
        supabase
            .from('profiles')
            .update({
                usage_ai_checks_today: isNewDay ? 1 : todayCount + 1,
                usage_ai_checks_total: profile.usage_ai_checks_total + 1,
                usage_ai_last_reset: isNewDay ? now.toISOString() : profile.usage_ai_last_reset
            })
            .eq('id', user.id)
            .then(() => console.log(`✅ Usage updated for user ${user.id}`))
            .catch(err => console.error(`❌ Usage update failed for user ${user.id}:`, err.message));

        return; // End the request handler here

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
