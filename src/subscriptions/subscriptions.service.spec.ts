import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from './subscriptions.constants';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: { subscription: any; user: any };

  const yesterday = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  };

  beforeEach(() => {
    process.env.FREE_PLAN_DAILY_LIMIT = '20';
    process.env.PREMIUM_PLAN_DAILY_LIMIT = '1000';

    prisma = {
      subscription: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    service = new SubscriptionsService(prisma as unknown as PrismaService);
  });

  describe('getOrCreate (via getStatus)', () => {
    it('creates a Free subscription for a user that does not have one yet', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce(null) // getOrCreate lookup
        .mockResolvedValueOnce({
          userId: 'u1',
          plan: 'FREE',
          dailyLimit: 20,
          requestsUsed: 0,
          usageResetAt: new Date(),
        }); // final read in getStatus
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.subscription.create.mockResolvedValue({
        userId: 'u1',
        plan: 'FREE',
        dailyLimit: 20,
        usageResetAt: new Date(),
      });

      await service.getStatus('u1');

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: { userId: 'u1', plan: 'FREE', dailyLimit: 20 },
      });
    });
  });

  describe('tryConsumeUsage', () => {
    it('allows the request and increments usage when under the limit', async () => {
      const sub = {
        userId: 'u1',
        plan: 'FREE',
        status: 'ACTIVE',
        dailyLimit: 20,
        requestsUsed: 5,
        usageResetAt: new Date(),
      };
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const allowed = await service.tryConsumeUsage('u1');

      expect(allowed).toBe(true);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { requestsUsed: { increment: 1 } },
      });
    });

    it('blocks the request once the daily limit is reached', async () => {
      const sub = {
        userId: 'u1',
        plan: 'FREE',
        status: 'ACTIVE',
        dailyLimit: 20,
        requestsUsed: 20,
        usageResetAt: new Date(),
      };
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const allowed = await service.tryConsumeUsage('u1');

      expect(allowed).toBe(false);
      expect(prisma.subscription.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { requestsUsed: { increment: 1 } } }),
      );
    });

    it('blocks the request when the subscription is not ACTIVE', async () => {
      const sub = {
        userId: 'u1',
        plan: 'PREMIUM',
        status: 'CANCELED',
        dailyLimit: 1000,
        requestsUsed: 0,
        usageResetAt: new Date(),
      };
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const allowed = await service.tryConsumeUsage('u1');
      expect(allowed).toBe(false);
    });

    it('resets usage to 0 when the stored usageResetAt is from a previous UTC day', async () => {
      const staleSub = {
        userId: 'u1',
        plan: 'FREE',
        status: 'ACTIVE',
        dailyLimit: 20,
        requestsUsed: 20,
        usageResetAt: yesterday(),
      };
      // First call inside resetUsageIfNewDay's own read of "sub" argument comes from getOrCreate's
      // findUnique; second is the post-reset fresh read.
      prisma.subscription.findUnique
        .mockResolvedValueOnce(staleSub)
        .mockResolvedValueOnce({ ...staleSub, requestsUsed: 0, usageResetAt: new Date() });

      const allowed = await service.tryConsumeUsage('u1');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({ requestsUsed: 0 }),
        }),
      );
      expect(allowed).toBe(true);
    });
  });

  describe('changePlan', () => {
    it('upgrading to Premium sets the Premium daily limit and a 30-day renewal', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'FREE' });
      prisma.subscription.update.mockResolvedValue({
        userId: 'u1',
        plan: 'PREMIUM',
        dailyLimit: 1000,
      });

      await service.changePlan('u1', PlanType.PREMIUM);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({
            plan: PlanType.PREMIUM,
            dailyLimit: 1000,
            status: 'ACTIVE',
          }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('marks the subscription as CANCELED with a timestamp', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'PREMIUM' });
      await service.cancel('u1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { status: 'CANCELED', canceledAt: expect.any(Date) },
      });
    });
  });
});
