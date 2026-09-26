import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { ProviderAdapterFactory } from '../providers/adapters/provider-adapter.factory';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { decryptSecret } from '../common/utils/crypto.util';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private providersService: ProvidersService,
    private adapterFactory: ProviderAdapterFactory,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async sendMessage(userId: string, dto: SendMessageDto) {
    const allowed = await this.subscriptionsService.tryConsumeUsage(userId);
    if (!allowed) {
      throw new ForbiddenException(
        'Daily request limit reached for your plan. Upgrade to Premium for a higher limit.',
      );
    }

    const provider = dto.providerId
      ? await this.getOwnedProvider(userId, dto.providerId)
      : await this.providersService.getDefault(userId);

    const conversation = dto.conversationId
      ? await this.getOwnedConversation(userId, dto.conversationId)
      : await this.prisma.conversation.create({
          data: { userId, title: dto.prompt.slice(0, 60) },
        });

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: dto.prompt,
      },
    });

    const history = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    const adapter = this.adapterFactory.get(provider.name as any);
    const apiKey = decryptSecret(provider.encryptedApiKey);

    const result = await adapter.chat({
      apiKey,
      model: provider.model || undefined,
      baseUrl: provider.baseUrl || undefined,
      messages: history.map((m) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    });

    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        providerId: provider.id,
        role: 'ASSISTANT',
        content: result.content,
        tokensUsed: result.tokensUsed,
      },
    });

    return {
      conversationId: conversation.id,
      message: assistantMessage,
      provider: { id: provider.id, name: provider.name },
    };
  }

  /**
   * Bonus: streaming response. Same setup as sendMessage() (usage check, provider/conversation
   * resolution, user message persisted, history loaded), but yields text chunks as they arrive
   * from the provider and persists the assembled assistant message once the stream ends.
   * The controller wraps this generator as a Server-Sent-Events response.
   */
  async *sendMessageStream(
    userId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<{
    event: 'chunk' | 'done' | 'error';
    data: any;
  }> {
    const allowed = await this.subscriptionsService.tryConsumeUsage(userId);
    if (!allowed) {
      yield {
        event: 'error',
        data: { message: 'Daily request limit reached for your plan.' },
      };
      return;
    }

    const provider = dto.providerId
      ? await this.getOwnedProvider(userId, dto.providerId)
      : await this.providersService.getDefault(userId);

    const conversation = dto.conversationId
      ? await this.getOwnedConversation(userId, dto.conversationId)
      : await this.prisma.conversation.create({
          data: { userId, title: dto.prompt.slice(0, 60) },
        });

    await this.prisma.message.create({
      data: { conversationId: conversation.id, role: 'USER', content: dto.prompt },
    });

    const history = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    const adapter = this.adapterFactory.get(provider.name as any);
    const apiKey = decryptSecret(provider.encryptedApiKey);

    let fullText = '';
    try {
      for await (const chunk of adapter.chatStream({
        apiKey,
        model: provider.model || undefined,
        baseUrl: provider.baseUrl || undefined,
        messages: history.map((m) => ({
          role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
      })) {
        fullText += chunk;
        yield { event: 'chunk', data: { text: chunk } };
      }
    } catch (err) {
      yield { event: 'error', data: { message: (err as Error).message } };
      return;
    }

    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        providerId: provider.id,
        role: 'ASSISTANT',
        content: fullText,
      },
    });

    yield {
      event: 'done',
      data: {
        conversationId: conversation.id,
        message: assistantMessage,
        provider: { id: provider.id, name: provider.name },
      },
    };
  }

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  async getConversationHistory(userId: string, conversationId: string) {
    const conversation = await this.getOwnedConversation(userId, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    return { conversation, messages };
  }

  async deleteConversation(userId: string, conversationId: string) {
    await this.getOwnedConversation(userId, conversationId);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { message: 'Conversation deleted' };
  }

  private async getOwnedProvider(userId: string, providerId: string) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: providerId } });
    if (!provider || provider.userId !== userId) {
      throw new NotFoundException('Provider not found');
    }
    if (!provider.isEnabled) {
      throw new ForbiddenException('This provider is currently disabled');
    }
    return provider;
  }

  private async getOwnedConversation(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }
}
