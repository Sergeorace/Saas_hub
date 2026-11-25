import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildLoyaltyApp, handleLoyaltyEvent } from './app.js';
import { loadLoyaltyConfig } from './config.js';
import { createLoyaltyStore, seedLoyaltyDemo } from './store.js';

const config = loadLoyaltyConfig();
const store = createLoyaltyStore();
if (config.demoSeed) seedLoyaltyDemo(store);

const bus = createEventBus({
  name: 'loyalty-marketing-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
bus.on('OrderPaid', async (envelope) => {
  handleLoyaltyEvent(store, envelope);
});

const running = await startServer(
  {
    name: 'loyalty-marketing-service',
    routes: [
      ...buildLoyaltyApp({
        store,
        order: createServiceClient({ baseUrl: config.orderUrl, internalKey: config.internalKey }),
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

console.log(`loyalty-marketing-service à l'écoute sur ${running.url}`);
