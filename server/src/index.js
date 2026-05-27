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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const BENEFIT_CATEGORIES = [
  'Software & Tools',
  'Banking & Money',
  'Food & Dining',
  'Travel & Transport',
  'Health & Wellness',
  'Career & Jobs',
  'Entertainment',
  'Local Deals',
];

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

// ── AI Perks Discovery ───────────────────────────────────────────────────────
async function discoverUniversityPerks(university, force = false) {
  if (!university || university === 'Generic') return [];

  // Check if recently run
  const existing = await prisma.universityDiscovery.findUnique({ where: { university } });
  if (!force && existing && (Date.now() - existing.lastRunAt.getTime()) < SEVEN_DAYS_MS) {
    return [];
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: `You are a student benefits researcher. Return ONLY a valid JSON array. No markdown, no explanation.`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Find all student discounts, perks, hidden benefits, and money-saving opportunities specifically for ${university} students in 2026. Include: software discounts, banking bonuses, local business deals, travel perks, health benefits, gym memberships, career perks, food discounts, and anything else students might not know about.

Return a JSON array of 10-20 perks. Each item must have exactly these fields:
- "title": short name (max 50 chars)
- "description": what it offers (1-2 sentences)
- "savings": estimated savings like "$600/year" or "50% off"
- "howToClaim": how to get it (1-3 sentences)
- "category": exactly one of: ${BENEFIT_CATEGORIES.map(c => `"${c}"`).join(', ')}
- "sourceUrl": official URL to claim, or "" if unknown

Focus on real, actionable benefits students can claim today. Return ONLY the JSON array.`,
      },
    ],
  });

  const raw = response.content[0]?.text?.trim() ?? '[]';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let perks = [];
  try {
    perks = JSON.parse(cleaned);
    if (!Array.isArray(perks)) perks = [];
  } catch {
    perks = [];
  }

  // Validate and normalize each perk
  const now = new Date();
  const validPerks = perks
    .filter(p => p && typeof p.title === 'string' && p.title.trim())
    .map(p => ({
      university,
      title:         String(p.title).slice(0, 80).trim(),
      description:   String(p.description || '').slice(0, 300).trim(),
      savings:       String(p.savings || 'Varies').slice(0, 50).trim(),
      howToClaim:    String(p.howToClaim || '').slice(0, 300).trim(),
      category:      BENEFIT_CATEGORIES.includes(p.category) ? p.category : 'Software & Tools',
      sourceUrl:     String(p.sourceUrl || '').slice(0, 500).trim(),
      isAiDiscovered: true,
      isActive:      true,
      lastRefreshed: now,
    }));

  if (validPerks.length === 0) return [];

  // Replace old AI-discovered perks for this university
  await prisma.$transaction([
    prisma.universityBenefit.deleteMany({
      where: { university, isAiDiscovered: true },
    }),
    prisma.universityBenefit.createMany({ data: validPerks }),
  ]);

  // Update discovery log
  await prisma.universityDiscovery.upsert({
    where:  { university },
    update: { lastRunAt: now },
    create: { university, lastRunAt: now },
  });

  return validPerks;
}

// ── Scheduled 7-day refresh ───────────────────────────────────────────────────
async function runScheduledDiscoveries() {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
    const stale = await prisma.universityDiscovery.findMany({
      where: { lastRunAt: { lt: sevenDaysAgo } },
    });
    for (const u of stale) {
      await discoverUniversityPerks(u.university, true).catch(() => {});
    }
  } catch (_) {}
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

// ── API: save university + trigger background discovery ───────────────────────
app.put('/api/me/university', requireAuth, async (req, res) => {
  const { university } = req.body;
  if (!university) return res.status(400).json({ error: 'Missing university' });

  try {
    const user = await prisma.user.update({
      where:  { id: req.userId },
      data:   { university },
      select: { id: true, university: true },
    });
    res.json(user);

    // Fire-and-forget: discover perks for universities we haven't seen before
    if (university !== 'Generic') {
      discoverUniversityPerks(university, false).catch(() => {});
    }
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

    await prisma.codeVote.create({ data: { codeId, userId: req.userId, vote } });

    const code = await prisma.referralCode.findUnique({ where: { id: codeId } });
    if (!code) return res.status(404).json({ error: 'Code not found' });

    const newYes  = code.yesVotes + (vote === 'yes' ? 1 : 0);
    const newNo   = code.noVotes  + (vote === 'no'  ? 1 : 0);
    const total   = newYes + newNo;
    const rate    = total > 0 ? newYes / total : 0;
    const expired = newNo >= 3;

    const updated = await prisma.referralCode.update({
      where: { id: codeId },
      data:  { yesVotes: newYes, noVotes: newNo, successRate: rate, isExpired: expired },
    });

    res.json({ yesVotes: updated.yesVotes, noVotes: updated.noVotes, successRate: updated.successRate, isExpired: updated.isExpired });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    try { dna = JSON.parse(cleaned); } catch {
      dna = { why: 'To attract new customers and grow their user base.', catches: 'May require a minimum purchase or only apply to first-time users.', bestTime: 'Use it on your first purchase.', duration: 'Typically 30–90 days.' };
    }

    const dealDnaStr = JSON.stringify(dna);
    await prisma.referralCode.update({ where: { id: codeId }, data: { dealDna: dealDnaStr } });
    res.json({ dealDna: dealDnaStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: university benefits (GET) ───────────────────────────────────────────
app.get('/api/benefits', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { university: true },
    });

    const university = user?.university ?? 'Generic';

    const [uniPerks, genericPerks, discovery, userUpvotes] = await Promise.all([
      university !== 'Generic'
        ? prisma.universityBenefit.findMany({
            where:   { university, isActive: true },
            orderBy: [{ upvotes: 'desc' }, { createdAt: 'asc' }],
          })
        : Promise.resolve([]),
      prisma.universityBenefit.findMany({
        where:   { university: 'Generic', isActive: true },
        orderBy: [{ upvotes: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.universityDiscovery.findUnique({ where: { university } }),
      prisma.benefitUpvote.findMany({ where: { userId: req.userId } }),
    ]);

    const upvotedSet = new Set(userUpvotes.map(u => u.benefitId));
    const allBenefits = [...uniPerks, ...genericPerks].map(b => ({
      ...b,
      userUpvoted: upvotedSet.has(b.id),
    }));

    res.json({
      university,
      benefits:         allBenefits,
      lastDiscoveredAt: discovery?.lastRunAt ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: trigger AI perks discovery ─────────────────────────────────────────
app.post('/api/benefits/discover/:university', requireAuth, async (req, res) => {
  const university = decodeURIComponent(req.params.university);

  if (!university || university === 'Generic') {
    return res.status(400).json({ error: 'Set a specific university to discover perks' });
  }

  try {
    await discoverUniversityPerks(university, true);

    // Return fresh benefits after discovery
    const [uniPerks, userUpvotes, discovery] = await Promise.all([
      prisma.universityBenefit.findMany({
        where:   { university, isActive: true },
        orderBy: [{ upvotes: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.benefitUpvote.findMany({ where: { userId: req.userId } }),
      prisma.universityDiscovery.findUnique({ where: { university } }),
    ]);

    const upvotedSet = new Set(userUpvotes.map(u => u.benefitId));
    const benefits = uniPerks.map(b => ({ ...b, userUpvoted: upvotedSet.has(b.id) }));

    res.json({ university, benefits, lastDiscoveredAt: discovery?.lastRunAt ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: community perk submission ───────────────────────────────────────────
app.post('/api/benefits/community', requireAuth, async (req, res) => {
  const { title, description, savings, howToClaim, category, sourceUrl } = req.body;

  if (!title || !description || !savings || !howToClaim) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { university: true },
    });

    if (!user?.university) {
      return res.status(400).json({ error: 'Set your university before sharing perks' });
    }

    const benefit = await prisma.universityBenefit.create({
      data: {
        university:    user.university,
        title:         title.slice(0, 80).trim(),
        description:   description.slice(0, 300).trim(),
        savings:       savings.slice(0, 50).trim(),
        howToClaim:    howToClaim.slice(0, 300).trim(),
        category:      BENEFIT_CATEGORIES.includes(category) ? category : 'Software & Tools',
        sourceUrl:     (sourceUrl || '').slice(0, 500).trim(),
        communityAdded: true,
        addedByUserId:  req.userId,
        isActive:      true,
      },
    });

    res.status(201).json({ ...benefit, userUpvoted: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: upvote a benefit ────────────────────────────────────────────────────
app.post('/api/benefits/:id/upvote', requireAuth, async (req, res) => {
  const benefitId = req.params.id;

  try {
    const existing = await prisma.benefitUpvote.findUnique({
      where: { benefitId_userId: { benefitId, userId: req.userId } },
    });

    if (existing) {
      // Toggle off: remove upvote
      await prisma.benefitUpvote.delete({ where: { id: existing.id } });
      const updated = await prisma.universityBenefit.update({
        where: { id: benefitId },
        data:  { upvotes: { decrement: 1 } },
      });
      return res.json({ upvotes: updated.upvotes, userUpvoted: false });
    }

    // Add upvote
    await prisma.benefitUpvote.create({ data: { benefitId, userId: req.userId } });
    const updated = await prisma.universityBenefit.update({
      where: { id: benefitId },
      data:  { upvotes: { increment: 1 } },
    });
    res.json({ upvotes: updated.upvotes, userUpvoted: true });
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
    if (user.coinBalance < coins) return res.status(400).json({ error: 'Insufficient coins' });

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

// ── API: AI smart search ──────────────────────────────────────────────────────
app.post('/api/search/ai', requireAuth, async (req, res) => {
  const query = (req.body.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: 'You are a student deals researcher. Return ONLY valid JSON array — no markdown, no explanation.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Find real working referral codes or student discounts for: "${query}".
Return a JSON array of up to 5 items. Each item must have exactly these fields:
- "brand": brand/company name (string)
- "emoji": one relevant emoji (string)
- "code": the actual referral or discount code, or "" if genuinely unknown (string)
- "discount": what the discount offers e.g. "$25 off first order" (string)
- "category": one of Food, Shopping, Streaming, Music, Education, Productivity, Design, Other (string)
- "expiry": e.g. "30 days" or "No expiry" (string)
- "domain": main website domain e.g. "doordash.com" (string)
Focus on commonly-known, likely-valid codes. Return ONLY the JSON array.`,
        },
      ],
    });

    const raw = response.content[0]?.text?.trim() ?? '[]';
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let results = [];
    try { results = JSON.parse(cleaned); } catch { results = []; }
    if (!Array.isArray(results)) results = [];

    const VALID_CATEGORIES = ['Food','Shopping','Streaming','Music','Education','Productivity','Design','Other'];

    // Validate and normalize
    const valid = results
      .filter(r => r && typeof r.brand === 'string' && r.brand.trim())
      .map(r => ({
        brand:    String(r.brand).slice(0, 40).trim(),
        emoji:    String(r.emoji || '🏷').slice(0, 4).trim(),
        code:     String(r.code || '').toUpperCase().slice(0, 30).trim(),
        discount: String(r.discount || '').slice(0, 80).trim(),
        category: VALID_CATEGORIES.includes(r.category) ? r.category : 'Other',
        expiry:   String(r.expiry || '30 days').slice(0, 20).trim(),
        domain:   String(r.domain || '').toLowerCase().replace(/^www\./, '').slice(0, 100).trim(),
      }));

    // Auto-save codes that have a code value and aren't already in DB
    const withCode = valid.filter(r => r.code);
    if (withCode.length > 0) {
      const existing = await prisma.referralCode.findMany({
        where: {
          brand:     { in: withCode.map(r => r.brand) },
          isExpired: false,
        },
        select: { brand: true },
      });
      const existingBrands = new Set(existing.map(e => e.brand.toLowerCase()));

      const toSave = withCode.filter(r => !existingBrands.has(r.brand.toLowerCase()));
      if (toSave.length > 0) {
        await prisma.referralCode.createMany({
          data: toSave.map(r => ({
            brand:       r.brand,
            domain:      r.domain || r.brand.toLowerCase().replace(/\s+/g, '') + '.com',
            emoji:       r.emoji,
            code:        r.code,
            description: r.discount,
            category:    r.category,
            expiresIn:   r.expiry,
            coins:       0,
            userId:      req.userId,
            source:      'ai-search',
          })),
          skipDuplicates: true,
        });
      }
    }

    res.json({ results: valid });
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
          text: `Available referral codes:\n${JSON.stringify(codes)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `The user is visiting "${domain}". Which of the available referral codes are most relevant? Return up to 3 matches as a JSON array: [{"id":"...","score":0.9,"reason":"one short sentence"}]. If none are relevant, return [].`,
        },
      ],
    });

    const raw = response.content[0]?.text?.trim() ?? '[]';
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let picks = [];
    try { picks = JSON.parse(cleaned); } catch { picks = []; }

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Stackd API running on port ${PORT}`);

  // Run stale-discovery check on startup, then every 6 hours
  runScheduledDiscoveries();
  setInterval(runScheduledDiscoveries, 6 * 60 * 60 * 1000);
});
