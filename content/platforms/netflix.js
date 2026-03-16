(function() {
// Netflix-Specific Content Script with Default Blocking
console.log("🎬 Netflix Focus Guard Loaded");

let netflixSettings = {};
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
            // Apply normal Netflix blocking settings
            applyNetflixBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Netflix');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['netflixSettings'], (result) => {
    netflixSettings = result.netflixSettings || {};
    console.log("🎬 Netflix settings loaded:", netflixSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "netflix") {
        netflixSettings = request.settings;
        console.log("🎬 Netflix settings updated:", netflixSettings);
        if (isAllowedForSession) {
            applyNetflixBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyNetflixBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyNetflixBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyNetflixBlocking() {
    // RECOMMENDATIONS
    if (netflixSettings.blockRecommendations) {
        hideElements('.lolomoRow', 'Recommendations');
        hideElements('[data-list-context="recommendations"]', 'Recommendation Rows');
    }

    if (netflixSettings.blockTrending) {
        hideElements('[data-list-context="trendingNow"]', 'Trending Now');
    }

    if (netflixSettings.blockAutoplay) {
        // Disable autoplay previews
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            video.pause();
            video.removeAttribute('autoplay');
        });
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

console.log("🎬 Netflix Focus Guard Ready");

})();