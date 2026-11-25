import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  startServer,
} from '@resto-hub/service-kit';
import { buildPlatformAdminApp } from './app.js';
import { loadPlatformAdminConfig } from './config.js';
import { applyPlatformEvent, createPlatformAdminStore, seedPlatformDemo } from './store.js';
import { checkAllServices } from './supervision.js';

const config = loadPlatformAdminConfig();
const store = createPlatformAdminStore();
if (config.demoSeed) seedPlatformDemo(store, config.services);
else for (const service of config.services) store.registerService(service.name, service.url);

const bus = createEventBus({
  name: 'platform-admin-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

const HANDLED_EVENTS = [
  'TenantApplicationSubmitted',
  'TenantApproved',
  'TenantApplicationRejected',
  'TenantSuspended',
  'TenantReactivated',
  'PaymentConfirmed',
  'PaymentFailed',
  'RefundIssued',
  'DisputeOpened',
  'DisputeResolved',
  'SettlementPaid',
  'SubscriptionInvoicePaid',
];

for (const type of HANDLED_EVENTS) {
  bus.on(type, (envelope) => applyPlatformEvent(store, envelope));
}

const running = await startServer(
  {
    name: 'platform-admin-service',
    routes: [
      ...buildPlatformAdminApp({
        store,
        publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
        checkServices: () => checkAllServices(store),
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

const runChecks = () => {
  void checkAllServices(store).catch((error) => {
    console.error('[platform-admin-service] contrôle de santé en échec', error);
  });
};
runChecks();
const timer = setInterval(runChecks, config.healthIntervalMs);
timer.unref();

console.log(`platform-admin-service à l'écoute sur ${running.url}`);
