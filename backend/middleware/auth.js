const { supabase } = require('../supabase');

/**
 * Auth middleware — verifies a Supabase access token from the
 * Authorization: Bearer <token> header.
 *
 * Attaches to req:
 *   req.user    — Supabase auth user object { id, email, ... }
 *   req.profile — Row from public.profiles table
 */
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No authentication token provided' });
        }

        // Verify the token against Supabase Auth
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Fetch the user's profile from public.profiles
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return res.status(401).json({ error: 'User profile not found' });
        }

        // Update last_login (fire-and-forget — don't await)
        supabase
            .from('profiles')
            .update({ last_login: new Date().toISOString() })
            .eq('id', user.id)
            .then(() => { });

        req.user = { ...user, profile };
        req.profile = profile;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
};

module.exports = authMiddleware;
