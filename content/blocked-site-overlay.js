// Shared Blocking Overlay for Restricted Sites - Premium Design
console.log("🚫 Blocked Site Overlay Script Loaded");

class BlockedSiteOverlay {
    constructor(siteName) {
        this.siteName = siteName;
        this.overlay = null;
    }

    show() {
        // Remove existing overlay if present
        this.remove();

        // Import Google Font
        const fontLink = document.createElement('link');
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);

        // Create overlay container with animated gradient
        this.overlay = document.createElement('div');
        this.overlay.id = 'blocked-site-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: linear-gradient(-45deg, #667eea, #764ba2, #f093fb, #4facfe);
            background-size: 400% 400%;
            animation: gradientShift 15s ease infinite;
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden;
        `;

        // Add floating particles
        this.createParticles();

        // Create glassmorphism card
        const card = document.createElement('div');
        card.style.cssText = `
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 30px;
            padding: 70px 90px;
            box-shadow: 0 25px 70px rgba(0, 0, 0, 0.25), 
                        0 0 0 1px rgba(255, 255, 255, 0.2) inset;
            text-align: center;
            max-width: 650px;
            animation: slideInScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
            position: relative;
            z-index: 10;
        `;

        // Add enhanced animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
            
            @keyframes gradientShift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            
            @keyframes slideInScale {
                from {
                    opacity: 0;
                    transform: translateY(-40px) scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            
            @keyframes float {
                0%, 100% {
                    transform: translateY(0px);
                }
                50% {
                    transform: translateY(-20px);
                }
            }
            
            @keyframes glow {
                0%, 100% {
                    box-shadow: 0 8px 30px rgba(102, 126, 234, 0.5),
                                0 0 0 1px rgba(255, 255, 255, 0.3) inset;
                }
                50% {
                    box-shadow: 0 12px 40px rgba(118, 75, 162, 0.7),
                                0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                }
            }
            
            @keyframes particleFloat {
                0% {
                    transform: translateY(0) rotate(0deg);
                    opacity: 0;
                }
                10% {
                    opacity: 1;
                }
                90% {
                    opacity: 1;
                }
                100% {
                    transform: translateY(-100vh) rotate(360deg);
                    opacity: 0;
                }
            }
            
            .blocked-particle {
                position: absolute;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                pointer-events: none;
                animation: particleFloat linear infinite;
            }
        `;
        document.head.appendChild(style);

        // Icon container with animation
        const iconContainer = document.createElement('div');
        iconContainer.style.cssText = `
            font-size: 90px;
            margin-bottom: 25px;
            animation: float 3s ease-in-out infinite;
            filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.2));
        `;
        iconContainer.textContent = '🔒';

        // Title with gradient text
        const title = document.createElement('h1');
        title.style.cssText = `
            font-size: 42px;
            font-weight: 800;
            background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin: 0 0 20px 0;
            letter-spacing: -1px;
            text-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        `;
        title.textContent = 'Access Restricted';

        // Site name badge
        const siteBadge = document.createElement('div');
        siteBadge.style.cssText = `
            display: inline-block;
            background: rgba(255, 255, 255, 0.25);
            backdrop-filter: blur(10px);
            padding: 8px 24px;
            border-radius: 50px;
            font-size: 16px;
            font-weight: 600;
            color: white;
            margin-bottom: 25px;
            border: 1px solid rgba(255, 255, 255, 0.3);
        `;
        siteBadge.textContent = this.siteName;

        // Subtitle
        const subtitle = document.createElement('p');
        subtitle.style.cssText = `
            font-size: 18px;
            color: rgba(255, 255, 255, 0.95);
            margin: 0 0 15px 0;
            line-height: 1.7;
            font-weight: 500;
        `;
        subtitle.textContent = 'This site is blocked by default to help you maintain focus and productivity.';

        // Description
        const description = document.createElement('p');
        description.style.cssText = `
            font-size: 15px;
            color: rgba(255, 255, 255, 0.75);
            margin: 0 0 45px 0;
            line-height: 1.6;
        `;
        description.textContent = 'You can grant temporary access for this browsing session only.';

        // Allow button with enhanced styling
        const allowBtn = document.createElement('button');
        allowBtn.id = 'allow-session-btn';
        allowBtn.style.cssText = `
            background: rgba(255, 255, 255, 0.95);
            color: #667eea;
            border: none;
            padding: 18px 50px;
            font-size: 17px;
            font-weight: 700;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 0 8px 30px rgba(102, 126, 234, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.3) inset;
            margin-bottom: 20px;
            position: relative;
            overflow: hidden;
            font-family: 'Inter', sans-serif;
        `;
        allowBtn.innerHTML = `
            <span style="position: relative; z-index: 1;">✓ Allow for This Session</span>
        `;

        allowBtn.onmouseover = () => {
            allowBtn.style.transform = 'translateY(-3px) scale(1.05)';
            allowBtn.style.animation = 'glow 2s ease-in-out infinite';
        };
        allowBtn.onmouseout = () => {
            allowBtn.style.transform = 'translateY(0) scale(1)';
            allowBtn.style.animation = 'none';
        };
        allowBtn.onclick = () => this.allowForSession();

        // Info text with icon
        const info = document.createElement('p');
        info.style.cssText = `
            font-size: 13px;
            color: rgba(255, 255, 255, 0.7);
            margin: 20px 0 0 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        `;
        info.innerHTML = `
            <span style="font-size: 16px;">⏱️</span>
            <span>Access expires when you close your browser</span>
        `;

        // Assemble card
        card.appendChild(iconContainer);
        card.appendChild(title);
        card.appendChild(siteBadge);
        card.appendChild(subtitle);
        card.appendChild(description);
        card.appendChild(allowBtn);
        card.appendChild(info);

        // Add card to overlay
        this.overlay.appendChild(card);

        // Add overlay to page
        document.body.appendChild(this.overlay);
    }

    createParticles() {
        // Create floating particles for visual effect
        for (let i = 0; i < 15; i++) {
            const particle = document.createElement('div');
            particle.className = 'blocked-particle';
            const size = Math.random() * 60 + 20;
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${Math.random() * 100}%;
                animation-duration: ${Math.random() * 10 + 15}s;
                animation-delay: ${Math.random() * 5}s;
            `;
            this.overlay.appendChild(particle);
        }
    }

    allowForSession() {
        console.log(`🔓 Allowing ${this.siteName} for this session`);

        // Add success animation
        const card = this.overlay.querySelector('div');
        if (card) {
            card.style.animation = 'slideInScale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) reverse';
        }

        setTimeout(() => {
            // Send message to background script
            chrome.runtime.sendMessage({
                action: 'allowSiteForSession',
                hostname: window.location.hostname
            }, (response) => {
                if (response && response.success) {
                    this.remove();
                    // Store in session storage as backup
                    sessionStorage.setItem('siteAllowedForSession', 'true');
                }
            });
        }, 200);
    }

    remove() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.style.opacity = '0';
            this.overlay.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                if (this.overlay && this.overlay.parentNode) {
                    this.overlay.parentNode.removeChild(this.overlay);
                    this.overlay = null;
                }
            }, 300);
        }
    }

    isAllowedForSession() {
        // Check session storage
        return sessionStorage.getItem('siteAllowedForSession') === 'true';
    }
}

// Export for use in platform scripts
window.BlockedSiteOverlay = BlockedSiteOverlay;
