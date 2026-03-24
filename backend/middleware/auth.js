const { supabase } = require('../supabase');

/**
 * Auth middleware — verifies a Supabase access token.
 * Caches the FULL auth result (user + profile) keyed by token
 * to avoid hitting Supabase on every single AI scan.
 */
const authCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No authentication token provided' });
        }

        // ── Full Auth Cache (token → user + profile) ──
        const cached = authCache.get(token);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            console.log(`⚡ Full Auth Cache HIT`);
            req.user = cached.user;
            req.profile = cached.profile;
            return next();
        }

        // ── Cache MISS: verify token with Supabase ──
        console.time('AUTH-SUPABASE-VERIFY');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        console.timeEnd('AUTH-SUPABASE-VERIFY');

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        console.time('AUTH-PROFILE-FETCH');
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        console.timeEnd('AUTH-PROFILE-FETCH');

        if (profileError || !profile) {
            return res.status(401).json({ error: 'User profile not found' });
        }

        // ── Store in cache ──
        const userWithProfile = { ...user, profile };
        authCache.set(token, {
            user: userWithProfile,
            profile,
            timestamp: Date.now()
        });

        // Update last_login (fire-and-forget)
        supabase
            .from('profiles')
            .update({ last_login: new Date().toISOString() })
            .eq('id', user.id)
            .then(() => { });

        req.user = userWithProfile;
        req.profile = profile;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
};

module.exports = authMiddleware;
