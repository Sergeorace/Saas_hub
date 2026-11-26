import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
} from '@resto-hub/service-kit';
import { buildPaymentApp, handlePaymentEvent } from './app.js';
import { loadPaymentConfig } from './config.js';
import { createPaymentStore, seedPaymentDemo } from './store.js';

const config = loadPaymentConfig();
const store = createPaymentStore();
if (config.demoSeed) seedPaymentDemo(store);

const bus = createEventBus({
  name: 'payment-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
bus.on('OrderPaid', async (envelope) => {
  handlePaymentEvent(store, envelope.tenantId ?? String(envelope.payload.tenantId ?? ''), envelope);
});

const running = await startServer(
  {
    name: 'payment-service',
    routes: [
      ...buildPaymentApp({
        store,
        sandbox: config.sandbox,
        providerKeys: config.providerKeys,
        webhookSecrets: config.webhookSecrets,
        deps: {
          tenant: createServiceClient({
            baseUrl: config.tenantUrl,
            internalKey: config.internalKey,
          }),
          order: createServiceClient({ baseUrl: config.orderUrl, internalKey: config.internalKey }),
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

console.log(`payment-service à l'écoute sur ${running.url}`);
