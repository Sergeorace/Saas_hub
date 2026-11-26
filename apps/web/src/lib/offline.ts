import { ApiError, orderApi, type CreateOrderInput, type Order } from './api';

const STORAGE_KEY = 'restohub.orderQueue.v1';

export interface QueuedOrder {
  id: string;
  tenantId: string;
  payload: CreateOrderInput;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  conflicted?: boolean;
}

function read(): QueuedOrder[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: QueuedOrder[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* stockage plein ou indisponible : la file reste en mémoire de session */
  }
}

export function queuedOrders(tenantId?: string): QueuedOrder[] {
  const list = read();
  return tenantId ? list.filter((entry) => entry.tenantId === tenantId) : list;
}

export function clientRequestId(tenantId: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `of-${tenantId}-${Date.now()}-${random}`;
}

export interface EnqueueResult {
  item: QueuedOrder;
  error?: string;
}

export function enqueueOrder(
  tenantId: string,
  payload: CreateOrderInput,
  error?: string,
): QueuedOrder {
  const item: QueuedOrder = {
    id: clientRequestId(tenantId),
    tenantId,
    payload: { ...payload, clientRequestId: payload.clientRequestId ?? clientRequestId(tenantId) },
    queuedAt: new Date().toISOString(),
    attempts: 1,
    lastError: error,
  };
  write([...read(), item]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('restohub:queue-changed'));
  }
  return item;
}

export function removeQueued(id: string) {
  write(read().filter((entry) => entry.id !== id));
  window.dispatchEvent(new CustomEvent('restohub:queue-changed'));
}

export interface SyncOutcome {
  synced: Array<{ queued: QueuedOrder; order: Order }>;
  conflicts: QueuedOrder[];
  pending: QueuedOrder[];
}

export function isTransportError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0;
  return error instanceof TypeError;
}

export async function syncQueue(tenantId: string): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { synced: [], conflicts: [], pending: [] };
  const list = read();
  const mine = list.filter((entry) => entry.tenantId === tenantId);
  if (mine.length === 0) return outcome;
  // Un conflit de validation n'est jamais rejoué automatiquement : il attend
  // une décision humaine (retrait de la file) pour éviter une boucle d'erreurs.
  const remaining: QueuedOrder[] = list.filter(
    (entry) => entry.tenantId !== tenantId || entry.conflicted,
  );

  for (const entry of mine.filter((queued) => !queued.conflicted)) {
    try {
      const result = await orderApi.create(tenantId, entry.payload);
      outcome.synced.push({ queued: entry, order: result.order });
    } catch (error) {
      if (isTransportError(error)) {
        outcome.pending.push(entry);
        remaining.push(entry);
        continue;
      }
      const message = error instanceof ApiError ? error.message : 'Erreur inconnue.';
      const updated: QueuedOrder = {
        ...entry,
        attempts: entry.attempts + 1,
        lastError: message,
        conflicted: true,
      };
      outcome.conflicts.push(updated);
      remaining.push(updated);
    }
  }

  write(remaining);
  window.dispatchEvent(new CustomEvent('restohub:queue-changed'));
  return outcome;
}
