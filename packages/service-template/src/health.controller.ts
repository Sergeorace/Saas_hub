import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantDatabase } from './tenant/tenant.database';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly database: TenantDatabase) {}

  @Get('health')
  @ApiOperation({ summary: 'Sonde de liveness (toujours sans authentification)' })
  health(): { status: 'ok'; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: process.env.SERVICE_NAME ?? 'service-template',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Sonde de readiness : vérifie PostgreSQL si configuré' })
  async ready(): Promise<{ status: 'ready' | 'degraded'; database: string }> {
    const database = await this.database.ping();
    return {
      status: database ? 'ready' : 'degraded',
      database: database ? 'up' : 'not_configured_or_down',
    };
  }
}
