import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { PlanType } from '../../subscriptions/subscriptions.constants';

export enum AdminSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
}

/**
 * All fields are optional so an admin can patch just one attribute (e.g. only the
 * daily limit) without having to resend the user's whole subscription state.
 */
export class OverrideSubscriptionDto {
  @ApiPropertyOptional({ enum: PlanType, description: "Force the user's plan" })
  @IsOptional()
  @IsEnum(PlanType)
  plan?: PlanType;

  @ApiPropertyOptional({
    enum: AdminSubscriptionStatus,
    description: "Force the user's subscription status",
  })
  @IsOptional()
  @IsEnum(AdminSubscriptionStatus)
  status?: AdminSubscriptionStatus;

  @ApiPropertyOptional({ description: 'Override the daily request limit', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyLimit?: number;
}
