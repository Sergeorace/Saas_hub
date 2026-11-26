import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildTenantApp } from './app.js';
import { loadTenantConfig } from './config.js';
import { createTenantStore, seedTenantDemo } from './store.js';

const config = loadTenantConfig();
const store = createTenantStore();
if (config.demoSeed) seedTenantDemo(store);

const bus = createEventBus({
  name: 'tenant-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

bus.on('SubscriptionInvoicePaid', async (envelope) => {
  console.log(`[tenant-service] Facture payée pour ${String(envelope.payload.tenantId ?? '')}.`);
});

const identity = createServiceClient({
  baseUrl: config.identityUrl,
  internalKey: config.internalKey,
});
const catalog = createServiceClient({
  baseUrl: config.catalogUrl,
  internalKey: config.internalKey,
});
const routes = buildTenantApp({
  store,
  config,
  identity,
  catalog,
  publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
});

const running = await startServer(
  {
    name: 'tenant-service',
    routes: [...routes, createEventInboxRoute(bus)],
    authenticate: createIntrospectionAuthenticator({
      identityUrl: config.identityUrl,
      internalKey: config.internalKey,
    }),
    internalKey: config.internalKey,
    corsOrigin: config.corsOrigin,
  },
  config.port,
);

console.log(`tenant-service à l'écoute sur ${running.url}`);
