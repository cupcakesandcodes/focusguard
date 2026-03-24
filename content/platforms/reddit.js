(function() {
// Reddit-Specific Content Script - Accurate DOM-based Blocking
console.log("🔴 Reddit Focus Guard Loaded");

let redditSettings = {};
let learnedKeywords = {}; // Dictionary: { "goal": ["keyword1", "keyword2"] }
let styleElement = null;

// Load settings from storage
chrome.storage.local.get(['redditSettings', 'learnedKeywords'], (result) => {
    redditSettings = result.redditSettings || {};
    learnedKeywords = result.learnedKeywords || {};

    // Load filter mode from settings (handle old boolean values)
    if (redditSettings.filterMode) {
        // If it's a boolean true, convert to 'blur'
        if (redditSettings.filterMode === true) {
            filterMode = 'blur';
        } else if (typeof redditSettings.filterMode === 'string') {
            filterMode = redditSettings.filterMode;
        }
    }

    console.log("📕 Reddit settings loaded:", redditSettings);
    console.log("🎯 Filter mode:", filterMode);
    applyRedditBlocking();
});

// Goal-based content filtering
let currentGoal = null;
let isSessionActive = false;
let filterMode = 'blur'; // 'blur' or 'remove'
let processedPosts = new Set(); // Track already processed posts

// Listen for settings updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "platformSettingsUpdated" && request.platform === "reddit") {
        redditSettings = request.settings;
        console.log("📕 Reddit settings updated:", redditSettings);

        // Update filter mode
        if (redditSettings.filterMode) {
            filterMode = redditSettings.filterMode;
            console.log("🎯 Filter mode updated to:", filterMode);
        }

        applyRedditBlocking();
    }

    // Listen for session updates
    if (request.action === "sessionStarted") {
        currentGoal = request.goal;
        isSessionActive = true;
        console.log("🎯 Reddit: Session started with goal:", currentGoal);
        processAllPosts();
    }

    // Listen for session end
    if (request.type === "SESSION_ENDED") {
        currentGoal = null;
        isSessionActive = false;
        processedPosts.clear();

        // Remove any blur alerts
        const oldAlert = document.getElementById('reddit-goal-alert');
        if (oldAlert) {
            oldAlert.remove();
        }

        // Reset all container blur effects
        const containers = document.querySelectorAll('div.bg-neutral-background');
        containers.forEach(container => {
            container.style.filter = '';
            container.style.opacity = '';
            container.style.pointerEvents = '';
            container.style.display = '';
        });

        console.log("🎯 Reddit: Session ended, filters cleared");
    }

    if (request.action === "sessionEnded") {
        currentGoal = null;
        isSessionActive = false;
        console.log("🎯 Reddit: Session ended");
        removeAllFilters();
    }
});

// Listen for storage changes (fallback if messages don't work)
chrome.storage.onChanged.addListener((changes, area) => {
    console.log("🔍 Storage change detected - Area:", area, "Changes:", Object.keys(changes));

    if (area === 'local') {
        // Check for session changes
        if (changes.activeSession) {
            console.log("🔍 activeSession changed:", changes.activeSession);
            if (changes.activeSession.newValue) {
                // Session started
                const session = changes.activeSession.newValue;
                currentGoal = session.goal;
                isSessionActive = true;
                console.log("🎯 Reddit: Session started via storage change:", currentGoal);
                processAllPosts();
            } else {
                // Session ended
                currentGoal = null;
                isSessionActive = false;
                processedPosts.clear();

                // Remove blur alerts
                const oldAlert = document.getElementById('reddit-goal-alert');
                if (oldAlert) oldAlert.remove();

                // Reset blur effects
                const containers = document.querySelectorAll('div.bg-neutral-background');
                containers.forEach(container => {
                    container.style.filter = '';
                    container.style.opacity = '';
                    container.style.pointerEvents = '';
                    container.style.display = '';
                });

                console.log("🎯 Reddit: Session ended via storage change");
            }
        }

        // Check for Reddit settings changes
        if (changes.redditSettings) {
            console.log("🔍 redditSettings changed:", changes.redditSettings);
            redditSettings = changes.redditSettings.newValue || {};
            if (redditSettings.filterMode) {
                filterMode = redditSettings.filterMode;
            }
            console.log("📕 Reddit settings updated via storage:", redditSettings);
            applyRedditBlocking();
        }

        // Check for learned keywords changes
        if (changes.learnedKeywords) {
            console.log("🔍 learnedKeywords changed:", changes.learnedKeywords);
            learnedKeywords = changes.learnedKeywords.newValue || {};
        }
    }
});

// Check for active session when page becomes visible
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        try {
            chrome.storage.local.get(['activeSession', 'redditSettings'], (result) => {
                if (chrome.runtime.lastError) {
                    // Extension context invalidated (happens during development when reloading extension)
                    console.debug("Extension context invalidated, page refresh needed");
                    return;
                }

                if (result.activeSession && !isSessionActive) {
                    currentGoal = result.activeSession.goal;
                    isSessionActive = true;
                    console.log("🎯 Reddit: Session detected on visibility change:", currentGoal);
                    processAllPosts();
                }

                if (result.redditSettings) {
                    redditSettings = result.redditSettings;
                    if (redditSettings.filterMode) {
                        filterMode = redditSettings.filterMode;
                    }
                    applyRedditBlocking();
                }
            });
        } catch (e) {
            // Extension was reloaded, context invalidated - auto-reload page
            console.log("🔄 Extension reloaded, refreshing page to load new scripts...");
            window.location.reload();
        }
    }
});

function applyRedditBlocking() {
    // Remove existing style if present
    if (styleElement) {
        styleElement.remove();
    }

    // Create CSS rules based on settings
    let cssRules = [];

    // HEADER BUTTONS
    if (redditSettings.blockChat) {
        cssRules.push('a[href="/chat"] { display: none !important; }');
        cssRules.push('header a[href*="chat"] { display: none !important; }');
    }

    if (redditSettings.blockCreatePost) {
        cssRules.push('a[href*="/submit"] { display: none !important; }');
    }

    if (redditSettings.blockNotifications) {
        cssRules.push('header button[aria-label*="notification" i] { display: none !important; }');
    }

    if (redditSettings.blockGetApp) {
        cssRules.push('a[href*="/get-app"] { display: none !important; }');
        cssRules.push('a[href*="get-app"] { display: none !important; }');
    }

    if (redditSettings.blockLogIn) {
        cssRules.push('a[href*="/login"] { display: none !important; }');
    }

    if (redditSettings.blockSettingsMenu) {
        cssRules.push('#user-drawer-button { display: none !important; }');
        cssRules.push('header button[id*="user-drawer"] { display: none !important; }');
    }

    // LEFT SIDEBAR - Using actual structure from screenshots
    if (redditSettings.blockLeftSidebar) {
        cssRules.push('#left-sidebar-container { display: none !important; }');
        cssRules.push('flex-left-nav-container { display: none !important; }');
        cssRules.push('reddit-sidebar-nav { display: none !important; }');
    }

    if (redditSettings.blockCommunities) {
        // Target the Communities section in sidebar
        cssRules.push('nav[aria-label*="Communities"] { display: none !important; }');
        cssRules.push('shreddit-async-loader:has([aria-label*="Communities"]) { display: none !important; }');
    }

    if (redditSettings.blockRecent) {
        // Target the Recent section - trying multiple approaches
        cssRules.push('summary[aria-controls="RECENT"] { display: none !important; }');
        cssRules.push('summary[aria-controls="RECENT"] + ul { display: none !important; }');

        // Try targeting the parent details element
        cssRules.push('details:has(> summary[aria-controls="RECENT"]) { display: none !important; }');

        console.log('🔴 Applied Recent blocking selectors');
    }

    if (redditSettings.blockTopics) {
        cssRules.push('nav[aria-label*="Topics"] { display: none !important; }');
        cssRules.push('shreddit-async-loader:has([aria-label*="Topics"]) { display: none !important; }');
    }

    if (redditSettings.blockResources) {
        cssRules.push('nav[aria-label="Reddit resources"] { display: none !important; }');
        cssRules.push('shreddit-async-loader:has([aria-label="Reddit resources"]) { display: none !important; }');
    }

    if (redditSettings.blockPopularPosts) {
        // Hide "Popular" link in left sidebar - using exact href from HTML
        cssRules.push('a[href="///popular/"] { display: none !important; }');
        cssRules.push('reddit-sidebar-nav a[href*="popular/"]:has(span.text-14) { display: none !important; }');

        // Hide main feed content ONLY on /r/popular/ page using URL-specific selector
        const currentUrl = window.location.pathname;
        if (currentUrl === '/r/popular/' || currentUrl.startsWith('/r/popular/')) {
            cssRules.push('shreddit-feed { display: none !important; }');
            cssRules.push('shreddit-post { display: none !important; }');
            cssRules.push('#main-content { display: none !important; }');
            console.log('🔴 Hiding posts on /r/popular/ page');
        }

        // Target Popular Posts in left sidebar (on any page)
        cssRules.push('nav[aria-label*="Popular Posts"] { display: none !important; }');
        cssRules.push('shreddit-async-loader:has([aria-label*="Popular Posts"]) { display: none !important; }');
        cssRules.push('aside section:has(h3:contains("Popular Posts")) { display: none !important; }');
        cssRules.push('[bundlename*="popular_posts"] { display: none !important; }');
    }

    // FOOTER
    if (redditSettings.blockFooter) {
        cssRules.push('shreddit-footer { display: none !important; }');
        cssRules.push('footer { display: none !important; }');
        cssRules.push('.legal-links { display: none !important; }');
    }

    // RIGHT SIDEBAR
    if (redditSettings.blockPopularCommunities) {
        // Target the entire right sidebar on /popular/ page
        cssRules.push('.right-sidebar-container { display: none !important; }');
        cssRules.push('#right-sidebar-container { display: none !important; }');

        // Target async loaders with Popular Communities
        cssRules.push('aside shreddit-async-loader:has([aria-label*="Popular Communities"]) { display: none !important; }');
        cssRules.push('shreddit-async-loader[bundlename*="popular"] { display: none !important; }');

        // Target by aria-label
        cssRules.push('[aria-label*="Popular Communities"] { display: none !important; }');
        cssRules.push('aside section:has(h3:contains("Popular Communities")) { display: none !important; }');

        // Target the grid container on popular page
        cssRules.push('div[class*="grid-container"]:has([aria-label*="Popular"]) aside { display: none !important; }');
    }

    if (redditSettings.blockRelatedPosts) {
        // Target Related Posts section
        cssRules.push('aside shreddit-async-loader:has([aria-label*="Related"]) { display: none !important; }');
        cssRules.push('[aria-label*="Related Posts"] { display: none !important; }');
        cssRules.push('[aria-label*="Related Answers"] { display: none !important; }');
        cssRules.push('aside section:has(h3:contains("Related")) { display: none !important; }');
    }

    // POST ELEMENTS - Using actual inspected structure
    if (redditSettings.blockComments) {
        // Hide comments button and comments section
        cssRules.push('a[data-click-location="comments-button"] { display: none !important; }');
        cssRules.push('shreddit-comment-tree { display: none !important; }');
        cssRules.push('shreddit-comment { display: none !important; }');
    }

    if (redditSettings.blockUpvoteDownvote) {
        // Hide upvote and downvote buttons
        cssRules.push('button[aria-label*="upvote" i] { display: none !important; }');
        cssRules.push('button[aria-label*="downvote" i] { display: none !important; }');
        cssRules.push('button[aria-pressed="false"][class*="upvote"] { display: none !important; }');
        cssRules.push('button[aria-pressed="false"][class*="downvote"] { display: none !important; }');
    }

    if (redditSettings.blockUpvotesCount) {
        cssRules.push('faceplate-number[pretty] { display: none !important; }');
        cssRules.push('faceplate-number { display: none !important; }');
    }

    if (redditSettings.blockShare) {
        // Hide share button
        cssRules.push('shreddit-post-share-button { display: none !important; }');
        cssRules.push('button[aria-label*="Share" i] { display: none !important; }');
    }

    if (redditSettings.blockAward) {
        // Hide award button
        cssRules.push('award-button { display: none !important; }');
        cssRules.push('button[class*="award"] { display: none !important; }');
    }

    // HOME FEED
    if (redditSettings.blockHomeFeed) {
        cssRules.push('shreddit-feed { display: none !important; }');
        cssRules.push('shreddit-post { display: none !important; }');
    }

    // Apply CSS if there are rules
    if (cssRules.length > 0) {
        styleElement = document.createElement('style');
        styleElement.id = 'reddit-focus-guard-styles';
        styleElement.textContent = cssRules.join('\n');
        document.head.appendChild(styleElement);
        console.log(`✅ Applied ${cssRules.length} Reddit blocking rules`);
    } else {
        console.log('ℹ️ No Reddit blocking rules active');
    }

    // Manually hide POST elements if needed (CSS not working due to shadow DOM)
    setTimeout(() => {
        if (redditSettings.blockComments) {
            document.querySelectorAll('a[data-post-click-location="comments-button"]').forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
        }

        if (redditSettings.blockUpvoteDownvote) {
            document.querySelectorAll('button[aria-label*="upvote"], button[aria-label*="downvote"]').forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
        }

        if (redditSettings.blockShare) {
            document.querySelectorAll('shreddit-post-share-button').forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
        }

        if (redditSettings.blockAward) {
            document.querySelectorAll('award-button').forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
        }
    }, 50);

    // Manually hide Recent section if needed (CSS not working)
    if (redditSettings.blockRecent) {
        setTimeout(() => {
            const recentSummary = document.querySelector('summary[aria-controls="RECENT"]');
            if (recentSummary) {
                const recentDetails = recentSummary.closest('details');
                if (recentDetails) {
                    recentDetails.style.setProperty('display', 'none', 'important');
                    console.log('✅ Manually hidden Recent section');
                }
            }
        }, 50);
    }
}

// Initial application
setTimeout(() => {
    applyRedditBlocking();
}, 50);

// Listen for URL changes (Reddit is a SPA)
let lastUrl = location.pathname;
new MutationObserver(() => {
    const currentUrl = location.pathname;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('🔴 URL changed, reapplying blocking');
        applyRedditBlocking();
    }
}).observe(document.body, { subtree: true, childList: true });

// ===== GOAL-BASED CONTENT FILTERING =====

/**
 * Extract post data from Reddit post element
 */
function extractPostData(postElement) {
    try {
        // Get post title
        let titleElement = postElement.querySelector('h2 a') ||
            postElement.querySelector('[slot="title"]') ||
            postElement.querySelector('h3') ||
            postElement.querySelector('[data-testid="post-title"]') ||
            postElement.querySelector('a[data-click-id="body"]');

        let title = titleElement ? titleElement.textContent.trim() : '';

        // Get subreddit name
        const subredditElement = postElement.querySelector('a[href*="/r/"]');
        let subreddit = '';
        if (subredditElement) {
            const href = subredditElement.getAttribute('href');
            const match = href.match(/\/r\/([^\/]+)/);
            subreddit = match ? match[1] : '';
        }

        // Get post content/text
        const contentElement = postElement.querySelector('[slot="text-body"]') ||
            postElement.querySelector('[data-test-id="post-content"]') ||
            postElement.querySelector('.md') ||
            postElement.querySelector('p');
        const content = contentElement ? contentElement.textContent.trim().substring(0, 500) : '';

        return { title, subreddit, content };
    } catch (error) {
        console.error("Error extracting post data:", error);
        return { title: '', subreddit: '', content: '' };
    }
}

/**
 * FREE TIER: Check post relevance using keyword matching
 */
function checkPostRelevance(postData) {
    if (!currentGoal) return true;

    const stopWords = ['and', 'for', 'the', 'with', 'how', 'to', 'in', 'on', 'at', 'a', 'an', 'is', 'are', 'be', 'of'];

    const goalKeywords = currentGoal
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(" ")
        .filter(w => w.length >= 2 && !stopWords.includes(w));

    const postContext = `${postData.title} ${postData.content} ${postData.subreddit}`.toLowerCase();

    const exactMatch = goalKeywords.some(keyword => postContext.includes(keyword));
    if (exactMatch) return true;

    const goalKey = currentGoal.toLowerCase().trim();
    if (learnedKeywords && learnedKeywords[goalKey]) {
        const learnedMatch = learnedKeywords[goalKey].some(keyword => postContext.includes(keyword));
        if (learnedMatch) return true;
    }

    const postWords = postContext.split(/\s+/).filter(w => w.length >= 3);
    const fuzzyMatch = goalKeywords.some(gk => {
        if (gk.length >= 3) {
            return postWords.some(pw =>
                pw.includes(gk) || gk.includes(pw) ||
                (pw.length >= 4 && gk.length >= 4 && pw.substring(0, 3) === gk.substring(0, 3))
            );
        }
        return false;
    });

    if (fuzzyMatch) return true;

    const learningKeywords = ['learn', 'tutorial', 'course', 'study', 'guide', 'explained'];
    const isLearningGoal = learningKeywords.some(k => currentGoal.toLowerCase().includes(k));

    if (isLearningGoal) {
        const educationalIndicators = ['tutorial', 'course', 'learn', 'guide', 'explained', 'introduction', 'beginner', 'complete', 'how to'];
        const hasEducationalContent = educationalIndicators.some(ind => postContext.includes(ind));

        if (hasEducationalContent) {
            const titleWords = postData.title.toLowerCase()
                .replace(/[^a-z0-9 ]/g, "")
                .split(" ")
                .filter(w => w.length >= 3 && !stopWords.includes(w));

            const sharedWords = titleWords.filter(tw =>
                goalKeywords.some(gk => tw.includes(gk) || gk.includes(tw))
            );

            if (sharedWords.length > 0) return true;
        }
    }

    return false;
}

/**
 * Apply filtering to a post based on relevance
 */
function applyPostFiltering(postElement, isRelevant) {
    if (filterMode === 'off') {
        postElement.style.removeProperty('filter');
        postElement.style.removeProperty('opacity');
        postElement.style.removeProperty('display');
        postElement.classList.remove('reddit-filtered-post');
        return;
    }

    if (isRelevant) {
        postElement.style.removeProperty('filter');
        postElement.style.removeProperty('opacity');
        postElement.style.removeProperty('display');
        postElement.classList.remove('reddit-filtered-post');
    } else {
        if (filterMode === 'blur') {
            postElement.style.filter = 'blur(8px)';
            postElement.style.opacity = '0.5';
            postElement.style.transition = 'filter 0.3s ease';
            postElement.classList.add('reddit-filtered-post');

            postElement.style.cursor = 'pointer';
            postElement.addEventListener('click', function revealPost() {
                postElement.style.filter = 'none';
                postElement.style.opacity = '1';
                postElement.removeEventListener('click', revealPost);
            }, { once: true });
        } else {
            postElement.style.display = 'none';
            postElement.classList.add('reddit-filtered-post');
        }
    }
}

/**
 * Process all visible Reddit posts
 */
async function processAllPosts() {
    if (!isSessionActive || !currentGoal || filterMode === 'off') return;

    chrome.storage.local.get(['aiMonitor', 'isPremium'], async (result) => {
        if (result.aiMonitor && result.isPremium) return;
        _runKeywordFallback();
    });
}

/**
 * Keyword-based fallback for free users
 */
async function _runKeywordFallback() {
    const searchQuery = new URLSearchParams(window.location.search).get('q');
    if (searchQuery) {
        const isRelevant = checkPostRelevance({ title: searchQuery, content: '', subreddit: '' });

        if (!isRelevant) {
            const container = document.querySelector('div.bg-neutral-background');
            if (container) {
                if (filterMode === 'blur') {
                    container.style.filter = 'blur(20px)';
                    container.style.opacity = '0.3';
                    container.style.pointerEvents = 'none';

                    const message = document.createElement('div');
                    message.id = 'reddit-goal-alert';
                    message.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; text-align: center;';
                    message.innerHTML = `<h2>🎯 Not relevant to your goal</h2><p>Search: "${searchQuery}"</p><p>Your goal: "${currentGoal}"</p><button onclick="this.parentElement.remove(); document.querySelector('div.bg-neutral-background').style.filter='none'; document.querySelector('div.bg-neutral-background').style.opacity='1'; document.querySelector('div.bg-neutral-background').style.pointerEvents='auto';" style="padding: 10px 20px; background: #0079d3; color: white; border: none; border-radius: 5px; cursor: pointer;">Show anyway</button>`;
                    document.body.appendChild(message);
                } else {
                    container.style.display = 'none';
                }
            }
            return;
        }
    }

    let posts = document.querySelectorAll('shreddit-post');
    if (posts.length === 0) posts = document.querySelectorAll('div[data-testid="search-post-with-content-preview"]');
    if (posts.length === 0) posts = document.querySelectorAll('div[data-testid="post-container"]');

    const postsToAnalyze = [];
    const postElements = [];

    for (const post of posts) {
        const postId = post.getAttribute('id') || post.getAttribute('data-post-id');
        if (processedPosts.has(postId)) continue;

        const postData = extractPostData(post);
        if (!postData.title) continue;

        postsToAnalyze.push(postData);
        postElements.push(post);
        processedPosts.add(postId);
    }

    if (postsToAnalyze.length === 0) return;

    postsToAnalyze.forEach((postData, index) => {
        const isRelevant = checkPostRelevance(postData);
        applyPostFiltering(postElements[index], isRelevant);
    });
}

/**
 * Remove all filters from posts
 */
function removeAllFilters() {
    const filteredPosts = document.querySelectorAll('.reddit-filtered-post');
    filteredPosts.forEach(post => {
        post.style.removeProperty('filter');
        post.style.removeProperty('opacity');
        post.style.removeProperty('display');
        post.classList.remove('reddit-filtered-post');
    });
    processedPosts.clear();
}

/**
 * Observe for new posts (infinite scroll)
 */
const postObserver = new MutationObserver((mutations) => {
    if (isSessionActive && currentGoal) {
        clearTimeout(window.redditProcessTimeout);
        window.redditProcessTimeout = setTimeout(() => {
            processAllPosts();
        }, 100);
    }
});

// Start observing for new posts
setTimeout(() => {
    const feedContainer = document.querySelector('shreddit-feed') || document.body;
    postObserver.observe(feedContainer, {
        childList: true,
        subtree: true
    });
}, 200);

// Check for existing session on load
chrome.storage.local.get(['activeSession'], (result) => {
    if (result.activeSession && result.activeSession.goal) {
        currentGoal = result.activeSession.goal;
        isSessionActive = true;
        setTimeout(() => processAllPosts(), 200);
    }
});

console.log("🔴 Reddit Focus Guard Ready");

})();