export enum PlanType {
  FREE = 'FREE',
  PREMIUM = 'PREMIUM',
}

export const PLAN_DAILY_LIMITS: Record<PlanType, number> = {
  [PlanType.FREE]: Number(process.env.FREE_PLAN_DAILY_LIMIT || 20),
  [PlanType.PREMIUM]: Number(process.env.PREMIUM_PLAN_DAILY_LIMIT || 1000),
};
