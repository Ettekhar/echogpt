import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { encryptSecret, maskSecret, decryptSecret } from '../common/utils/crypto.util';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';
import { HealthCheckResult } from './adapters/provider-adapter.interface';

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

    const { model, label, baseUrl } = this.sanitizeProviderInput(dto);

    const existing = await this.prisma.aiProvider.findFirst({
      where: {
        userId,
        name: dto.name,
        ...(label ? { label } : {}),
      },
    });

    let provider;
    if (existing) {
      provider = await this.prisma.aiProvider.update({
        where: { id: existing.id },
        data: {
          label: label ?? existing.label,
          model: model ?? existing.model,
          baseUrl: baseUrl ?? existing.baseUrl,
          isDefault: dto.isDefault ?? existing.isDefault,
          isEnabled: true,
          encryptedApiKey: encryptSecret(dto.apiKey),
        },
      });
    } else {
      provider = await this.prisma.aiProvider.create({
        data: {
          userId,
          name: dto.name,
          label,
          model,
          baseUrl,
          isDefault: dto.isDefault ?? false,
          encryptedApiKey: encryptSecret(dto.apiKey),
        },
      });
    }

    return this.toSafeDto(provider, dto.apiKey);
  }

  private sanitizeProviderInput(dto: { name: string; label?: string; model?: string; baseUrl?: string }) {
    let model = dto.model?.trim()?.replace(/^models\//i, '')?.replace(/\s+/g, '-');
    let label = dto.label?.trim();

    // If model is empty, but label looks like a model name, use label as model
    if (!model && label) {
      const cleanLabel = label.toLowerCase().replace(/^models\//i, '').replace(/\s+/g, '-');
      if (cleanLabel.startsWith('gemini') || cleanLabel.startsWith('gpt') || cleanLabel.startsWith('claude')) {
        model = cleanLabel;
      }
    }

    // Default models per provider if still empty
    if (!model) {
      if (dto.name === 'GEMINI') model = 'gemini-2.5-flash';
      else if (dto.name === 'OPENAI') model = 'gpt-4o-mini';
      else if (dto.name === 'CLAUDE') model = 'claude-3-5-sonnet-20241022';
    }

    // Default label if empty
    if (!label) {
      label = `${dto.name} (${model})`;
    }

    let baseUrl = dto.baseUrl?.trim();
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/+$/, '');
    }

    return { model, label, baseUrl };
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
    const result: HealthCheckResult = await adapter.healthCheck(apiKey, provider.baseUrl || undefined);

    const updated = await this.prisma.aiProvider.update({
      where: { id },
      data: { lastHealthCheck: new Date(), lastHealthy: result.healthy },
    });
    return {
      id: updated.id,
      healthy: result.healthy,
      isHealthy: result.healthy,
      checkedAt: updated.lastHealthCheck,
      ...(result.model ? { model: result.model } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
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
