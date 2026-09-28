import { PrismaClient, Role, PlanType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@echogpt.app';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: Role.ADMIN,
      isEmailVerified: true,
      isActive: true,
      deletedAt: null,
      passwordHash,
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'EchoGPT Admin',
      role: Role.ADMIN,
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
      role: Role.USER,
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
  const rawApiKey = process.env.GEMINI_API_KEY;
  if (!rawApiKey) {
    console.log(
      'Skipping provider seed: set GEMINI_API_KEY in .env to pre-load a Gemini provider.',
    );
    return;
  }

  // Both seeded accounts get a working provider. The demo account used to have
  // none, which made "log in as demo and try the chat" fail with a 404
  // ("No enabled AI provider configured") even though the account was
  // advertised in the README.
  for (const [owner, label] of [
    [admin, 'admin user'],
    [demo, 'demo user'],
  ] as const) {
    try {
      const { encryptSecret } = require('../src/common/utils/crypto.util');
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
