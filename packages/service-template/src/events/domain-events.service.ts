import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

export interface DomainEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  type: string;
  tenantId: string | null;
  occurredAt: string;
  payload: TPayload;
}

/** Remplacé par le générateur avec les événements du service (cf. packages/shared-contracts). */
export const SERVICE_EVENT_ALLOWLIST: readonly string[] = [];

export function isDomainEventEnvelope(value: unknown): value is DomainEventEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const allowed =
    SERVICE_EVENT_ALLOWLIST.length === 0 ||
    SERVICE_EVENT_ALLOWLIST.includes(String(candidate.type));
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    allowed &&
    (candidate.tenantId === null || typeof candidate.tenantId === 'string') &&
    typeof candidate.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.occurredAt)) &&
    !!candidate.payload &&
    typeof candidate.payload === 'object' &&
    !Array.isArray(candidate.payload)
  );
}

type Handler = (event: DomainEventEnvelope) => Promise<void> | void;

/**
 * Publication/consommation d'événements métier.
 * - Les identifiants sont générés côté service et dédupliqués côté consommateur (inbox).
 * - En production, l'outbox est une table PostgreSQL dépouillée par un worker BullMQ ; ici,
 *   l'interface reste identique pour les tests du gabarit.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);
  private readonly handlers = new Map<string, Handler[]>();
  private readonly outbox: DomainEventEnvelope[] = [];
  private readonly processed = new Set<string>();

  publish(
    type: string,
    payload: Record<string, unknown>,
    tenantId: string | null,
  ): DomainEventEnvelope {
    const event: DomainEventEnvelope = {
      id: randomUUID(),
      type,
      tenantId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    if (!isDomainEventEnvelope(event)) throw new Error(`Événement invalide : ${type}`);
    this.outbox.push(event);
    return event;
  }

  on(type: string, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async deliver(event: unknown): Promise<{ status: 'accepted' | 'duplicate'; id: string }> {
    if (!isDomainEventEnvelope(event)) throw new Error('Enveloppe d’événement invalide.');
    if (this.processed.has(event.id)) return { status: 'duplicate', id: event.id };
    for (const handler of this.handlers.get(event.type) ?? []) {
      await handler(event);
    }
    this.processed.add(event.id);
    this.logger.log(`Événement consommé : ${event.type} (${event.id})`);
    return { status: 'accepted', id: event.id };
  }

  outboxFor(tenantId: string): DomainEventEnvelope[] {
    return this.outbox.filter((event) => event.tenantId === tenantId);
  }
}
