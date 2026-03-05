// TikTok-Specific Content Script with Default Blocking
console.log("🎵 TikTok Focus Guard Loaded");

let tiktokSettings = {};
let blockingOverlay = null;
let isAllowedForSession = false;

// Check if site is allowed for this session
function checkSessionAccess() {
    chrome.runtime.sendMessage({
        action: 'checkSiteAccess',
        hostname: window.location.hostname
    }, (response) => {
        if (response && response.allowed) {
            isAllowedForSession = true;
            if (blockingOverlay) {
                blockingOverlay.remove();
            }
            // Apply normal TikTok blocking settings
            applyTikTokBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('TikTok');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['tiktokSettings'], (result) => {
    tiktokSettings = result.tiktokSettings || {};
    console.log("🎵 TikTok settings loaded:", tiktokSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "tiktok") {
        tiktokSettings = request.settings;
        console.log("🎵 TikTok settings updated:", tiktokSettings);
        if (isAllowedForSession) {
            applyTikTokBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyTikTokBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyTikTokBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyTikTokBlocking() {
    // FOR YOU FEED
    if (tiktokSettings.blockForYou) {
        hideElements('[data-e2e="recommend-list-item-container"]', 'For You Feed');
    }

    if (tiktokSettings.blockFollowing) {
        hideElements('[data-e2e="following-item-container"]', 'Following Feed');
    }

    if (tiktokSettings.blockDiscover) {
        hideElements('[href*="/discover"]', 'Discover');
    }
}

function hideElements(selector, name) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
        elements.forEach(el => {
            el.style.display = 'none';
        });
        console.log(`✅ Blocked ${elements.length} ${name} element(s)`);
    }
}

// Initial check
setTimeout(() => {
    checkSessionAccess();
}, 500);

console.log("🎵 TikTok Focus Guard Ready");
