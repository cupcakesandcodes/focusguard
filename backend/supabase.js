const { createClient } = require('@supabase/supabase-js');

/**
 * Admin Supabase client — uses the SERVICE ROLE KEY.
 * This bypasses Row Level Security (RLS) so the server
 * can read/write any user's data (e.g. updating subscription
 * tier from a Stripe webhook).
 *
 * ⚠️  NEVER expose this key to the browser or the extension.
 *     Server-side only.
 */
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            // Disable auto-refresh — server doesn't need sessions
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

module.exports = { supabase };
