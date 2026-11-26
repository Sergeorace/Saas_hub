import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { TenantContextService } from './tenant-context';

export interface TenantRequest {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
  userId?: string | null;
  params?: Record<string, string | undefined>;
  requestId?: string;
}

export function readHeader(request: TenantRequest, header: string): string | null {
  const value = request.headers[header];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function deny(message: string): never {
  throw new ForbiddenException({ code: 'tenant_scope_denied', message });
}

/**
 * Vérifie trois invariants avant tout accès aux données :
 * 1. un tenant_id est fourni par la passerelle d'authentification ;
 * 2. il correspond au tenant de l'utilisateur authentifié (x-user-tenant) ;
 * 3. il correspond au tenant de la route, s'il est présent.
 */
const TENANT_HEADER = 'x-tenant-id';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly context: TenantContextService) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const request = executionContext.switchToHttp().getRequest<TenantRequest>();
    const tenantId = readHeader(request, TENANT_HEADER);
    if (!tenantId) deny('En-tête tenant_id absent.');

    const userTenant = readHeader(request, 'x-user-tenant');
    if (userTenant && userTenant !== tenantId) deny('Tenant incohérent avec le jeton.');

    const routeTenant = request.params?.tenantId;
    if (routeTenant && routeTenant !== tenantId) deny('Tenant de la route différent du jeton.');

    request.tenantId = tenantId;
    const store = this.context.current();
    if (store && store.tenantId !== tenantId) deny('Contexte de requête incohérent.');
    return true;
  }
}
