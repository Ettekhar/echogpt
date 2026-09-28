import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '../subscriptions/subscriptions.constants';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription: {
        findUnique: jest.fn(),
        update: jest.fn((args) => ({ userId: args.where.userId, ...args.data })),
        groupBy: jest.fn(),
      },
      aiProvider: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn((args) => ({ id: args.where.id, encryptedApiKey: 'enc', ...args.data })),
        delete: jest.fn(),
        groupBy: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    service = new AdminService(prisma as unknown as PrismaService);
  });

  describe('overrideUserSubscription', () => {
    it('throws NotFoundException when the user has no subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      await expect(
        service.overrideUserSubscription('missing-user', { plan: PlanType.PREMIUM }),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies only the fields provided (partial override)', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'FREE' });

      await service.overrideUserSubscription('u1', { dailyLimit: 500 });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { dailyLimit: 500 },
      });
    });

    it('applies plan and status together when both provided', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'FREE' });

      await service.overrideUserSubscription('u1', { plan: PlanType.PREMIUM, status: 'ACTIVE' });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { plan: PlanType.PREMIUM, status: 'ACTIVE' },
      });
    });
  });

  describe('getUserSubscription', () => {
    it('throws NotFoundException when the user has no subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.getUserSubscription('missing-user')).rejects.toThrow(NotFoundException);
    });

    it('returns the subscription when found', async () => {
      const sub = { userId: 'u1', plan: 'FREE' };
      prisma.subscription.findUnique.mockResolvedValue(sub);
      await expect(service.getUserSubscription('u1')).resolves.toEqual(sub);
    });
  });

  describe('adminSetProviderEnabled', () => {
    it('throws NotFoundException for a missing provider', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue(null);
      await expect(service.adminSetProviderEnabled('missing', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('never returns the encrypted key in the response', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue({ id: 'p1', encryptedApiKey: 'enc' });

      const result = await service.adminSetProviderEnabled('p1', false);

      expect(result).not.toHaveProperty('encryptedApiKey');
      expect(prisma.aiProvider.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isEnabled: false },
      });
    });
  });

  describe('adminDeleteProvider', () => {
    it('throws NotFoundException for a missing provider', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue(null);
      await expect(service.adminDeleteProvider('missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes an existing provider', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue({ id: 'p1' });
      const result = await service.adminDeleteProvider('p1');
      expect(prisma.aiProvider.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(result.message).toBe('Provider removed');
    });
  });

  describe('listUserProviders', () => {
    it('strips the encrypted key from every provider in the list', async () => {
      prisma.aiProvider.findMany.mockResolvedValue([
        { id: 'p1', encryptedApiKey: 'enc1', name: 'OPENAI' },
        { id: 'p2', encryptedApiKey: 'enc2', name: 'CLAUDE' },
      ]);

      const result = await service.listUserProviders('u1');

      expect(result).toHaveLength(2);
      result.forEach((p) => expect(p).not.toHaveProperty('encryptedApiKey'));
    });
  });

  describe('systemHealth', () => {
    it('reports ok when the DB query succeeds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const result = await service.systemHealth();
      expect(result.status).toBe('ok');
      expect(result.database).toBe('up');
    });

    it('reports degraded when the DB query throws', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      const result = await service.systemHealth();
      expect(result.status).toBe('degraded');
      expect(result.database).toBe('down');
    });
  });
});
