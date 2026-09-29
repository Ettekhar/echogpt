/**
 * Report what the seed actually left in the database.
 *
 * "npm run seed" exits 0 as soon as the two demo accounts exist, so any step
 * that gets skipped further down still looks like a clean success. That is not
 * theoretical: seeding used to return early when no API key was present, which
 * skipped the sample activity, and the setup still printed "ok seeded" while the
 * reviewer's dashboard came up empty.
 *
 * Printing the real counts lets the setup check the outcome instead of trusting
 * the exit code. Invoked as: node scripts/seed-report.js
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const [users, conversations, messages, providers, usageLogs] = await Promise.all([
      prisma.user.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.aiProvider.count(),
      prisma.apiUsageLog.count(),
    ]);
    // Single line of JSON: demo.js parses this, so keep it machine-readable.
    console.log(JSON.stringify({ users, conversations, messages, providers, usageLogs }));
  } catch (err) {
    console.error(`seed-report failed: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
