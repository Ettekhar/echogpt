import { NotFoundException } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';
import { decryptSecret, encryptSecret } from '../common/utils/crypto.util';
import { ProviderName } from './providers.constants';

describe('ProvidersService', () => {
  let service: ProvidersService;
  let prisma: { aiProvider: any };
  let adapterFactory: Partial<ProviderAdapterFactory>;

  beforeEach(() => {
    process.env.PROVIDER_KEY_ENCRYPTION_SECRET = 'b'.repeat(64);

    prisma = {
      aiProvider: {
        create: jest.fn((args) => ({ id: 'p1', userId: args.data.userId, ...args.data })),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn((args) => ({ id: args.where.id, ...args.data })),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
    };

    adapterFactory = {
      get: jest.fn(() => ({
        chat: jest.fn(),
        chatStream: jest.fn(),
        healthCheck: jest.fn(async () => true),
      })),
    };

    service = new ProvidersService(
      prisma as unknown as PrismaService,
      adapterFactory as ProviderAdapterFactory,
    );
  });

  describe('create', () => {
    it('encrypts the API key before storing it and never returns it in plaintext', async () => {
      const dto = {
        name: ProviderName.OPENAI,
        apiKey: 'sk-real-secret-key-value',
        isDefault: false,
      };
      const result = await service.create('u1', dto as any);

      expect(prisma.aiProvider.create).toHaveBeenCalled();
      const storedArgs = prisma.aiProvider.create.mock.calls[0][0].data;
      expect(storedArgs.encryptedApiKey).not.toEqual(dto.apiKey);
      expect(decryptSecret(storedArgs.encryptedApiKey)).toEqual(dto.apiKey);

      expect(result).not.toHaveProperty('encryptedApiKey');
      expect(result.apiKeyPreview).not.toEqual(dto.apiKey);
    });

    it('clears any existing default before setting a new one', async () => {
      await service.create('u1', {
        name: ProviderName.CLAUDE,
        apiKey: 'sk-another-secret-value',
        isDefault: true,
      } as any);

      expect(prisma.aiProvider.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('ownership checks', () => {
    it('throws NotFoundException when the provider belongs to a different user', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue({ id: 'p1', userId: 'someone-else' });
      await expect(service.findOne('u1', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the provider does not exist', async () => {
      prisma.aiProvider.findUnique.mockResolvedValue(null);
      await expect(service.remove('u1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('healthCheck', () => {
    it('decrypts the stored key and delegates to the adapter', async () => {
      const encrypted = encryptSecret('sk-live-key');
      prisma.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        name: ProviderName.OPENAI,
        encryptedApiKey: encrypted,
        baseUrl: null,
      });
      prisma.aiProvider.update.mockResolvedValue({
        id: 'p1',
        lastHealthCheck: new Date(),
      });

      const result = await service.healthCheck('u1', 'p1');

      expect(adapterFactory.get).toHaveBeenCalledWith(ProviderName.OPENAI);
      expect(result.healthy).toBe(true);
    });
  });
});
