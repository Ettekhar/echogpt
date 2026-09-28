import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Public system liveness and health check endpoint' })
  @ApiResponse({ status: 200, description: 'Liveness status, uptime and current server time' })
  healthCheck() {
    return {
      status: 'ok',
      service: 'EchoGPT Backend API',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
