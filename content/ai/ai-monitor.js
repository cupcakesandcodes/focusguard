/**
 * ============================================================
 *  FocusGuard — AI Monitor Module (PREMIUM)
 *  content/ai/ai-monitor.js
 *
 *  Loaded BEFORE platform scripts (see manifest.json).
 *  Exposes window.aiMonitor with:
 *    - checkAndBlock(goal, videoData)  → runs AI check, blocks page if off-topic
 *    - recheck(goal, videoData)        → re-run AI check after user disputes (unblocks if AI agrees)
 * ============================================================
 */

(() => {
    const BACKEND_URL = 'http://127.0.0.1:3000/api';

    // ── Auth state ──────────────────────────────────
    let _token = null;
    let _isPremium = false;

    // Load on init and stay in sync
    chrome.storage.local.get(['authToken', 'isPremium'], ({ authToken, isPremium }) => {
        _token = authToken || null;
        _isPremium = isPremium || false;
        console.log('[AI Monitor] Loaded — premium:', _isPremium, '| token:', !!_token);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.authToken !== undefined) _token = changes.authToken.newValue || null;
        if (changes.isPremium !== undefined) _isPremium = changes.isPremium.newValue || false;
        console.log('[AI Monitor] State updated — premium:', _isPremium);
    });

    // ── isAvailable ─────────────────────────────────
    function isAvailable() {
        return _isPremium && !!_token;
    }

    // ── Token refresh ────────────────────────────────
    async function _tryRefreshToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['refreshToken'], (result) => {
                if (!result.refreshToken) return resolve(false);
                chrome.runtime.sendMessage({
                    action: "refreshToken",
                    refreshToken: result.refreshToken
                }, (response) => {
                    if (response && response.ok && response.data.access_token) {
                        _token = response.data.access_token;
                        chrome.storage.local.set({
                            authToken: _token,
                            refreshToken: response.data.refresh_token || result.refreshToken
                        });
                        console.log('[AI Monitor] Token refreshed successfully via background');
                        resolve(true);
                    } else {
                        console.warn('[AI Monitor] Refresh failed via background');
                        resolve(false);
                    }
                });
            });
        });
    }

    // ── Core fetch function (proxied through background) ──
    async function _fetchAI(goal, videoData, isRetry = false, userJustification = '') {
        return new Promise((resolve, reject) => {
            const payload = {
                goal,
                videoTitle: videoData.title || '',
                videoChannel: videoData.channel || '',
                videoDescription: videoData.description || '',
                url: videoData.url || window.location.href,
                userJustification
            };

            chrome.runtime.sendMessage({
                action: 'fetchAI',
                token: _token,
                payload
            }, async (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[AI Monitor] Extension connection error:', chrome.runtime.lastError);
                    return reject(new Error('Background script disconnected'));
                }

                if (!response) {
                    return reject(new Error('No response from background'));
                }

                const { status, ok, data } = response;

                if (status === 401 && !isRetry) {
                    console.log('[AI Monitor] Token expired — attempting refresh...');
                    const refreshed = await _tryRefreshToken();
                    if (refreshed) {
                        try {
                            const retryRes = await _fetchAI(goal, videoData, true);
                            return resolve(retryRes);
                        } catch (err) {
                            return reject(err);
                        }
                    }
                    console.warn('[AI Monitor] Refresh failed — user needs to sign in again');
                    return reject(new Error('Session expired. Please sign in again from the extension popup.'));
                }

                if (!ok) {
                    console.error('[AI Monitor] Backend error response:', data);
                    return reject(new Error(data.detail || data.error || `HTTP ${status}`));
                }

                resolve(data);
            });
        });
    }

    // ── Scanning notice (small bottom-right badge) ──
    function _showScanningNotice(message) {
        _removeScanningNotice();
        const el = document.createElement('div');
        el.id = 'fg-ai-notice';
        el.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            background: rgba(20,20,60,0.97); color: #c8d6ff;
            padding: 12px 20px; border-radius: 12px;
            font-family: system-ui, sans-serif; font-size: 13px;
            z-index: 2147483647; border: 1px solid rgba(100,120,255,0.5);
            display: flex; align-items: center; gap: 10px;
            box-shadow: 0 4px 20px rgba(0,0,70,0.5);
            animation: fg-fadein 0.3s ease;
        `;
        el.innerHTML = `<span style="font-size:16px;">🤖</span> ${message}`;
        document.body.appendChild(el);

        // inject keyframe once
        if (!document.getElementById('fg-anim-style')) {
            const s = document.createElement('style');
            s.id = 'fg-anim-style';
            s.textContent = `
                @keyframes fg-fadein { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
                @keyframes fg-spin   { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(s);
        }
    }

    function _removeScanningNotice() {
        document.getElementById('fg-ai-notice')?.remove();
    }

    // ── Full-screen block overlay ────────────────────
    function _showBlockOverlay(goal, videoData, aiResult, onRecheck) {
        _removeBlockOverlay();

        // Pause video immediately
        document.querySelector('video')?.pause();

        const overlay = document.createElement('div');
        overlay.id = 'fg-block-overlay';

        // Smart placement logic: if we are on Reddit or YouTube, leave the top header (search bar) unblocked
        const isReddit = window.location.hostname.includes('reddit.com');
        const isYouTube = window.location.hostname.includes('youtube.com');
        const insetRule = (isReddit || isYouTube) ? 'top: 56px; left: 0; right: 0; bottom: 0;' : 'inset: 0;';

        overlay.style.cssText = `
            position: fixed; ${insetRule}
            background: rgba(10, 10, 10, 0.95);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            z-index: 2147483647;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        `;

        const confidence = aiResult?.confidence ?? null;
        const reasoning = aiResult?.reasoning ?? 'This page does not appear related to your goal.';

        overlay.innerHTML = `
            <div style="
                max-width: 520px; width: 90%;
                background: #1a1a1a;
                border: 1px solid #333;
                border-radius: 16px; padding: 40px;
                text-align: center; color: #e0e0e0;
                box-shadow: 0 20px 40px rgba(0,0,0,0.8);
                display: flex; flex-direction: column; gap: 24px;
            ">
                <div>
                    <div style="
                        width: 48px; height: 48px; 
                        background: rgba(255, 82, 82, 0.1); 
                        border: 1px solid rgba(255, 82, 82, 0.3);
                        border-radius: 12px; margin: 0 auto 16px; 
                        display: flex; align-items: center; justify-content: center;
                    ">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff5252" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                    </div>
                    <h2 style="
                        margin: 0; font-size: 1.5rem; color: #fff; font-weight: 700;
                        letter-spacing: -0.5px;
                    ">Focus Blocked</h2>
                    <p style="margin: 8px 0 0; color: #888; font-size: 0.95rem;">
                        This page conflicts with your active session goal.
                    </p>
                </div>

                <div style="
                    background: #0a0a0a; border: 1px solid #222;
                    border-radius: 12px; padding: 16px; text-align: left;
                ">
                    <p style="
                        font-size: 0.75rem; text-transform: uppercase; 
                        letter-spacing: 0.5px; color: #4CAF50; 
                        font-weight: 700; margin: 0 0 8px;
                    ">Active Goal</p>
                    <p style="margin: 0; color: #fff; font-weight: 500; font-size: 1rem;">
                        "${goal}"
                    </p>
                </div>

                <div style="
                    background: rgba(255,82,82,0.05); border: 1px solid rgba(255,82,82,0.15);
                    border-radius: 12px; padding: 16px; text-align: left;
                ">
                    <p style="
                        font-size: 0.75rem; text-transform: uppercase; 
                        letter-spacing: 0.5px; color: #ff5252; 
                        font-weight: 700; margin: 0 0 8px;
                    ">AI Analysis</p>
                    <p style="margin: 0; color: #e0e0e0; font-size: 0.95rem; line-height: 1.5;">
                        ${reasoning}
                    </p>
                    ${confidence !== null ? '<p style="color:#666;font-size:0.75rem;margin:8px 0 0;font-weight:500;">Confidence: ' + Math.round(confidence * 100) + '%</p>' : ''}
                </div>

                <div style="display:flex; flex-direction:column; gap:12px; margin-top: 8px;">
                    <textarea id="fg-justification-input" placeholder="Justify relevance... (e.g. 'I am researching design patterns for my project')" style="
                        width: 100%; padding: 14px; font-size: 0.95rem; font-family: inherit;
                        background: #0a0a0a; color: white;
                        border: 1px solid #333; border-radius: 10px;
                        resize: vertical; min-height: 60px; outline: none; box-sizing: border-box;
                        transition: all 0.2s ease;
                    " onfocus="this.style.borderColor='#4CAF50'" onblur="this.style.borderColor='#333'"></textarea>

                    <button id="fg-btn-claim" style="
                        width: 100%; padding: 14px; font-size: 0.95rem; font-weight: 600;
                        background: linear-gradient(135deg, #4CAF50, #00C853);
                        color: white; border: none; border-radius: 10px; cursor: pointer;
                        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.2);
                        transition: all 0.2s ease;
                    ">Submit Justification</button>

                    <button id="fg-btn-back" style="
                        width: 100%; padding: 14px; font-size: 0.95rem; font-weight: 500;
                        background: transparent; color: #aaa;
                        border: 1px solid #333; border-radius: 10px; cursor: pointer;
                        transition: all 0.2s ease;
                    " onmouseover="this.style.background='#111'; this.style.color='#fff'" onmouseleave="this.style.background='transparent'; this.style.color='#aaa'">← Close Tab</button>
                </div>

                <p style="color: #444; font-size: 0.75rem; margin: 0; font-weight: 500; letter-spacing: 0.5px;">
                    FOCUSGUARD PREMIUM • GEMINI AI
                </p>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('fg-btn-back').onclick = () => {
            window.location.href = 'https://www.google.com';
        };

        const claimBtn = document.getElementById('fg-btn-claim');
        const inputField = document.getElementById('fg-justification-input');

        claimBtn.onmouseenter = () => { claimBtn.style.opacity = '0.9'; };
        claimBtn.onmouseleave = () => { claimBtn.style.opacity = '1'; };
        claimBtn.onclick = async () => {
            const justification = inputField.value.trim();
            if (!justification) {
                inputField.style.borderColor = '#ff7070';
                inputField.focus();
                return;
            }
            claimBtn.textContent = '⏳ Evaluating...';
            claimBtn.disabled = true;
            inputField.disabled = true;
            await onRecheck(justification);
        };
    }

    function _removeBlockOverlay() {
        document.getElementById('fg-block-overlay')?.remove();
    }

    // ── Public API ───────────────────────────────────

    /**
     * Run AI check. If off-topic, block the full page.
     * @param {string} goal
     * @param {{ title, channel, description }} videoData
     */
    async function checkAndBlock(goal, videoData) {
        // Always re-read token fresh from storage
        return new Promise((resolve) => {
            chrome.storage.local.get(['authToken', 'isPremium'], async ({ authToken, isPremium }) => {
                _token = authToken || null;
                _isPremium = isPremium || false;

                if (!_token || !_isPremium) {
                    console.warn('[AI Monitor] Not available — no token or not premium');
                    resolve({ used: false });
                    return;
                }

                _showScanningNotice('AI Monitor scanning video...');
                try {
                    const result = await _fetchAI(goal, videoData);
                    _removeScanningNotice();

                    console.log('[AI Monitor] Raw AI Result Payload:', result);
                    console.log('[AI Monitor] Result:', result.isRelevant ? '✅ RELEVANT' : '❌ BLOCKED', '| Confidence:', result.confidence);
                    if (result.reasoning) console.log('[AI Monitor] Reason:', result.reasoning);

                    if (!result.isRelevant) {
                        _showBlockOverlay(goal, videoData, result, (just) => recheck(goal, videoData, just));
                    } else {
                        // If it is relevant (e.g. user navigated to a useful search result),
                        // actively remove the block overlay if it exists from a previous page
                        _removeBlockOverlay();
                    }

                    resolve({ used: true, isRelevant: result.isRelevant, result });
                } catch (err) {
                    _removeScanningNotice();
                    console.error('[AI Monitor] Error:', err.message);
                    resolve({ used: false, error: err.message });
                }
            });
        });
    }

    // Local cache to prevent immediate re-blocking on SPAs after user justifies a page
    const _justifiedUrls = new Set();

    /**
     * Re-check after user disputes the AI block.
     * Unblocks only if AI now agrees the content is relevant.
     */
    async function recheck(goal, videoData, userJustification = '') {
        _showScanningNotice('Evaluating justification...');
        try {
            const result = await _fetchAI(goal, videoData, false, userJustification);
            _removeScanningNotice();

            console.log('[AI Monitor] Re-check result:', result.isRelevant ? '✅ JUSTIFICATION ACCEPTED — UNBLOCKED' : '❌ JUSTIFICATION REJECTED — STILL BLOCKED');

            if (result.isRelevant) {
                // Add to local whitelist so the SPA mutation observer doesn't immediately re-block it
                _justifiedUrls.add(window.location.href);
                _removeBlockOverlay();
                console.log('[AI Monitor] User claim confirmed — page unblocked temporarily.');
            } else {
                // Update overlay with new reasoning
                _showBlockOverlay(goal, videoData, result, (just) => recheck(goal, videoData, just));
            }
        } catch (err) {
            _removeScanningNotice();
            console.error('[AI Monitor] Re-check error:', err.message);
        }
    }

    // ── Attach to window ─────────────────────────────
    window.aiMonitor = {
        isAvailable,
        checkAndBlock,
        recheck
    };

    console.log('[AI Monitor] Module loaded ✓');

    // ── Auto-scan for Platform Sites (SPAs) ──────────
    // YouTube handles its own scanning because it's a SPA with dynamic video loading.
    // For other platform sites (Reddit, Facebook, LinkedIn, etc)
    const platformSites = [
        'reddit.com', 'twitter.com', 'x.com', 'instagram.com',
        'facebook.com', 'tiktok.com', 'twitch.tv', 'netflix.com',
        'discord.com', 'linkedin.com', 'pinterest.com'
    ];

    const hostname = window.location.hostname;

    // VERY IMPORTANT: Check HOSTNAME strictly
    const isPlatformSite = platformSites.some(site => hostname === site || hostname.endsWith('.' + site));
    const isYouTube = hostname.includes('youtube.com');

    // YouTube now uses the universal platform scan for search and channel pages
    if ((isPlatformSite || isYouTube)) {

        const runPlatformScan = () => {
            if (_justifiedUrls.has(window.location.href)) return;

            chrome.storage.local.get(['aiMonitor', 'currentGoal', 'activeSession'], (result) => {
                if (!result.aiMonitor || !result.currentGoal || !result.activeSession) return;

                console.log(`[AI Monitor] Auto-scanning platform site: ${hostname}`);

                // Enhanced Context Extraction for YouTube
                let title = document.title;
                let description = "";

                if (isYouTube) {
                    const urlParams = new URLSearchParams(window.location.search);
                    const searchQuery = urlParams.get('search_query');
                    if (searchQuery) {
                        description = `YouTube Search Query: ${searchQuery}`;
                    }

                    // Check if we are on a channel page
                    if (window.location.pathname.startsWith('/@') || window.location.pathname.includes('/channel/')) {
                        const channelName = document.querySelector('ytd-channel-name yt-formatted-string')?.textContent ||
                            document.querySelector('#channel-name')?.textContent || "";
                        description += ` | Viewing YouTube Channel: ${channelName}`;
                    }
                }

                if (!description) {
                    const mainTextEl = document.querySelector('main, [role="main"], article, .feed, #stream, #content');
                    description = mainTextEl?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1000) ||
                        document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 1000);
                }

                const pageData = {
                    title: title,
                    channel: hostname,
                    description: description,
                    url: window.location.href
                };

                console.log('[AI Monitor] Sending to Gemini:', pageData);

                checkAndBlock(result.currentGoal, pageData).catch(err => {
                    console.error('[AI Monitor] Auto-scan error:', err);
                });
            });
        };

        // 1. Initial Scan on page load (wait 4s for DOM to build)
        setTimeout(runPlatformScan, 4000);

        // 2. Continuous Scan on SPA Navigation
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('[AI Monitor] URL changed, checking if scan is needed...');

                if (_justifiedUrls.has(location.href)) {
                    console.log('[AI Monitor] Auto-scan skipped for justified URL.');
                    return;
                }

                // Show a quick scanning notice while waiting for new content to load
                _showScanningNotice('Waiting for new page to load...');

                setTimeout(() => {
                    runPlatformScan();
                }, 3000); // Wait 3s after URL change for React/SPA to render new feed
            }
        }).observe(document.body, { subtree: true, childList: true });
    }
})();
