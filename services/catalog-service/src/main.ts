import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  startServer,
} from '@resto-hub/service-kit';
import { buildCatalogApp } from './app.js';
import { loadCatalogConfig } from './config.js';
import { createCatalogStore, seedCatalogDemo } from './store.js';

const config = loadCatalogConfig();
const store = createCatalogStore();
if (config.demoSeed) seedCatalogDemo(store);

const bus = createEventBus({
  name: 'catalog-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

const running = await startServer(
  {
    name: 'catalog-service',
    routes: [
      ...buildCatalogApp({
        store,
        timeZone: config.timeZone,
        publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
      }),
      createEventInboxRoute(bus),
    ],
    authenticate: createIntrospectionAuthenticator({
      identityUrl: config.identityUrl,
      internalKey: config.internalKey,
    }),
    internalKey: config.internalKey,
    corsOrigin: config.corsOrigin,
  },
  config.port,
);

console.log(`catalog-service à l'écoute sur ${running.url}`);
