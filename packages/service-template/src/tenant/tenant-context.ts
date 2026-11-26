import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface TenantStore {
  tenantId: string;
  userId: string | null;
  requestId: string | null;
}

export class TenantContextMissingError extends Error {
  constructor() {
    super('Aucun tenant_id dans le contexte de requête.');
    this.name = 'TenantContextMissingError';
  }
}

/**
 * Contexte de requête isolé : le tenant_id n'est jamais lu depuis un corps de requête,
 * uniquement depuis l'en-tête validé par le TenantGuard/middleware.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantStore>();

  run<T>(store: TenantStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  current(): TenantStore | undefined {
    return this.storage.getStore();
  }

  requireTenantId(): string {
    const store = this.storage.getStore();
    if (!store?.tenantId) throw new TenantContextMissingError();
    return store.tenantId;
  }
}
