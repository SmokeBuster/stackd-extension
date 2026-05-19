const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const seedCodes = [
  { brand: 'DoorDash',  domain: 'doordash.com',  emoji: '🍕', code: 'CAMPUS25',       description: '$25 off your first order',        category: 'Food',         coins: 50,  expiresIn: '30 days'  },
  { brand: 'Uber Eats', domain: 'ubereats.com',   emoji: '🛵', code: 'STUDENT15',      description: '$15 off + free delivery',          category: 'Food',         coins: 30,  expiresIn: '15 days'  },
  { brand: 'Spotify',   domain: 'spotify.com',    emoji: '🎵', code: 'SPOTISTUDENT',   description: '3 months Premium for $0.99',       category: 'Music',        coins: 75,  expiresIn: '60 days'  },
  { brand: 'Amazon',    domain: 'amazon.com',     emoji: '📦', code: 'PRIME4STUDENTS', description: '6 months free Prime Student',      category: 'Shopping',     coins: 100, expiresIn: 'No expiry' },
  { brand: 'Chegg',     domain: 'chegg.com',      emoji: '📚', code: 'STUDYSTACK',     description: '40% off first month',             category: 'Education',    coins: 40,  expiresIn: '7 days'   },
  { brand: 'Grubhub',   domain: 'grubhub.com',    emoji: '🥡', code: 'CAMPUSEATS',     description: 'Free delivery for 30 days',       category: 'Food',         coins: 25,  expiresIn: '30 days'  },
  { brand: 'Notion',    domain: 'notion.so',      emoji: '📝', code: 'NOTIONPRO',      description: 'Free Pro plan for students',      category: 'Productivity', coins: 60,  expiresIn: 'No expiry' },
  { brand: 'Adobe',     domain: 'adobe.com',      emoji: '🎨', code: 'ADOBECC60',      description: '60% off Creative Cloud',          category: 'Design',       coins: 80,  expiresIn: '14 days'  },
  { brand: 'Coursera',  domain: 'coursera.org',   emoji: '🎓', code: 'LEARNFREE30',    description: '30 days free Coursera Plus',      category: 'Education',    coins: 55,  expiresIn: '21 days'  },
  { brand: 'Hulu',      domain: 'hulu.com',       emoji: '📺', code: 'HULU99CENTS',    description: '$0.99/mo for 12 months',          category: 'Streaming',    coins: 45,  expiresIn: '45 days'  },
];

async function main() {
  const teamUser = await prisma.user.upsert({
    where:  { googleId: 'stackd-seed' },
    update: {},
    create: { googleId: 'stackd-seed', email: 'seed@stackd.app', name: 'Stackd Team', coinBalance: 0 },
  });

  const existing = await prisma.referralCode.count({ where: { userId: teamUser.id } });
  if (existing === 0) {
    await prisma.referralCode.createMany({
      data: seedCodes.map(c => ({ ...c, userId: teamUser.id })),
    });
    console.log(`Seeded ${seedCodes.length} referral codes.`);
  } else {
    console.log(`Seed already applied (${existing} codes found). Skipping.`);
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
