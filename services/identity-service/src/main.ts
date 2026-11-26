import { createEventBus, createEventInboxRoute, startServer } from '@resto-hub/service-kit';
import { buildIdentityApp } from './app.js';
import { loadIdentityConfig } from './config.js';
import { createIdentityStore, seedDemo } from './store.js';

const config = loadIdentityConfig();
const store = createIdentityStore();
if (config.demoSeed) await seedDemo(store);

const bus = createEventBus({
  name: 'identity-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

bus.on('TenantSuspended', async (envelope) => {
  const tenantId = String(envelope.payload.tenantId ?? envelope.tenantId ?? '');
  if (!tenantId) return;
  const revoked = store.revokeTenantSessions(tenantId, 'tenant-service', 'tenant_suspended');
  console.log(
    `[identity-service] Établissement ${tenantId} suspendu : ${revoked} session(s) révoquée(s).`,
  );
});

bus.on('TenantApproved', async (envelope) => {
  console.log(
    `[identity-service] Établissement ${String(envelope.payload.tenantId ?? '')} validé (${String(
      envelope.payload.slug ?? '',
    )}).`,
  );
});

const { routes, authenticate } = buildIdentityApp({ store, config });

const running = await startServer(
  {
    name: 'identity-service',
    routes: [...routes, createEventInboxRoute(bus)],
    authenticate,
    internalKey: config.internalKey,
    corsOrigin: config.corsOrigin,
  },
  config.port,
);

console.log(`identity-service à l'écoute sur ${running.url}`);
if (config.demoSeed) {
  console.log(
    'Comptes de démonstration : admin@resto-hub.tg / Admin#2026 · gerant@sahelgrill.tg / Gerant#2026 · serveur@sahelgrill.tg / Serveur#2026',
  );
}
