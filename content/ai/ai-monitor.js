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
    let _isScanning = false;
    let _currentScanId = 0; // Prevent stale results during navigation
    let _cooldownUntil = 0; // Time in MS to skip scans until (for Rate Limiting)
    const _scanCache = new Map(); // URL → { isRelevant, confidence, reasoning, goal } (session-only)

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
            if (!_token) {
                console.warn('[AI Monitor] No auth token found, skipping AI scan.');
                return resolve({ used: false, error: 'Not authenticated' });
            }

            const payload = {
                goal,
                videoTitle: videoData.title || '',
                videoChannel: videoData.channel || '',
                videoDescription: videoData.description || '',
                url: videoData.url || window.location.href,
                userJustification
            };

            console.time('CONTENT-TO-BACKGROUND');
            console.time('BACKGROUND-WAIT');

            chrome.runtime.sendMessage({
                action: 'fetchAI',
                token: _token,
                payload
            }, async (response) => {
                try { console.timeEnd('BACKGROUND-WAIT'); } catch(e){}
                
                // If a new scan started while we were waiting, ignore this response
                if (window.location.href !== payload.url && !userJustification) {
                    console.log('[AI Monitor] Ignoring stale response for old URL');
                    return;
                }
                
                console.time('BACKEND-TO-CONTENT');
                if (chrome.runtime.lastError) {
                    console.error('[AI Monitor] Extension connection error:', chrome.runtime.lastError);
                    return reject(new Error('Background script disconnected'));
                }

                if (!response) {
                    return reject(new Error('No response from background'));
                }

                const { status, ok, data } = response;

                if (status === 429) {
                    console.warn('[AI Monitor] Rate limit hit (429). Cooling down for 60s.');
                    _cooldownUntil = Date.now() + 60000;
                    return reject(new Error('Daily scan limit reached. Please try again later.'));
                }

                if (status === 401 && !isRetry) {
                    console.log('[AI Monitor] Token expired — attempting refresh...');
                    const refreshed = await _tryRefreshToken();
                    if (refreshed) {
                        try {
                            const retryRes = await _fetchAI(goal, videoData, true, userJustification);
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

                console.timeEnd('BACKEND-TO-CONTENT');
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
        // Guard: If the URL has changed since the scan started, don't show the block
        const currentUrl = window.location.href;
        const scanUrl = videoData.url || currentUrl;
        if (currentUrl !== scanUrl) {
            console.log('[AI Monitor] Skipping block overlay: URL changed since scan.');
            return;
        }

        _removeBlockOverlay();

        // Pause video immediately
        document.querySelector('video')?.pause();

        const overlay = document.createElement('div');
        overlay.id = 'fg-block-overlay';

        // Smart placement: leave the search bar visible so users can navigate to a new topic
        const host = window.location.hostname;
        const isReddit = host.includes('reddit.com');
        const isYouTube = host.includes('youtube.com');
        const isX = host.includes('x.com') || host.includes('twitter.com');
        const isGoogle = host.includes('google.com');
        
        let insetRule = 'inset: 0;';
        if (isReddit) insetRule = 'top: 80px; left: 0; right: 0; bottom: 0;';
        else if (isYouTube) insetRule = 'top: 72px; left: 0; right: 0; bottom: 0;';
        else if (isX) insetRule = 'top: 64px; left: 0; right: 0; bottom: 0;';
        else if (isGoogle) insetRule = 'top: 80px; left: 0; right: 0; bottom: 0;';

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
     * @param {number} [scanId] - Optional ID to prevent stale results
     */
    async function checkAndBlock(goal, videoData, scanId = 0) {
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

                _isScanning = true;
                _showScanningNotice('Analysing content...');

                // ── Check session scan cache ──
                const pageUrl = videoData.url || window.location.href;
                const cached = _scanCache.get(pageUrl);
                if (cached && cached.goal === goal) {
                    console.log(`⚡ [AI Monitor] Cache HIT for ${pageUrl}`);
                    _isScanning = false;
                    _removeScanningNotice();
                    if (scanId !== 0 && scanId !== _currentScanId) {
                        console.log('[AI Monitor] Aborting block: stale scan ID');
                        return;
                    }
                    if (!cached.isRelevant) {
                        _showBlockOverlay(goal, videoData, cached, (just) => recheck(goal, videoData, just));
                    } else {
                        _removeBlockOverlay();
                    }
                    resolve({ used: true, isRelevant: cached.isRelevant, result: cached });
                    return;
                }

                try {
                    const result = await _fetchAI(goal, videoData);
                    _isScanning = false;
                    _removeScanningNotice();

                    // Crucial check: if a new scan has started while this one was in progress,
                    // ignore the result of this older scan to prevent stale UI updates.
                    if (scanId !== 0 && scanId !== _currentScanId) {
                        console.log('[AI Monitor] Aborting block: stale scan ID');
                        return;
                    }

                    console.log('[AI Monitor] Raw AI Result Payload:', result);
                    console.log('[AI Monitor] Result:', result.isRelevant ? '✅ RELEVANT' : '❌ BLOCKED', '| Confidence:', result.confidence);
                    if (result.reasoning) console.log('[AI Monitor] Reason:', result.reasoning);

                    // ── Store in session cache ──
                    _scanCache.set(pageUrl, { ...result, goal });

                    if (!result.isRelevant) {
                        _showBlockOverlay(goal, videoData, result, (just) => recheck(goal, videoData, just));
                    } else {
                        // If it is relevant (e.g. user navigated to a useful search result),
                        // actively remove the block overlay if it exists from a previous page
                        _removeBlockOverlay();
                    }

                    resolve({ used: true, isRelevant: result.isRelevant, result });
                } catch (err) {
                    _isScanning = false;
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
        // Clear caches for this URL to ensure a fresh scan
        const pageUrl = videoData.url || window.location.href;
        _scanCache.delete(pageUrl);
        _justifiedUrls.delete(pageUrl);
        
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
            if (_isScanning) {
                console.log('[AI Monitor] Scan already in progress, skipping auto-scan...');
                return;
            }

            const scanId = ++_currentScanId;
            _isScanning = true;
            _showScanningNotice('Analysing content...');
            if (Date.now() < _cooldownUntil) {
                console.log('[AI Monitor] Cooling down from 429 error, skipping scan...');
                return;
            }
            if (_justifiedUrls.has(window.location.href)) return;

            chrome.storage.local.get(['aiMonitor', 'currentGoal', 'activeSession'], (result) => {
                if (!result.aiMonitor || !result.currentGoal || !result.activeSession) {
                    _isScanning = false;
                    _removeScanningNotice();
                    return;
                }

                console.log(`[AI Monitor] Auto-scanning platform site: ${hostname}`);

                // === YOUTUBE: Precise Context Extraction (port from youtube.js) ===
                let title = document.title;
                let description = "";
                let dataReady = true;

                if (isYouTube) {
                    const pathname = window.location.pathname;
                    const urlParams = new URLSearchParams(window.location.search);

                    if (pathname.includes('/watch')) {
                        // -- Watch Page: Precise DOM selectors from the old youtube.js reference
                        const videoTitle = document.querySelector(
                            'h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string'
                        )?.innerText?.trim() || "";
                        const videoDesc = document.querySelector(
                            '#description-inline-expander, ytd-text-inline-expander, #description-text'
                        )?.innerText?.trim()?.slice(0, 500) || "";
                        const channelName = document.querySelector(
                            '#channel-name a, ytd-channel-name a'
                        )?.innerText?.trim() || "";
                        const metaDesc = document.querySelector('meta[name="description"]')?.content || "";

                        // Guard: If DOM isn't ready, retry
                        if (!videoTitle) {
                            dataReady = false;
                            console.log('[AI Monitor] Video DOM not ready, retrying in 1s...');
                            setTimeout(runPlatformScan, 1000);
                        } else {
                            title = videoTitle;
                            description = `Channel: ${channelName} | Description: ${videoDesc} | Meta: ${metaDesc}`;
                        }

                    } else if (pathname.includes('/results')) {
                        // -- Search Results Page: Use query + visible titles
                        const searchQuery = urlParams.get('search_query') || "";
                        const resultTitles = Array.from(
                            document.querySelectorAll('ytd-video-renderer #video-title, ytd-video-renderer a#video-title')
                        ).slice(0, 10).map(el => el.innerText?.trim()).filter(Boolean);

                        if (!searchQuery && resultTitles.length === 0) {
                            dataReady = false;
                            console.log('[AI Monitor] Search DOM not ready, retrying in 1s...');
                            setTimeout(runPlatformScan, 1000);
                        } else {
                            title = `YouTube Search: ${searchQuery}`;
                            description = `Search query: "${searchQuery}" | Results shown: ${resultTitles.join(' | ')}`;
                        }

                    } else if (pathname.startsWith('/@') || pathname.includes('/channel/')) {
                        // -- Channel Page
                        const channelName = document.querySelector('ytd-channel-name yt-formatted-string')?.textContent?.trim() ||
                            document.querySelector('#channel-name')?.textContent?.trim() || "";
                        description = `Viewing YouTube Channel: ${channelName}`;

                    } else if (pathname === '/') {
                        // -- Home Feed
                        const visibleTitles = Array.from(document.querySelectorAll('ytd-rich-grid-renderer #video-title'))
                            .slice(0, 8).map(el => el.innerText?.trim()).filter(Boolean);
                        title = "YouTube Home Feed";
                        description = `Home feed videos: ${visibleTitles.join(' | ')}`;
                    }
                }

                // If not ready to scan, skip
                if (!dataReady) {
                    _isScanning = false;
                    _removeScanningNotice();
                    return;
                }

                if (!description && !isYouTube) {
                    // General fallback for non-YouTube platforms
                    const isReddit = hostname.includes('reddit.com');
                    const isX = hostname.includes('x.com') || hostname.includes('twitter.com');

                    if (isReddit) {
                        const postTitles = Array.from(document.querySelectorAll('shreddit-post[post-title]'))
                            .map(el => el.getAttribute('post-title')).slice(0, 10);
                        if (postTitles.length > 0) description = `Reddit Feed Titles: ${postTitles.join(' | ')}`;
                    } else if (isX) {
                        const tweets = Array.from(document.querySelectorAll('[data-testid="tweetText"]'))
                            .map(el => el.innerText.replace(/\n/g, ' ')).slice(0, 8);
                        if (tweets.length > 0) description = `X/Twitter Feed Contents: ${tweets.join(' | ')}`;
                    }

                    if (!description) {
                        const selectors = ['#main-content', 'shreddit-feed', '[role="main"]', 'article', 'main', '.markdown-body'];
                        let el = null;
                        for (const s of selectors) { el = document.querySelector(s); if (el) break; }
                        description = el?.innerText?.slice(0, 2000) || document.body.innerText.slice(0, 2000);
                    }
                }
                
                description = description.replace(/\s+/g, ' ').trim();

                const pageData = {
                    title: title,
                    channel: hostname,
                    description: description,
                    url: window.location.href
                };

                console.log('[AI Monitor] Sending to Gemini:', pageData);
                console.time('AI-TOTAL');
                console.time('CONTENT-TO-BACKGROUND');

                checkAndBlock(result.currentGoal, pageData, scanId).then((res) => {
                    if (res && res.used) {
                        try { console.timeEnd('AI-TOTAL'); } catch(e){}
                    }
                }).catch(err => {
                    console.error('[AI Monitor] Auto-scan error:', err);
                    _isScanning = false;
                    _removeScanningNotice();
                    try { console.timeEnd('AI-TOTAL'); } catch(e){}
                });
            });
        };

        // 1. Initial Scan on page load
        setTimeout(runPlatformScan, 400);

        // 2. Continuous Detection (Polling + Title Observer + Platform Events)
        let lastUrl = location.href;
        let lastTitle = document.title;

        const handleNavigation = (source) => {
            const currentUrl = location.href;
            const currentTitle = document.title;
            
            // Smart Guard: Ignore title updates if typing in a search bar
            const activeInput = document.activeElement;
            const isTyping = activeInput && (activeInput.tagName === 'INPUT' || activeInput.getAttribute('role') === 'combobox');

            if (currentUrl !== lastUrl || (currentTitle !== lastTitle && !isTyping)) {
                console.log(`[AI Monitor] Navigation detected (${source}):`, currentUrl);
                
                // Clear cache for old URL before updating lastUrl
                _scanCache.delete(lastUrl);
                _scanCache.delete(currentUrl);
                lastUrl = currentUrl;
                lastTitle = currentTitle;

                // Instant UI/Lock Clear
                _removeBlockOverlay();
                _removeScanningNotice();
                _isScanning = false;
                _currentScanId++; 

                // For YouTube: yt-navigate-finish handles the scan at the right time.
                // The poller ONLY clears the UI here; it must NOT trigger a premature scan.
                if (isYouTube) {
                    console.log('[AI Monitor] YouTube nav detected by poller — scan deferred to yt-navigate-finish');
                    return;
                }

                chrome.storage.local.get(['aiMonitor', 'currentGoal', 'activeSession'], (result) => {
                    if (!result.aiMonitor || !result.currentGoal || !result.activeSession) return;
                    
                    // For non-YouTube sites, use a simple fixed delay
                    setTimeout(runPlatformScan, 600); 
                });
            }
        };

        // --- Platform-Specific Precise Events ---
        if (isYouTube) {
            // yt-navigate-start: Clear UI AND cache INSTANTLY when you click a link
            window.addEventListener('yt-navigate-start', () => {
                console.log('[AI Monitor] YouTube navigate START — clearing UI + cache');
                _removeBlockOverlay();
                _removeScanningNotice();
                _isScanning = false;
                _currentScanId++;
                // Clear cache for the old page so next scan is always fresh
                _scanCache.delete(location.href);
            });

            // yt-navigate-finish: Trigger scan when transition is FULLY complete
            window.addEventListener('yt-navigate-finish', () => {
                console.log('[AI Monitor] YouTube navigate FINISH — clearing new URL cache, then scanning');
                // Also clear the new destination URL from cache before scanning
                _scanCache.delete(location.href);
                lastUrl = location.href; 
                lastTitle = document.title;
                // 1500ms: gives YouTube's SPA renderer enough time to fully swap DOM
                setTimeout(runPlatformScan, 1500); 
            });
        }

        // Fast Poller (200ms) fallback
        setInterval(() => handleNavigation('poller'), 200);

        // Popstate listener for browser back/forward navigation
        window.addEventListener('popstate', () => handleNavigation('popstate'));
    }
})();
