import { Module } from '@nestjs/common';
import { SERVICE_CONFIG, loadConfig } from './config';
import { HealthController } from './health.controller';
import { PingController } from './example/ping.controller';
import { AuditService } from './audit/audit.service';
import { DomainEventsService } from './events/domain-events.service';
import { EventsController } from './events/events.controller';
import { InternalKeyGuard } from './events/internal-key.guard';
import { TenantContextService } from './tenant/tenant-context';
import { TenantDatabase } from './tenant/tenant.database';
import { TenantGuard } from './tenant/tenant.guard';
import { TenantMiddleware } from './tenant/tenant.middleware';

@Module({
  controllers: [HealthController, PingController, EventsController],
  providers: [
    { provide: SERVICE_CONFIG, useFactory: () => loadConfig() },
    TenantContextService,
    TenantDatabase,
    TenantGuard,
    TenantMiddleware,
    InternalKeyGuard,
    DomainEventsService,
    AuditService,
  ],
  exports: [TenantContextService, TenantDatabase, DomainEventsService, AuditService],
})
export class AppModule {}
