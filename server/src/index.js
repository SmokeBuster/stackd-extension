require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const jwt      = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');

const prisma    = new PrismaClient();
const anthropic = new Anthropic();
const app       = express();

const API_URL = process.env.API_URL || 'http://localhost:3001';

// ── CORS ─────────────────────────────────────────────────────────────────────
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
      select: { id: true, name: true, email: true, avatar: true, coinBalance: true, university: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: save university ─────────────────────────────────────────────────────
app.put('/api/me/university', requireAuth, async (req, res) => {
  const { university } = req.body;
  if (!university) return res.status(400).json({ error: 'Missing university' });

  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data:  { university },
      select: { id: true, university: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: referral codes ──────────────────────────────────────────────────────
app.get('/api/codes', async (_req, res) => {
  try {
    const codes = await prisma.referralCode.findMany({
      where:   { isExpired: false },
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

// ── API: delete referral code (owner only) ───────────────────────────────────
app.delete('/api/codes/:id', requireAuth, async (req, res) => {
  try {
    const code = await prisma.referralCode.findUnique({ where: { id: req.params.id } });
    if (!code) return res.status(404).json({ error: 'Not found' });
    if (code.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    await prisma.referralCode.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: vote on a referral code ─────────────────────────────────────────────
app.post('/api/codes/:id/vote', requireAuth, async (req, res) => {
  const { vote } = req.body;
  if (!['yes', 'no'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "yes" or "no"' });
  }

  const codeId = req.params.id;

  try {
    const existing = await prisma.codeVote.findUnique({
      where: { codeId_userId: { codeId, userId: req.userId } },
    });
    if (existing) return res.status(409).json({ error: 'Already voted on this code' });

    await prisma.codeVote.create({
      data: { codeId, userId: req.userId, vote },
    });

    const code = await prisma.referralCode.findUnique({ where: { id: codeId } });
    if (!code) return res.status(404).json({ error: 'Code not found' });

    const newYes = code.yesVotes + (vote === 'yes' ? 1 : 0);
    const newNo  = code.noVotes  + (vote === 'no'  ? 1 : 0);
    const total  = newYes + newNo;
    const rate   = total > 0 ? newYes / total : 0;
    const expired = newNo >= 3;

    const updated = await prisma.referralCode.update({
      where: { id: codeId },
      data: {
        yesVotes:    newYes,
        noVotes:     newNo,
        successRate: rate,
        isExpired:   expired,
      },
    });

    res.json({ yesVotes: updated.yesVotes, noVotes: updated.noVotes, successRate: updated.successRate, isExpired: updated.isExpired });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Deal DNA ────────────────────────────────────────────────────────────
app.post('/api/codes/:id/deal-dna', requireAuth, async (req, res) => {
  const codeId = req.params.id;

  try {
    const code = await prisma.referralCode.findUnique({ where: { id: codeId } });
    if (!code) return res.status(404).json({ error: 'Code not found' });

    if (code.dealDna) return res.json({ dealDna: code.dealDna });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        {
          type: 'text',
          text: 'You are a savvy consumer analyst helping students understand referral deals. Be concise and practical. Return ONLY valid JSON.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Analyze this referral deal and return a JSON object with exactly these 4 keys:
- "why": Why does ${code.brand} offer this discount? (1-2 sentences)
- "catches": Hidden catches or limitations to watch out for (1-2 sentences)
- "bestTime": When is the best time to use this deal? (1 sentence)
- "duration": How long do referral deals like this typically last? (1 sentence)

Deal: ${code.brand} — "${code.description}" (code: ${code.code}, category: ${code.category})`,
        },
      ],
    });

    const raw = response.content[0]?.text?.trim() ?? '{}';
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let dna;
    try {
      dna = JSON.parse(cleaned);
    } catch {
      dna = { why: 'To attract new customers and grow their user base.', catches: 'May require a minimum purchase or only apply to first-time users.', bestTime: 'Use it on your first purchase.', duration: 'Typically 30–90 days.' };
    }

    const dealDnaStr = JSON.stringify(dna);

    await prisma.referralCode.update({
      where: { id: codeId },
      data:  { dealDna: dealDnaStr },
    });

    res.json({ dealDna: dealDnaStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: university benefits ─────────────────────────────────────────────────
app.get('/api/benefits', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { university: true },
    });

    const university = user?.university ?? 'Generic';

    const [universityBenefits, genericBenefits] = await Promise.all([
      university !== 'Generic'
        ? prisma.universityBenefit.findMany({
            where:   { university, isActive: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      prisma.universityBenefit.findMany({
        where:   { university: 'Generic', isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({ university, benefits: [...universityBenefits, ...genericBenefits] });
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

// ── API: AI code suggestions ─────────────────────────────────────────────────
app.post('/api/ai-suggest', requireAuth, async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Missing domain' });

  try {
    const codes = await prisma.referralCode.findMany({
      where:   { isExpired: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, brand: true, domain: true, category: true, description: true, emoji: true, code: true, coins: true },
    });

    if (codes.length === 0) return res.json({ suggestions: [] });

    const codesJson = JSON.stringify(codes);

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: 'You are a helpful assistant that matches referral codes to websites. Return ONLY valid JSON — no markdown, no explanation.',
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: `Available referral codes:\n${codesJson}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `The user is visiting "${domain}". Which of the available referral codes are most relevant to this site or its typical use case? Return up to 3 matches as a JSON array with this shape: [{"id":"...","score":0.9,"reason":"one short sentence"}]. If none are relevant, return [].`,
        },
      ],
    });

    const raw = response.content[0]?.text?.trim() ?? '[]';
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let picks;
    try {
      picks = JSON.parse(cleaned);
    } catch {
      picks = [];
    }

    const codeMap = Object.fromEntries(codes.map(c => [c.id, c]));
    const suggestions = picks
      .filter(p => codeMap[p.id])
      .map(p => ({ ...codeMap[p.id], score: p.score, reason: p.reason }))
      .slice(0, 3);

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Stackd API running on port ${PORT}`);
});
