import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { TenantContextService } from '../src/tenant/tenant-context';
import { TenantGuard, type TenantRequest } from '../src/tenant/tenant.guard';
import { TenantMiddleware } from '../src/tenant/tenant.middleware';

function contextFor(request: TenantRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function request(
  headers: Record<string, string>,
  params: Record<string, string> = {},
): TenantRequest {
  return { headers, params };
}

function denialCode(error: unknown): string | undefined {
  if (!(error instanceof ForbiddenException)) return undefined;
  const response = error.getResponse() as { code?: string };
  return response.code;
}

test('isolation : un tenant différent du jeton est refusé en 403 tenant_scope_denied', () => {
  const guard = new TenantGuard(new TenantContextService());
  const ctx = contextFor(
    request({ 'x-tenant-id': 'tnt_baobab', 'x-user-tenant': 'tnt_sahelgrill' }),
  );
  assert.throws(
    () => guard.canActivate(ctx),
    (error) => denialCode(error) === 'tenant_scope_denied',
  );
});

test('isolation : un tenant de route différent de l’en-tête est refusé', () => {
  const guard = new TenantGuard(new TenantContextService());
  const ctx = contextFor(request({ 'x-tenant-id': 'tnt_sahelgrill' }, { tenantId: 'tnt_baobab' }));
  assert.throws(
    () => guard.canActivate(ctx),
    (error) => denialCode(error) === 'tenant_scope_denied',
  );
});

test('isolation : sans en-tête tenant, la requête est refusée', () => {
  const guard = new TenantGuard(new TenantContextService());
  assert.throws(
    () => guard.canActivate(contextFor(request({}))),
    (error) => denialCode(error) === 'tenant_scope_denied',
  );
});

test('isolation : le contexte de requête ne peut pas être contredit par l’en-tête', () => {
  const service = new TenantContextService();
  const guard = new TenantGuard(service);
  service.run({ tenantId: 'tnt_baobab', userId: null, requestId: null }, () => {
    assert.throws(
      () => guard.canActivate(contextFor(request({ 'x-tenant-id': 'tnt_sahelgrill' }))),
      (error) => denialCode(error) === 'tenant_scope_denied',
    );
  });
});

test('contexte : le tenant_id valide est propagé dans AsyncLocalStorage', () => {
  const service = new TenantContextService();
  const middleware = new TenantMiddleware(service);
  let observed: string | null = null;
  middleware.use(request({ 'x-tenant-id': 'tnt_sahelgrill', 'x-user-id': 'usr_1' }), {}, () => {
    observed = service.requireTenantId();
  });
  assert.equal(observed, 'tnt_sahelgrill');
  assert.equal(service.current(), undefined);
});

test('contexte : hors requête, requireTenantId échoue explicitement', () => {
  const service = new TenantContextService();
  assert.throws(() => service.requireTenantId(), /tenant_id/);
});
