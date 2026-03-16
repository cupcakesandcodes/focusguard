(function() {
// Discord-Specific Content Script with Default Blocking
console.log("💬 Discord Focus Guard Loaded");

let discordSettings = {};
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
            // Apply normal Discord blocking settings
            applyDiscordBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Discord');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['discordSettings'], (result) => {
    discordSettings = result.discordSettings || {};
    console.log("💬 Discord settings loaded:", discordSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "discord") {
        discordSettings = request.settings;
        console.log("💬 Discord settings updated:", discordSettings);
        if (isAllowedForSession) {
            applyDiscordBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyDiscordBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyDiscordBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyDiscordBlocking() {
    // SERVER LIST
    if (discordSettings.blockServerList) {
        hideElements('[aria-label="Servers"]', 'Server List');
        hideElements('nav[aria-label="Servers sidebar"]', 'Servers Sidebar');
    }

    if (discordSettings.blockDirectMessages) {
        hideElements('[aria-label="Direct Messages"]', 'Direct Messages');
        hideElements('a[href*="/channels/@me"]', 'DM Links');
    }

    if (discordSettings.blockVoiceChannels) {
        hideElements('[aria-label*="Voice"]', 'Voice Channels');
    }

    if (discordSettings.blockNotifications) {
        hideElements('[class*="numberBadge"]', 'Notification Badges');
    }

    if (discordSettings.blockUserProfile) {
        hideElements('[class*="panels"]', 'User Panel');
    }

    if (discordSettings.blockDiscovery) {
        hideElements('[aria-label="Explore Discoverable Servers"]', 'Server Discovery');
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

console.log("💬 Discord Focus Guard Ready");

})();