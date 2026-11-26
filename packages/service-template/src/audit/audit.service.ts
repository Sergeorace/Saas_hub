import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  const material = [
    entry.id,
    entry.prevHash,
    entry.tenantId,
    entry.actorId ?? '',
    entry.action,
    JSON.stringify(entry.payload),
    entry.createdAt,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Journal d'audit à chaîne de hachage (append-only). En production, les entrées sont
 * également écrites dans `app.audit_log` (RLS + trigger d'immuabilité, voir rls.sql).
 */
@Injectable()
export class AuditService {
  private readonly entries: AuditEntry[] = [];

  record(
    tenantId: string,
    actorId: string | null,
    action: string,
    payload: Record<string, unknown> = {},
  ): AuditEntry {
    if (!tenantId) throw new Error('tenant_id obligatoire pour journaliser une action.');
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS;
    const draft = {
      id: randomUUID(),
      tenantId,
      actorId,
      action,
      payload,
      createdAt: new Date().toISOString(),
      prevHash,
    };
    const entry: AuditEntry = { ...draft, hash: hashEntry(draft) };
    this.entries.push(entry);
    return entry;
  }

  list(tenantId: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.tenantId === tenantId);
  }

  verifyChain(entries: AuditEntry[] = this.entries): { valid: boolean; brokenAt: string | null } {
    let prev = GENESIS;
    for (const entry of entries) {
      if (entry.prevHash !== prev) return { valid: false, brokenAt: entry.id };
      const { hash, ...rest } = entry;
      if (hashEntry(rest) !== hash) return { valid: false, brokenAt: entry.id };
      prev = hash;
    }
    return { valid: true, brokenAt: null };
  }
}
