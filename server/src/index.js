require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const jwt      = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app    = express();

const API_URL = process.env.API_URL || 'http://localhost:3001';

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow Chrome extension origins (any ID) and the API domain itself
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      /^chrome-extension:\/\/.+/.test(origin) ||
      origin === API_URL ||
      origin === 'http://localhost:3001'
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());
app.use(passport.initialize());

// ── Google OAuth strategy ────────────────────────────────────────────────────
passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${API_URL}/auth/google/callback`,
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const user = await prisma.user.upsert({
        where:  { googleId: profile.id },
        update: { name: profile.displayName, avatar: profile.photos?.[0]?.value ?? null },
        create: {
          googleId: profile.id,
          email:    profile.emails[0].value,
          name:     profile.displayName,
          avatar:   profile.photos?.[0]?.value ?? null,
          coinBalance: 0,
        },
      });
      done(null, user);
    } catch (err) {
      done(err);
    }
  }
));

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Auth routes ──────────────────────────────────────────────────────────────
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    // The extension's background.js watches for this URL pattern and extracts the token
    res.redirect(`/auth/success?token=${token}`);
  }
);

app.get('/auth/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><title>Stackd — Signed in</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; background: #F5F5F7; }
  .card { text-align: center; padding: 32px; background: #fff; border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h2 { color: #7C3AED; margin: 0 0 8px; }
  p  { color: #6B7280; margin: 0; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h2>You're signed in to Stackd!</h2>
    <p>This tab will close automatically…</p>
  </div>
</body>
</html>`);
});

app.get('/auth/failure', (_req, res) => {
  res.status(401).send('<p>Authentication failed. Close this tab and try again.</p>');
});

// ── API: current user ────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { id: true, name: true, email: true, avatar: true, coinBalance: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: referral codes ──────────────────────────────────────────────────────
app.get('/api/codes', async (_req, res) => {
  try {
    const codes = await prisma.referralCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, avatar: true } } },
    });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/codes', requireAuth, async (req, res) => {
  const { brand, domain, emoji, code, description, category, expiresIn } = req.body;

  if (!brand || !domain || !code || !description || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [newCode] = await prisma.$transaction([
      prisma.referralCode.create({
        data: {
          brand,
          domain,
          emoji:       emoji || '🏷',
          code:        code.toUpperCase(),
          description,
          category,
          expiresIn:   expiresIn || '30 days',
          coins:       50,
          userId:      req.userId,
        },
      }),
      prisma.user.update({
        where: { id: req.userId },
        data:  { coinBalance: { increment: 50 } },
      }),
    ]);
    res.status(201).json(newCode);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: gift card redemption ────────────────────────────────────────────────
app.post('/api/redeem', requireAuth, async (req, res) => {
  const { giftCardId, brand, value, coins, giftCode } = req.body;

  if (!giftCardId || !brand || !value || !coins || !giftCode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.coinBalance < coins) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }

    const [redemption] = await prisma.$transaction([
      prisma.redemption.create({
        data: { userId: req.userId, giftCardId, brand, value, coinsSpent: coins, giftCode },
      }),
      prisma.user.update({
        where: { id: req.userId },
        data:  { coinBalance: { decrement: coins } },
      }),
    ]);
    res.status(201).json(redemption);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Stackd API running on port ${PORT}`);
});