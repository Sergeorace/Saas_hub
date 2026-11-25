import { createHash } from 'node:crypto';
import { newId, nowIso } from './ids.js';

export interface AuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  tenantId: string | null;
  occurredAt: string;
  payload: T;
}

export interface OutboxRecord<T = Record<string, unknown>> extends DomainEvent<T> {
  publishedAt: string | null;
}

export function buildAuditEntry(input: {
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
  previousHash?: string;
}): AuditEntry {
  const createdAt = nowIso();
  const prevHash = input.previousHash ?? 'genesis';
  const canonical = JSON.stringify({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    meta: input.meta ?? {},
    createdAt,
    prevHash,
  });
  return {
    id: newId('aud'),
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    meta: input.meta ?? {},
    createdAt,
    prevHash,
    hash: createHash('sha256').update(canonical).digest('hex'),
  };
}

export function verifyAuditChain(entries: AuditEntry[]): boolean {
  let previous = 'genesis';
  for (const entry of entries) {
    if (entry.prevHash !== previous) return false;
    const canonical = JSON.stringify({
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt: entry.createdAt,
      prevHash: entry.prevHash,
    });
    const expected = createHash('sha256').update(canonical).digest('hex');
    if (expected !== entry.hash) return false;
    previous = entry.hash;
  }
  return true;
}

export function makeEvent<T>(type: string, tenantId: string | null, payload: T): OutboxRecord<T> {
  return {
    id: newId('evt'),
    type,
    tenantId,
    occurredAt: nowIso(),
    payload,
    publishedAt: null,
  };
}
