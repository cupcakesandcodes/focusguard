const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const authMiddleware = require('../middleware/auth');
const { supabase } = require('../supabase');

const router = express.Router();

// ── POST /api/payment/create-checkout ─────────────────────────
// Creates a Stripe Checkout session for the Premium subscription.
router.post('/create-checkout', authMiddleware, async (req, res) => {
    try {
        const { user, profile } = req;

        // Create or reuse Stripe customer
        let customerId = profile.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { userId: user.id }
            });
            customerId = customer.id;

            // Save Stripe customer ID to profile
            await supabase
                .from('profiles')
                .update({ stripe_customer_id: customerId })
                .eq('id', user.id);
        }

        // Build success/cancel URLs
        const baseUrl = process.env.PRICING_PAGE_URL?.replace(/#.*/, '') ||
            req.headers.origin ||
            'https://your-site.github.io/focusguard';

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'FocusGuard Premium',
                            description: 'AI-powered content monitoring — 150 scans/day'
                        },
                        unit_amount: 499, // $4.99/month
                        recurring: { interval: 'month' }
                    },
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/cancel.html`,
            metadata: { userId: user.id }
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// ── POST /api/payment/webhook ──────────────────────────────────
// Stripe sends events here. Verified via webhook signature.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {

            // ── Payment succeeded → upgrade to premium ──
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.metadata?.userId;
                if (!userId) break;

                await supabase
                    .from('profiles')
                    .update({
                        subscription_tier: 'premium',
                        subscription_status: 'active',
                        stripe_subscription_id: session.subscription
                    })
                    .eq('id', userId);

                console.log(`✅ Upgraded user ${userId} to premium`);
                break;
            }

            // ── Subscription updated or cancelled ──
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                const customer = await stripe.customers.retrieve(sub.customer);

                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('stripe_customer_id', customer.id);

                if (profiles?.length) {
                    const isActive = sub.status === 'active';
                    await supabase
                        .from('profiles')
                        .update({
                            subscription_status: sub.status,
                            subscription_tier: isActive ? 'premium' : 'free'
                        })
                        .eq('stripe_customer_id', customer.id);

                    console.log(`🔄 Subscription ${sub.status} for customer ${customer.id}`);
                }
                break;
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ── POST /api/payment/cancel ───────────────────────────────────
// Cancels the user's active subscription (at period end).
router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        const { profile } = req;

        if (!profile.stripe_subscription_id) {
            return res.status(400).json({ error: 'No active subscription found' });
        }

        // Cancel at period end — user keeps premium until billing period ends
        await stripe.subscriptions.update(profile.stripe_subscription_id, {
            cancel_at_period_end: true
        });

        await supabase
            .from('profiles')
            .update({ subscription_status: 'canceled' })
            .eq('id', req.user.id);

        res.json({ message: 'Subscription will cancel at end of billing period.' });
    } catch (error) {
        console.error('Cancel error:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

module.exports = router;
