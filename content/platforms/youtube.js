// YouTube-Specific Content Script with Smart Goal Checking
console.log("🎬 YouTube Focus Guard Loaded");

let silencerEnabled = false;
let grayscaleEnabled = false;
let aiMonitorEnabled = false;
let useAIMode = false; // Premium feature
let authToken = null;
let currentGoal = "";
let checkedVideos = new Set();
let whitelistedVideos = new Set();
let learnedKeywords = {}; // Dictionary: { "goal": ["keyword1", "keyword2"] }
let youtubeSettings = {}; // Platform-specific settings from popup

const API_URL = 'https://your-backend-url.com/api'; // Will be configured

// Initial State Check
chrome.storage.local.get(['silencerMode', 'grayscaleMode', 'aiMonitor', 'currentGoal', 'useAIMode', 'authToken', 'learnedKeywords', 'youtubeSettings'], (result) => {
    silencerEnabled = result.silencerMode || false;
    grayscaleEnabled = result.grayscaleMode || false;
    aiMonitorEnabled = result.aiMonitor || false;
    useAIMode = result.useAIMode || false;
    authToken = result.authToken || null;
    currentGoal = result.currentGoal || "";
    learnedKeywords = result.learnedKeywords || {};
    youtubeSettings = result.youtubeSettings || {};

    // DEBUG: Show what was loaded
    console.log("🔧 YouTube Script Initialized:");
    console.log("  - AI Monitor:", aiMonitorEnabled);
    console.log("  - Current Goal:", currentGoal || "(none)");
    console.log("  - Silencer:", silencerEnabled);
    console.log("  - Use AI Mode:", useAIMode);
    console.log("  - Learned Keywords:", learnedKeywords);
    console.log("  - YouTube Settings:", youtubeSettings);

    if (silencerEnabled) enableSilencer();
    if (grayscaleEnabled) enableGrayscale();
    applyYouTubeSettings(); // Apply platform-specific settings
    if (aiMonitorEnabled && currentGoal) {
        console.log("✅ Starting initial check...");
        checkCurrentVideo();
    } else {
        console.warn("⚠️ AI Monitor not active:", {
            aiMonitorEnabled,
            hasGoal: !!currentGoal
        });
    }

    console.log(`🎯 Mode: ${useAIMode ? 'AI (Premium)' : 'Keyword (Free)'}`);
});

// Listener for real-time updates
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "updateMode") {
        if (request.key === "silencerMode") {
            silencerEnabled = request.value;
            request.value ? enableSilencer() : disableSilencer();
        } else if (request.key === "grayscaleMode") {
            grayscaleEnabled = request.value;
            request.value ? enableGrayscale() : disableGrayscale();
        } else if (request.key === "aiMonitor") {
            aiMonitorEnabled = request.value;
            if (request.value && currentGoal) {
                checkCurrentVideo();
            }
        }
    } else if (request.action === "updateGoal") {
        chrome.storage.local.get('currentGoal', (result) => {
            currentGoal = result.currentGoal || "";
            console.log("🎯 Goal updated to:", currentGoal);

            // Clear all processed flags so videos get re-checked
            document.querySelectorAll('[data-goal-processed]').forEach(el => {
                delete el.dataset.goalProcessed;
            });
            console.log("🔄 Cleared all processed video flags");

            if (aiMonitorEnabled && currentGoal) {
                checkedVideos.clear();
                console.log("✅ Re-checking with new goal...");
                checkCurrentVideo();
            } else {
                console.warn("⚠️ Cannot check - AI Monitor:", aiMonitorEnabled, "Goal:", currentGoal);
            }
        });
    } else if (request.action === "removeOverlay") {
        removeGoalOverlay();
    } else if (request.action === "platformSettingsUpdated" && request.platform === "youtube") {
        youtubeSettings = request.settings;
        console.log("🎬 YouTube settings updated:", youtubeSettings);
        applyYouTubeSettings();
    }
});

// Watch for URL changes (YouTube is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log("📍 YouTube navigation detected");
        if (aiMonitorEnabled && currentGoal) {
            setTimeout(() => checkCurrentVideo(), 1000);
        }
    }
}).observe(document, { subtree: true, childList: true });

// FIX 1: Continuous browse monitoring (handles infinite scroll)
const browseObserver = new MutationObserver(() => {
    if (!aiMonitorEnabled || !currentGoal) return;

    const pathname = window.location.pathname;
    if (
        pathname === '/' ||
        pathname.includes('/results') ||
        pathname.includes('/feed')
    ) {
        checkBrowsePage();
    }
});

browseObserver.observe(document.body, {
    childList: true,
    subtree: true
});

// FIX 2: Click interception (blocks clicks on blurred videos)
document.addEventListener('click', (e) => {
    // Don't intercept if clicking the unblur button
    if (e.target.classList.contains('unblur-btn')) {
        return;
    }

    const anchor = e.target.closest('a#video-title');
    if (!anchor) return;

    const renderer = anchor.closest(
        'ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
    );

    if (!renderer) return;

    // If video is blurred (check for pointer-events: none)
    if (renderer.style.pointerEvents === 'none') {
        e.preventDefault();
        e.stopPropagation();

        const title = anchor.textContent.trim();
        const channel =
            renderer.querySelector('#channel-name a')?.textContent.trim() || '';

        showGoalOverlay({
            title,
            channel,
            description: '',
            metaDesc: '',
            metaKeywords: '',
            url: anchor.href
        }, 'keyword');

        console.log("🚫 Blocked off-track video click:", title);
    }
}, true);

// FIX 3: Video play detection (catches autoplay)
document.addEventListener('play', (e) => {
    if (e.target.tagName === 'VIDEO') {
        console.log("▶️ Video play detected");
        setTimeout(() => checkCurrentVideo(), 800);
    }
}, true);

// Grayscale
function enableGrayscale() {
    document.documentElement.classList.add('grayscale-mode');
    grayscaleEnabled = true;
}

function disableGrayscale() {
    document.documentElement.classList.remove('grayscale-mode');
    grayscaleEnabled = false;
}

// YouTube Silencer
function enableSilencer() {
    if (window.youtubeObserver) return;

    document.body.classList.add('silencer-active');
    hideYouTubeDistractions();

    const observer = new MutationObserver(hideYouTubeDistractions);
    observer.observe(document.body, { childList: true, subtree: true });
    window.youtubeObserver = observer;
    silencerEnabled = true;

    console.log("✅ YouTube Silencer enabled");
}

function disableSilencer() {
    document.body.classList.remove('silencer-active');
    if (window.youtubeObserver) {
        window.youtubeObserver.disconnect();
        window.youtubeObserver = null;
    }
    silencerEnabled = false;
    console.log("❌ YouTube Silencer disabled");
}

function hideYouTubeDistractions() {
    if (!silencerEnabled) return;

    // Hide recommended videos sidebar
    document.querySelectorAll('#secondary, #related').forEach(el => {
        el.style.display = 'none';
    });

    // Hide Shorts shelf
    document.querySelectorAll('ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts]').forEach(el => {
        el.style.display = 'none';
    });

    // Hide comments
    document.querySelectorAll('#comments, ytd-comments').forEach(el => {
        el.style.display = 'none';
    });

    // Blur home feed (when on homepage)
    if (window.location.pathname === '/') {
        document.querySelectorAll('ytd-rich-grid-renderer').forEach(el => {
            el.style.filter = 'blur(8px)';
            el.style.pointerEvents = 'none';
        });
    }
}

// ========== YOUTUBE PLATFORM SETTINGS ==========

function applyYouTubeSettings() {
    console.log("🎬 Applying YouTube settings:", youtubeSettings);

    // Set up observer for dynamic content
    if (!window.youtubeSettingsObserver) {
        window.youtubeSettingsObserver = new MutationObserver(() => {
            applyYouTubeBlocking();
        });
        window.youtubeSettingsObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Apply immediately
    applyYouTubeBlocking();
}

function applyYouTubeBlocking() {
    // BLOCK SHORTS
    if (youtubeSettings.blockShorts) {
        // Shorts shelf on homepage
        hideElements('ytd-reel-shelf-renderer', 'Shorts Shelf');
        hideElements('ytd-rich-shelf-renderer[is-shorts]', 'Shorts Rich Shelf');

        // Shorts button in sidebar
        hideElements('ytd-guide-entry-renderer a[href="/shorts"]', 'Shorts Button');
        hideElements('ytd-mini-guide-entry-renderer a[href="/shorts"]', 'Shorts Mini Button');

        // Individual shorts videos
        hideElements('ytd-reel-video-renderer', 'Shorts Videos');

        // Shorts tab on channel pages
        hideElements('yt-tab-shape[tab-title="Shorts"]', 'Shorts Tab');
    }

    // BLOCK RECOMMENDATIONS (Sidebar on watch page)
    if (youtubeSettings.blockRecommendations) {
        hideElements('#secondary #related', 'Recommendations Sidebar');
        hideElements('ytd-watch-next-secondary-results-renderer', 'Watch Next');
    }

    // BLOCK COMMENTS
    if (youtubeSettings.blockComments) {
        hideElements('#comments', 'Comments Section');
        hideElements('ytd-comments', 'Comments');
        hideElements('#comment-teaser', 'Comment Teaser');
    }

    // BLOCK HOME FEED
    if (youtubeSettings.blockHomeFeed) {
        if (window.location.pathname === '/' || window.location.pathname === '/feed/subscriptions') {
            hideElements('ytd-rich-grid-renderer', 'Home Feed');
            hideElements('ytd-browse[page-subtype="home"]', 'Home Page');
            hideElements('ytd-browse[page-subtype="subscriptions"]', 'Subscriptions Feed');
        }
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

// ========== SMART GOAL CHECKING ==========

function checkCurrentVideo() {
    if (!aiMonitorEnabled || !currentGoal) return;

    const pathname = window.location.pathname;

    // Watch page: Check the current video
    if (pathname.includes('/watch')) {
        checkWatchPage();
    }
    // Browse pages: Check all visible thumbnails
    else if (pathname === '/' || pathname.includes('/results') || pathname.includes('/feed')) {
        checkBrowsePage();
    }
}

// Check video on watch page (show overlay if not relevant)
function checkWatchPage() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return;

    if (checkedVideos.has(videoId) || whitelistedVideos.has(videoId)) {
        console.log("✅ Video already checked or whitelisted");
        return;
    }

    setTimeout(() => {
        const videoData = extractVideoData();
        if (!videoData) {
            console.log("⏳ Video data not ready yet");
            return;
        }

        checkedVideos.add(videoId);

        // Choose checking method based on user's tier
        if (useAIMode && authToken) {
            checkWithAI(videoData);
        } else {
            checkWithKeywords(videoData);
        }
    }, 1500);
}

// Check thumbnails on browse pages (blur non-relevant videos)
function checkBrowsePage() {
    console.log("🔍 Checking browse page...");
    console.log("  - AI Monitor:", aiMonitorEnabled);
    console.log("  - Goal:", currentGoal);

    if (!aiMonitorEnabled || !currentGoal) {
        console.warn("⚠️ Skipping browse check - AI Monitor or Goal missing");
        return;
    }

    // Get all video renderers
    const videoRenderers = document.querySelectorAll('ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
    console.log(`  - Found ${videoRenderers.length} video thumbnails`);

    videoRenderers.forEach(renderer => {
        // Temporarily disabled - process all videos every time
        // TODO: Re-enable with smarter logic later
        // if (renderer.dataset.goalProcessed === 'true') {
        //     return;
        // }

        // Extract title from thumbnail
        const titleElement = renderer.querySelector('#video-title');
        const title = titleElement?.textContent?.trim() || "";
        const channelElement = renderer.querySelector('#channel-name a, .ytd-channel-name a');
        const channel = channelElement?.textContent?.trim() || "";

        if (!title) return;

        console.log(`🔍 Checking: ${title.substring(0, 50)}...`);

        const videoData = { title, channel, description: "", metaDesc: "", metaKeywords: "", url: "" };
        const isRelevant = checkGoalRelevance(videoData);

        if (!isRelevant) {
            console.log(`❌ Marking as off-track: ${title}`);

            // Find and blur ONLY the thumbnail
            const thumbnail = renderer.querySelector('ytd-thumbnail, #thumbnail');
            if (thumbnail) {
                thumbnail.style.filter = 'blur(12px) grayscale(100%)';
                thumbnail.style.transition = 'filter 0.3s';
            }

            // Dim the metadata (title, channel, etc.) but keep readable
            const metadata = renderer.querySelector('#details, #meta');
            if (metadata) {
                metadata.style.opacity = '0.4';
                metadata.style.transition = 'opacity 0.3s';
            }

            // Block clicks on the entire video
            renderer.style.pointerEvents = 'none';
            renderer.style.position = 'relative';

            // Add warning label
            if (!renderer.querySelector('.off-track-label')) {
                const label = document.createElement('div');
                label.className = 'off-track-label';
                label.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background: rgba(255, 107, 107, 0.95);
                    color: white;
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 700;
                    z-index: 100;
                    pointer-events: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                `;
                label.textContent = '⚠️ Off-Track';
                renderer.appendChild(label);
                console.log("  ✅ Added label");
            }

            // Add unblur button (NOT inside blurred area!)
            if (!renderer.querySelector('.unblur-btn')) {
                const unblurBtn = document.createElement('button');
                unblurBtn.className = 'unblur-btn';
                unblurBtn.style.cssText = `
                    position: absolute;
                    bottom: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgb(76, 175, 80);
                    color: white;
                    border: 2px solid white;
                    padding: 10px 24px;
                    border-radius: 8px;
                    font-weight: 700;
                    cursor: pointer;
                    font-size: 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    pointer-events: auto;
                    z-index: 101;
                    transition: all 0.3s;
                `;
                unblurBtn.textContent = '✓ This is Related';

                // Hover effect
                unblurBtn.addEventListener('mouseenter', () => {
                    unblurBtn.style.transform = 'translateX(-50%) scale(1.05)';
                    unblurBtn.style.boxShadow = '0 6px 16px rgba(76, 175, 80, 0.5)';
                });
                unblurBtn.addEventListener('mouseleave', () => {
                    unblurBtn.style.transform = 'translateX(-50%) scale(1)';
                    unblurBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
                });

                // Click to unblur & LEARN
                unblurBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    console.log(`✅ User marked as relevant: "${title}"`);

                    // 1. Unblur UI
                    if (thumbnail) thumbnail.style.filter = 'none';
                    if (metadata) metadata.style.opacity = '1';
                    renderer.style.pointerEvents = 'auto';
                    const label = renderer.querySelector('.off-track-label');
                    if (label) label.remove();
                    unblurBtn.remove();
                    renderer.removeEventListener('mouseenter', hoverHandler);
                    renderer.removeEventListener('mouseleave', leaveHandler);

                    // 2. LEARN: Extract keywords for THIS goal
                    const titleWords = title.toLowerCase()
                        .replace(/[^a-z0-9 ]/g, "")
                        .split(' ')
                        .filter(w => w.length > 3);

                    console.log(`📚 Learning from feedback for goal "${currentGoal}":`, titleWords);

                    // Initialize list for this goal if missing
                    const goalKey = currentGoal.toLowerCase().trim();
                    if (!learnedKeywords[goalKey]) {
                        learnedKeywords[goalKey] = [];
                    }

                    // Add new unique keywords
                    const existing = learnedKeywords[goalKey];
                    const newKeywords = titleWords.filter(w => !existing.includes(w));

                    if (newKeywords.length > 0) {
                        learnedKeywords[goalKey].push(...newKeywords);
                        chrome.storage.local.set({ learnedKeywords }, () => {
                            console.log(`💾 Saved ${newKeywords.length} new terms for "${goalKey}":`, newKeywords);
                            // IMMEDIATE UPDATE: Re-scan the whole page to unblur other matching videos!
                            console.log("🔄 Triggering immediate page re-scan...");
                            checkBrowsePage();
                        });
                    } else {
                        // Even if no new unique words (rare), re-check just in case
                        checkBrowsePage();
                    }
                });

                renderer.appendChild(unblurBtn);
                console.log("  ✅ Added unblur button");
            }

            // Hover to preview (unblur temporarily)
            const hoverHandler = () => {
                if (thumbnail) {
                    thumbnail.style.filter = 'blur(0px) grayscale(0%)';
                }
                if (metadata) {
                    metadata.style.opacity = '1';
                }
            };

            const leaveHandler = () => {
                if (thumbnail) {
                    thumbnail.style.filter = 'blur(12px) grayscale(100%)';
                }
                if (metadata) {
                    metadata.style.opacity = '0.4';
                }
            };

            renderer.addEventListener('mouseenter', hoverHandler);
            renderer.addEventListener('mouseleave', leaveHandler);
        } else {
            console.log(`✅ Relevant: ${title}`);

            // CLEANUP: If video was previously blurred, unblur it now!
            const thumbnail = renderer.querySelector('ytd-thumbnail, #thumbnail');
            if (thumbnail) {
                thumbnail.style.filter = 'none';
                thumbnail.style.transition = 'filter 0.3s';
            }

            const metadata = renderer.querySelector('#details, #meta');
            if (metadata) {
                metadata.style.opacity = '1';
                metadata.style.transition = 'opacity 0.3s';
            }

            renderer.style.pointerEvents = 'auto';
            renderer.style.position = '';

            const label = renderer.querySelector('.off-track-label');
            if (label) label.remove();

            const unblurBtn = renderer.querySelector('.unblur-btn');
            if (unblurBtn) unblurBtn.remove();
        }
    });
}

// FREE TIER: Keyword-based checking (works offline)
function checkWithKeywords(videoData) {
    const isRelevant = checkGoalRelevance(videoData);

    console.log("🎯 Keyword Check Result:", isRelevant ? "✅ RELEVANT" : "❌ NOT RELEVANT");

    if (!isRelevant) {
        showGoalOverlay(videoData, 'keyword');
    }
}

// PREMIUM TIER: AI-based checking
// Delegates entirely to content/ai/ai-monitor.js — no API keys here.
async function checkWithAI(videoData) {
    // Guard: ai-monitor.js might not be injected yet (non-premium users)
    if (!window.aiMonitor?.isAvailable()) {
        console.warn("⚠️ AI Monitor not available — falling back to keyword mode");
        checkWithKeywords(videoData);
        return;
    }

    try {
        console.log("🤖 AI Monitor checking:", videoData.title?.slice(0, 50));

        const result = await window.aiMonitor.checkContent({
            goal: currentGoal,
            title: videoData.title,
            channel: videoData.channel,
            description: videoData.description
        });

        console.log("🤖 AI Result:", result.isRelevant ? "✅ RELEVANT" : "❌ NOT RELEVANT");
        console.log("📊 Confidence:", result.confidence, "| From cache:", result.fromCache);
        if (result.reasoning) console.log("💭 Reasoning:", result.reasoning);
        if (result.remainingScans !== undefined) console.log("🔢 Remaining scans today:", result.remainingScans);

        if (!result.isRelevant) {
            showGoalOverlay(videoData, 'ai', result);
        }

    } catch (error) {
        if (error.message === 'AUTH_EXPIRED') {
            console.warn("🔒 Session expired — please log in again");
            useAIMode = false;
            checkWithKeywords(videoData);
        } else if (error.message === 'NOT_PREMIUM') {
            console.warn("⭐ Premium required for AI Monitor");
            showUpgradePrompt();
            checkWithKeywords(videoData);
        } else if (error.message?.startsWith('LIMIT_REACHED')) {
            const resetsAt = error.message.split(':')[1];
            console.warn("⏳ Daily AI scan limit reached. Resets at:", resetsAt);
            checkWithKeywords(videoData); // Graceful fallback
        } else {
            console.error("AI Monitor error:", error.message);
            console.log("⚠️ Falling back to keyword mode");
            checkWithKeywords(videoData);
        }
    }
}

function extractVideoData() {
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer, h1.title yt-formatted-string');
    const title = titleElement?.innerText || "";

    const descElement = document.querySelector('#description-inline-expander, ytd-text-inline-expander');
    const description = descElement?.innerText || "";

    const channelElement = document.querySelector('#channel-name a, ytd-channel-name a');
    const channel = channelElement?.innerText || "";

    const metaDesc = document.querySelector('meta[name="description"]')?.content || "";
    const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || "";

    if (!title) return null;

    return {
        title,
        description,
        channel,
        metaDesc,
        metaKeywords,
        url: window.location.href
    };
}

// ========== SMART GOAL CHECKING WITH ADAPTIVE LEARNING ==========
// Strategy: content/platforms/youtube.js

function checkGoalRelevance(videoData) {
    const stopWords = ['and', 'for', 'the', 'with', 'how', 'to', 'in', 'on', 'at', 'a', 'an', 'is', 'are', 'be', 'of', 'video', 'watch'];

    // 1. Clean and tokenize the current goal
    const goalKeywords = currentGoal
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(" ")
        .filter(w => w.length >= 2 && !stopWords.includes(w));

    // 2. Prepare video context
    const videoContext = `
        ${videoData.title}
        ${videoData.description}
        ${videoData.channel}
        ${videoData.metaDesc}
        ${videoData.metaKeywords}
    `.toLowerCase();

    // 3. Get adaptive keywords for THIS specific goal
    const goalKey = currentGoal.toLowerCase().trim();
    // Default to empty list if no keywords learned for this goal yet
    const adaptiveKeywords = (learnedKeywords && learnedKeywords[goalKey]) ? learnedKeywords[goalKey] : [];

    console.log("🔍 Goal:", currentGoal);
    console.log("📚 Known Keywords:", goalKeywords);
    console.log("🧠 Learned Context:", adaptiveKeywords);
    console.log("📄 Video Title:", videoData.title);

    // Strategy A: Exact Goal Match
    const exactMatch = goalKeywords.some(keyword => videoContext.includes(keyword));
    if (exactMatch) {
        console.log("✅ RELEVANT (Direct goal match)");
        return true;
    }

    // Strategy B: Learned Concept Match (The "Knapsack" Fix)
    // If the video contains a keyword we previously learned is related to this goal
    if (adaptiveKeywords.length > 0) {
        const learnedMatch = adaptiveKeywords.some(keyword => videoContext.includes(keyword));
        if (learnedMatch) {
            console.log("✅ RELEVANT (Adaptive learning match)");
            return true;
        }
    }

    // Strategy C: Fuzzy Matching (Typos/Plurals)
    const videoWords = videoContext.split(/\s+/).filter(w => w.length >= 3);
    const fuzzyMatch = goalKeywords.some(gk => {
        if (gk.length >= 3) {
            return videoWords.some(vw =>
                vw.includes(gk) || gk.includes(vw) ||
                (vw.length >= 4 && gk.length >= 4 && vw.substring(0, 3) === gk.substring(0, 3))
            );
        }
        return false;
    });

    if (fuzzyMatch) {
        console.log("✅ RELEVANT (Fuzzy match)");
        return true;
    }

    // Strategy D: Broad Educational Check (Learning Mode)
    const learningKeywords = ['learn', 'tutorial', 'course', 'study', 'guide', 'explained', 'roadmap'];
    const isLearningGoal = learningKeywords.some(k => currentGoal.toLowerCase().includes(k));

    if (isLearningGoal) {
        const educationalIndicators = ['tutorial', 'course', 'learn', 'guide', 'explained', 'introduction', 'beginner', 'complete'];
        const hasEducationalContent = educationalIndicators.some(ind => videoContext.includes(ind));

        if (hasEducationalContent) {
            // If it's educational, be more lenient with partial matches
            const titleWords = videoData.title.toLowerCase()
                .replace(/[^a-z0-9 ]/g, "")
                .split(" ")
                .filter(w => w.length >= 3 && !stopWords.includes(w));

            const sharedWords = titleWords.filter(tw =>
                goalKeywords.some(gk => tw.includes(gk) || gk.includes(tw))
            );

            if (sharedWords.length > 0) {
                console.log("✅ RELEVANT (Broad educational match)");
                return true;
            }
        }
    }

    console.log("❌ NOT RELEVANT (No matching concepts found)");
    return false;
}

function showGoalOverlay(videoData, mode = 'keyword', aiResult = null) {
    removeGoalOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'youtube-goal-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(15px);
        -webkit-backdrop-filter: blur(15px);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-family: 'Roboto', sans-serif;
    `;

    const modeLabel = mode === 'ai' ? '🤖 AI Analysis' : '🔍 Keyword Match';
    const reasoning = aiResult?.reasoning || 'Video content doesn\'t match your goal keywords';

    overlay.innerHTML = `
        <div style="background: rgba(30, 30, 30, 0.95); padding: 50px; border-radius: 20px; text-align: center; border: 1px solid #444; max-width: 600px;">
            <div style="font-size: 0.9rem; color: #888; margin-bottom: 10px;">${modeLabel}</div>
            <h1 style="font-size: 2rem; margin: 0 0 15px 0; color: #ff6b6b;">⚠️ Off-Track Alert</h1>
            <p style="font-size: 1.1rem; color: #bbb; margin-bottom: 10px;">This video doesn't seem related to your goal:</p>
            <p style="font-size: 1.3rem; color: white; font-weight: 600; margin-bottom: 20px;">"${currentGoal}"</p>
            
            <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <p style="font-size: 0.95rem; color: #888; margin: 0;">Current video:</p>
                <p style="font-size: 1.1rem; color: #fff; margin: 10px 0 0 0; font-weight: 500;">${videoData.title}</p>
            </div>

            ${mode === 'ai' ? `
                <div style="background: rgba(100,100,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid rgba(100,100,255,0.3);">
                    <p style="font-size: 0.9rem; color: #aaf; margin: 0;">💭 AI Reasoning:</p>
                    <p style="font-size: 0.95rem; color: #ddf; margin: 5px 0 0 0;">${reasoning}</p>
                </div>
            ` : ''}
            
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <button id="btn-go-back" style="
                    padding: 16px; 
                    font-size: 1.1rem; 
                    cursor: pointer; 
                    background: #4CAF50; 
                    color: white; 
                    border: none; 
                    border-radius: 12px; 
                    font-weight: 600;
                    transition: all 0.2s;">
                    ← Go Back to Goal
                </button>
                
                <button id="btn-this-is-related" style="
                    padding: 14px; 
                    font-size: 1rem; 
                    cursor: pointer; 
                    background: transparent; 
                    color: #e0e0e0; 
                    border: 1px solid #666; 
                    border-radius: 12px;
                    transition: all 0.2s;">
                    This IS Related (Continue)
                </button>

                ${mode === 'keyword' && !useAIMode ? `
                    <button id="btn-upgrade" style="
                        padding: 12px; 
                        font-size: 0.9rem; 
                        cursor: pointer; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        border: none; 
                        border-radius: 10px;
                        margin-top: 10px;">
                        ✨ Upgrade to AI Mode for Smarter Detection
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btn-go-back').addEventListener('click', () => {
        window.history.back();
    });

    document.getElementById('btn-this-is-related').addEventListener('click', () => {
        const videoId = new URLSearchParams(window.location.search).get('v');
        if (videoId) {
            whitelistedVideos.add(videoId);
            console.log("✅ Video whitelisted:", videoId);
        }
        removeGoalOverlay();
    });

    if (mode === 'keyword' && !useAIMode) {
        document.getElementById('btn-upgrade')?.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openUpgradePage' });
        });
    }

    const video = document.querySelector('video');
    if (video) video.pause();
}

function showUpgradePrompt() {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 12px;
        z-index: 9999998;
        max-width: 300px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;

    notification.innerHTML = `
        <h3 style="margin: 0 0 10px 0; font-size: 1.1rem;">⚠️ AI Limit Reached</h3>
        <p style="margin: 0 0 15px 0; font-size: 0.9rem;">You've used all your AI checks for today. Upgrade for unlimited access!</p>
        <button id="upgrade-now" style="
            width: 100%;
            padding: 10px;
            background: white;
            color: #667eea;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;">
            Upgrade Now
        </button>
    `;

    document.body.appendChild(notification);

    document.getElementById('upgrade-now').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openUpgradePage' });
        notification.remove();
    });

    setTimeout(() => notification.remove(), 10000);
}

function removeGoalOverlay() {
    const overlay = document.getElementById('youtube-goal-overlay');
    if (overlay) overlay.remove();
}
