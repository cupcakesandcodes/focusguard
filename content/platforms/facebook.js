(function() {
// Facebook-Specific Content Script with Default Blocking
console.log("🔵 Facebook Focus Guard Loaded");

let facebookSettings = {};
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
            // Apply normal Facebook blocking settings
            applyFacebookBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Facebook');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['facebookSettings'], (result) => {
    facebookSettings = result.facebookSettings || {};
    console.log("📘 Facebook settings loaded:", facebookSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "facebook") {
        facebookSettings = request.settings;
        console.log("📘 Facebook settings updated:", facebookSettings);
        if (isAllowedForSession) {
            applyFacebookBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyFacebookBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyFacebookBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyFacebookBlocking() {
    // HOME PAGE
    if (facebookSettings.blockHomeFeed) {
        hideElements('[role="feed"]', 'Home Feed');
        hideElements('[data-pagelet="FeedUnit_0"]', 'Feed Unit');
    }

    if (facebookSettings.blockStories) {
        hideElements('[aria-label*="Stories"]', 'Stories');
        hideElements('[data-pagelet="StoriesTray"]', 'Stories Tray');
        hideElements('div[role="region"][aria-label*="Stories"]', 'Stories Region');
    }

    if (facebookSettings.blockSponsoredPosts) {
        // Hide sponsored posts in feed
        document.querySelectorAll('[role="article"]').forEach(article => {
            if (article.textContent.includes('Sponsored') || article.textContent.includes('پیشنهاد شده')) {
                article.style.display = 'none';
            }
        });
    }

    if (facebookSettings.blockGroupPosts) {
        // Hide posts from groups in feed
        document.querySelectorAll('[role="article"]').forEach(article => {
            const groupIndicators = article.querySelectorAll('a[href*="/groups/"]');
            if (groupIndicators.length > 0) {
                article.style.display = 'none';
            }
        });
    }

    if (facebookSettings.blockPeopleFollow) {
        // Hide "Posts from people you follow" section
        hideElements('[aria-label*="People you follow"]', 'People you follow');
    }

    if (facebookSettings.blockPeopleKnow) {
        hideElements('[aria-label*="People you may know"]', 'People you may know');
        hideElements('[data-pagelet*="PeopleYouMayKnow"]', 'PYMK Section');
    }

    if (facebookSettings.blockReelsShort) {
        hideElements('[aria-label*="Reels"]', 'Reels');
        hideElements('[data-pagelet*="Reels"]', 'Reels Pagelet');
        hideElements('a[href*="/reel"]', 'Reels Links');
    }

    if (facebookSettings.blockSuggestedGroups) {
        hideElements('[aria-label*="Suggested groups"]', 'Suggested Groups');
        hideElements('[data-pagelet*="GroupsSuggestions"]', 'Groups Suggestions');
    }

    // HEADER
    if (facebookSettings.blockFriendsButton) {
        hideElements('a[href*="/friends"]', 'Friends Button');
        hideElements('[aria-label="Friends"]', 'Friends Button');
    }

    if (facebookSettings.blockWatchButton) {
        hideElements('a[href*="/watch"]', 'Watch Button');
        hideElements('[aria-label="Watch"]', 'Watch Button');
    }

    if (facebookSettings.blockGroupsButton) {
        hideElements('a[href*="/groups"]', 'Groups Button');
        hideElements('[aria-label="Groups"]', 'Groups Button');
    }

    if (facebookSettings.blockGamingButton) {
        hideElements('a[href*="/gaming"]', 'Gaming Button');
        hideElements('[aria-label="Gaming"]', 'Gaming Button');
    }

    if (facebookSettings.blockCreateButton) {
        hideElements('[aria-label="Create"]', 'Create Button');
        hideElements('[aria-label*="Create new"]', 'Create New Button');
    }

    if (facebookSettings.blockMenuButton) {
        hideElements('[aria-label="Menu"]', 'Menu Button');
    }

    if (facebookSettings.blockMessengerButton) {
        hideElements('a[href*="/messages"]', 'Messenger Button');
        hideElements('[aria-label="Messenger"]', 'Messenger Button');
    }

    if (facebookSettings.blockNotificationsButton) {
        hideElements('[aria-label="Notifications"]', 'Notifications Button');
    }

    // LEFT NAVIGATION BAR
    if (facebookSettings.blockProfileButton) {
        hideElements('a[href*="/profile.php"]', 'Profile Button');
        hideElements('[data-pagelet="LeftRail"] a[href*="/profile"]', 'Profile Link');
    }

    if (facebookSettings.blockFindFriendsButton) {
        hideElements('a[href*="/friends/suggestions"]', 'Find Friends');
        hideElements('[aria-label*="Find friends"]', 'Find Friends');
    }

    if (facebookSettings.blockMemoriesButton) {
        hideElements('a[href*="/memories"]', 'Memories');
        hideElements('[aria-label="Memories"]', 'Memories');
    }

    if (facebookSettings.blockSavedButton) {
        hideElements('a[href*="/saved"]', 'Saved');
        hideElements('[aria-label="Saved"]', 'Saved');
    }

    if (facebookSettings.blockGroupsLeftButton) {
        hideElements('[data-pagelet="LeftRail"] a[href*="/groups"]', 'Groups Left Nav');
    }

    if (facebookSettings.blockVideoButton) {
        hideElements('a[href*="/watch"]', 'Video Button');
    }

    if (facebookSettings.blockMarketplaceButton) {
        hideElements('a[href*="/marketplace"]', 'Marketplace');
        hideElements('[aria-label="Marketplace"]', 'Marketplace');
    }

    if (facebookSettings.blockFeedsLeftButton) {
        hideElements('a[href*="/feeds"]', 'Feeds');
        hideElements('[aria-label="Feeds"]', 'Feeds');
    }

    if (facebookSettings.blockEventsButton) {
        hideElements('a[href*="/events"]', 'Events');
        hideElements('[aria-label="Events"]', 'Events');
    }

    if (facebookSettings.blockAdsManagerButton) {
        hideElements('a[href*="/adsmanager"]', 'Ads Manager');
        hideElements('[aria-label*="Ads"]', 'Ads Manager');
    }

    if (facebookSettings.blockFundraisersButton) {
        hideElements('a[href*="/fundraisers"]', 'Fundraisers');
        hideElements('[aria-label="Fundraisers"]', 'Fundraisers');
    }

    if (facebookSettings.blockSeeMoreButton) {
        hideElements('[data-pagelet="LeftRail"] [aria-label="See more"]', 'See More');
    }

    if (facebookSettings.blockFooter) {
        hideElements('footer', 'Footer');
        hideElements('[role="contentinfo"]', 'Footer Content');
    }

    // RIGHT BAR
    if (facebookSettings.blockSponsoredRight) {
        hideElements('[data-pagelet*="RightRail"] [aria-label*="Sponsored"]', 'Sponsored Right');
        // Hide any element containing "Sponsored" in right rail
        document.querySelectorAll('[data-pagelet*="RightRail"] *').forEach(el => {
            if (el.textContent.includes('Sponsored')) {
                const parent = el.closest('[data-pagelet]') || el.closest('div[class]');
                if (parent) parent.style.display = 'none';
            }
        });
    }

    if (facebookSettings.blockContactsBlock) {
        hideElements('[aria-label="Contacts"]', 'Contacts');
        hideElements('[data-pagelet*="RightRail"] [aria-label*="Contacts"]', 'Contacts Block');
    }

    if (facebookSettings.blockGroupConversations) {
        hideElements('[aria-label*="Group conversations"]', 'Group Conversations');
    }

    if (facebookSettings.blockNewMessageButton) {
        hideElements('[aria-label="New message"]', 'New Message Button');
        hideElements('div[role="button"][aria-label*="New message"]', 'New Message Floating');
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

// Initial application
setTimeout(() => {
    applyFacebookBlocking();
}, 1000);

console.log("🔵 Facebook Focus Guard Ready");

})();