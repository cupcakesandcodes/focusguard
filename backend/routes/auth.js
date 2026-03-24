const express = require('express');
const { supabase } = require('../supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/register ───────────────────────────────────
// Supports Email+Password signup.
// Google OAuth is handled entirely client-side
// via the Supabase JS client in the extension popup.
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Create user via Supabase Auth admin API
        // (admin createUser auto-confirms email, no verification email sent)
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true  // skip email confirmation for smoother UX
        });

        if (error) {
            // Supabase returns a readable message e.g. "User already registered"
            return res.status(400).json({ error: error.message });
        }

        // Fetch the auto-created profile (trigger creates it on auth.users insert)
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        // Sign in immediately to return a usable token
        const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
            return res.status(500).json({ error: 'Account created but sign-in failed' });
        }

        res.status(201).json({
            token: session.session.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                subscriptionTier: profile?.subscription_tier || 'free'
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── POST /api/auth/login ──────────────────────────────────────
// Email + password login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Fetch profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_tier, subscription_status')
            .eq('id', data.user.id)
            .single();

        res.json({
            token: data.session.access_token,
            // Also return refresh_token so extension can silently re-auth
            refreshToken: data.session.refresh_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                subscriptionTier: profile?.subscription_tier || 'free',
                subscriptionStatus: profile?.subscription_status || 'none'
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// ── POST /api/auth/refresh ────────────────────────────────────
// Refreshes an expired access token using a refresh token.
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

        const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

        if (error) return res.status(401).json({ error: 'Session expired — please log in again' });

        res.json({
            token: data.session.access_token,
            refreshToken: data.session.refresh_token
        });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── GET /api/auth/me ──────────────────────────────────────────
// Returns current user + profile. Auth middleware attaches both.
router.get('/me', authMiddleware, (req, res) => {
    const { user, profile } = req;
    res.json({
        user: {
            id: user.id,
            email: user.email,
            subscriptionTier: profile.subscription_tier,
            subscriptionStatus: profile.subscription_status,
            usage: {
                aiChecksToday: profile.usage_ai_checks_today,
                aiChecksTotal: profile.usage_ai_checks_total,
                limit: parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 150
            }
        }
    });
});

module.exports = router;
