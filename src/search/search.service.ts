import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ProvidersService } from '../providers/providers.service';
import { ProviderAdapterFactory } from '../providers/adapters/provider-adapter.factory';
import { decryptSecret } from '../common/utils/crypto.util';
import { SearchProviderFactory } from './adapters/search-provider.factory';
import { SearchResultItem } from './adapters/search-provider.interface';

/** Cache window: identical queries within this many minutes reuse the stored result. */
const CACHE_WINDOW_MINUTES = 30;

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private subscriptionsService: SubscriptionsService,
    private searchProviderFactory: SearchProviderFactory,
    private providersService: ProvidersService,
    private adapterFactory: ProviderAdapterFactory,
  ) {}

  async search(userId: string, query: string) {
    const cached = await this.findCached(query);
    if (cached) {
      await this.prisma.webSearch.create({
        data: { userId, query, resultsJson: cached.resultsJson as any, cached: true },
      });
      const c = cached.resultsJson as any;
      return {
        query,
        answer: c.answer || c.summary || 'Cached search complete.',
        summary: c.answer || c.summary || 'Cached search complete.',
        results: Array.isArray(c.results) ? c.results : c.items || [],
        items: Array.isArray(c.results) ? c.results : c.items || [],
        cached: true,
      };
    }

    const allowed = await this.subscriptionsService.tryConsumeUsage(userId);
    if (!allowed) {
      throw new ForbiddenException(
        'Daily request limit reached for your plan. Upgrade to Premium for a higher limit.',
      );
    }

    const provider = this.searchProviderFactory.getActive();
    let items: SearchResultItem[] = [];

    try {
      items = await provider.search(query);
    } catch {
      items = [];
    }

    let answer = '';
    if (items.length > 0) {
      try {
        const defaultProvider = await this.providersService.getDefault(userId);
        if (defaultProvider) {
          const adapter = this.adapterFactory.get(defaultProvider.name as any);
          const apiKey = decryptSecret(defaultProvider.encryptedApiKey);
          const snippets = items
            .slice(0, 5)
            .map((item, i) => `[${i + 1}] ${item.title}: ${item.snippet}`)
            .join('\n\n');
          const prompt = `Based on these web search results for "${query}", provide a concise, informative summary answer:\n\n${snippets}`;
          const aiRes = await adapter.chat({
            apiKey,
            model: defaultProvider.model || undefined,
            messages: [{ role: 'user', content: prompt }],
          });
          answer = aiRes.content;
        }
      } catch {
        // Fall back gracefully
      }
    }

    if (!answer) {
      answer =
        items.length > 0
          ? `Found ${items.length} relevant web sources for "${query}".`
          : `No web results found for "${query}".`;
    }

    const responsePayload = {
      query,
      answer,
      summary: answer,
      results: items,
      items,
      cached: false,
    };

    await this.prisma.webSearch.create({
      data: { userId, query, resultsJson: responsePayload as any, cached: false },
    });

    return responsePayload;
  }

  async history(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.webSearch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.webSearch.count({ where: { userId } }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async recent(userId: string, limit = 10) {
    return this.prisma.webSearch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      distinct: ['query'],
    });
  }

  async suggestions(userId: string, prefix: string) {
    const matches = await this.prisma.webSearch.findMany({
      where: { userId, query: { startsWith: prefix, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      distinct: ['query'],
      select: { query: true },
    });
    return matches.map((m) => m.query);
  }

  private async findCached(query: string) {
    const since = new Date(Date.now() - CACHE_WINDOW_MINUTES * 60 * 1000);
    return this.prisma.webSearch.findFirst({
      where: { query, createdAt: { gte: since }, resultsJson: { not: null as any } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
