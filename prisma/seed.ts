import { PrismaClient, Role, PlanType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@echogpt.app';
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
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

  console.log('Seeded admin user:', admin.email, '(password: ChangeMe123!)');

  try {
    const { encryptSecret } = require('../src/common/utils/crypto.util');
    const rawApiKey = process.env.GEMINI_API_KEY || 'AIzaSyDemoKeyReplaceInDashboard';
    const encKey = encryptSecret(rawApiKey);
    await prisma.aiProvider.deleteMany({ where: { userId: admin.id } });
    await prisma.aiProvider.create({
      data: {
        userId: admin.id,
        name: 'GEMINI',
        label: 'Google Gemini (Flash)',
        model: 'gemini-flash-latest',
        encryptedApiKey: encKey,
        isEnabled: true,
        isDefault: true,
        lastHealthCheck: new Date(),
        lastHealthy: true,
      },
    });
    console.log('Seeded Gemini provider for admin user');
  } catch (err) {
    console.log('Note: could not seed Gemini provider:', err.message);
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
