(function () {
    console.log("Pages Silencer Loaded (Blogs, Articles, Docs)");

    let silencerEnabled = false;
    let grayscaleEnabled = false;

    // Initial State Check — read from storage and run AI scan if needed
    chrome.storage.local.get(['silencerMode', 'grayscaleMode', 'aiMonitor', 'currentGoal', 'activeSession'], (result) => {
        if (result.silencerMode) enableSilencer();
        if (result.grayscaleMode) enableGrayscale();
        silencerEnabled = result.silencerMode;
        grayscaleEnabled = result.grayscaleMode;

        // Run AI scan when AI Monitor is on, there's a goal, and a session is active
        if (result.aiMonitor && result.currentGoal && result.activeSession) {
            runUniversalAIScan(result.currentGoal);
        }
    });

    // Listener for real-time updates
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "updateMode") {
            if (request.key === "silencerMode") {
                request.value ? enableSilencer() : disableSilencer();
            } else if (request.key === "grayscaleMode") {
                request.value ? enableGrayscale() : disableGrayscale();
            }
        }
    });

    // --- Feature: Grayscale ---
    function enableGrayscale() {
        document.documentElement.classList.add('grayscale-mode');
        grayscaleEnabled = true;
    }

    function disableGrayscale() {
        document.documentElement.classList.remove('grayscale-mode');
        grayscaleEnabled = false;
    }

    // --- Feature: The Silencer (Smart Hiding) ---
    function enableSilencer() {
        if (window.silencerObserver) return; // Guard against duplicates

        document.body.classList.add('silencer-active');
        hideDistractions();

        // Re-run on mutation (dynamic content)
        const observer = new MutationObserver(hideDistractions);
        observer.observe(document.body, { childList: true, subtree: true });
        window.silencerObserver = observer;
        silencerEnabled = true;

        // Start Doom Scroll Guard
        initDoomScrollGuard();
    }

    function disableSilencer() {
        document.body.classList.remove('silencer-active');
        if (window.silencerObserver) {
            window.silencerObserver.disconnect();
            window.silencerObserver = null;
        }
        silencerEnabled = false;
    }

    function hideDistractions() {
        if (!silencerEnabled) return;

        console.log('🔇 Silencer running on:', window.location.hostname);

        // 1. Universal Ad Blocker (Aggressive but Video-Safe)
        if (!window.location.hostname.includes('youtube.com')) {
            const adSelectors = [
                'iframe[src*="ads"]',
                'div[id*="google_ads"]',
                '.ad-container',
                '.newsletter-popup',
                '.subscribe-widget'
            ];

            document.querySelectorAll(adSelectors.join(',')).forEach(el => {
                if (el.tagName === 'VIDEO' || el.querySelector('video')) return;
                el.style.display = 'none';
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
            });
        }

        // 2. Smart Sidebar Hiding
        if (!window.location.hostname.includes('youtube.com')) {
            const sidebars = document.querySelectorAll('aside, .sidebar, #sidebar, [role="complementary"]');
            sidebars.forEach(sidebar => {
                if (sidebar.querySelector('video')) return;
                if (isSignal(sidebar)) {
                    sidebar.style.display = '';
                } else {
                    sidebar.style.display = 'none';
                }
            });
        }

        // 3. YouTube/Social Specifics
        if (window.location.hostname.includes('youtube.com')) {
            document.querySelectorAll('#secondary, #related, ytd-reel-shelf-renderer').forEach(el => {
                el.style.display = 'none';
            });
        }
    }

    function isSignal(element) {
        const text = element.innerText.toLowerCase();
        if (element.querySelector('nav') || element.getAttribute('role') === 'navigation') return true;
        if (text.includes('table of contents') || text.includes('on this page')) return true;
        if (text.length < 50) return false;
        if (text.includes('recommended') || text.includes('read next') || text.includes('you may also like')) return false;
        return false;
    }

    // --- Feature: Doom Scroll Guard ---
    let lastScrollY = window.scrollY;
    let scrollDistance = 0;
    let lastTime = Date.now();
    let scrollListener = null;

    function initDoomScrollGuard() {
        if (scrollListener) return;
        scrollListener = () => {
            if (!silencerEnabled) return;
            const now = Date.now();
            scrollDistance += Math.abs(window.scrollY - lastScrollY);
            lastScrollY = window.scrollY;
            if (scrollDistance > 3000 && now - lastTime < 120000) {
                console.log("🚨 Doom scrolling detected.");
                scrollDistance = 0;
                lastTime = now;
            } else if (now - lastTime >= 120000) {
                scrollDistance = 0;
                lastTime = now;
            }
        };
        window.addEventListener('scroll', scrollListener);
    }

    // ── Universal AI Monitor ──────────────────────────────────────────────────────
    function extractPageContent() {
        const title = document.title || '';
        const url = window.location.href;
        const hostname = window.location.hostname;
        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
        const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
        const h1 = document.querySelector('h1')?.innerText?.trim() || '';
        const redditTitle = document.querySelector('[data-testid="post-container"] h1, shreddit-post [slot="title"]')?.innerText?.trim() || '';
        const bestTitle = redditTitle || h1 || title;

        const bodyText = (() => {
            const selectors = ['article', 'main', '.content', '#content', '.post-body', '.article-body', 'section'];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = el.innerText?.replace(/\s+/g, ' ').trim().slice(0, 400);
                    if (text && text.length > 50) return text;
                }
            }
            const paras = [...document.querySelectorAll('p')].slice(0, 4).map(p => p.innerText?.trim()).filter(Boolean).join(' ');
            return paras.slice(0, 400);
        })();

        const description = [metaDesc, metaKeywords, bodyText].filter(Boolean).join(' | ').slice(0, 600);
        return { title: bestTitle, channel: hostname, description, url };
    }

    async function runUniversalAIScan(goal) {
        const hostname = window.location.hostname;
        const url = window.location.href;

        const skipSites = [
            'youtube.com', 'reddit.com', 'twitter.com', 'x.com',
            'instagram.com', 'facebook.com', 'tiktok.com', 'twitch.tv',
            'netflix.com', 'discord.com', 'linkedin.com', 'pinterest.com',
            'chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'anthropic.com'
        ];
        if (skipSites.some(site => hostname.includes(site))) return;

        const searchEngines = {
            'google.com': 'q', 'bing.com': 'q', 'duckduckgo.com': 'q',
            'search.yahoo.com': 'p', 'ecosia.org': 'q', 'yandex.com': 'text', 'baidu.com': 'wd'
        };
        const matchedEngine = Object.keys(searchEngines).find(e => hostname.includes(e));
        if (matchedEngine) {
            const paramKey = searchEngines[matchedEngine];
            const query = new URLSearchParams(window.location.search).get(paramKey);
            if (!query) return;
            await new Promise(r => setTimeout(r, 800));
            if (!window.aiMonitor) return;
            await window.aiMonitor.checkAndBlock(goal, {
                title: `Search: "${query}"`,
                channel: hostname,
                description: `The user searched for: ${query}`,
                url
            });
            return;
        }

        await new Promise(r => setTimeout(r, 1500));
        if (!window.aiMonitor) return;

        const pageData = extractPageContent();
        if (!pageData.title) return;
        await window.aiMonitor.checkAndBlock(goal, pageData);
    }
})();
