// LinkedIn-Specific Content Script
console.log("LinkedIn Silencer Loaded");

let silencerEnabled = false;
let grayscaleEnabled = false;

chrome.storage.local.get(['silencerMode', 'grayscaleMode'], (result) => {
    if (result.silencerMode) enableSilencer();
    if (result.grayscaleMode) enableGrayscale();
    silencerEnabled = result.silencerMode;
    grayscaleEnabled = result.grayscaleMode;
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "updateMode") {
        if (request.key === "silencerMode") {
            request.value ? enableSilencer() : disableSilencer();
        } else if (request.key === "grayscaleMode") {
            request.value ? enableGrayscale() : disableGrayscale();
        }
    }
});

function enableGrayscale() {
    document.documentElement.classList.add('grayscale-mode');
    grayscaleEnabled = true;
}

function disableGrayscale() {
    document.documentElement.classList.remove('grayscale-mode');
    grayscaleEnabled = false;
}

function enableSilencer() {
    if (window.linkedinObserver) return;

    document.body.classList.add('silencer-active');
    hideLinkedInDistractions();

    const observer = new MutationObserver(hideLinkedInDistractions);
    observer.observe(document.body, { childList: true, subtree: true });
    window.linkedinObserver = observer;
    silencerEnabled = true;

    console.log("✅ LinkedIn Silencer enabled");
}

function disableSilencer() {
    document.body.classList.remove('silencer-active');
    if (window.linkedinObserver) {
        window.linkedinObserver.disconnect();
        window.linkedinObserver = null;
    }
    silencerEnabled = false;
}

function hideLinkedInDistractions() {
    if (!silencerEnabled) return;

    // Hide news feed sidebar
    document.querySelectorAll('.scaffold-layout__aside, .news-module').forEach(el => {
        el.style.display = 'none';
    });

    // Hide "People you may know" suggestions
    document.querySelectorAll('[data-view-name="pymk-list"]').forEach(el => {
        el.style.display = 'none';
    });

    // Reduce feed noise
    document.querySelectorAll('.feed-shared-update-v2--sponsored').forEach(el => {
        el.style.opacity = '0.2';
    });
}
