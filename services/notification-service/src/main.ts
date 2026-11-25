import {
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  startServer,
  type ServiceClient,
} from '@resto-hub/service-kit';
import { buildNotificationApp, handleNotificationEvent, type ContactInfo } from './app.js';
import { loadNotificationConfig } from './config.js';
import { createNotificationStore, seedNotificationDemo, type NotificationLocale } from './store.js';

const config = loadNotificationConfig();
const store = createNotificationStore();
if (config.demoSeed) seedNotificationDemo(store);

const bus = createEventBus({
  name: 'notification-service',
  internalKey: config.internalKey,
  subscribers: config.eventSubscribers,
});
const identity: ServiceClient = createServiceClient({ baseUrl: config.identityUrl, internalKey: config.internalKey });

const contactCache = new Map<string, { at: number; contact: ContactInfo | null }>();
async function resolveContact(userId: string): Promise<ContactInfo | null> {
  const cached = contactCache.get(userId);
  if (cached && Date.now() - cached.at < 60_000) return cached.contact;
  try {
    const response = await identity.get<{
      user: { id: string; name: string; email: string | null; phone: string | null; locale: string };
    }>(`/internal/users/${encodeURIComponent(userId)}/contacts`);
    const contact: ContactInfo = {
      name: response.user.name,
      email: response.user.email,
      phone: response.user.phone,
      locale: (response.user.locale === 'en' ? 'en' : 'fr') as NotificationLocale,
    };
    contactCache.set(userId, { at: Date.now(), contact });
    return contact;
  } catch {
    contactCache.set(userId, { at: Date.now(), contact: null });
    return null;
  }
}

const staffCache = new Map<string, { at: number; ids: Set<string> }>();
async function resolveStaff(tenantId: string): Promise<Set<string>> {
  const cached = staffCache.get(tenantId);
  if (cached && Date.now() - cached.at < 60_000) return cached.ids;
  try {
    const response = await identity.get<{ items: Array<{ userId: string; roles: string[] }> }>(
      `/internal/tenants/${encodeURIComponent(tenantId)}/members`,
    );
    const ids = new Set(
      response.items.filter((member) => member.roles.some((role) => role !== 'client')).map((member) => member.userId),
    );
    staffCache.set(tenantId, { at: Date.now(), ids });
    return ids;
  } catch {
    return new Set();
  }
}

const options = {
  store,
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => bus.publish(type, tenantId, payload),
  smsSecret: config.smsWebhookSecret,
  resolveContact,
  resolveStaff,
};

const HANDLED_EVENTS = [
  'OrderCreated',
  'OrderPaid',
  'PaymentFailed',
  'TableStatusChanged',
  'ReservationCreated',
  'StockBelowThreshold',
  'StockDepleted',
  'PayrollApproved',
  'PayrollPaid',
  'CampaignSent',
];

for (const type of HANDLED_EVENTS) {
  bus.on(type, async (envelope) => {
    await handleNotificationEvent(options, envelope.tenantId ?? '', envelope);
  });
}

const running = await startServer(
  {
    name: 'notification-service',
    routes: [...buildNotificationApp(options), createEventInboxRoute(bus)],
    authenticate: createIntrospectionAuthenticator({
      identityUrl: config.identityUrl,
      internalKey: config.internalKey,
    }),
    internalKey: config.internalKey,
    corsOrigin: config.corsOrigin,
  },
  config.port,
);

console.log(`notification-service à l'écoute sur ${running.url}`);
