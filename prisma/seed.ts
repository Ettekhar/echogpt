import { PrismaClient, PlanType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { encryptSecret } from '../src/common/utils/crypto.util';
import { Role as RoleName } from '../src/common/enums/role.enum';

const prisma = new PrismaClient();

/**
 * Ensure a role row exists and return its id.
 *
 * The migration creates USER and ADMIN, but seeding should not depend on that
 * having run - a database set up with `prisma db push` has the Role table and
 * nothing in it. Upserting here means the seed works against any of them.
 */
async function roleIdFor(name: RoleName): Promise<string> {
  const role = await prisma.role.upsert({
    where: { name },
    update: {},
    create: {
      name,
      description:
        name === RoleName.ADMIN
          ? 'Full access to the admin panel and every /admin endpoint'
          : 'Default role for every registered account',
    },
  });
  return role.id;
}

async function main() {
  const adminRoleId = await roleIdFor(RoleName.ADMIN);
  const userRoleId = await roleIdFor(RoleName.USER);

  const adminEmail = 'admin@echogpt.app';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      roleId: adminRoleId,
      isEmailVerified: true,
      isActive: true,
      deletedAt: null,
      passwordHash,
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'EchoGPT Admin',
      roleId: adminRoleId,
      isEmailVerified: true,
      subscription: {
        create: { plan: PlanType.PREMIUM, dailyLimit: 100000 },
      },
    },
  });

  console.log(`Seeded admin user: ${admin.email} (password: ${adminPassword})`);

  // The README advertises a second demo account for reviewers; keep it in sync.
  const demoEmail = 'demo@echogpt.app';
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'DemoUser123!';
  const demoHash = await bcrypt.hash(demoPassword, 10);
  const demo = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {
      isEmailVerified: true,
      isActive: true,
      deletedAt: null,
      passwordHash: demoHash,
    },
    create: {
      email: demoEmail,
      passwordHash: demoHash,
      name: 'EchoGPT Demo',
      roleId: userRoleId,
      isEmailVerified: true,
      subscription: {
        create: { plan: PlanType.FREE, dailyLimit: 20 },
      },
    },
  });
  console.log(`Seeded demo user:  ${demo.email} (password: ${demoPassword})`);

  // Provider seeding is opt-in: only seed a real key when one is actually
  // provided. Storing a placeholder key only produces confusing failed health
  // checks later.
  //
  // Note this deliberately does not return early when there is no key. It used
  // to, and that silently skipped the sample activity below - which is exactly
  // what a reviewer running `npm install && npm run demo` without an API key
  // gets, so their dashboard came up empty. Whether a provider exists and
  // whether the install looks populated are unrelated questions.
  const rawApiKey = process.env.GEMINI_API_KEY;
  if (!rawApiKey) {
    console.log(
      'Skipping provider seed: set GEMINI_API_KEY in .env to pre-load a Gemini provider.',
    );
  } else {
    // Both seeded accounts get a working provider. The demo account used to
    // have none, which made "log in as demo and try the chat" fail with a 404
    // ("No enabled AI provider configured") even though the account was
    // advertised in the README.
    for (const [owner, label] of [
      [admin, 'admin user'],
      [demo, 'demo user'],
    ] as const) {
      try {
        const encKey = encryptSecret(rawApiKey);
        await prisma.aiProvider.deleteMany({ where: { userId: owner.id } });
        await prisma.aiProvider.create({
          data: {
            userId: owner.id,
            name: 'GEMINI',
            label: 'Google Gemini (Flash)',
            model: 'gemini-3.8-flash',
            encryptedApiKey: encKey,
            isEnabled: true,
            isDefault: true,
            lastHealthCheck: new Date(),
            lastHealthy: true,
          },
        });
        console.log(`Seeded Gemini provider (gemini-3.8-flash) for ${label}`);
      } catch (err) {
        console.log(`Note: could not seed Gemini provider for ${label}:`, err.message);
      }
    }
  }

  await seedSampleActivity(admin, demo);
}

/**
 * Optional sample activity, so a fresh install does not look abandoned.
 *
 * A brand-new clone has exactly two users and zero conversations, which makes
 * the admin dashboard indistinguishable from a broken one: "Total Users 2", no
 * charts, empty chat history. Someone reviewing the work cannot tell a working
 * dashboard from a dead one, so this gives the charts something real to plot.
 *
 * Opt out with SEED_DEMO_DATA=false for a genuinely empty database. The rows are
 * deterministic (fixed text, backdated timestamps) and it refuses to run when
 * any conversation already exists, so re-seeding never duplicates or inflates
 * counts. Timestamps are backdated across the last fortnight so the daily usage
 * chart has a spread rather than a single spike today.
 */
async function seedSampleActivity(
  admin: { id: string },
  demo: { id: string },
) {
  if (String(process.env.SEED_DEMO_DATA).toLowerCase() === 'false') {
    console.log('Skipping sample activity (SEED_DEMO_DATA=false).');
    return;
  }

  if ((await prisma.conversation.count()) > 0) {
    console.log('Sample activity already present - leaving existing conversations alone.');
    return;
  }

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const samples = [
    {
      owner: demo,
      title: 'Explain quantum computing simply',
      ask: 'Explain quantum computing in simple terms.',
      reply:
        'A normal bit is either 0 or 1. A qubit can be in a combination of both until it is measured, which is what lets a quantum computer explore many possibilities at once.',
    },
    {
      owner: demo,
      title: 'Sci-fi recommendations',
      ask: 'Recommend 5 great sci-fi movies.',
      reply:
        'Arrival, Blade Runner 2049, The Expanse, Interstellar and Solaris are five well-regarded starting points.',
    },
    {
      owner: admin,
      title: 'Current rate limits',
      ask: 'What are the current rate limits?',
      reply:
        'Free plans get 20 AI requests per day and premium gets 1000. The global throttle allows 100 requests per 60 seconds.',
    },
  ];

  for (const [i, s] of samples.entries()) {
    // Backdate across the last two weeks so the dashboard's daily chart shows
    // a spread of activity instead of a single bar.
    const at = new Date(now - (samples.length - i) * 3 * DAY);

    await prisma.conversation.create({
      data: {
        userId: s.owner.id,
        title: s.title,
        createdAt: at,
        messages: {
          create: [
            { role: 'USER', content: s.ask, createdAt: at },
            {
              role: 'ASSISTANT',
              content: s.reply,
              tokensUsed: 64,
              createdAt: at,
            },
          ],
        },
      },
    });

    await prisma.apiUsageLog.create({
      data: {
        userId: s.owner.id,
        method: 'POST',
        path: '/api/v1/chat/messages',
        statusCode: 200,
        durationMs: 820,
        createdAt: at,
      },
    });

    await prisma.webSearch.create({
      data: {
        userId: s.owner.id,
        query: 'quantum computing explained simply',
        cached: false,
        createdAt: at,
      },
    });

    console.log(`Seeded sample conversation "${s.title}".`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
