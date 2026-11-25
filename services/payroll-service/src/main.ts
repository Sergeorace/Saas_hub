import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildPayrollApp, handlePayrollEvent } from './app.js';
import { loadPayrollConfig } from './config.js';
import { createPayrollStore, seedPayrollDemo } from './store.js';

const config = loadPayrollConfig();
const store = createPayrollStore();
if (config.demoSeed) seedPayrollDemo(store);

const bus = createEventBus({
  name: 'payroll-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
bus.on('StaffUpdated', async (envelope) => {
  handlePayrollEvent(store, envelope.tenantId ?? '', envelope);
});
bus.on('RetentionDecided', async (envelope) => {
  handlePayrollEvent(store, envelope.tenantId ?? '', envelope);
});

const running = await startServer(
  {
    name: 'payroll-service',
    routes: [
      ...buildPayrollApp({
        store,
        staff: createServiceClient({ baseUrl: config.staffUrl, internalKey: config.internalKey }),
        payment: createServiceClient({ baseUrl: config.paymentUrl, internalKey: config.internalKey }),
        tenant: createServiceClient({ baseUrl: config.tenantUrl, internalKey: config.internalKey }),
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

console.log(`payroll-service à l'écoute sur ${running.url}`);
