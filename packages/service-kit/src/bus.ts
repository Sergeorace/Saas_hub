import type { Route } from './http.js';
import { makeEvent, type OutboxRecord } from './eventing.js';
import { isDomainEventEnvelope } from '@resto-hub/shared-contracts';

export interface EventEnvelope {
  id: string;
  type: string;
  tenantId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;

export interface EventBusOptions {
  name: string;
  internalKey: string;
  subscribers?: string[];
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface EventBus {
  publish: (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<OutboxRecord>;
  on: (type: string, handler: EventHandler) => void;
  deliver: (envelope: EventEnvelope) => Promise<void>;
  flush: () => Promise<void>;
  outbox: () => ReadonlyArray<OutboxRecord>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createEventBus(options: EventBusOptions): EventBus {
  const subscribers = options.subscribers ?? [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const outbox: OutboxRecord[] = [];
  const handlers = new Map<string, EventHandler[]>();
  let chain: Promise<void> = Promise.resolve();

  const deliver = async (envelope: EventEnvelope) => {
    const registered = handlers.get(envelope.type) ?? [];
    for (const handler of registered) {
      try {
        await handler(envelope);
      } catch (error) {
        console.error(`[${options.name}] handler ${envelope.type} en échec`, error);
      }
    }
  };

  const pushRemote = async (record: OutboxRecord) => {
    let delivered = subscribers.length === 0;
    for (const subscriber of subscribers) {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await fetchImpl(`${subscriber.replace(/\/$/, '')}/internal/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-key': options.internalKey },
            body: JSON.stringify({
              id: record.id,
              type: record.type,
              tenantId: record.tenantId,
              occurredAt: record.occurredAt,
              payload: record.payload,
            }),
          });
          if (response.ok) {
            delivered = true;
            break;
          }
        } catch {
          // le pair peut être indisponible ; on retente
        }
        if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
      }
      if (!delivered) {
        console.warn(`[${options.name}] événement ${record.type} non livré à ${subscriber}`);
      }
    }
    if (delivered) record.publishedAt = new Date().toISOString();
  };

  return {
    publish(type, tenantId, payload) {
      const record = makeEvent(type, tenantId, payload);
      outbox.push(record);
      chain = chain.then(() => pushRemote(record));
      return Promise.resolve(record);
    },
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    deliver,
    flush() {
      return chain;
    },
    outbox() {
      return outbox;
    },
  };
}

export function createEventInboxRoute(bus: EventBus): Route {
  return {
    method: 'POST',
    path: '/internal/events',
    service: true,
    handler: async (ctx) => {
      if (!isDomainEventEnvelope(ctx.body)) {
        return {
          status: 400,
          body: {
            error: { code: 'invalid_event', message: 'Événement invalide ou hors contrat.' },
          },
        };
      }
      const envelope = ctx.body as EventEnvelope;
      await bus.deliver(envelope);
      return { status: 202, body: { accepted: true, id: envelope.id } };
    },
  };
}
