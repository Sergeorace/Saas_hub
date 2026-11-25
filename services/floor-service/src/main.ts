import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  startServer,
} from '@resto-hub/service-kit';
import { buildFloorApp } from './app.js';
import { loadFloorConfig } from './config.js';
import { createFloorStore, seedFloorDemo } from './store.js';

const config = loadFloorConfig();
const store = createFloorStore();
if (config.demoSeed) seedFloorDemo(store);

const bus = createEventBus({
  name: 'floor-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

const running = await startServer(
  {
    name: 'floor-service',
    routes: [
      ...buildFloorApp({
        store,
        appPublicUrl: config.appPublicUrl,
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

console.log(`floor-service à l'écoute sur ${running.url}`);
