import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';

@ApiTags('AI Providers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 401, description: 'Missing or invalid access token' })
@Controller('providers')
export class ProvidersController {
  constructor(private providersService: ProvidersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a new AI provider configuration (OpenAI / Claude / Gemini)' })
  @ApiResponse({ status: 201, description: 'Provider created; apiKeyPreview shows a masked key' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (missing/short apiKey, invalid enum, etc.)',
  })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateProviderDto) {
    return this.providersService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's configured AI providers" })
  @ApiResponse({ status: 200, description: 'Array of provider configs (keys never exposed)' })
  findAll(@CurrentUser('id') userId: string) {
    return this.providersService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single provider configuration' })
  @ApiResponse({ status: 200, description: 'Provider found' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.providersService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a provider configuration (label, model, key rotation, etc.)' })
  @ApiResponse({ status: 200, description: 'Provider updated' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a provider configuration' })
  @ApiResponse({ status: 200, description: 'Provider removed' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.providersService.remove(userId, id);
  }

  @Patch(':id/enable')
  @ApiOperation({ summary: 'Enable a provider' })
  @ApiResponse({ status: 200, description: 'Provider enabled' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  enable(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.providersService.setEnabled(userId, id, true);
  }

  @Patch(':id/disable')
  @ApiOperation({ summary: 'Disable a provider' })
  @ApiResponse({ status: 200, description: 'Provider disabled' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  disable(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.providersService.setEnabled(userId, id, false);
  }

  @Post(':id/health-check')
  @ApiOperation({ summary: "Ping the provider's API to confirm the stored key is valid" })
  @ApiResponse({ status: 200, description: '{ healthy: boolean, checkedAt: Date }' })
  @ApiResponse({ status: 404, description: 'Provider not found or not owned by this user' })
  healthCheck(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.providersService.healthCheck(userId, id);
  }
}
