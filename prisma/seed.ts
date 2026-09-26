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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
