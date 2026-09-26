import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AdminService } from './admin.service';
import { UsersService } from '../users/users.service';
import { UpdateUserRoleDto } from '../users/dto/update-user-role.dto';
import { OverrideSubscriptionDto } from './dto/override-subscription.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@ApiResponse({ status: 403, description: 'Authenticated but not an ADMIN' })
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private usersService: UsersService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Aggregate dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Counts of users, subscriptions, and usage' })
  dashboard() {
    return this.adminService.dashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users with subscription info' })
  users(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.usersService.findAll(Number(page) || 1, Number(pageSize) || 20);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user (admin view)' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  userDetail(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: "Change a user's role (USER / ADMIN)" })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  setRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.usersService.setRole(id, dto.role);
  }

  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend (deactivate) a user account' })
  @ApiResponse({ status: 200, description: 'Account suspended' })
  @ApiResponse({ status: 404, description: 'User not found' })
  suspend(@Param('id') id: string) {
    return this.usersService.setActive(id, false);
  }

  @Patch('users/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended user account' })
  @ApiResponse({ status: 200, description: 'Account reactivated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  reactivate(@Param('id') id: string) {
    return this.usersService.setActive(id, true);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Subscription overview across all users, grouped by plan and status' })
  @ApiResponse({ status: 200, description: 'Aggregate counts per plan/status combination' })
  subscriptions() {
    return this.adminService.subscriptionsOverview();
  }

  @Get('subscriptions/:userId')
  @ApiOperation({ summary: "Get a specific user's full subscription record" })
  @ApiResponse({ status: 200, description: 'Subscription found' })
  @ApiResponse({ status: 404, description: 'User has no subscription record' })
  getUserSubscription(@Param('userId') userId: string) {
    return this.adminService.getUserSubscription(userId);
  }

  @Patch('subscriptions/:userId')
  @ApiOperation({
    summary: "Override a specific user's subscription (plan, status, or daily limit)",
    description:
      'Direct admin control distinct from the self-service /subscriptions/* endpoints - e.g. ' +
      'to comp a Premium plan, correct a failed payment webhook, or force-cancel for abuse.',
  })
  @ApiResponse({ status: 200, description: 'Subscription updated' })
  @ApiResponse({ status: 404, description: 'User has no subscription record' })
  overrideSubscription(@Param('userId') userId: string, @Body() dto: OverrideSubscriptionDto) {
    return this.adminService.overrideUserSubscription(userId, dto);
  }

  @Get('providers')
  @ApiOperation({
    summary: 'AI provider overview across all users, grouped by provider and status',
  })
  @ApiResponse({ status: 200, description: 'Aggregate counts per provider/enabled combination' })
  providers() {
    return this.adminService.providersOverview();
  }

  @Get('users/:userId/providers')
  @ApiOperation({ summary: 'List every AI provider a specific user has configured' })
  @ApiResponse({ status: 200, description: "List of the user's providers (keys never exposed)" })
  listUserProviders(@Param('userId') userId: string) {
    return this.adminService.listUserProviders(userId);
  }

  @Patch('providers/:id/disable')
  @ApiOperation({ summary: "Force-disable any user's provider (e.g. reported abuse, leaked key)" })
  @ApiResponse({ status: 200, description: 'Provider disabled' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  disableProvider(@Param('id') id: string) {
    return this.adminService.adminSetProviderEnabled(id, false);
  }

  @Patch('providers/:id/enable')
  @ApiOperation({ summary: "Re-enable any user's provider" })
  @ApiResponse({ status: 200, description: 'Provider enabled' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  enableProvider(@Param('id') id: string) {
    return this.adminService.adminSetProviderEnabled(id, true);
  }

  @Delete('providers/:id')
  @ApiOperation({ summary: "Force-delete any user's provider configuration" })
  @ApiResponse({ status: 200, description: 'Provider removed' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  deleteProvider(@Param('id') id: string) {
    return this.adminService.adminDeleteProvider(id);
  }

  @Get('usage-analytics')
  @ApiOperation({ summary: 'API usage analytics grouped by day' })
  @ApiResponse({ status: 200, description: 'Per-day request counts, error counts, avg duration' })
  usageAnalytics(@Query('days') days?: string) {
    return this.adminService.usageAnalytics(Number(days) || 7);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Paginated raw request logs' })
  @ApiResponse({ status: 200, description: 'Paginated ApiUsageLog rows' })
  logs(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.adminService.requestLogs(Number(page) || 1, Number(pageSize) || 50);
  }

  @Get('system-health')
  @ApiOperation({ summary: 'System / database health check' })
  @ApiResponse({ status: 200, description: 'ok/degraded status, DB connectivity, uptime' })
  systemHealth() {
    return this.adminService.systemHealth();
  }
}
