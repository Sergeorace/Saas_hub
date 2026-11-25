import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  startServer,
} from '@resto-hub/service-kit';
import { buildStaffApp, handleStaffEvent } from './app.js';
import { loadStaffConfig } from './config.js';
import { createStaffStore, seedStaffDemo } from './store.js';

const config = loadStaffConfig();
const store = createStaffStore();
if (config.demoSeed) seedStaffDemo(store);

const bus = createEventBus({
  name: 'staff-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
bus.on('OrderPaid', async (envelope) => {
  handleStaffEvent(store, envelope.tenantId ?? '', envelope);
});
bus.on('TipDistributed', async (envelope) => {
  handleStaffEvent(store, envelope.tenantId ?? '', envelope);
});

const running = await startServer(
  {
    name: 'staff-service',
    routes: [
      ...buildStaffApp({
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

console.log(`staff-service à l'écoute sur ${running.url}`);
