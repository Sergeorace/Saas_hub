import {
  HttpError,
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
  type ServiceClient,
} from '@resto-hub/service-kit';
import { buildReportingApp, handleReportingEvent, type OrderSnapshot } from './app.js';
import { loadReportingConfig } from './config.js';
import { createReportingStore, seedReportingDemo } from './store.js';

const config = loadReportingConfig();
const store = createReportingStore();
if (config.demoSeed) seedReportingDemo(store);

const bus = createEventBus({
  name: 'reporting-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});

const order: ServiceClient = createServiceClient({ baseUrl: config.orderUrl, internalKey: config.internalKey });
const inventory: ServiceClient = createServiceClient({ baseUrl: config.inventoryUrl, internalKey: config.internalKey });
const floor: ServiceClient = createServiceClient({ baseUrl: config.floorUrl, internalKey: config.internalKey });

const options = {
  store,
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) =>
    bus.publish(type, tenantId, payload),
  readOrder: async (tenantId: string, orderId: string): Promise<OrderSnapshot | null> => {
    try {
      return await order.get<OrderSnapshot>(
        `/internal/tenants/${encodeURIComponent(tenantId)}/orders/${encodeURIComponent(orderId)}`,
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      return null;
    }
  },
  cogs: async (tenantId: string, from: string, to: string) => {
    const response = await inventory.get<{ cogsXof: number }>(
      `/internal/tenants/${encodeURIComponent(tenantId)}/inventory/cogs?from=${from}&to=${to}`,
    );
    return response.cogsXof;
  },
  capacity: async (tenantId: string) => {
    try {
      const response = await floor.get<{ seats: number; tables: number }>(
        `/internal/tenants/${encodeURIComponent(tenantId)}/floor/capacity`,
      );
      return { seats: response.seats, tables: response.tables };
    } catch {
      return null;
    }
  },
};

const HANDLED_EVENTS = [
  'OrderPaid',
  'RefundIssued',
  'PaymentFailed',
  'ReservationCreated',
  'PayrollPaid',
  'ReviewSubmitted',
  'ReviewModerated',
];

for (const type of HANDLED_EVENTS) {
  bus.on(type, async (envelope) => {
    await handleReportingEvent(options, envelope.tenantId ?? '', envelope);
  });
}

const running = await startServer(
  {
    name: 'reporting-service',
    routes: [...buildReportingApp(options), createEventInboxRoute(bus)],
    authenticate: createIntrospectionAuthenticator({
      identityUrl: config.identityUrl,
      internalKey: config.internalKey,
    }),
    internalKey: config.internalKey,
    corsOrigin: config.corsOrigin,
  },
  config.port,
);

console.log(`reporting-service à l'écoute sur ${running.url}`);
