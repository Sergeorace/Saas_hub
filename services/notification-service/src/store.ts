import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';
import {
  renderTemplate,
  TEMPLATE_SEEDS,
  type TemplateChannel,
  type TemplateLocale,
} from './templates.js';

export type NotificationChannel = TemplateChannel | 'realtime';
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'read' | 'supprime';
export type NotificationLocale = TemplateLocale;
export type RoomName = 'floor' | 'kds' | 'bar' | 'pos' | 'admin';

export const ROOMS: RoomName[] = ['floor', 'kds', 'bar', 'pos', 'admin'];

export interface MessageTemplate {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  channel: TemplateChannel;
  locale: TemplateLocale;
  subject: string | null;
  body: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DeliveryAttempt {
  at: string;
  provider: string;
  status: 'sent' | 'failed' | 'delivered';
  messageId: string | null;
  error: string | null;
}

export interface NotificationRecord {
  id: string;
  tenantId: string;
  userId: string | null;
  recipient: string;
  recipientName: string | null;
  channel: NotificationChannel;
  templateCode: string | null;
  subject: string | null;
  body: string;
  status: NotificationStatus;
  attempts: DeliveryAttempt[];
  room: RoomName | null;
  eventId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

export interface RoomMessage {
  id: string;
  tenantId: string;
  room: RoomName;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  at: string;
}

export interface DeviceToken {
  id: string;
  tenantId: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  createdAt: string;
  lastSeenAt: string;
}

export interface NotificationPreference {
  tenantId: string;
  userId: string;
  sms: boolean;
  email: boolean;
  push: boolean;
  locale: NotificationLocale;
  quietFrom: string | null;
  quietTo: string | null;
  updatedAt: string;
}

export interface NotificationStore {
  templates: Map<string, MessageTemplate>;
  notifications: Map<string, NotificationRecord>;
  rooms: RoomMessage[];
  devices: Map<string, DeviceToken>;
  preferences: Map<string, NotificationPreference>;
  idempotency: Set<string>;
  handledEvents: Set<string>;
  sequence: number;
  audit: AuditEntry[];
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export function createNotificationStore(): NotificationStore {
  const store: NotificationStore = {
    templates: new Map(),
    notifications: new Map(),
    rooms: [],
    devices: new Map(),
    preferences: new Map(),
    idempotency: new Set(),
    handledEvents: new Set(),
    sequence: 0,
    audit: [],
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
  };
  return store;
}

export function preferenceKey(tenantId: string, userId: string): string {
  return `${tenantId}::${userId}`;
}

export function defaultPreference(tenantId: string, userId: string): NotificationPreference {
  return {
    tenantId,
    userId,
    sms: true,
    email: true,
    push: true,
    locale: 'fr',
    quietFrom: null,
    quietTo: null,
    updatedAt: nowIso(),
  };
}

export function getPreference(
  store: NotificationStore,
  tenantId: string,
  userId: string,
): NotificationPreference {
  const key = preferenceKey(tenantId, userId);
  const existing = store.preferences.get(key);
  if (existing) return existing;
  const created = defaultPreference(tenantId, userId);
  store.preferences.set(key, created);
  return created;
}

export function inQuietHours(from: string | null, to: string | null, date = new Date()): boolean {
  if (!from || !to) return false;
  const parse = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null || start === end) return false;
  const current = date.getUTCHours() * 60 + date.getUTCMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function findTemplate(
  store: NotificationStore,
  tenantId: string,
  code: string,
  channel: TemplateChannel,
  locale: NotificationLocale,
): MessageTemplate | undefined {
  const candidates = [...store.templates.values()].filter(
    (entry) => entry.code === code && entry.channel === channel,
  );
  const pick = (tenantId: string | null, locale: NotificationLocale) =>
    candidates.find((entry) => entry.tenantId === tenantId && entry.locale === locale);
  return pick(tenantId, locale) ?? pick(tenantId, 'fr') ?? pick(null, locale) ?? pick(null, 'fr');
}

export function simulateDelivery(
  channel: TemplateChannel,
  recipient: string,
): { ok: false; error: string } | { ok: true } {
  if (channel === 'sms' && recipient.replace(/\s/g, '').startsWith('000')) {
    return { ok: false, error: 'destinataire_sms_invalide' };
  }
  if (channel === 'email' && recipient.toLowerCase().includes('invalid')) {
    return { ok: false, error: 'adresse_email_invalide' };
  }
  if (channel === 'push' && recipient.startsWith('invalid')) {
    return { ok: false, error: 'jeton_push_invalide' };
  }
  return { ok: true };
}

export function pushRoomMessage(
  store: NotificationStore,
  input: {
    tenantId: string;
    room: RoomName;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    at?: string;
  },
): RoomMessage {
  const message: RoomMessage = {
    id: newId('rt'),
    tenantId: input.tenantId,
    room: input.room,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data ?? {},
    at: input.at ?? nowIso(),
  };
  store.rooms.push(message);
  if (store.rooms.length > 1000) store.rooms.splice(0, store.rooms.length - 1000);
  return message;
}

export interface SendInput {
  tenantId: string;
  userId: string | null;
  recipient: string;
  recipientName?: string | null;
  channel: TemplateChannel;
  templateCode?: string | null;
  subject?: string | null;
  body?: string | null;
  data?: Record<string, unknown>;
  room?: RoomName | null;
  eventId?: string | null;
  kind?: 'transactional' | 'marketing';
  locale?: NotificationLocale;
  now?: string;
}

export function sendNotification(
  store: NotificationStore,
  input: SendInput,
): { record: NotificationRecord; duplicate: boolean } {
  const now = input.now ?? nowIso();
  const idempotencyKey =
    input.eventId && input.userId
      ? `${input.tenantId}::${input.eventId}::${input.userId}::${input.channel}`
      : null;
  if (idempotencyKey && store.idempotency.has(idempotencyKey)) {
    const existing = [...store.notifications.values()].find(
      (entry) =>
        entry.tenantId === input.tenantId &&
        entry.eventId === input.eventId &&
        entry.userId === input.userId &&
        entry.channel === input.channel,
    );
    if (existing) return { record: existing, duplicate: true };
  }

  const preference = input.userId ? getPreference(store, input.tenantId, input.userId) : null;
  const locale: NotificationLocale = input.locale ?? preference?.locale ?? 'fr';
  const template = input.templateCode
    ? findTemplate(store, input.tenantId, input.templateCode, input.channel, locale)
    : undefined;
  if (input.templateCode && !template) {
    throw Object.assign(new Error('template_not_found'), { code: 'template_not_found' });
  }
  const data = { ...(input.data ?? {}) };
  const body = renderTemplate(input.body ?? template?.body ?? '', data);
  const subject =
    input.subject ?? (template?.subject ? renderTemplate(template.subject, data) : null);

  const record: NotificationRecord = {
    id: newId('ntf'),
    tenantId: input.tenantId,
    userId: input.userId,
    recipient: input.recipient,
    recipientName: input.recipientName ?? null,
    channel: input.channel,
    templateCode: input.templateCode ?? null,
    subject,
    body,
    status: 'queued',
    attempts: [],
    room: input.room ?? null,
    eventId: input.eventId ?? null,
    data,
    createdAt: now,
    sentAt: null,
    readAt: null,
  };
  store.notifications.set(record.id, record);
  if (idempotencyKey) store.idempotency.add(idempotencyKey);

  const optedOut = preference ? preference[input.channel] === false : false;
  const quiet =
    input.kind === 'marketing' &&
    preference &&
    inQuietHours(preference.quietFrom, preference.quietTo, new Date(now));
  if (optedOut || quiet) {
    record.status = 'supprime';
    record.data = { ...data, suppression: optedOut ? 'preference_desactivee' : 'heures_calmes' };
    return { record, duplicate: false };
  }

  store.sequence += 1;
  const messageId = `${input.channel.toUpperCase()}-${String(store.sequence).padStart(6, '0')}`;
  const delivery = simulateDelivery(input.channel, input.recipient);
  record.attempts.push({
    at: now,
    provider:
      input.channel === 'sms'
        ? 'agrégateur-sms'
        : input.channel === 'email'
          ? 'smtp-transactionnel'
          : 'fcm-push',
    status: delivery.ok ? 'sent' : 'failed',
    messageId: delivery.ok ? messageId : null,
    error: delivery.ok ? null : delivery.error,
  });
  if (delivery.ok) {
    record.status = 'sent';
    record.sentAt = now;
  } else {
    record.status = 'failed';
  }
  if (input.room) {
    pushRoomMessage(store, {
      tenantId: input.tenantId,
      room: input.room,
      type: 'notification',
      title: subject ?? input.templateCode ?? 'Notification',
      body,
      data: { notificationId: record.id, ...data },
      at: now,
    });
  }
  return { record, duplicate: false };
}

export function retryNotification(
  store: NotificationStore,
  record: NotificationRecord,
): NotificationRecord {
  if (record.channel === 'realtime') return record;
  const now = nowIso();
  store.sequence += 1;
  const messageId = `${record.channel.toUpperCase()}-${String(store.sequence).padStart(6, '0')}`;
  const delivery = simulateDelivery(record.channel, record.recipient);
  record.attempts.push({
    at: now,
    provider:
      record.channel === 'sms'
        ? 'agrégateur-sms'
        : record.channel === 'email'
          ? 'smtp-transactionnel'
          : 'fcm-push',
    status: delivery.ok ? 'sent' : 'failed',
    messageId: delivery.ok ? messageId : null,
    error: delivery.ok ? null : delivery.error,
  });
  record.status = delivery.ok ? 'sent' : 'failed';
  record.sentAt = delivery.ok ? now : record.sentAt;
  return record;
}

export function seedNotificationDemo(store: NotificationStore): void {
  if (store.templates.size > 0) return;
  const now = nowIso();
  for (const seed of TEMPLATE_SEEDS) {
    const template: MessageTemplate = {
      id: `tpl_${seed.code.toLowerCase()}_${seed.locale}`,
      tenantId: null,
      code: seed.code,
      name: seed.name,
      channel: seed.channel,
      locale: seed.locale,
      subject: seed.subject,
      body: seed.body,
      updatedAt: now,
      updatedBy: 'usr_demo_seed',
    };
    store.templates.set(template.id, template);
  }

  const tenantId = 'tnt_sahelgrill';
  const devices: DeviceToken[] = [
    {
      id: 'dev_demo_gerant',
      tenantId,
      userId: 'usr_gerant_sahel',
      token: 'tok_demo_gerant_sahel',
      platform: 'web',
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: 'dev_demo_client',
      tenantId,
      userId: 'usr_demo_visiteur',
      token: 'tok_demo_client_visiteur',
      platform: 'android',
      createdAt: now,
      lastSeenAt: now,
    },
  ];
  for (const device of devices) store.devices.set(device.id, device);

  store.preferences.set(preferenceKey(tenantId, 'usr_demo_visiteur'), {
    ...defaultPreference(tenantId, 'usr_demo_visiteur'),
    quietFrom: '22:00',
    quietTo: '07:00',
  });
  store.preferences.set(preferenceKey(tenantId, 'usr_gerant_sahel'), {
    ...defaultPreference(tenantId, 'usr_gerant_sahel'),
    sms: false,
  });

  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  sendNotification(store, {
    tenantId,
    userId: 'usr_demo_visiteur',
    recipient: 'akouvi.demo@example.tg',
    recipientName: 'Akouvi M.',
    channel: 'email',
    templateCode: 'WELCOME',
    data: { name: 'Akouvi', tenantName: 'Sahel Grill' },
    kind: 'transactional',
    now: daysAgo(6),
  });
  sendNotification(store, {
    tenantId,
    userId: 'usr_gerant_sahel',
    recipient: 'tok_demo_gerant_sahel',
    recipientName: 'Gérant Sahel',
    channel: 'push',
    templateCode: 'STOCK_ALERT',
    data: { name: 'Tomates fraîches', quantity: 7.5, unit: 'kg', threshold: 8 },
    room: 'admin',
    kind: 'transactional',
    now: daysAgo(1),
  });
  sendNotification(store, {
    tenantId,
    userId: null,
    recipient: '+228 90 12 34 56',
    recipientName: 'Client table T5',
    channel: 'sms',
    templateCode: 'RESERVATION_REMINDER',
    data: { tableCode: 'T5', time: '19:30', tenantName: 'Sahel Grill' },
    kind: 'transactional',
    now: daysAgo(3),
  });

  pushRoomMessage(store, {
    tenantId,
    room: 'floor',
    type: 'order_created',
    title: 'Nouvelle commande',
    body: 'CMD-2026-000004 · Table T5 · 2 articles',
    data: { orderId: 'ord_demo_4', tableCode: 'T5' },
    at: daysAgo(2),
  });
  pushRoomMessage(store, {
    tenantId,
    room: 'kds',
    type: 'order_created',
    title: 'Ticket cuisine',
    body: 'CMD-2026-000004 · 2 articles à préparer',
    data: { orderId: 'ord_demo_4' },
    at: daysAgo(2),
  });
  pushRoomMessage(store, {
    tenantId,
    room: 'pos',
    type: 'order_paid',
    title: 'Addition réglée',
    body: 'CMD-2026-000004 · 9 000 F CFA · TMoney',
    data: { orderId: 'ord_demo_4', method: 'tmoney' },
    at: daysAgo(2),
  });

  store.recordAudit({
    tenantId: null,
    actorId: 'usr_demo_seed',
    action: 'notifications.seeded',
    targetType: 'notifications',
    targetId: 'demo',
    meta: {
      templates: store.templates.size,
      notifications: store.notifications.size,
      devices: devices.length,
    },
  });
}
