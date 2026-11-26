import { randomUUID } from 'node:crypto';
import type { NextFunction } from 'express';
import { Injectable } from '@nestjs/common';
import { TenantContextService, type TenantStore } from './tenant-context';
import { readHeader, type TenantRequest } from './tenant.guard';

@Injectable()
export class TenantMiddleware {
  constructor(private readonly context: TenantContextService) {}

  use(request: TenantRequest, _response: unknown, next: NextFunction): void {
    const tenantId = readHeader(request, 'x-tenant-id');
    const store: TenantStore = {
      tenantId: tenantId ?? '',
      userId: readHeader(request, 'x-user-id'),
      requestId: readHeader(request, 'x-request-id') ?? randomUUID(),
    };
    this.context.run(store, () => next());
  }
}
