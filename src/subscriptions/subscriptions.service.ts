import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_DAILY_LIMITS, PlanType } from './subscriptions.constants';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  async getStatus(userId: string) {
    const sub = await this.getOrCreate(userId);
    await this.resetUsageIfNewDay(sub);
    return this.prisma.subscription.findUnique({ where: { userId } });
  }

  async changePlan(userId: string, plan: PlanType) {
    await this.getOrCreate(userId);
    return this.prisma.subscription.update({
      where: { userId },
      data: {
        plan,
        dailyLimit: PLAN_DAILY_LIMITS[plan],
        status: 'ACTIVE',
        renewsAt: plan === PlanType.PREMIUM ? this.addDays(new Date(), 30) : null,
        canceledAt: null,
      },
    });
  }

  async cancel(userId: string) {
    await this.getOrCreate(userId);
    return this.prisma.subscription.update({
      where: { userId },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
  }

  async getRemainingRequests(userId: string) {
    const sub = await this.getOrCreate(userId);
    await this.resetUsageIfNewDay(sub);
    const fresh = await this.prisma.subscription.findUnique({ where: { userId } });
    return {
      plan: fresh!.plan,
      dailyLimit: fresh!.dailyLimit,
      requestsUsed: fresh!.requestsUsed,
      remaining: Math.max(fresh!.dailyLimit - fresh!.requestsUsed, 0),
      resetsAt: fresh!.usageResetAt,
    };
  }

  /**
   * Consumes one unit of usage. Called by the Chat/Search modules before
   * fulfilling a request. Returns false when the user is over their limit.
   */
  async tryConsumeUsage(userId: string): Promise<boolean> {
    const sub = await this.getOrCreate(userId);
    await this.resetUsageIfNewDay(sub);
    const fresh = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!fresh || fresh.status !== 'ACTIVE') return false;
    if (fresh.requestsUsed >= fresh.dailyLimit) return false;

    await this.prisma.subscription.update({
      where: { userId },
      data: { requestsUsed: { increment: 1 } },
    });
    return true;
  }

  private async getOrCreate(userId: string) {
    let sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      sub = await this.prisma.subscription.create({
        data: { userId, plan: 'FREE', dailyLimit: PLAN_DAILY_LIMITS[PlanType.FREE] },
      });
    }
    return sub;
  }

  private async resetUsageIfNewDay(sub: { userId: string; usageResetAt: Date }) {
    const now = new Date();
    const last = new Date(sub.usageResetAt);
    const isNewDay =
      now.getUTCFullYear() !== last.getUTCFullYear() ||
      now.getUTCMonth() !== last.getUTCMonth() ||
      now.getUTCDate() !== last.getUTCDate();

    if (isNewDay) {
      await this.prisma.subscription.update({
        where: { userId: sub.userId },
        data: { requestsUsed: 0, usageResetAt: now },
      });
    }
  }

  private addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
}
