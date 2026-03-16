(function() {
// Pinterest-Specific Content Script with Default Blocking
console.log("📌 Pinterest Focus Guard Loaded");

let pinterestSettings = {};
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
            // Apply normal Pinterest blocking settings
            applyPinterestBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Pinterest');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['pinterestSettings'], (result) => {
    pinterestSettings = result.pinterestSettings || {};
    console.log("📌 Pinterest settings loaded:", pinterestSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "pinterest") {
        pinterestSettings = request.settings;
        console.log("📌 Pinterest settings updated:", pinterestSettings);
        if (isAllowedForSession) {
            applyPinterestBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyPinterestBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyPinterestBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyPinterestBlocking() {
    // HOME FEED
    if (pinterestSettings.blockHomeFeed) {
        hideElements('[data-test-id="homefeed"]', 'Home Feed');
        hideElements('[data-test-id="pin"]', 'Pins');
    }

    if (pinterestSettings.blockSearch) {
        hideElements('[data-test-id="search-box"]', 'Search');
        hideElements('[role="search"]', 'Search Bar');
    }

    if (pinterestSettings.blockExplore) {
        hideElements('a[href*="/explore/"]', 'Explore');
    }

    if (pinterestSettings.blockCreate) {
        hideElements('[data-test-id="create-pin-button"]', 'Create Button');
        hideElements('a[href*="/pin-builder/"]', 'Pin Builder');
    }

    if (pinterestSettings.blockNotifications) {
        hideElements('[data-test-id="header-notifications"]', 'Notifications');
    }

    if (pinterestSettings.blockMessages) {
        hideElements('[data-test-id="header-messages"]', 'Messages');
        hideElements('a[href*="/messages/"]', 'Messages Link');
    }

    if (pinterestSettings.blockRelatedPins) {
        hideElements('[data-test-id="related-pins"]', 'Related Pins');
        hideElements('[data-test-id="more-ideas"]', 'More Ideas');
    }

    if (pinterestSettings.blockSuggestions) {
        hideElements('[data-test-id="board-suggestions"]', 'Board Suggestions');
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

console.log("📌 Pinterest Focus Guard Ready");

})();