(function() {
// Twitch-Specific Content Script with Default Blocking
console.log("🎮 Twitch Focus Guard Loaded");

let twitchSettings = {};
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
            // Apply normal Twitch blocking settings
            applyTwitchBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Twitch');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['twitchSettings'], (result) => {
    twitchSettings = result.twitchSettings || {};
    console.log("🎮 Twitch settings loaded:", twitchSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "twitch") {
        twitchSettings = request.settings;
        console.log("🎮 Twitch settings updated:", twitchSettings);
        if (isAllowedForSession) {
            applyTwitchBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyTwitchBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyTwitchBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyTwitchBlocking() {
    // SIDEBAR
    if (twitchSettings.blockSidebar) {
        hideElements('[data-a-target="side-nav"]', 'Sidebar');
        hideElements('.side-nav', 'Side Navigation');
    }

    if (twitchSettings.blockRecommendedChannels) {
        hideElements('[data-a-target="recommended-channels"]', 'Recommended Channels');
    }

    if (twitchSettings.blockFollowedChannels) {
        hideElements('[data-a-target="followed-channels"]', 'Followed Channels');
    }

    if (twitchSettings.blockChat) {
        hideElements('[data-a-target="chat-room"]', 'Chat Room');
        hideElements('.chat-shell', 'Chat');
    }

    if (twitchSettings.blockBrowse) {
        hideElements('[data-a-target="browse-link"]', 'Browse Link');
    }

    if (twitchSettings.blockEsports) {
        hideElements('[data-a-target="esports-link"]', 'Esports Link');
    }

    if (twitchSettings.blockNotifications) {
        hideElements('[data-a-target="notifications-button"]', 'Notifications');
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

console.log("🎮 Twitch Focus Guard Ready");

})();