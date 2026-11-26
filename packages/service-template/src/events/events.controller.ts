import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DomainEventsService, isDomainEventEnvelope } from './domain-events.service';
import { InternalKeyGuard } from './internal-key.guard';

@ApiTags('internal')
@ApiHeader({ name: 'x-internal-key', required: true, description: 'Clé partagée entre services' })
@Controller('internal/events')
@UseGuards(InternalKeyGuard)
export class EventsController {
  constructor(private readonly events: DomainEventsService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Réception idempotente d’un événement métier (inbox)' })
  @ApiResponse({ status: 202, description: 'Événement accepté ou déjà traité' })
  @ApiResponse({ status: 400, description: 'Enveloppe hors contrat' })
  @ApiResponse({ status: 401, description: 'Clé interne invalide' })
  async receive(@Body() body: unknown): Promise<{ accepted: true; status: string; id: string }> {
    if (!isDomainEventEnvelope(body)) {
      throw new BadRequestException({
        code: 'invalid_event',
        message: 'Événement invalide ou hors contrat.',
      });
    }
    const result = await this.events.deliver(body);
    return { accepted: true, ...result };
  }
}
