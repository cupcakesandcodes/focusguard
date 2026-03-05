// =========================================
// FocusGuard Landing Page - JavaScript
// =========================================

// ── Navbar scroll effect ──
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// ── FAQ accordion ──
document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const answer = item.querySelector('.faq-a');
        const isOpen = btn.getAttribute('aria-expanded') === 'true';

        // Close all
        document.querySelectorAll('.faq-q').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
            b.closest('.faq-item').querySelector('.faq-a').classList.remove('open');
        });

        // Toggle current
        if (!isOpen) {
            btn.setAttribute('aria-expanded', 'true');
            answer.classList.add('open');
        }
    });
});

// ── Intersection Observer: fade-in on scroll ──
const observer = new IntersectionObserver(
    (entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    },
    { threshold: 0.12 }
);

document.querySelectorAll(
    '.feature-card, .step, .pricing-card, .faq-item, .section-header'
).forEach(el => {
    el.classList.add('fade-up');
    observer.observe(el);
});

// Inject fade-up CSS dynamically
const style = document.createElement('style');
style.textContent = `
  .fade-up {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  .fade-up.visible {
    opacity: 1;
    transform: translateY(0);
  }
`;
document.head.appendChild(style);

// ── Upgrade button: open Stripe Payment Link ──
// Replace STRIPE_PAYMENT_LINK_URL with your actual Stripe Payment Link
const STRIPE_PAYMENT_LINK_URL = 'https://buy.stripe.com/YOUR_PAYMENT_LINK';

document.getElementById('upgradeBtn').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(STRIPE_PAYMENT_LINK_URL, '_blank');
});

// ── Install button: open Chrome Web Store ──
// Replace CHROME_EXTENSION_STORE_URL with your actual Chrome Web Store link
const CHROME_EXTENSION_STORE_URL = 'https://chrome.google.com/webstore/detail/YOUR_EXTENSION_ID';

document.getElementById('installBtn').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(CHROME_EXTENSION_STORE_URL, '_blank');
});

// ── Smooth scroll for nav links ──
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// ── AI scan ring: cycle between states ──
const scanLabel = document.querySelector('.ai-scan-label');
const states = [
    { text: '🔍 Scanning...', color: '#06b6d4' },
    { text: '✓ On-topic', color: '#4ade80' },
    { text: '⚠ Off-topic?', color: '#fb923c' },
    { text: '✓ On-topic', color: '#4ade80' },
];
let stateIdx = 0;
if (scanLabel) {
    setInterval(() => {
        stateIdx = (stateIdx + 1) % states.length;
        scanLabel.textContent = states[stateIdx].text;
        scanLabel.style.color = states[stateIdx].color;
    }, 2200);
}
