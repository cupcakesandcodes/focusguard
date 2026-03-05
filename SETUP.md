# Anti-Distraction Extension - Setup Guide

## 🚀 Quick Start (No Backend Needed!)

The extension works **immediately** without any setup. Just:

1. Load the extension in Chrome
2. Set your goal
3. Start browsing!

**Free features (works offline):**
- ✅ Keyword-based goal checking
- ✅ YouTube/Reddit/LinkedIn silencer
- ✅ Tunnel Vision mode
- ✅ Grayscale mode
- ✅ All features work without internet!

---

## 💎 Premium AI Mode (Optional)

For smarter, context-aware goal checking, you can set up the backend.

### Prerequisites

1. **Node.js** (v18+)
2. **MongoDB** (local or MongoDB Atlas)
3. **Gemini API Key** (free tier available)
4. **Stripe Account** (for payments)

### Backend Setup

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` file:**
   ```env
   MONGODB_URI=mongodb://localhost:27017/antidistraction
   JWT_SECRET=your-random-secret-key-here
   GEMINI_API_KEY=your-gemini-api-key
   STRIPE_SECRET_KEY=sk_test_your-stripe-key
   ```

4. **Start MongoDB:**
   ```bash
   # If using local MongoDB
   mongod
   ```

5. **Run backend:**
   ```bash
   npm run dev
   ```

### Deploy Backend (Production)

**Option A: Railway.app (Easiest)**
1. Push code to GitHub
2. Connect Railway to your repo
3. Add environment variables
4. Deploy automatically

**Option B: Heroku**
```bash
heroku create your-app-name
heroku addons:create mongolab
git push heroku main
```

### Update Extension

In `content/platforms/youtube.js`, update line 13:
```javascript
const API_URL = 'https://your-deployed-backend.com/api';
```

---

## 📊 Pricing Tiers

**Free Tier:**
- Unlimited keyword-based checking
- All silencer features
- No account required

**Premium Tier ($4.99/month):**
- AI-powered goal checking
- 1000 checks/day
- Cross-device sync
- Advanced analytics

---

## 🔧 Development

```bash
# Backend
cd backend
npm run dev

# Extension
# Load unpacked in chrome://extensions
```

---

## 📝 Notes

- Extension works **100% offline** by default
- Backend is **only needed** for AI premium features
- Users can use the extension forever without paying
- Premium is an **optional upgrade** for power users
