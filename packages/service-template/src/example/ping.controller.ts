import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '../tenant/tenant-context';
import { TenantGuard } from '../tenant/tenant.guard';

/**
 * Route de démonstration du gabarit, remplacée par les routes métier du service généré.
 * Elle prouve que le contexte tenant est disponible et isolé.
 */
@ApiTags('template')
@ApiBearerAuth()
@ApiHeader({ name: 'x-tenant-id', required: true, description: 'Identifiant de l’établissement' })
@Controller('api/v1')
@UseGuards(TenantGuard)
export class PingController {
  constructor(private readonly context: TenantContextService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Vérifie le contexte tenant du service' })
  ping(): { ok: true; tenantId: string; requestId: string | null } {
    const store = this.context.current();
    return {
      ok: true,
      tenantId: this.context.requireTenantId(),
      requestId: store?.requestId ?? null,
    };
  }
}
