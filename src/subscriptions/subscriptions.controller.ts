import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { ChangePlanDto } from './dto/change-plan.dto';

@ApiTags('Subscriptions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current subscription status' })
  @ApiResponse({ status: 200, description: 'Plan, status, and renewal/cancellation dates' })
  getStatus(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getStatus(userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current subscription status (alias)' })
  getStatusMe(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getStatus(userId);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get remaining requests for today' })
  @ApiResponse({ status: 200, description: 'Daily limit, requests used, and requests remaining' })
  getUsage(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getRemainingRequests(userId);
  }

  @Get('remaining')
  @ApiOperation({ summary: 'Get remaining requests for today (alias)' })
  @ApiResponse({ status: 200, description: 'Daily limit, requests used, and requests remaining' })
  getRemaining(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getRemainingRequests(userId);
  }

  @Patch('plan')
  @ApiOperation({ summary: 'Upgrade or downgrade subscription plan' })
  @ApiResponse({ status: 200, description: 'Plan changed; usage limits updated accordingly' })
  @ApiResponse({ status: 400, description: 'Validation failed (invalid plan value)' })
  changePlan(@CurrentUser('id') userId: string, @Body() dto: ChangePlanDto) {
    return this.subscriptionsService.changePlan(userId, dto.plan);
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upgrade subscription to PREMIUM' })
  @ApiResponse({ status: 200, description: 'Upgraded to PREMIUM' })
  upgrade(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.changePlan(userId, 'PREMIUM' as any);
  }

  @Post('downgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Downgrade subscription to FREE' })
  @ApiResponse({ status: 200, description: 'Downgraded to FREE' })
  downgrade(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.changePlan(userId, 'FREE' as any);
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel the current subscription (reverts to Free at period end)' })
  @ApiResponse({ status: 201, description: 'Subscription marked as canceled' })
  cancel(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.cancel(userId);
  }
}
