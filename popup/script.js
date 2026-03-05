// ══════════════════════════════════════════════════
//  FocusGuard Popup — Auth Logic
// ══════════════════════════════════════════════════

const BACKEND_URL = 'http://localhost:3000/api'; // Local dev server
const PRICING_URL = 'https://cupcakesandcodes.github.io/antidistract#pricing';
const DAILY_LIMIT = 150;

// ── Views ─────────────────────────────────────────
const authView = document.getElementById('authView');
const accountView = document.getElementById('accountView');
const mainView = document.getElementById('mainView');

function showAuthView() { authView.style.display = 'flex'; accountView.style.display = 'none'; mainView.style.display = 'none'; }
function showMainView() { authView.style.display = 'none'; mainView.style.display = 'block'; }
function showAccountPanel() { accountView.style.display = 'flex'; }
function hideAccountPanel() { accountView.style.display = 'none'; }

// ── On load: check if user is already logged in ───
chrome.storage.local.get(['authToken', 'userEmail', 'isPremium', 'refreshToken'], async (data) => {
    // ALWAYS show main view by default
    showMainView();
    const exploreBtn = document.getElementById('explorePremiumBtn');

    if (data.authToken) {
        // Try to verify token is still valid
        try {
            const res = await fetch(`${BACKEND_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${data.authToken}` }
            });
            if (res.ok) {
                const { user } = await res.json();
                renderAccountPanel(user);
                showAccountPanel();
                if (exploreBtn) exploreBtn.style.display = 'none';
                return;
            }
            // Token expired — try refresh
            if (data.refreshToken) {
                const refreshed = await tryRefresh(data.refreshToken);
                if (refreshed) {
                    renderAccountPanel(refreshed);
                    showAccountPanel();
                    if (exploreBtn) exploreBtn.style.display = 'none';
                    return;
                }
            }
        } catch (e) { /* network error */ }
    }

    // Not logged in or invalid token
    if (exploreBtn) exploreBtn.style.display = 'block';
});

// Bind Explore Premium Button
document.getElementById('explorePremiumBtn').addEventListener('click', () => {
    showAuthView();
});

async function tryRefresh(refreshToken) {
    try {
        const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) return null;
        const { token, refreshToken: newRefresh } = await res.json();
        chrome.storage.local.set({ authToken: token, refreshToken: newRefresh });

        // Re-fetch user
        const me = await fetch(`${BACKEND_URL}/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!me.ok) return null;
        const { user } = await me.json();
        return user;
    } catch { return null; }
}

function renderAccountPanel(user) {
    document.getElementById('accountEmail').textContent = user.email;
    document.getElementById('accountAvatar').textContent = user.email[0].toUpperCase();

    const isPremium = user.subscriptionTier === 'premium';
    const badge = document.getElementById('accountBadge');
    badge.textContent = isPremium ? '✦ Premium' : 'Free';
    badge.className = isPremium ? 'account-badge premium' : 'account-badge';

    const upgradeBtn = document.getElementById('upgradeBtn');
    if (isPremium && user.usage) {
        // Show usage bar for premium users
        const used = user.usage.aiChecksToday || 0;
        const pct = Math.min((used / DAILY_LIMIT) * 100, 100);
        document.getElementById('usageBarFill').style.width = `${pct}%`;
        document.getElementById('usageLabel').textContent = `${used} / ${DAILY_LIMIT} AI scans today`;
        document.getElementById('accountUsage').style.display = 'flex';
        upgradeBtn.style.display = 'none';
    } else {
        document.getElementById('accountUsage').style.display = 'none';
        upgradeBtn.style.display = 'block';
        upgradeBtn.href = PRICING_URL;
    }

    // Save premium status so content scripts can read it
    chrome.storage.local.set({ isPremium, userEmail: user.email });
}

// ── Tab switching ──────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-panel').forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'flex';
    });
});

// ── Magic Link ────────────────────────────────────
document.getElementById('magicLinkBtn').addEventListener('click', async () => {
    const email = document.getElementById('magicEmail').value.trim();
    const msg = document.getElementById('magicMsg');
    const btn = document.getElementById('magicLinkBtn');
    if (!email) { showMsg(msg, 'Enter your email first', true); return; }

    btn.disabled = true; btn.textContent = 'Sending…';
    try {
        const res = await fetch(`${BACKEND_URL}/auth/magic-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showMsg(msg, '✅ Check your inbox!');
    } catch (e) {
        showMsg(msg, e.message || 'Failed to send', true);
    } finally {
        btn.disabled = false; btn.textContent = 'Send Magic Link';
    }
});

// ── Google OAuth ──────────────────────────────────
document.getElementById('googleSignInBtn').addEventListener('click', () => {
    // Google OAuth must be handled via a full-page redirect.
    // We open the Supabase Google OAuth URL in a new tab.
    // The user signs in, then comes back to the extension.
    // The extension detects the token via chrome.identity or a callback page.
    const SUPABASE_URL = 'https://jtnqrswupbjqobasrrjm.supabase.co'; // Actual Supabase URL
    const REDIRECT_URL = chrome.identity.getRedirectURL('oauth2');
    const oauthUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(REDIRECT_URL)}`;

    chrome.identity.launchWebAuthFlow({ url: oauthUrl, interactive: true }, async (redirectUrl) => {
        if (chrome.runtime.lastError) {
            alert("Google Auth Error: " + chrome.runtime.lastError.message);
            console.error(chrome.runtime.lastError);
            return;
        }
        if (!redirectUrl) {
            alert("Google Auth Error: No redirect URL returned");
            return;
        }

        // Extract access_token from the redirect URL hash
        const hash = new URL(redirectUrl).hash.slice(1);
        const params = new URLSearchParams(hash);
        const token = params.get('access_token');
        const refresh = params.get('refresh_token');
        const errorDesc = params.get('error_description');

        if (errorDesc) {
            alert("Supabase Error: " + errorDesc);
            return;
        }

        if (!token) {
            alert("Google Auth Error: No access token in URL");
            return;
        }

        chrome.storage.local.set({ authToken: token, refreshToken: refresh });
        const res = await fetch(`${BACKEND_URL}/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
            const errText = await res.text();
            alert("Google Auth Error: Backend rejected token. Details: " + errText);
            console.error("Backend rejected token:", errText);
            return;
        }
        const { user } = await res.json();

        if (user.subscriptionTier !== 'premium') {
            chrome.tabs.create({ url: PRICING_URL });
        }

        renderAccountPanel(user);
        showMainView();
        showAccountPanel();
        document.getElementById('explorePremiumBtn').style.display = 'none';
    });
});

// ── Email + Password ──────────────────────────────
let authMode = 'login'; // or 'register'

document.getElementById('loginModeBtn').addEventListener('click', () => {
    authMode = 'login';
    document.getElementById('loginModeBtn').classList.add('active');
    document.getElementById('registerModeBtn').classList.remove('active');
    document.getElementById('emailAuthBtn').textContent = 'Sign In';
});

document.getElementById('registerModeBtn').addEventListener('click', () => {
    authMode = 'register';
    document.getElementById('registerModeBtn').classList.add('active');
    document.getElementById('loginModeBtn').classList.remove('active');
    document.getElementById('emailAuthBtn').textContent = 'Create Account';
});

document.getElementById('emailAuthBtn').addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const msg = document.getElementById('emailMsg');
    const btn = document.getElementById('emailAuthBtn');

    if (!email || !password) { showMsg(msg, 'Email and password required', true); return; }

    btn.disabled = true;
    btn.textContent = authMode === 'login' ? 'Signing in…' : 'Creating account…';

    try {
        const endpoint = authMode === 'login' ? 'login' : 'register';
        const res = await fetch(`${BACKEND_URL}/auth/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        chrome.storage.local.set({ authToken: data.token, refreshToken: data.refreshToken });

        if (data.user.subscriptionTier !== 'premium') {
            chrome.tabs.create({ url: PRICING_URL });
        }

        renderAccountPanel(data.user);
        showMainView();
        showAccountPanel();
        document.getElementById('explorePremiumBtn').style.display = 'none';
    } catch (e) {
        alert("Auth Error: " + e.message);
        console.error("Auth fetch error:", e);
        showMsg(msg, e.message || 'Auth failed', true);
    } finally {
        btn.disabled = false;
        btn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
    }
});

// ── Skip auth ─────────────────────────────────────
document.getElementById('skipAuthBtn').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.storage.local.set({ skippedAuth: true });
    showMainView();
});

// ── Sign out ──────────────────────────────────────
document.getElementById('signOutBtn').addEventListener('click', () => {
    chrome.storage.local.remove(['authToken', 'refreshToken', 'userEmail', 'isPremium', 'skippedAuth'], () => {
        hideAccountPanel();
        showMainView();
        document.getElementById('explorePremiumBtn').style.display = 'block';
    });
});

// ── Helpers ───────────────────────────────────────
function showMsg(el, text, isError = false) {
    el.textContent = text;
    el.className = isError ? 'auth-msg error' : 'auth-msg';
    setTimeout(() => { el.textContent = ''; }, 4000);
}

// ══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    let selectedDuration = null;

    // Restore state
    chrome.storage.local.get(['tunnelMode', 'silencerMode', 'grayscaleMode', 'aiMonitor', 'currentGoal', 'activeSession'], (result) => {
        document.getElementById('tunnelToggle').checked = result.tunnelMode || false;
        document.getElementById('silencerToggle').checked = result.silencerMode || false;
        document.getElementById('grayscaleToggle').checked = result.grayscaleMode || false;
        document.getElementById('monitorToggle').checked = result.aiMonitor || false;
        document.getElementById('goalInput').value = result.currentGoal || "";

        // If there's an active session, show it
        if (result.activeSession) {
            selectedDuration = result.activeSession.duration;
            updateSessionUI(true);
        }

        updateStatus("Ready to focus.");
    });

    // Duration button selection
    const durationButtons = document.querySelectorAll('.duration-btn');
    durationButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            durationButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedDuration = parseInt(btn.dataset.minutes);
        });
    });

    // Start Session Button
    document.getElementById('startSessionBtn').addEventListener('click', () => {
        const goal = document.getElementById('goalInput').value.trim();

        if (!goal) {
            updateStatus("⚠️ Please enter a goal first!");
            return;
        }

        if (!selectedDuration) {
            updateStatus("⚠️ Please select a duration!");
            return;
        }

        // Create session
        const session = {
            goal: goal,
            duration: selectedDuration,
            startTime: Date.now(),
            endTime: Date.now() + (selectedDuration * 60 * 1000)
        };

        chrome.storage.local.set({
            currentGoal: goal,
            activeSession: session
        }, () => {
            chrome.runtime.sendMessage({
                action: "startSession",
                session: session
            });

            updateStatus(`✅ Session started: ${selectedDuration} min`);
            updateSessionUI(true);
        });
    });

    // Save state listeners
    const toggles = ['tunnelToggle', 'silencerToggle', 'grayscaleToggle', 'monitorToggle'];
    toggles.forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            let key;
            if (id === 'monitorToggle') {
                key = 'aiMonitor';
            } else {
                key = id.replace('Toggle', 'Mode');
            }

            const value = e.target.checked;

            console.log(`💾 Saving ${key}:`, value);

            chrome.storage.local.set({ [key]: value }, () => {
                console.log(`✅ ${key} saved to storage`);

                chrome.storage.local.get([key], (result) => {
                    console.log(`🔍 Verification - ${key} in storage:`, result[key]);
                });
            });

            chrome.runtime.sendMessage({
                action: "updateConfig",
                key: key,
                value: value
            });

            updateStatus(`${key.replace('Mode', '').replace('ai', 'AI ')} ${value ? 'Enabled' : 'Disabled'}`);
        });
    });

    function updateSessionUI(hasActiveSession) {
        const startBtn = document.getElementById('startSessionBtn');
        const endBtn = document.getElementById('endSessionBtn');

        if (hasActiveSession) {
            startBtn.textContent = 'Session Active';
            startBtn.disabled = true;
            endBtn.disabled = false;
        } else {
            startBtn.textContent = 'Start Focus Session';
            startBtn.disabled = false;
            endBtn.disabled = true;
        }
    }

    // End session button handler
    document.getElementById('endSessionBtn').addEventListener('click', async () => {
        console.log('Ending session...');

        // Clear session data first
        await chrome.storage.local.remove(['activeSession', 'sessionGoal', 'sessionEndTime']);

        // Notify content scripts to reset everything
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                // Hide timer widget
                chrome.tabs.sendMessage(tab.id, {
                    action: 'hideTimer'
                }).catch(() => { });

                // Reset content script state (removes Reddit alerts, resets filters)
                chrome.tabs.sendMessage(tab.id, {
                    type: 'SESSION_ENDED'
                }).catch(() => { });
            });
        });

        // Manually reset all UI elements
        updateSessionUI(false);
        document.getElementById('goalInput').value = '';

        // Reset duration button selection
        document.querySelectorAll('.duration-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        // Reset selected duration variable
        selectedDuration = null;

        // Update status message
        updateStatus('Session ended. Ready to focus.');

        console.log('Session ended successfully');
    });

    // ===== SOCIAL MEDIA CONTROLS =====

    const platformSettings = {
        youtube: [
            { id: 'blockShorts', label: 'Block Shorts' },
            { id: 'blockRecommendations', label: 'Block Recommendations' },
            { id: 'blockComments', label: 'Block Comments' },
            { id: 'blockHomeFeed', label: 'Block Home Feed' }
        ],
        facebook: {
            sections: [
                {
                    title: 'HOME PAGE',
                    options: [
                        { id: 'blockHomeFeed', label: 'Hide Home Feed' },
                        { id: 'blockStories', label: 'Hide Stories Section' },
                        { id: 'blockSponsoredPosts', label: 'Hide Sponsored Posts' },
                        { id: 'blockGroupPosts', label: 'Hide Posts from Groups' },
                        { id: 'blockPeopleFollow', label: 'Hide Posts from People to Follow' },
                        { id: 'blockPeopleKnow', label: 'Hide "People you may Know" Section' },
                        { id: 'blockReelsShort', label: 'Hide "Reels and Short videos" Section' },
                        { id: 'blockSuggestedGroups', label: 'Hide "Suggested Groups" Section' }
                    ]
                },
                {
                    title: 'HEADER',
                    options: [
                        { id: 'blockFriendsButton', label: 'Hide "Friends" Button' },
                        { id: 'blockWatchButton', label: 'Hide "Watch" Button' },
                        { id: 'blockGroupsButton', label: 'Hide "Groups" Button' },
                        { id: 'blockGamingButton', label: 'Hide "Gaming" Button' },
                        { id: 'blockCreateButton', label: 'Hide "Create" Button' },
                        { id: 'blockMenuButton', label: 'Hide "Menu" Button' },
                        { id: 'blockMessengerButton', label: 'Hide "Messenger" Button' },
                        { id: 'blockNotificationsButton', label: 'Hide "Notifications" Button' }
                    ]
                },
                {
                    title: 'LEFT NAVIGATION BAR',
                    options: [
                        { id: 'blockProfileButton', label: 'Hide "Profile" Button' },
                        { id: 'blockFindFriendsButton', label: 'Hide "Find Friends" Button' },
                        { id: 'blockMemoriesButton', label: 'Hide "Memories" Button' },
                        { id: 'blockSavedButton', label: 'Hide "Saved" Button' },
                        { id: 'blockGroupsLeftButton', label: 'Hide "Groups" Button' },
                        { id: 'blockVideoButton', label: 'Hide "Video" Button' },
                        { id: 'blockMarketplaceButton', label: 'Hide "Marketplace" Button' },
                        { id: 'blockFeedsLeftButton', label: 'Hide "Feeds" Button' },
                        { id: 'blockEventsButton', label: 'Hide "Events" Button' },
                        { id: 'blockAdsManagerButton', label: 'Hide "Ads Manager" Button' },
                        { id: 'blockFundraisersButton', label: 'Hide "Fundraisers" Button' },
                        { id: 'blockSeeMoreButton', label: 'Hide "See more" Button' },
                        { id: 'blockFooter', label: 'Hide Footer' }
                    ]
                },
                {
                    title: 'RIGHT BAR',
                    options: [
                        { id: 'blockSponsoredRight', label: 'Hide "Sponsored" Block' },
                        { id: 'blockContactsBlock', label: 'Hide "Contacts" Block' },
                        { id: 'blockGroupConversations', label: 'Hide "Group conversations" Block' },
                        { id: 'blockNewMessageButton', label: 'Hide "New Message" Floating Button' }
                    ]
                }
            ]
        },
        instagram: [
            { id: 'blockReels', label: 'Block Reels' },
            { id: 'blockStories', label: 'Block Stories' },
            { id: 'blockFeed', label: 'Block Feed' },
            { id: 'blockExplore', label: 'Block Explore' },
            { id: 'blockMessages', label: 'Block Messages' }
        ],
        twitter: [
            { id: 'blockForYou', label: 'Block "For You" Tab' },
            { id: 'blockTrends', label: 'Block Trends' },
            { id: 'blockRecommendations', label: 'Block Recommendations' }
        ],
        reddit: {
            sections: [
                {
                    title: 'HEADER',
                    options: [
                        { id: 'blockAdvertise', label: 'Hide "Advertise" Button' },
                        { id: 'blockChat', label: 'Hide "Chat" Button' },
                        { id: 'blockLogIn', label: 'Hide "Log In" Button' },
                        { id: 'blockTrendingToday', label: 'Hide Trending Today' },
                        { id: 'blockLogoWordmark', label: 'Hide Logo Wordmark' }
                    ]
                },
                {
                    title: 'LEFT SIDEBAR',
                    options: [
                        { id: 'blockLeftSidebar', label: 'Hide Left Sidebar' },
                        { id: 'blockCommunities', label: 'Hide "Communities" Block' },
                        { id: 'blockTopics', label: 'Hide "Topics" Block' },
                        { id: 'blockResources', label: 'Hide "Resources" Block' },
                        { id: 'blockPopularPosts', label: 'Hide "Popular Posts" Block' },
                        { id: 'blockFooter', label: 'Hide "Footer" Block' }
                    ]
                },
                {
                    title: 'POST',
                    options: [
                        { id: 'blockComments', label: 'Hide Comments' },
                        { id: 'blockUpvoteDownvote', label: 'Hide "Upvote / Downvote Button"' },
                        { id: 'blockUpvotesCount', label: 'Hide Upvotes Count' },
                        { id: 'blockAward', label: 'Hide "Award" Button' },
                        { id: 'blockShare', label: 'Hide "Share" Button' }
                    ]
                },
                {
                    title: 'HOME PAGE',
                    options: [
                        { id: 'blockHomeFeed', label: 'Hide Home Feed' },
                        { id: 'blockRelatedPosts', label: 'Hide Related Posts' },
                        { id: 'blockTrendingTodayBlock', label: 'Hide "Trending Today" Block' }
                    ]
                },
                {
                    title: 'HOME RIGHT BAR',
                    options: [
                        { id: 'blockRecentPosts', label: 'Hide "Recent Posts" Block' },
                        { id: 'blockPopularCommunities', label: 'Hide "Popular Communities" Block' }
                    ]
                },
                {
                    title: 'GOAL FILTERING',
                    options: [
                        {
                            id: 'filterMode',
                            label: 'Filter irrelevant posts',
                            type: 'select',
                            choices: [
                                { value: 'blur', label: 'Blur (click to reveal)' },
                                { value: 'remove', label: 'Remove completely' },
                                { value: 'off', label: 'Off' }
                            ]
                        }
                    ]
                }
            ]
        },
        linkedin: [
            { id: 'blockFeed', label: 'Block Feed' },
            { id: 'blockNews', label: 'Block News' },
            { id: 'blockRecommendations', label: 'Block Recommendations' }
        ]
    };

    const socialMediaHeader = document.getElementById('socialMediaHeader');
    const platformList = document.getElementById('platformList');
    const expandArrow = document.querySelector('.expand-arrow');
    const mainView = document.getElementById('mainView');
    const platformSettingsView = document.getElementById('platformSettingsView');
    const backButton = document.getElementById('backButton');
    const platformTitle = document.getElementById('platformTitle');
    const platformToggles = document.getElementById('platformToggles');

    // Accordion expand/collapse
    socialMediaHeader.addEventListener('click', () => {
        if (platformList.classList.contains('collapsed')) {
            platformList.classList.remove('collapsed');
            platformList.classList.add('expanded');
            expandArrow.classList.add('expanded');
        } else {
            platformList.classList.remove('expanded');
            platformList.classList.add('collapsed');
            expandArrow.classList.remove('expanded');
        }
    });

    // Platform item click handlers
    document.querySelectorAll('.platform-item').forEach(item => {
        item.addEventListener('click', () => {
            const platform = item.dataset.platform;
            showPlatformSettings(platform);
        });
    });

    // Back button handler
    backButton.addEventListener('click', () => {
        platformSettingsView.style.display = 'none';
        mainView.style.display = 'block';
    });

    function showPlatformSettings(platform) {
        // Hide main view, show settings view
        mainView.style.display = 'none';
        platformSettingsView.style.display = 'block';

        // Set platform title
        const platformNames = {
            youtube: 'YouTube',
            facebook: 'Facebook',
            instagram: 'Instagram',
            twitter: 'X (Twitter)',
            reddit: 'Reddit',
            linkedin: 'LinkedIn'
        };
        platformTitle.textContent = platformNames[platform];

        // Clear previous toggles
        platformToggles.innerHTML = '';

        // Get settings for this platform
        const settings = platformSettings[platform];

        // Load saved settings
        chrome.storage.local.get([`${platform}Settings`], (result) => {
            const savedSettings = result[`${platform}Settings`] || {};

            // Check if platform has sections (like Facebook)
            if (settings.sections) {
                // Render with sections
                settings.sections.forEach((section, sectionIndex) => {
                    // Create section header with toggle
                    const sectionHeaderContainer = document.createElement('div');
                    sectionHeaderContainer.className = 'section-header-container';

                    const sectionHeader = document.createElement('div');
                    sectionHeader.className = 'section-header-label';
                    sectionHeader.textContent = section.title;

                    // Create master toggle for section
                    const masterToggle = document.createElement('label');
                    masterToggle.className = 'switch switch-small';

                    const masterCheckbox = document.createElement('input');
                    masterCheckbox.type = 'checkbox';
                    masterCheckbox.className = 'section-master-toggle';
                    masterCheckbox.dataset.sectionIndex = sectionIndex;

                    // Check if all options in this section are enabled
                    const allEnabled = section.options.every(opt => savedSettings[opt.id]);
                    masterCheckbox.checked = allEnabled;

                    const masterSlider = document.createElement('span');
                    masterSlider.className = 'slider round';

                    masterToggle.appendChild(masterCheckbox);
                    masterToggle.appendChild(masterSlider);

                    sectionHeaderContainer.appendChild(sectionHeader);
                    sectionHeaderContainer.appendChild(masterToggle);
                    platformToggles.appendChild(sectionHeaderContainer);

                    // Master toggle handler
                    masterCheckbox.addEventListener('change', (e) => {
                        const isChecked = e.target.checked;

                        // Update all options in this section
                        section.options.forEach(setting => {
                            savedSettings[setting.id] = isChecked;

                            // Update individual checkbox if it exists
                            const individualCheckbox = document.getElementById(`${platform}-${setting.id}`);
                            if (individualCheckbox) {
                                individualCheckbox.checked = isChecked;
                            }
                        });

                        // Save to storage
                        chrome.storage.local.set({
                            [`${platform}Settings`]: savedSettings
                        }, () => {
                            console.log(`✅ ${platform} section "${section.title}" ${isChecked ? 'enabled' : 'disabled'}`);

                            // Notify background script
                            chrome.runtime.sendMessage({
                                action: 'updatePlatformSettings',
                                platform: platform,
                                settings: savedSettings
                            });
                        });
                    });

                    // Create toggles for this section
                    section.options.forEach(setting => {
                        createToggleRow(platform, setting, savedSettings, sectionIndex);
                    });
                });
            } else {
                // Render without sections (for other platforms)
                settings.forEach(setting => {
                    createToggleRow(platform, setting, savedSettings);
                });
            }
        });
    }

    function createToggleRow(platform, setting, savedSettings, sectionIndex) {
        const toggleRow = document.createElement('div');
        toggleRow.className = 'platform-toggle-row';

        const label = document.createElement('span');
        label.textContent = setting.label;

        // Check if this is a select dropdown
        if (setting.type === 'select') {
            const select = document.createElement('select');
            select.id = `${platform}-${setting.id}`;
            select.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc; background: white; cursor: pointer;';

            // Add options
            setting.choices.forEach(choice => {
                const option = document.createElement('option');
                option.value = choice.value;
                option.textContent = choice.label;
                select.appendChild(option);
            });

            // Set saved value
            select.value = savedSettings[setting.id] || setting.choices[0].value;

            // Save on change
            select.addEventListener('change', (e) => {
                savedSettings[setting.id] = e.target.value;
                chrome.storage.local.set({
                    [`${platform}Settings`]: savedSettings
                }, () => {
                    console.log(`✅ ${platform} settings saved:`, savedSettings);

                    // Notify background script
                    chrome.runtime.sendMessage({
                        action: 'updatePlatformSettings',
                        platform: platform,
                        settings: savedSettings
                    });
                });
            });

            toggleRow.appendChild(label);
            toggleRow.appendChild(select);
        } else {
            // Regular toggle switch
            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `${platform}-${setting.id}`;
            checkbox.checked = savedSettings[setting.id] || false;

            // Save on change
            checkbox.addEventListener('change', (e) => {
                savedSettings[setting.id] = e.target.checked;
                chrome.storage.local.set({
                    [`${platform}Settings`]: savedSettings
                }, () => {
                    console.log(`✅ ${platform} settings saved:`, savedSettings);

                    // Update master toggle if exists
                    if (sectionIndex !== undefined) {
                        const masterToggle = document.querySelector(`.section-master-toggle[data-section-index="${sectionIndex}"]`);
                        if (masterToggle) {
                            const settings = platformSettings[platform];
                            const section = settings.sections[sectionIndex];
                            const allEnabled = section.options.every(opt => savedSettings[opt.id]);
                            masterToggle.checked = allEnabled;
                        }
                    }

                    // Notify background script
                    chrome.runtime.sendMessage({
                        action: 'updatePlatformSettings',
                        platform: platform,
                        settings: savedSettings
                    });
                });
            });

            const slider = document.createElement('span');
            slider.className = 'slider round';

            switchLabel.appendChild(checkbox);
            switchLabel.appendChild(slider);

            toggleRow.appendChild(label);
            toggleRow.appendChild(switchLabel);
        }

        platformToggles.appendChild(toggleRow);
    }

    function updateStatus(msg) {
        const s = document.getElementById('statusMessage');
        s.textContent = msg;
        setTimeout(() => { s.textContent = ""; }, 2000);
    }
});
