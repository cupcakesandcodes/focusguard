(function () {
    console.log("Overlay Script Loaded");

    let overlayDOM = null;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "triggerDistractionOverlay") {
            showOverlay(request.goal);
        } else if (request.action === "removeOverlay") {
            removeOverlay();
        }
    });

    function showOverlay(goal) {
        if (document.getElementById('focus-overlay-protector')) return;

        // Create Overlay
        const overlay = document.createElement('div');
        overlay.id = 'focus-overlay-protector';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 2147483647; /* Max Z-Index */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            font-family: sans-serif;
        `;

        overlay.innerHTML = `
            <div style="background: rgba(18, 18, 18, 0.95); padding: 40px; border-radius: 20px; text-align: center; border: 1px solid #333; max-width: 500px;">
                <h1 style="font-size: 2.5rem; margin: 0 0 10px 0; color: #ff5252;">Where is your focus?</h1>
                <p style="font-size: 1.2rem; color: #aaa; margin-bottom: 30px;">Your goal is: <br><strong style="color: white; font-size: 1.4rem;">"${goal}"</strong></p>
                
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button id="btn-back" style="
                        padding: 14px; 
                        font-size: 1.1rem; 
                        cursor: pointer; 
                        background: #4CAF50; 
                        color: white; 
                        border: none; 
                        border-radius: 12px; 
                        font-weight: 600;
                        transition: transform 0.1s;">
                        Redirect me to Work
                    </button>
                    
                    <button id="btn-10min" style="
                        padding: 14px; 
                        font-size: 1.1rem; 
                        cursor: pointer; 
                        background: transparent; 
                        color: #e0e0e0; 
                        border: 1px solid #555; 
                        border-radius: 12px;
                        transition: background 0.2s;">
                        This is related (Allow 10 min)
                    </button>

                     <button id="btn-change-goal" style="
                        padding: 10px; 
                        font-size: 1rem; 
                        cursor: pointer; 
                        background: transparent; 
                        color: #888; 
                        border: none;
                        text-decoration: underline;">
                        Change my Goal
                    </button>
                </div>
                 <p style="margin-top: 20px; font-size: 0.9rem; color: #555;">Focus Score: <span style="color: #ff5252">Critical</span></p>
            </div>
        `;

        document.body.appendChild(overlay);
        overlayDOM = overlay;

        // Stop Scrolling
        document.body.style.overflow = 'hidden';

        // Event Listeners
        document.getElementById('btn-back').addEventListener('click', () => {
            removeOverlay();
        });

        document.getElementById('btn-10min').addEventListener('click', () => {
            chrome.runtime.sendMessage({
                action: "whitelistTenMinutes",
                url: window.location.href
            });
            removeOverlay();
        });

        document.getElementById('btn-change-goal').addEventListener('click', () => {
            alert("Please open the extension popup to update your goal.");
            removeOverlay();
        });
    }

    function removeOverlay() {
        const el = document.getElementById('focus-overlay-protector');
        if (el) el.remove();
        document.body.style.overflow = '';
    }
})();
