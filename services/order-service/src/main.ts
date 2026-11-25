import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildOrderApp } from './app.js';
import { loadOrderConfig } from './config.js';
import { createOrderStore, seedOrderDemo } from './store.js';

const config = loadOrderConfig();
const store = createOrderStore();
if (config.demoSeed) seedOrderDemo(store);

const bus = createEventBus({
  name: 'order-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

const client = (baseUrl: string) => createServiceClient({ baseUrl, internalKey: config.internalKey });

const running = await startServer(
  {
    name: 'order-service',
    routes: [
      ...buildOrderApp({
        store,
        vatRate: config.vatRate,
        timeZone: config.timeZone,
        appPublicUrl: config.appPublicUrl,
        deps: {
          catalog: client(config.catalogUrl),
          floor: client(config.floorUrl),
          tenant: client(config.tenantUrl),
        },
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

console.log(`order-service à l'écoute sur ${running.url}`);
