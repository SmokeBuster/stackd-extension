const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const benefits = [
  // ── USC ──────────────────────────────────────────────────────────────
  {
    university: 'USC',
    title: 'Enterprise Car Rental',
    description: 'Waived $25 young driver fee for USC students under 25.',
    savings: '$25 saved',
    howToClaim: 'Book via Enterprise.com with your USC email for the corporate discount code.',
    category: 'Travel',
  },
  {
    university: 'USC',
    title: 'Adobe Creative Cloud',
    description: 'Free Adobe Creative Cloud access for all enrolled USC students.',
    savings: '$600/year',
    howToClaim: 'Log in at adobe.com/education with your USC email (@usc.edu).',
    category: 'Software',
  },
  {
    university: 'USC',
    title: 'Microsoft Office 365',
    description: 'Free Microsoft 365 (Word, Excel, PowerPoint, Teams, OneDrive) for USC students.',
    savings: '$70/year',
    howToClaim: 'Visit office.com and sign in with your USC email.',
    category: 'Software',
  },
  {
    university: 'USC',
    title: 'Apple Education Discount',
    description: '$200 off MacBook + free AirPods with Apple Education pricing for USC students.',
    savings: 'Up to $200',
    howToClaim: 'Visit apple.com/education-store and verify with your USC email.',
    category: 'Electronics',
  },

  // ── UCLA ─────────────────────────────────────────────────────────────
  {
    university: 'UCLA',
    title: 'Adobe Creative Cloud',
    description: 'Free Adobe Creative Cloud for all enrolled UCLA students.',
    savings: '$600/year',
    howToClaim: 'Sign in at adobe.com/education using your @g.ucla.edu email.',
    category: 'Software',
  },
  {
    university: 'UCLA',
    title: 'Microsoft Office 365',
    description: 'Free Microsoft 365 suite for UCLA students while enrolled.',
    savings: '$70/year',
    howToClaim: 'Visit office.com and sign in with your UCLA email.',
    category: 'Software',
  },
  {
    university: 'UCLA',
    title: 'Apple Education Discount',
    description: '$200 off MacBook + free AirPods for UCLA students.',
    savings: 'Up to $200',
    howToClaim: 'Visit apple.com/education-store and verify with your UCLA email.',
    category: 'Electronics',
  },
  {
    university: 'UCLA',
    title: 'Westwood Village Discounts',
    description: 'Discounts at 30+ Westwood restaurants with your BruinCard.',
    savings: '10–20% off',
    howToClaim: 'Show your BruinCard at participating Westwood restaurants.',
    category: 'Food',
  },

  // ── Harvard ───────────────────────────────────────────────────────────
  {
    university: 'Harvard',
    title: 'Adobe Creative Cloud',
    description: 'Free Adobe Creative Cloud for Harvard students via Harvard IT.',
    savings: '$600/year',
    howToClaim: 'Visit harvard.edu/software and sign in with your Harvard credentials.',
    category: 'Software',
  },
  {
    university: 'Harvard',
    title: 'Microsoft Office 365',
    description: 'Free Microsoft 365 for Harvard students.',
    savings: '$70/year',
    howToClaim: 'Visit huit.harvard.edu/microsoft-office for access.',
    category: 'Software',
  },
  {
    university: 'Harvard',
    title: 'Apple Education Discount',
    description: '$200 off MacBook + free AirPods for Harvard students.',
    savings: 'Up to $200',
    howToClaim: 'Visit apple.com/education-store and verify with your Harvard email.',
    category: 'Electronics',
  },
  {
    university: 'Harvard',
    title: 'Harvard Coop Discount',
    description: '10% member discount on textbooks and merchandise at the Harvard Coop.',
    savings: '10% off',
    howToClaim: 'Sign up for Coop membership at thecoop.com with your Harvard ID.',
    category: 'Shopping',
  },

  // ── MIT ───────────────────────────────────────────────────────────────
  {
    university: 'MIT',
    title: 'Adobe Creative Cloud',
    description: 'Free Adobe Creative Cloud for all MIT students.',
    savings: '$600/year',
    howToClaim: 'Visit ist.mit.edu/software/adobe and log in with your MIT credentials.',
    category: 'Software',
  },
  {
    university: 'MIT',
    title: 'Microsoft Office 365',
    description: 'Free Microsoft 365 for MIT students.',
    savings: '$70/year',
    howToClaim: 'Visit ist.mit.edu/microsoft/o365 and sign in with your MIT email.',
    category: 'Software',
  },
  {
    university: 'MIT',
    title: 'Apple Education Discount',
    description: '$200 off MacBook + free AirPods for MIT students.',
    savings: 'Up to $200',
    howToClaim: 'Visit apple.com/education-store and verify with your MIT email.',
    category: 'Electronics',
  },
  {
    university: 'MIT',
    title: 'MIT Campus Store Discount',
    description: 'Discounts on tech, books, and MIT merchandise at the MIT Coop.',
    savings: '10–15% off',
    howToClaim: 'Show your MIT ID at the campus store or shop online at coop.mit.edu.',
    category: 'Shopping',
  },

  // ── Generic (all universities) ────────────────────────────────────────
  {
    university: 'Generic',
    title: 'Spotify + Hulu',
    description: 'Spotify Premium + Hulu (ad-supported) bundle at the student rate.',
    savings: '$13/month vs $22',
    howToClaim: 'Go to spotify.com/student and verify your enrollment via SheerID.',
    category: 'Streaming',
  },
  {
    university: 'Generic',
    title: 'YouTube Premium',
    description: 'YouTube Premium (ad-free + YouTube Music) at student pricing.',
    savings: '$7/month vs $14',
    howToClaim: 'Visit youtube.com/premium and verify student status with your .edu email.',
    category: 'Streaming',
  },
  {
    university: 'Generic',
    title: 'Amazon Prime Student',
    description: '6-month free trial of Amazon Prime, then 50% off the annual plan.',
    savings: '6 months free',
    howToClaim: 'Visit amazon.com/prime/student and sign up with your .edu email.',
    category: 'Shopping',
  },
  {
    university: 'Generic',
    title: 'Apple Music Student',
    description: 'Apple Music at the student rate — includes Apple TV+.',
    savings: '$6/month vs $11',
    howToClaim: 'Subscribe in the Apple Music app and verify via UNiDAYS.',
    category: 'Music',
  },
  {
    university: 'Generic',
    title: 'Discord Nitro',
    description: 'Discord Nitro at a student discount through various partnerships.',
    savings: 'Up to 30% off',
    howToClaim: 'Check discord.com/nitro for current student promotions or use UNiDAYS.',
    category: 'Gaming',
  },
];

async function main() {
  const count = await prisma.universityBenefit.count();
  if (count > 0) {
    console.log(`Benefits already seeded (${count} found). Skipping.`);
    return;
  }

  await prisma.universityBenefit.createMany({ data: benefits });
  console.log(`Seeded ${benefits.length} university benefits.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
