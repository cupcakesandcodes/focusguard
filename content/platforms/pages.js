console.log("Pages Silencer Loaded (Blogs, Articles, Docs)");

let silencerEnabled = false;
let grayscaleEnabled = false;

// Initial State Check
chrome.storage.local.get(['silencerMode', 'grayscaleMode'], (result) => {
    if (result.silencerMode) enableSilencer();
    if (result.grayscaleMode) enableGrayscale();
    silencerEnabled = result.silencerMode;
    grayscaleEnabled = result.grayscaleMode;
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
    console.log('📺 YouTube check:', window.location.hostname.includes('youtube.com'));


    // 1. Universal Ad Blocker (Aggressive but Video-Safe)
    // CRITICAL: Skip on YouTube - generic selectors break the player due to race conditions
    if (!window.location.hostname.includes('youtube.com')) {
        const adSelectors = [
            'iframe[src*="ads"]',
            'div[id*="google_ads"]',
            '.ad-container',
            // '[class*="sponsored"]',
            '.newsletter-popup',
            '.subscribe-widget'
        ];

        document.querySelectorAll(adSelectors.join(',')).forEach(el => {
            // SAFETY CHECK: Never hide the video player itself!
            if (el.tagName === 'VIDEO' || el.querySelector('video')) return;

            el.style.display = 'none';
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
        });
    }

    // 2. Smart Sidebar Hiding
    // CRITICAL: Skip on YouTube - it uses aside/complementary for player containers too
    if (!window.location.hostname.includes('youtube.com')) {
        const sidebars = document.querySelectorAll('aside, .sidebar, #sidebar, [role="complementary"]');
        sidebars.forEach(sidebar => {
            // Safety: Don't hide sidebars containing video
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
    // Heuristic: Keep if it looks like Navigation or TOC
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

        // If scrolled > 3000px in < 2 minutes
        if (scrollDistance > 3000 && now - lastTime < 120000) {
            // Trigger Friction Logic (Console for MVP)
            console.log("🚨 Doom scrolling detected.");
            // Reset to avoid spam
            scrollDistance = 0;
            lastTime = now;
        } else if (now - lastTime >= 120000) {
            // Reset timer window
            scrollDistance = 0;
            lastTime = now;
        }
    };

    window.addEventListener('scroll', scrollListener);
}
