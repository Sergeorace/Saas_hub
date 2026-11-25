import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildInventoryApp, createOrderLineReader, handleInventoryEvent } from './app.js';
import { loadInventoryConfig } from './config.js';
import { createInventoryStore, seedInventoryDemo } from './store.js';

const config = loadInventoryConfig();
const store = createInventoryStore();
if (config.demoSeed) seedInventoryDemo(store);

const bus = createEventBus({
  name: 'inventory-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
const readOrderLines = createOrderLineReader(
  createServiceClient({ baseUrl: config.orderUrl, internalKey: config.internalKey }),
);
bus.on('OrderPaid', async (envelope) => {
  await handleInventoryEvent(
    store,
    envelope.tenantId ?? '',
    envelope,
    (type, tenantId, payload) => bus.publish(type, tenantId, payload),
    readOrderLines,
  );
});

const running = await startServer(
  {
    name: 'inventory-service',
    routes: [
      ...buildInventoryApp({
        store,
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

console.log(`inventory-service à l'écoute sur ${running.url}`);
