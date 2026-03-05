const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ── Model: Gemini 1.5 Flash (~20x cheaper than Pro) ──
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ── In-memory result cache: videoId → { result, cachedAt } ──
// Key: SHA-1-like string of "goal|videoTitle|channel"
// Cached results expire after 7 days
const resultCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCacheKey(goal, videoTitle, videoChannel = '') {
    // Normalize so minor differences don't bypass cache
    const normalized = [goal, videoTitle, videoChannel]
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
// Uses Gemini 1.5 Flash + result caching
// ─────────────────────────────────────────
router.post('/check-ai', authMiddleware, async (req, res) => {
    try {
        const { goal, videoTitle, videoDescription, videoChannel } = req.body;

        if (!goal || !videoTitle) {
            return res.status(400).json({ error: 'Goal and video title required' });
        }

        const user = req.user;

        // ── Check subscription ──
        if (user.subscription_tier !== 'premium' || user.subscription_status !== 'active') {
            return res.status(403).json({
                error: 'AI Monitor requires a Premium subscription',
                upgradeUrl: process.env.PRICING_PAGE_URL || '/pricing'
            });
        }

        // ── Check daily limit ──
        const profile = user.profile; // attached by middleware
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
        const cacheKey = getCacheKey(goal, videoTitle, videoChannel || '');
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                method: 'ai',
                fromCache: true,
                remainingScans: DAILY_AI_LIMIT - todayCount
            });
        }

        // ── Call Gemini 1.5 Flash ──
        const prompt = `You are a focus assistant. Determine if this content is relevant to the user's goal.

User's Goal: "${goal}"

Content:
- Title: ${videoTitle}
- Channel: ${videoChannel || 'N/A'}
- Description: ${(videoDescription || '').slice(0, 300)}

Reply ONLY with a JSON object, no markdown:
{"isRelevant": true/false, "confidence": 0.0-1.0, "reasoning": "one sentence"}

Be strict. Entertainment unrelated to the goal = not relevant.`;

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
        console.error('AI check error:', error);
        res.status(500).json({ error: 'AI analysis failed. Please try again.' });
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
