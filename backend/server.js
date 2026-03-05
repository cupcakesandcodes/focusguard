require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const paymentRoutes = require('./routes/payment');

const app = express();

// ── Security ──────────────────────────────────────────────────
app.use(helmet());

app.use(cors({
    origin: '*', // Allow all origins for the Chrome Extension during dev
    credentials: false // Must be false if origin is '*'
}));

// Rate limiting — 100 req / 15 min per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);

// ── Body parsing ──────────────────────────────────────────────
// Skip JSON parsing for Stripe webhook (needs raw body)
app.use((req, res, next) => {
    if (req.originalUrl === '/api/payment/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/payment', paymentRoutes);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🗄️  Database: Supabase (${process.env.SUPABASE_URL})`);
});
