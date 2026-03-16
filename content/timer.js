(function () {
    // Floating Timer Widget
    console.log("Timer Widget Loaded");

    let timerWidget = null;
    let timerInterval = null;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    // Listen for session updates from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "showTimer") {
            showTimer(request.session);
        } else if (request.action === "hideTimer") {
            hideTimer();
        } else if (request.action === "updateTimer") {
            updateTimerDisplay(request.remainingTime);
        } else if (request.action === "showContinuePrompt") {
            showContinuePrompt(request.session, request.remainingTime);
        }
    });

    // Check for active session on load
    chrome.storage.local.get(['activeSession'], (result) => {
        if (result.activeSession) {
            const now = Date.now();
            if (now < result.activeSession.endTime) {
                showTimer(result.activeSession);
            }
        }
    });

    // Listen for storage changes to show/hide timer instantly
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.activeSession) {
            if (changes.activeSession.newValue) {
                // Session started - show timer
                const session = changes.activeSession.newValue;
                const now = Date.now();
                if (now < session.endTime) {
                    console.log("⏱️ Timer: Session started via storage, showing timer");
                    showTimer(session);
                }
            } else {
                // Session ended - hide timer
                console.log("⏱️ Timer: Session ended via storage, hiding timer");
                hideTimer();
            }
        }
    });

    function showTimer(session) {
        if (timerWidget) return; // Already showing

        // Create timer widget
        timerWidget = document.createElement('div');
        timerWidget.id = 'focus-timer-widget';
        timerWidget.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(18, 18, 18, 0.95) 100%);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(76, 175, 80, 0.3);
            border-radius: 12px;
            padding: 10px 14px;
            color: white;
            font-family: 'Inter', 'Segoe UI', sans-serif;
            z-index: 2147483646;
            cursor: move;
            user-select: none;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
            min-width: 140px;
            transition: opacity 0.2s;
        `;

        timerWidget.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Focus Time</div>
                    <div id="timer-display" style="font-size: 20px; font-weight: 700; color: #4CAF50; font-variant-numeric: tabular-nums;">--:--</div>
                </div>
                <button id="timer-close" style="
                    opacity: 0;
                    background: rgba(255, 82, 82, 0.2);
                    border: 1px solid rgba(255, 82, 82, 0.3);
                    color: #ff5252;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    line-height: 1;
                    transition: all 0.2s;
                    padding: 0;
                ">×</button>
            </div>
        `;

        document.body.appendChild(timerWidget);

        // Show close button on hover
        timerWidget.addEventListener('mouseenter', () => {
            const closeBtn = document.getElementById('timer-close');
            if (closeBtn) closeBtn.style.opacity = '1';
        });

        timerWidget.addEventListener('mouseleave', () => {
            const closeBtn = document.getElementById('timer-close');
            if (closeBtn) closeBtn.style.opacity = '0';
        });

        // Close button handler
        document.getElementById('timer-close').addEventListener('click', (e) => {
            e.stopPropagation();
            hideTimer();
        });

        // Make draggable
        timerWidget.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);

        // Start countdown
        startCountdown(session);
    }

    function startDrag(e) {
        if (e.target.id === 'timer-close') return;
        isDragging = true;
        const rect = timerWidget.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        timerWidget.style.cursor = 'grabbing';
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        let newX = e.clientX - dragOffset.x;
        let newY = e.clientY - dragOffset.y;

        // Keep within viewport
        const maxX = window.innerWidth - timerWidget.offsetWidth;
        const maxY = window.innerHeight - timerWidget.offsetHeight;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        timerWidget.style.left = newX + 'px';
        timerWidget.style.top = newY + 'px';
        timerWidget.style.right = 'auto';
    }

    function stopDrag() {
        isDragging = false;
        if (timerWidget) {
            timerWidget.style.cursor = 'move';
        }
    }

    function startCountdown(session) {
        updateTimerDisplay(session.endTime - Date.now());

        timerInterval = setInterval(() => {
            const remaining = session.endTime - Date.now();

            if (remaining <= 0) {
                clearInterval(timerInterval);
                showCompletionMessage(session.goal, session.duration);
                hideTimer();
                chrome.storage.local.remove('activeSession');
            } else {
                updateTimerDisplay(remaining);
            }
        }, 1000);
    }

    function updateTimerDisplay(remainingMs) {
        const display = document.getElementById('timer-display');
        if (!display) return;

        const totalSeconds = Math.floor(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Color changes based on time remaining
        if (minutes < 5) {
            display.style.color = '#ff5252'; // Red for last 5 minutes
        } else if (minutes < 10) {
            display.style.color = '#FFA726'; // Orange for last 10 minutes
        } else {
            display.style.color = '#4CAF50'; // Green
        }
    }

    function hideTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        if (timerWidget) {
            timerWidget.remove();
            timerWidget = null;
        }

        // Remove event listeners
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', stopDrag);
    }

    function showCompletionMessage(goal, duration) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
        `;

        overlay.innerHTML = `
            <div style="
                background: linear-gradient(135deg, rgba(26, 26, 26, 0.98) 0%, rgba(18, 18, 18, 0.98) 100%);
                padding: 48px;
                border-radius: 24px;
                text-align: center;
                border: 2px solid #4CAF50;
                box-shadow: 0 20px 60px rgba(76, 175, 80, 0.3);
                max-width: 500px;
            ">
                <div style="font-size: 64px; margin-bottom: 20px;">🎉</div>
                <h1 style="font-size: 2rem; margin: 0 0 16px 0; color: #4CAF50; font-weight: 700;">Congratulations!</h1>
                <p style="font-size: 1.2rem; color: #e0e0e0; margin-bottom: 12px;">You completed your ${duration}-minute focus session!</p>
                <p style="font-size: 1rem; color: #888; margin-bottom: 32px;">Goal: <strong style="color: white;">"${goal}"</strong></p>
                <button id="completion-close" style="
                    padding: 14px 32px;
                    background: linear-gradient(135deg, #4CAF50 0%, #00C853 100%);
                    color: white;
                    border: none;
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 16px;
                    cursor: pointer;
                    transition: transform 0.2s;
                ">Awesome!</button>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('completion-close').addEventListener('click', () => {
            overlay.remove();
        });

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.remove();
            }
        }, 10000);
    }

    function showContinuePrompt(session, remainingTime) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const minutes = Math.floor(remainingTime / 60000);

        overlay.innerHTML = `
            <div style="
                background: linear-gradient(135deg, rgba(26, 26, 26, 0.98) 0%, rgba(18, 18, 18, 0.98) 100%);
                padding: 40px;
                border-radius: 20px;
                text-align: center;
                border: 1px solid rgba(76, 175, 80, 0.3);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                max-width: 450px;
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">⏸️</div>
                <h2 style="font-size: 1.5rem; margin: 0 0 12px 0; color: #e0e0e0; font-weight: 600;">Session Paused</h2>
                <p style="font-size: 1rem; color: #aaa; margin-bottom: 8px;">You have <strong style="color: #4CAF50;">${minutes} minutes</strong> remaining</p>
                <p style="font-size: 0.9rem; color: #888; margin-bottom: 28px;">Goal: <strong style="color: white;">"${session.goal}"</strong></p>
                
                <div style="display: flex; gap: 12px;">
                    <button id="continue-session" style="
                        flex: 1;
                        padding: 14px;
                        background: linear-gradient(135deg, #4CAF50 0%, #00C853 100%);
                        color: white;
                        border: none;
                        border-radius: 12px;
                        font-weight: 600;
                        font-size: 15px;
                        cursor: pointer;
                        transition: transform 0.2s;
                    ">Continue Session</button>
                    
                    <button id="end-session" style="
                        flex: 1;
                        padding: 14px;
                        background: transparent;
                        color: #e0e0e0;
                        border: 1px solid #555;
                        border-radius: 12px;
                        font-weight: 600;
                        font-size: 15px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">End Session</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('continue-session').addEventListener('click', () => {
            overlay.remove();
            showTimer(session);
        });

        document.getElementById('end-session').addEventListener('click', () => {
            overlay.remove();
            chrome.storage.local.remove('activeSession');
            chrome.runtime.sendMessage({ action: "endSession" });
        });
    }
})();
