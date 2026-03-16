(function() {
// Instagram-Specific Content Script with Default Blocking
console.log("📸 Instagram Focus Guard Loaded");

let instagramSettings = {};
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
            // Apply normal Instagram blocking settings
            applyInstagramBlocking();
        } else {
            // Show blocking overlay
            showBlockingOverlay();
        }
    });
}

function showBlockingOverlay() {
    if (!blockingOverlay && window.BlockedSiteOverlay) {
        blockingOverlay = new window.BlockedSiteOverlay('Instagram');
        blockingOverlay.show();
    }
}

// Load settings from storage
chrome.storage.local.get(['instagramSettings'], (result) => {
    instagramSettings = result.instagramSettings || {};
    console.log("📸 Instagram settings loaded:", instagramSettings);

    // Check session access first
    checkSessionAccess();
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "instagram") {
        instagramSettings = request.settings;
        console.log("📸 Instagram settings updated:", instagramSettings);
        if (isAllowedForSession) {
            applyInstagramBlocking();
        }
    }

    // Listen for session access granted
    if (request.action === "siteAccessGranted" && request.hostname === window.location.hostname) {
        isAllowedForSession = true;
        if (blockingOverlay) {
            blockingOverlay.remove();
        }
        applyInstagramBlocking();
    }
});

// Watch for dynamic content changes
const observer = new MutationObserver(() => {
    if (isAllowedForSession) {
        applyInstagramBlocking();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

function applyInstagramBlocking() {
    console.log("📸 Applying Instagram settings:", instagramSettings);

    // BLOCK/UNBLOCK REELS
    if (instagramSettings.blockReels) {
        console.log("🚫 Blocking Reels...");
        hideElements('a[href="/reels/"]', 'Reels Nav Link');

        document.querySelectorAll('svg[aria-label="Reels"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.setProperty('display', 'none', 'important');
            }
        });

        if (window.location.pathname.includes('/reels')) {
            hideElements('main', 'Reels Page Content');
        }
    } else {
        showElements('a[href="/reels/"]', 'Reels Nav Link');
        document.querySelectorAll('svg[aria-label="Reels"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.removeProperty('display');
                link.style.removeProperty('visibility');
            }
        });
    }

    // BLOCK/UNBLOCK STORIES
    if (instagramSettings.blockStories) {
        console.log("🚫 Blocking Stories...");
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '';

        if (isHomePage) {
            document.querySelectorAll('canvas').forEach(canvas => {
                let parent = canvas.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (!parent) break;

                    const canvasCount = parent.querySelectorAll('canvas').length;
                    if (canvasCount >= 2) {
                        const rect = parent.getBoundingClientRect();
                        if (rect.top < 400) {
                            parent.style.setProperty('display', 'none', 'important');
                            parent.style.setProperty('visibility', 'hidden', 'important');
                            parent.setAttribute('data-blocked-stories', 'true');
                            console.log(`✅ Blocked stories bar with ${canvasCount} stories`);
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
            });
        }
    } else {
        // Unblock stories
        document.querySelectorAll('[data-blocked-stories="true"]').forEach(el => {
            el.style.removeProperty('display');
            el.style.removeProperty('visibility');
            el.removeAttribute('data-blocked-stories');
            console.log("✅ Unblocked stories");
        });
    }

    // BLOCK/UNBLOCK FEED
    if (instagramSettings.blockFeed) {
        console.log("🚫 Blocking Feed...");
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '';

        if (isHomePage) {
            document.querySelectorAll('main article').forEach(article => {
                article.style.setProperty('display', 'none', 'important');
                article.setAttribute('data-blocked-feed', 'true');
            });
            hideElements('article[role="presentation"]', 'Feed Articles');
        }
    } else {
        // Unblock feed
        document.querySelectorAll('[data-blocked-feed="true"]').forEach(article => {
            article.style.removeProperty('display');
            article.style.removeProperty('visibility');
            article.removeAttribute('data-blocked-feed');
        });
        showElements('article[role="presentation"]', 'Feed Articles');
        console.log("✅ Unblocked feed");
    }

    // BLOCK/UNBLOCK MESSAGES
    if (instagramSettings.blockMessages) {
        console.log("🚫 Blocking Messages...");
        hideElements('a[href*="/direct/"]', 'Messages Nav Link');

        document.querySelectorAll('svg[aria-label="Direct"], svg[aria-label="Messenger"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.setProperty('display', 'none', 'important');
                link.setAttribute('data-blocked-messages', 'true');
                console.log("✅ Blocked Messages button");
            }
        });

        // Block messages page content
        if (window.location.pathname.includes('/direct')) {
            document.querySelectorAll('main').forEach(main => {
                main.style.setProperty('display', 'none', 'important');
                main.setAttribute('data-blocked-messages-page', 'true');
                console.log("✅ Blocked Messages page content");
            });
        }
    } else {
        // Unblock messages buttons
        document.querySelectorAll('[data-blocked-messages="true"]').forEach(link => {
            link.style.removeProperty('display');
            link.style.removeProperty('visibility');
            link.removeAttribute('data-blocked-messages');
            console.log("✅ Unblocked Messages button");
        });

        // Unblock messages page content
        document.querySelectorAll('[data-blocked-messages-page="true"]').forEach(main => {
            main.style.removeProperty('display');
            main.style.removeProperty('visibility');
            main.removeAttribute('data-blocked-messages-page');
            console.log("✅ Unblocked Messages page content");
        });

        showElements('a[href*="/direct/"]', 'Messages Nav Link');

        document.querySelectorAll('svg[aria-label="Direct"], svg[aria-label="Messenger"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.removeProperty('display');
                link.style.removeProperty('visibility');
            }
        });
    }

    // BLOCK/UNBLOCK EXPLORE
    if (instagramSettings.blockExplore) {
        console.log("🚫 Blocking Explore...");
        hideElements('a[href="/explore/"]', 'Explore Nav Link');

        document.querySelectorAll('svg[aria-label="Explore"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.setProperty('display', 'none', 'important');
            }
        });

        if (window.location.pathname.includes('/explore')) {
            hideElements('main', 'Explore Page Content');
        }
    } else {
        showElements('a[href="/explore/"]', 'Explore Nav Link');
        document.querySelectorAll('svg[aria-label="Explore"]').forEach(svg => {
            const link = svg.closest('a');
            if (link) {
                link.style.removeProperty('display');
                link.style.removeProperty('visibility');
            }
        });
    }
}

function hideElements(selector, name) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
        elements.forEach(el => {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
        });
        console.log(`✅ Blocked ${elements.length} ${name} element(s)`);
    }
}

function showElements(selector, name) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
        elements.forEach(el => {
            el.style.removeProperty('display');
            el.style.removeProperty('visibility');
        });
        console.log(`✅ Unblocked ${elements.length} ${name} element(s)`);
    }
}

// Initial check
setTimeout(() => {
    checkSessionAccess();
}, 500);

console.log("📸 Instagram Focus Guard Ready");

})();