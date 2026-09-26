import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { encryptSecret, maskSecret, decryptSecret } from '../common/utils/crypto.util';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';

@Injectable()
export class ProvidersService {
  constructor(
    private prisma: PrismaService,
    private adapterFactory: ProviderAdapterFactory,
  ) {}

  async create(userId: string, dto: CreateProviderDto) {
    if (dto.isDefault) {
      await this.clearExistingDefault(userId);
    }

    const provider = await this.prisma.aiProvider.create({
      data: {
        userId,
        name: dto.name,
        label: dto.label,
        model: dto.model,
        baseUrl: dto.baseUrl,
        isDefault: dto.isDefault ?? false,
        encryptedApiKey: encryptSecret(dto.apiKey),
      },
    });
    return this.toSafeDto(provider, dto.apiKey);
  }

  async findAll(userId: string) {
    const providers = await this.prisma.aiProvider.findMany({ where: { userId } });
    return providers.map((p) => this.toSafeDto(p));
  }

  async findOne(userId: string, id: string) {
    const provider = await this.getOwnedOrThrow(userId, id);
    return this.toSafeDto(provider);
  }

  async update(userId: string, id: string, dto: UpdateProviderDto) {
    await this.getOwnedOrThrow(userId, id);

    if (dto.isDefault) {
      await this.clearExistingDefault(userId);
    }

    const provider = await this.prisma.aiProvider.update({
      where: { id },
      data: {
        label: dto.label,
        model: dto.model,
        baseUrl: dto.baseUrl,
        isEnabled: dto.isEnabled,
        isDefault: dto.isDefault,
        ...(dto.apiKey ? { encryptedApiKey: encryptSecret(dto.apiKey) } : {}),
      },
    });
    return this.toSafeDto(provider, dto.apiKey);
  }

  async remove(userId: string, id: string) {
    await this.getOwnedOrThrow(userId, id);
    await this.prisma.aiProvider.delete({ where: { id } });
    return { message: 'Provider removed' };
  }

  async setEnabled(userId: string, id: string, isEnabled: boolean) {
    await this.getOwnedOrThrow(userId, id);
    const provider = await this.prisma.aiProvider.update({ where: { id }, data: { isEnabled } });
    return this.toSafeDto(provider);
  }

  async getDefault(userId: string) {
    const provider = await this.prisma.aiProvider.findFirst({
      where: { userId, isDefault: true, isEnabled: true },
    });
    if (!provider) {
      throw new NotFoundException('No default AI provider configured. Add one first.');
    }
    return provider;
  }

  async healthCheck(userId: string, id: string) {
    const provider = await this.getOwnedOrThrow(userId, id);
    const adapter = this.adapterFactory.get(provider.name as any);
    const apiKey = decryptSecret(provider.encryptedApiKey);
    const healthy = await adapter.healthCheck(apiKey, provider.baseUrl || undefined);

    const updated = await this.prisma.aiProvider.update({
      where: { id },
      data: { lastHealthCheck: new Date(), lastHealthy: healthy },
    });
    return { id: updated.id, healthy, checkedAt: updated.lastHealthCheck };
  }

  private async clearExistingDefault(userId: string) {
    await this.prisma.aiProvider.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async getOwnedOrThrow(userId: string, id: string) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!provider || provider.userId !== userId) {
      throw new NotFoundException('AI provider not found');
    }
    return provider;
  }

  private toSafeDto(provider: any, plaintextKeyJustSet?: string) {
    let apiKeyPreview = '****';
    try {
      apiKeyPreview = maskSecret(plaintextKeyJustSet ?? decryptSecret(provider.encryptedApiKey));
    } catch {
      // If decryption fails (e.g. secret rotated), fall back to a generic mask.
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately stripped from the response
    const { encryptedApiKey, ...safe } = provider;
    return { ...safe, apiKeyPreview };
  }
}
