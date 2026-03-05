/**
 * ============================================================
 *  FocusGuard — AI Monitor (PREMIUM ONLY)
 *  content/ai/ai-monitor.js
 *
 *  This module is the ONLY place in the extension that talks
 *  to the backend AI endpoint.  It never calls Gemini directly
 *  — the API key lives on the server only.
 *
 *  Usage (from a platform script):
 *    window.aiMonitor.checkContent(payload)  → Promise<AIResult>
 *    window.aiMonitor.isAvailable()          → bool
 * ============================================================
 */

const AI_MONITOR_VERSION = '1.0.0';

// ── Config ──────────────────────────────────────────────────
// Backend URL — set this to wherever your Express server lives.
// In production this will be something like https://api.focusguard.app
const BACKEND_URL = 'http://localhost:3000/api';

// How long to cache a result locally (ms) to avoid hammering
// the backend for the same video in the same session.
const SESSION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Session-level cache (cleared on page reload) ─────────────
const _cache = new Map(); // key → { result, ts }

function _cacheKey(goal, title, channel = '') {
    return btoa([goal, title, channel].map(s => s.toLowerCase().trim()).join('|')).slice(0, 64);
}

function _getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > SESSION_CACHE_TTL) { _cache.delete(key); return null; }
    return entry.result;
}

// ── State ─────────────────────────────────────────────────────
let _token = null;          // Supabase access token
let _isPremium = false;     // Only true if subscription_tier === 'premium' & active

// Load auth state from storage once on init
chrome.storage.local.get(['authToken', 'isPremium'], ({ authToken, isPremium }) => {
    _token = authToken || null;
    _isPremium = isPremium || false;
    console.log(`[AI Monitor v${AI_MONITOR_VERSION}] loaded — premium: ${_isPremium}`);
});

// Stay in sync if popup logs in/out mid-session
chrome.storage.onChanged.addListener((changes) => {
    if (changes.authToken) _token = changes.authToken.newValue || null;
    if (changes.isPremium) _isPremium = changes.isPremium.newValue || false;
});

// ── Public API ────────────────────────────────────────────────

/**
 * Returns true if the user is logged in AND has an active premium subscription.
 */
function isAvailable() {
    return _isPremium && !!_token;
}

/**
 * Checks whether content is relevant to the user's goal via the
 * backend AI endpoint (Gemini 1.5 Flash, server-side, key never exposed).
 *
 * @param {{ goal: string, title: string, channel?: string, description?: string }} payload
 * @returns {Promise<{ isRelevant: boolean, confidence: number, reasoning: string, fromCache: boolean, remainingScans?: number }>}
 */
async function checkContent({ goal, title, channel = '', description = '' }) {
    if (!isAvailable()) {
        throw new Error('AI Monitor not available — user is not premium or not logged in');
    }

    if (!goal || !title) {
        throw new Error('goal and title are required');
    }

    // ── Session cache hit ──
    const key = _cacheKey(goal, title, channel);
    const cached = _getCached(key);
    if (cached) {
        console.log('[AI Monitor] cache hit →', title.slice(0, 40));
        return { ...cached, fromCache: true };
    }

    // ── Backend request ──
    console.log('[AI Monitor] calling backend for →', title.slice(0, 40));

    const response = await fetch(`${BACKEND_URL}/ai/check-ai`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${_token}`
        },
        body: JSON.stringify({
            goal,
            videoTitle: title,
            videoDescription: description.slice(0, 400),
            videoChannel: channel
        })
    });

    // Handle known error cases gracefully
    if (response.status === 401) {
        // Token expired — clear it so the platform script falls back to keyword mode
        _token = null;
        _isPremium = false;
        chrome.storage.local.set({ authToken: null, isPremium: false });
        throw new Error('AUTH_EXPIRED');
    }

    if (response.status === 403) {
        throw new Error('NOT_PREMIUM');
    }

    if (response.status === 429) {
        const data = await response.json();
        throw new Error(`LIMIT_REACHED:${data.resetsAt || ''}`);
    }

    if (!response.ok) {
        throw new Error(`Backend error ${response.status}`);
    }

    const result = await response.json();

    // Cache the successful result
    _cache.set(key, { result, ts: Date.now() });

    return result;
}

/**
 * Returns how many AI scans remain today (fetched from backend).
 * Returns null if not available.
 */
async function getUsage() {
    if (!isAvailable()) return null;
    try {
        const res = await fetch(`${BACKEND_URL}/ai/usage`, {
            headers: { 'Authorization': `Bearer ${_token}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ── Expose on window so platform scripts can use it ──────────
window.aiMonitor = {
    isAvailable,
    checkContent,
    getUsage,
    version: AI_MONITOR_VERSION
};

console.log(`[AI Monitor v${AI_MONITOR_VERSION}] ready`);
