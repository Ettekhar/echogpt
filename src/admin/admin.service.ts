import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '../subscriptions/subscriptions.constants';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async dashboardStats() {
    const [
      totalUsers,
      activeUsers,
      premiumSubs,
      freeSubs,
      totalConversations,
      totalMessages,
      totalSearches,
      requestsToday,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.subscription.count({ where: { plan: 'PREMIUM', status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { plan: 'FREE' } }),
      this.prisma.conversation.count(),
      this.prisma.message.count(),
      this.prisma.webSearch.count(),
      this.prisma.apiUsageLog.count({
        where: { createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } },
      }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers },
      subscriptions: { premium: premiumSubs, free: freeSubs },
      usage: {
        conversations: totalConversations,
        messages: totalMessages,
        searches: totalSearches,
      },
      requestsToday,
    };
  }

  async usageAnalytics(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await this.prisma.apiUsageLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, statusCode: true, durationMs: true, path: true },
    });

    const byDay: Record<string, { count: number; errors: number; avgDurationMs: number }> = {};
    for (const log of logs) {
      const day = log.createdAt.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { count: 0, errors: 0, avgDurationMs: 0 };
      byDay[day].count += 1;
      if (log.statusCode >= 400) byDay[day].errors += 1;
      byDay[day].avgDurationMs += log.durationMs;
    }
    for (const day of Object.keys(byDay)) {
      byDay[day].avgDurationMs = Math.round(byDay[day].avgDurationMs / byDay[day].count);
    }

    return { rangeDays: days, byDay };
  }

  async requestLogs(page = 1, pageSize = 50) {
    const skip = (page - 1) * pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.apiUsageLog.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.apiUsageLog.count(),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async subscriptionsOverview() {
    const grouped = await this.prisma.subscription.groupBy({
      by: ['plan', 'status'],
      _count: { _all: true },
    });
    return grouped.map((g) => ({ plan: g.plan, status: g.status, count: g._count._all }));
  }

  /** Admin: view a specific user's subscription (full record, not just an aggregate count). */
  async getUserSubscription(userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new NotFoundException('This user has no subscription record');
    return sub;
  }

  /**
   * Admin: directly override a specific user's plan/status - e.g. to comp a Premium plan,
   * manually correct a failed payment webhook, or force-cancel abuse. This is distinct from
   * SubscriptionsModule (self-service, `/subscriptions/*`), which only ever acts on the
   * currently authenticated user.
   */
  async overrideUserSubscription(
    userId: string,
    changes: {
      plan?: PlanType;
      status?: 'ACTIVE' | 'CANCELED' | 'EXPIRED' | 'PAST_DUE';
      dailyLimit?: number;
    },
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new NotFoundException('This user has no subscription record');

    return this.prisma.subscription.update({
      where: { userId },
      data: {
        ...(changes.plan ? { plan: changes.plan } : {}),
        ...(changes.status ? { status: changes.status } : {}),
        ...(changes.dailyLimit !== undefined ? { dailyLimit: changes.dailyLimit } : {}),
      },
    });
  }

  async providersOverview() {
    const grouped = await this.prisma.aiProvider.groupBy({
      by: ['name', 'isEnabled'],
      _count: { _all: true },
    });
    return grouped.map((g) => ({ provider: g.name, enabled: g.isEnabled, count: g._count._all }));
  }

  /** Admin: list every provider configured by a specific user (never exposes the raw key). */
  async listUserProviders(userId: string) {
    const providers = await this.prisma.aiProvider.findMany({ where: { userId } });
    return providers.map(({ encryptedApiKey: _encryptedApiKey, ...safe }) => safe);
  }

  /** Admin: force-disable any user's provider (e.g. reported abuse, a compromised key). */
  async adminSetProviderEnabled(providerId: string, isEnabled: boolean) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately stripped from the response
    const { encryptedApiKey: _encryptedApiKey, ...safe } = await this.prisma.aiProvider.update({
      where: { id: providerId },
      data: { isEnabled },
    });
    return safe;
  }

  /** Admin: force-delete any user's provider configuration. */
  async adminDeleteProvider(providerId: string) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');
    await this.prisma.aiProvider.delete({ where: { id: providerId } });
    return { message: 'Provider removed' };
  }

  async systemHealth() {
    let dbHealthy = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbHealthy = false;
    }
    return {
      status: dbHealthy ? 'ok' : 'degraded',
      database: dbHealthy ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
