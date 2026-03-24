// Background Service Worker
console.log("Anti-Distraction Extension Loaded");

// Restricted sites that are blocked by default
const RESTRICTED_SITES = [
  'facebook.com',
  'instagram.com',
  'discord.com',
  'pinterest.com',
  'twitch.tv',
  'tiktok.com',
  'netflix.com'
];

// Session-based allowed sites (cleared on browser close)
let sessionAllowedSites = new Set();

// Init Whitelist from session storage to survive service worker suspension
let tempWhitelist = new Map();
chrome.storage.session.get(['tempWhitelist', 'sessionAllowedSites'], (result) => {
  if (result.tempWhitelist) {
    tempWhitelist = new Map(result.tempWhitelist);
  }
  if (result.sessionAllowedSites) {
    sessionAllowedSites = new Set(result.sessionAllowedSites);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({
    tunnelMode: false,
    silencerMode: false,
    grayscaleMode: false,
    aiMonitor: false,
    currentGoal: ""
  });

  // Setup Periodic Cleanup Alarm
  chrome.alarms.create("cleanupWhitelist", { periodInMinutes: 1 });

  // Reload social media tabs to inject fresh content scripts
  if (details.reason === 'update' || details.reason === 'install') {
    const socialMediaDomains = ['reddit.com', 'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'twitch.com'];

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url && socialMediaDomains.some(domain => tab.url.includes(domain))) {
          chrome.tabs.reload(tab.id).catch(() => {
            console.debug("Could not reload tab", tab.id);
          });
        }
      });
    });
  }
});

async function saveSessionWhitelist() {
  await chrome.storage.session.set({
    tempWhitelist: Array.from(tempWhitelist.entries()),
    sessionAllowedSites: Array.from(sessionAllowedSites)
  });
}

// Communication Hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateConfig") {
    if (request.key === "tunnelMode") {
      toggleTunnelVision(request.value);
    } else if (request.key === "silencerMode" || request.key === "grayscaleMode") {
      broadcastToTabs({ action: "updateMode", key: request.key, value: request.value });
    } else if (request.key === "aiMonitor") {
      toggleAiMonitor(request.value);
    }
  } else if (request.action === "whitelistCurrentTab") {
    const url = new URL(request.url);
    sessionWhitelist.add(url.hostname);
  } else if (request.action === "whitelistTenMinutes") {
    const url = new URL(request.url);
    const expiry = Date.now() + 10 * 60 * 1000;
    tempWhitelist.set(url.hostname, expiry);
    saveSessionWhitelist();
  } else if (request.action === "updateGoal") {
    performCheck();
  } else if (request.action === "startSession") {
    startFocusSession(request.session);
  } else if (request.action === "updatePlatformSettings") {
    // Broadcast platform settings to all tabs
    broadcastToTabs({
      action: "platformSettingsUpdated",
      platform: request.platform,
      settings: request.settings
    });
  } else if (request.action === "checkSiteAccess") {
    // Only block restricted sites if the user has an active focus session.
    // Without an active session, all sites should be freely accessible.
    chrome.storage.local.get(['activeSession'], (storage) => {
      const hostname = request.hostname.toLowerCase();
      const hasActiveSession = !!(storage.activeSession && storage.activeSession.endTime > Date.now());

      if (!hasActiveSession) {
        // No active session — never block anything
        sendResponse({ allowed: true });
        return;
      }

      // Check Whitelist FIRST
      if (isWhitelisted(hostname)) {
        sendResponse({ allowed: true });
        return;
      }

      const isRestricted = RESTRICTED_SITES.some(site => hostname.includes(site));

      // If AI Monitor is on, we skip static/free tier blocking to let the AI decide
      chrome.storage.local.get(['aiMonitor'], (aiRes) => {
        const isAllowed = !isRestricted || sessionAllowedSites.has(hostname) || !!aiRes.aiMonitor;
        sendResponse({ allowed: isAllowed });
      });
    });
    return true; // Keep channel open for async response
  } else if (request.action === "allowSiteForSession") {
    // Grant temporary access for this session
    const hostname = request.hostname;
    sessionAllowedSites.add(hostname);
    saveSessionWhitelist();

    // Broadcast to all tabs with this hostname
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url && tab.url.includes(hostname)) {
          chrome.tabs.sendMessage(tab.id, {
            action: "siteAccessGranted",
            hostname: hostname
          }).catch(() => { });
        }
      });
    });

    sendResponse({ success: true });
    return true;
  } else if (request.action === "fetchAI") {
    console.time('BACKGROUND-TO-BACKEND');
    // Proxy the AI API call through background to bypass page CSP (e.g. Reddit)
    fetch(`http://127.0.0.1:3000/api/ai/check-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.token}`
      },
      body: JSON.stringify(request.payload)
    })
      .then(async res => {
        console.timeEnd('BACKGROUND-TO-BACKEND');
        const data = await res.json().catch(() => ({}));
        sendResponse({ status: res.status, ok: res.ok, data });
      })
      .catch(err => {
        console.timeEnd('BACKGROUND-TO-BACKEND');
        sendResponse({ status: 500, ok: false, data: { error: err.message } });
      });

    return true; // Keep channel open for async response
  } else if (request.action === "refreshToken") {
    fetch(`http://127.0.0.1:3000/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: request.refreshToken })
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        sendResponse({ status: res.status, ok: res.ok, data });
      })
      .catch(err => {
        sendResponse({ status: 500, ok: false, data: { error: err.message } });
      });
    return true;
  } else if (request.action === "authMe") {
    fetch(`http://127.0.0.1:3000/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${request.token}`
      }
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        sendResponse({ status: res.status, ok: res.ok, data });
      })
      .catch(err => {
        sendResponse({ status: 500, ok: false, data: { error: err.message } });
      });
    return true;
  }
});

function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch((err) => {
        // Silently fail - storage listeners will handle updates
        console.debug("Message failed for tab " + tab.id + " (storage listener will handle it)", err);
      });
    });
  });
}

// Tunnel Vision Logic
async function toggleTunnelVision(enabled) {
  const queryOptions = { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);

  if (enabled) {
    if (!tab) return;
    await chrome.storage.local.set({ originalWindowId: tab.windowId });

    chrome.windows.create({
      tabId: tab.id,
      type: 'popup',
      state: 'fullscreen'
    });
  } else {
    const { originalWindowId } = await chrome.storage.local.get("originalWindowId");
    if (originalWindowId && tab) {
      try {
        await chrome.tabs.move(tab.id, { windowId: originalWindowId, index: -1 });
        chrome.windows.update(originalWindowId, { focused: true });
      } catch (e) {
        chrome.windows.create({ tabId: tab.id, type: 'normal' });
      }
    } else if (tab) {
      chrome.windows.create({ tabId: tab.id, type: 'normal' });
    }
  }
}

function toggleAiMonitor(enabled) {
  if (enabled) {
    chrome.alarms.create("monitorLoop", { periodInMinutes: 0.1 });
  } else {
    chrome.alarms.clear("monitorLoop");
  }
  chrome.storage.local.set({ aiMonitor: enabled });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "monitorLoop") {
    performCheck();
  } else if (alarm.name === "cleanupWhitelist") {
    const now = Date.now();
    let changed = false;
    for (const [host, expiry] of tempWhitelist) {
      if (now > expiry) {
        tempWhitelist.delete(host);
        changed = true;
      }
    }
    if (changed) saveSessionWhitelist();
  }
});

let sessionWhitelist = new Set();

async function performCheck() {
  // CRITICAL: If AI Monitor is on, the background script should NOT run the local heuristic check (Free Feature)
  // We only run this if AI Monitor is OFF or if the user is NOT premium (fallback).
  // But per user request: "no free features works, when aimonitor is on"
  const { aiMonitor, isPremium } = await chrome.storage.local.get(["aiMonitor", "isPremium"]);
  if (!aiMonitor || isPremium) return;

  const { currentGoal, learnedKeywords } = await chrome.storage.local.get(['currentGoal', 'learnedKeywords']);
  if (!currentGoal) return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return;

  if (isWhitelisted(tab.url)) return;

  const score = await calculateDistractionScore(tab, currentGoal, learnedKeywords || {});

  // Thresholds: > 50: Distraction Overlay (lowered from 60 to be less aggressive)
  if (score > 50) {
    chrome.tabs.sendMessage(tab.id, {
      action: "triggerDistractionOverlay",
      goal: currentGoal,
      level: score > 70 ? "critical" : "warning"
    }).catch(() => { });
  }
}

function isWhitelisted(urlStr) {
  try {
    const url = new URL(urlStr);
    if (sessionWhitelist.has(url.hostname)) return true;

    if (tempWhitelist.has(url.hostname)) {
      if (Date.now() < tempWhitelist.get(url.hostname)) return true;
      // Don't auto-delete here, let the alarm handle cleanup logic
    }

    const safe = [
      'google.com', 'stackoverflow.com', 'github.com', 'localhost', '127.0.0.1',
      'chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai', 'anthropic.com'
    ];
    if (safe.some(s => url.hostname.includes(s))) return true;
    return false;
  } catch { return false; }
}

async function calculateDistractionScore(tab, goal, learnedKeywords = {}) {
  let score = 0;
  // Included youtube back but heavily weighted logic handles it
  const distractionKeywords = ['youtube', 'facebook', 'twitter', 'instagram', 'tiktok', 'netflix', 'reddit'];

  // Clean Goal Parsing - DON'T filter out 'learn' or 'tutorial'!
  const stopWords = ['and', 'for', 'the', 'with', 'how', 'to', 'in', 'on', 'at'];
  const goalKeywords = goal
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(w => w.length >= 2 && !stopWords.includes(w));

  let title = (tab.title || "").toLowerCase();
  const url = (tab.url || "").toLowerCase();

  console.log(`🎯 AI Monitor Check | Goal: "${goal}" | Keywords: [${goalKeywords.join(', ')}]`);
  console.log(`📍 Tab: ${title} | URL: ${url}`);

  // Factor 1: Known Distraction Site (+20 base)
  const onDistractionSite = distractionKeywords.some(d => url.includes(d));
  if (onDistractionSite) {
    score += 20;
    console.log(`⚠️  Distraction site detected (+20) | Score: ${score}`);

    // Skip if page is still loading
    if (distractionKeywords.some(d => title === d || title === `(${d})`)) {
      console.log(`⏳ Page loading, skipping check`);
      return 0;
    }
  }

  // Factor 2: Learning Mode Bonus (-20)
  const learningKeywords = ['learn', 'tutorial', 'course', 'study', 'research', 'documentation', 'docs'];
  const isLearningMode = learningKeywords.some(k => goal.toLowerCase().includes(k));
  if (isLearningMode) {
    score -= 20;
    console.log(`📚 Learning mode detected (-20) | Score: ${score}`);
  }

  // Factor 3: Content Relevance
  if (onDistractionSite) {
    let pageContext = title;
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const metaKeys = document.querySelector('meta[name="keywords"]')?.content || "";
          const metaDesc = document.querySelector('meta[name="description"]')?.content || "";
          const h1 = document.querySelector('h1')?.innerText || "";
          const videoTitle = document.querySelector('#video-title')?.innerText || "";
          return `${metaKeys} ${metaDesc} ${h1} ${videoTitle}`;
        }
      });
      if (result && result[0] && result[0].result) {
        pageContext += " " + result[0].result.toLowerCase();
      }
    } catch (e) {
      console.debug("Script injection failed", e);
    }

    console.log(`🔍 Page context: ${pageContext.substring(0, 100)}...`);

    // A. Direct Goal Match
    const matchesGoal = goalKeywords.some(k => pageContext.includes(k));

    // B. Adaptive/Learned Keywords Match
    let matchesLearned = false;
    const goalKey = goal.toLowerCase().trim();
    if (learnedKeywords[goalKey]) {
      matchesLearned = learnedKeywords[goalKey].some(k => pageContext.includes(k));
    }

    if (matchesGoal) {
      score -= 40;
      console.log(`✅ Goal keywords matched! (-40) | Score: ${score}`);
    } else if (matchesLearned) {
      score -= 40;
      console.log(`✅ Learned keywords matched! (-40) | Score: ${score}`);
    } else {
      score += 40;
      console.log(`❌ No goal or learned keywords found (+40) | Score: ${score}`);
    }
  }

  const finalScore = Math.max(0, score);
  console.log(`📊 Final Score: ${finalScore} | Threshold: 50 | ${finalScore > 50 ? '🚨 BLOCKING' : '✅ ALLOWING'}`);
  return finalScore;
}

// ===== SESSION MANAGEMENT =====

function startFocusSession(session) {
  console.log("🎯 Starting focus session:", session);

  // Broadcast to all tabs to show timer
  broadcastToTabs({
    action: "showTimer",
    session: session
  });

  // Broadcast to content scripts that session started
  broadcastToTabs({
    action: "sessionStarted",
    goal: session.goal
  });

  // Create alarm to check session completion
  chrome.alarms.create("sessionCheck", { periodInMinutes: 0.1 });
}

// Check for paused sessions on browser startup
chrome.runtime.onStartup.addListener(() => {
  checkForPausedSession();
});

// Also check when service worker wakes up
checkForPausedSession();

async function checkForPausedSession() {
  const { activeSession } = await chrome.storage.local.get('activeSession');

  if (!activeSession) return;

  const now = Date.now();
  const remaining = activeSession.endTime - now;

  if (remaining <= 0) {
    // Session expired while browser was closed
    chrome.storage.local.remove('activeSession');
    return;
  }

  // Show continuation prompt
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, {
      action: "showContinuePrompt",
      session: activeSession,
      remainingTime: remaining
    }).catch(() => {
      console.log("Could not show continue prompt - tab not ready");
    });
  }
}

// Monitor active session
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "monitorLoop") {
    performCheck();
  } else if (alarm.name === "cleanupWhitelist") {
    const now = Date.now();
    let changed = false;
    for (const [host, expiry] of tempWhitelist) {
      if (now > expiry) {
        tempWhitelist.delete(host);
        changed = true;
      }
    }
    if (changed) saveSessionWhitelist();
  } else if (alarm.name === "sessionCheck") {
    checkSessionStatus();
  }
});

async function checkSessionStatus() {
  const { activeSession } = await chrome.storage.local.get('activeSession');

  if (!activeSession) {
    chrome.alarms.clear("sessionCheck");
    return;
  }

  const remaining = activeSession.endTime - Date.now();

  if (remaining <= 0) {
    // Session completed
    chrome.storage.local.remove('activeSession');
    chrome.alarms.clear("sessionCheck");

    // Notify all tabs
    broadcastToTabs({
      action: "hideTimer"
    });
  }
}
