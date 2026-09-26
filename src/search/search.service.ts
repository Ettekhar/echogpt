import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SearchProviderFactory } from './adapters/search-provider.factory';

/** Cache window: identical queries within this many minutes reuse the stored result. */
const CACHE_WINDOW_MINUTES = 30;

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private subscriptionsService: SubscriptionsService,
    private searchProviderFactory: SearchProviderFactory,
  ) {}

  async search(userId: string, query: string) {
    const cached = await this.findCached(query);
    if (cached) {
      await this.prisma.webSearch.create({
        data: { userId, query, resultsJson: cached.resultsJson as any, cached: true },
      });
      return { query, results: cached.resultsJson, cached: true };
    }

    const allowed = await this.subscriptionsService.tryConsumeUsage(userId);
    if (!allowed) {
      throw new ForbiddenException(
        'Daily request limit reached for your plan. Upgrade to Premium for a higher limit.',
      );
    }

    const provider = this.searchProviderFactory.getActive();
    let results: unknown;

    if (!provider) {
      // No SERPER_API_KEY / BRAVE_SEARCH_API_KEY configured - degrade gracefully
      // instead of failing the request outright.
      results = {
        configured: false,
        message:
          'No web search provider is configured. Set SERPER_API_KEY or BRAVE_SEARCH_API_KEY ' +
          '(and SEARCH_PROVIDER) in .env to enable live results.',
        items: [],
      };
    } else {
      try {
        const items = await provider.search(query);
        results = { configured: true, items };
      } catch (err) {
        results = {
          configured: true,
          error: (err as Error).message,
          items: [],
        };
      }
    }

    await this.prisma.webSearch.create({
      data: { userId, query, resultsJson: results as any, cached: false },
    });

    return { query, results, cached: false };
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
