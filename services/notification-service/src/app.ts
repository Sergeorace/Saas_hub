import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  HttpError,
  asObject,
  optionalString,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import {
  ROOMS,
  getPreference,
  preferenceKey,
  pushRoomMessage,
  retryNotification,
  sendNotification,
  type DeviceToken,
  type MessageTemplate,
  type NotificationLocale,
  type NotificationPreference,
  type NotificationRecord,
  type NotificationStore,
  type RoomName,
  type SendInput,
} from './store.js';
import type { TemplateChannel } from './templates.js';

export interface ContactInfo {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: NotificationLocale;
}

export interface NotificationAppOptions {
  store: NotificationStore;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
  smsSecret: string;
  resolveContact?: (userId: string) => Promise<ContactInfo | null>;
  resolveStaff?: (tenantId: string) => Promise<Set<string>>;
}

const CHANNELS: TemplateChannel[] = ['sms', 'email', 'push'];
const LOCALES: NotificationLocale[] = ['fr', 'en'];
const STATUS_LABELS: Record<string, string> = {
  libre: 'libre',
  reservee: 'réservée',
  occupee: 'occupée',
  addition: 'en attente d’addition',
  a_nettoyer: 'à nettoyer',
  hors_service: 'hors service',
};

const ROOM_PERMISSIONS: Record<RoomName, string> = {
  floor: 'floor:view',
  kds: 'order:view',
  bar: 'order:view',
  pos: 'pos:operate',
  admin: 'notification:view',
};

function nowIso(): string {
  return new Date().toISOString();
}

function formatXof(value: number): string {
  const rounded = Math.round(value);
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F CFA`;
}

function serializeNotification(record: NotificationRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    userId: record.userId,
    recipient: record.recipient,
    recipientName: record.recipientName,
    channel: record.channel,
    templateCode: record.templateCode,
    subject: record.subject,
    body: record.body,
    preview: record.body.length > 160 ? `${record.body.slice(0, 157)}...` : record.body,
    status: record.status,
    attempts: record.attempts,
    room: record.room,
    eventId: record.eventId,
    data: record.data,
    createdAt: record.createdAt,
    sentAt: record.sentAt,
    readAt: record.readAt,
  };
}

function serializeTemplate(template: MessageTemplate) {
  return {
    id: template.id,
    tenantId: template.tenantId,
    source: template.tenantId ? 'tenant' : 'platform',
    code: template.code,
    name: template.name,
    channel: template.channel,
    locale: template.locale,
    subject: template.subject,
    body: template.body,
    updatedAt: template.updatedAt,
    updatedBy: template.updatedBy,
  };
}

function serializeDevice(device: DeviceToken) {
  return {
    id: device.id,
    tenantId: device.tenantId,
    userId: device.userId,
    token: device.token,
    platform: device.platform,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function serializePreference(preference: NotificationPreference) {
  return {
    tenantId: preference.tenantId,
    userId: preference.userId,
    sms: preference.sms,
    email: preference.email,
    push: preference.push,
    locale: preference.locale,
    quietFrom: preference.quietFrom,
    quietTo: preference.quietTo,
    updatedAt: preference.updatedAt,
  };
}

function channelField(value: unknown): TemplateChannel {
  if (typeof value !== 'string' || !CHANNELS.includes(value as TemplateChannel)) {
    throw HttpError.unprocessable('validation_error', 'Canal invalide (sms, email ou push).', { field: 'channel' });
  }
  return value as TemplateChannel;
}

function localeField(value: unknown): NotificationLocale {
  if (value === undefined || value === null || value === '') return 'fr';
  if (typeof value !== 'string' || !LOCALES.includes(value as NotificationLocale)) {
    throw HttpError.unprocessable('validation_error', 'Langue invalide (fr ou en).', { field: 'locale' });
  }
  return value as NotificationLocale;
}

function roomField(value: unknown): RoomName {
  if (typeof value !== 'string' || !ROOMS.includes(value as RoomName)) {
    throw HttpError.unprocessable('validation_error', 'Salle inconnue (floor, kds, bar, pos, admin).', { field: 'room' });
  }
  return value as RoomName;
}

function timeField(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw HttpError.unprocessable('validation_error', `Format HH:MM attendu pour ${field}.`, { field });
  }
  return value;
}

function queue(store: NotificationStore, input: SendInput) {
  try {
    return sendNotification(store, input);
  } catch (error) {
    if ((error as { code?: string }).code === 'template_not_found') {
      throw HttpError.unprocessable('template_not_found', 'Aucun modèle de notification ne correspond.', {
        field: 'templateCode',
      });
    }
    throw error;
  }
}

async function resolveDestination(
  options: NotificationAppOptions,
  userId: string,
  channel: TemplateChannel,
): Promise<{ recipient: string; name: string | null; locale: NotificationLocale } | null> {
  const contact = options.resolveContact ? await options.resolveContact(userId) : null;
  if (channel === 'sms' && contact?.phone) {
    return { recipient: contact.phone, name: contact.name ?? null, locale: contact.locale ?? 'fr' };
  }
  if (channel === 'email' && contact?.email) {
    return { recipient: contact.email, name: contact.name ?? null, locale: contact.locale ?? 'fr' };
  }
  if (channel === 'push') {
    const device = [...options.store.devices.values()].find((entry) => entry.userId === userId);
    if (device) return { recipient: device.token, name: contact?.name ?? null, locale: contact?.locale ?? 'fr' };
  }
  return null;
}

export interface CampaignDispatchResult {
  campaignId: string;
  total: number;
  sent: number;
  suppressed: number;
  failed: number;
  skipped: number;
  duplicates: number;
}

export async function dispatchCampaign(
  options: NotificationAppOptions,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<CampaignDispatchResult> {
  const { store } = options;
  const campaignId = String(payload.campaignId ?? '');
  const channel = channelField(payload.channel);
  const message = String(payload.message ?? '');
  const recipients = Array.isArray(payload.recipientUserIds)
    ? payload.recipientUserIds.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const result: CampaignDispatchResult = {
    campaignId,
    total: recipients.length,
    sent: 0,
    suppressed: 0,
    failed: 0,
    skipped: 0,
    duplicates: 0,
  };
  for (const userId of recipients) {
    const destination = await resolveDestination(options, userId, channel);
    if (!destination) {
      result.skipped += 1;
      continue;
    }
    const { record, duplicate } = queue(store, {
      tenantId,
      userId,
      recipient: destination.recipient,
      recipientName: destination.name,
      channel,
      subject: String(payload.name ?? 'Campagne'),
      body: message,
      data: { campaignId, campaignName: payload.name },
      eventId: `campaign:${campaignId}`,
      kind: 'marketing',
      locale: destination.locale,
    });
    if (duplicate) result.duplicates += 1;
    else if (record.status === 'supprime') result.suppressed += 1;
    else if (record.status === 'failed') result.failed += 1;
    else result.sent += 1;
  }
  store.recordAudit({
    tenantId,
    actorId: 'notification-service',
    action: 'notifications.campaign.dispatch',
    targetType: 'campaign',
    targetId: campaignId,
    meta: { ...result },
  });
  return result;
}

export interface NotificationEventEnvelope {
  type: string;
  payload: Record<string, unknown>;
}

export async function handleNotificationEvent(
  options: NotificationAppOptions,
  tenantId: string,
  event: NotificationEventEnvelope,
): Promise<void> {
  const { store } = options;
  const payload = event.payload;
  const seq = String(payload.orderId ?? payload.reservationId ?? payload.runId ?? payload.itemId ?? '');
  const dedupe = `${event.type}:${tenantId}:${seq}:${payload.quantity ?? payload.amountXof ?? ''}`;
  if (store.handledEvents.has(dedupe)) return;

  switch (event.type) {
    case 'OrderCreated': {
      store.handledEvents.add(dedupe);
      const number = String(payload.number ?? '');
      const channel = String(payload.channel ?? 'dine_in');
      const table = typeof payload.tableCode === 'string' ? payload.tableCode : null;
      pushRoomMessage(store, {
        tenantId,
        room: 'floor',
        type: 'order_created',
        title: 'Nouvelle commande',
        body: [number, table ? `Table ${table}` : null, channel].filter(Boolean).join(' · '),
        data: { orderId: payload.orderId ?? null, tableCode: table, totalXof: payload.totalXof ?? null },
      });
      pushRoomMessage(store, {
        tenantId,
        room: 'kds',
        type: 'order_created',
        title: 'Ticket cuisine',
        body: `${number} · ${formatXof(Number(payload.totalXof ?? 0))}`,
        data: { orderId: payload.orderId ?? null, tableCode: table },
      });
      break;
    }
    case 'OrderPaid': {
      store.handledEvents.add(dedupe);
      pushRoomMessage(store, {
        tenantId,
        room: 'pos',
        type: 'order_paid',
        title: 'Addition réglée',
        body: `${String(payload.number ?? '')} · ${formatXof(Number(payload.amountXof ?? payload.totalXof ?? 0))} · ${String(payload.method ?? '')}`,
        data: { orderId: payload.orderId ?? null, invoiceNumber: payload.invoiceNumber ?? null },
      });
      break;
    }
    case 'PaymentFailed': {
      store.handledEvents.add(dedupe);
      pushRoomMessage(store, {
        tenantId,
        room: 'pos',
        type: 'payment_failed',
        title: 'Paiement échoué',
        body: `${String(payload.orderId ?? payload.paymentId ?? '')} · ${String(payload.reason ?? payload.code ?? 'refus fournisseur')}`,
        data: { orderId: payload.orderId ?? null, paymentId: payload.paymentId ?? null },
      });
      pushRoomMessage(store, {
        tenantId,
        room: 'admin',
        type: 'payment_failed',
        title: 'Paiement échoué',
        body: `${String(payload.orderId ?? '')} · ${formatXof(Number(payload.amountXof ?? 0))}`,
        data: { orderId: payload.orderId ?? null },
      });
      break;
    }
    case 'TableStatusChanged': {
      store.handledEvents.add(dedupe);
      const code = String(payload.code ?? '');
      const to = String(payload.to ?? '');
      pushRoomMessage(store, {
        tenantId,
        room: 'floor',
        type: 'table_status',
        title: `Table ${code}`,
        body: `${STATUS_LABELS[to] ?? to}`,
        data: { tableId: payload.tableId ?? null, orderId: payload.orderId ?? null, from: payload.from ?? null, to },
      });
      break;
    }
    case 'ReservationCreated': {
      store.handledEvents.add(dedupe);
      pushRoomMessage(store, {
        tenantId,
        room: 'floor',
        type: 'reservation_created',
        title: 'Nouvelle réservation',
        body: `${String(payload.tableCode ?? '')} · ${String(payload.date ?? '')} ${String(payload.time ?? '')} · ${Number(payload.partySize ?? 0)} pers.`,
        data: { reservationId: payload.reservationId ?? null, reference: payload.reference ?? null },
      });
      break;
    }
    case 'StockBelowThreshold':
    case 'StockDepleted': {
      store.handledEvents.add(dedupe);
      const depleted = event.type === 'StockDepleted';
      const title = depleted ? 'Rupture de stock' : 'Stock sous le seuil';
      const body = depleted
        ? `${String(payload.name ?? '')} épuisé (${String(payload.unit ?? '')}).`
        : `${String(payload.name ?? '')} : ${Number(payload.quantity ?? 0)} ${String(payload.unit ?? '')} (seuil ${Number(payload.threshold ?? 0)}).`;
      pushRoomMessage(store, {
        tenantId,
        room: 'admin',
        type: depleted ? 'stock_depleted' : 'stock_below_threshold',
        title,
        body,
        data: { itemId: payload.itemId ?? null },
      });
      if (!depleted) {
        const staff = options.resolveStaff ? await options.resolveStaff(tenantId) : null;
        const targets = [...store.devices.values()].filter(
          (device) => device.tenantId === tenantId && (!staff || staff.has(device.userId)),
        );
        for (const device of targets) {
          queue(store, {
            tenantId,
            userId: device.userId,
            recipient: device.token,
            channel: 'push',
            templateCode: 'STOCK_ALERT',
            data: {
              name: payload.name ?? '',
              quantity: payload.quantity ?? 0,
              unit: payload.unit ?? '',
              threshold: payload.threshold ?? 0,
            },
            eventId: `stock:${String(payload.itemId ?? '')}:${String(payload.quantity ?? '')}`,
            kind: 'transactional',
          });
        }
      }
      break;
    }
    case 'PayrollApproved': {
      store.handledEvents.add(dedupe);
      pushRoomMessage(store, {
        tenantId,
        room: 'admin',
        type: 'payroll_approved',
        title: 'Paie approuvée',
        body: `${String(payload.period ?? '')} · ${Number(payload.headcount ?? 0)} employés · ${formatXof(Number(payload.totalXof ?? 0))}`,
        data: { runId: payload.runId ?? null },
      });
      break;
    }
    case 'PayrollPaid': {
      store.handledEvents.add(dedupe);
      pushRoomMessage(store, {
        tenantId,
        room: 'admin',
        type: 'payroll_paid',
        title: 'Salaires versés',
        body: `${String(payload.period ?? '')} · ${Number(payload.headcount ?? 0)} employés · ${formatXof(Number(payload.totalXof ?? 0))}`,
        data: { runId: payload.runId ?? null, reference: payload.reference ?? null },
      });
      break;
    }
    case 'CampaignSent': {
      store.handledEvents.add(dedupe);
      await dispatchCampaign(options, tenantId, payload);
      break;
    }
    default:
      break;
  }
}

export function buildNotificationApp(options: NotificationAppOptions): Route[] {
  const { store, publish, smsSecret } = options;

  const requireUser = (ctx: RequestContext): AuthClaims => {
    if (!ctx.auth) throw HttpError.unauthorized();
    return ctx.auth;
  };

  const requireRoomAccess = (ctx: RequestContext, room: RoomName): { tenantId: string; claims: AuthClaims } => {
    const tenantId = ctx.params.tenantId ?? '';
    const claims = requireTenantPermission(ctx.auth, tenantId, ROOM_PERMISSIONS[room]);
    return { tenantId, claims };
  };

  const deliver = async (input: SendInput, actorId: string) => {
    const { record, duplicate } = queue(store, input);
    if (!duplicate) {
      store.recordAudit({
        tenantId: input.tenantId,
        actorId,
        action: 'notification.sent',
        targetType: 'notification',
        targetId: record.id,
        meta: { channel: record.channel, templateCode: record.templateCode, status: record.status },
      });
    }
    return { record, duplicate };
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/me/notifications',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const tenantId = ctx.query.get('tenantId');
        const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 30) || 30));
        const items = [...store.notifications.values()]
          .filter((entry) => entry.userId === claims.sub && (!tenantId || entry.tenantId === tenantId))
          .filter((entry) => entry.channel !== 'realtime')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const unread = items.filter((entry) => entry.status === 'sent' && !entry.readAt).length;
        return {
          body: {
            items: items.slice(0, limit).map(serializeNotification),
            total: items.length,
            unread,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/notifications/:id/read',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const record = store.notifications.get(ctx.params.id ?? '');
        if (!record || record.userId !== claims.sub) throw HttpError.notFound('Notification introuvable.');
        if (!record.readAt) {
          record.readAt = nowIso();
          record.status = 'read';
        }
        return { body: { notification: serializeNotification(record) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/notifications/read-all',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = optionalString(body, 'tenantId');
        let updated = 0;
        for (const record of store.notifications.values()) {
          if (record.userId !== claims.sub || record.readAt) continue;
          if (tenantId && record.tenantId !== tenantId) continue;
          record.readAt = nowIso();
          record.status = 'read';
          updated += 1;
        }
        return { body: { updated } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/me/notification-preferences',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const tenantId = requireString({ tenantId: ctx.query.get('tenantId') ?? '' }, 'tenantId', { max: 64 });
        return { body: { preference: serializePreference(getPreference(store, tenantId, claims.sub)) } };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/me/notification-preferences',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const preference = getPreference(store, tenantId, claims.sub);
        for (const field of ['sms', 'email', 'push'] as const) {
          if (body[field] !== undefined) {
            if (typeof body[field] !== 'boolean') {
              throw HttpError.unprocessable('validation_error', `${field} doit être un booléen.`, { field });
            }
            preference[field] = body[field];
          }
        }
        if (body.locale !== undefined) preference.locale = localeField(body.locale);
        if (body.quietFrom !== undefined) preference.quietFrom = timeField(body.quietFrom, 'quietFrom');
        if (body.quietTo !== undefined) preference.quietTo = timeField(body.quietTo, 'quietTo');
        preference.updatedAt = nowIso();
        store.preferences.set(preferenceKey(tenantId, claims.sub), preference);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'notification.preference.updated',
          targetType: 'notification_preference',
          targetId: claims.sub,
          meta: { sms: preference.sms, email: preference.email, push: preference.push },
        });
        return { body: { preference: serializePreference(preference) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/device-tokens',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const token = requireString(body, 'token', { max: 256 });
        const platform = body.platform ?? 'web';
        if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
          throw HttpError.unprocessable('validation_error', 'Plateforme invalide.', { field: 'platform' });
        }
        const existing = [...store.devices.values()].find(
          (entry) => entry.tenantId === tenantId && entry.token === token,
        );
        if (existing) {
          existing.userId = claims.sub;
          existing.lastSeenAt = nowIso();
          return { body: { device: serializeDevice(existing), created: false } };
        }
        const device: DeviceToken = {
          id: `dev_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          userId: claims.sub,
          token,
          platform,
          createdAt: nowIso(),
          lastSeenAt: nowIso(),
        };
        store.devices.set(device.id, device);
        return { status: 201, body: { device: serializeDevice(device), created: true } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/me/device-tokens/:token',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const token = ctx.params.token ?? '';
        const device = [...store.devices.values()].find((entry) => entry.token === token && entry.userId === claims.sub);
        if (!device) throw HttpError.notFound('Jeton d’appareil introuvable.');
        store.devices.delete(device.id);
        return { body: { removed: true, token } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/realtime/rooms/:room/messages',
      handler: (ctx) => {
        const room = roomField(ctx.params.room);
        const { tenantId } = requireRoomAccess(ctx, room);
        const since = ctx.query.get('since');
        const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 40) || 40));
        const items = store.rooms
          .filter((entry) => entry.tenantId === tenantId && entry.room === room && (!since || entry.at > since))
          .slice(-limit);
        return {
          body: {
            tenantId,
            room,
            items,
            serverTime: nowIso(),
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/notifications/templates',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'notification:view');
        const channel = ctx.query.get('channel');
        const locale = ctx.query.get('locale');
        const items = [...store.templates.values()]
          .filter((entry) => entry.tenantId === null || entry.tenantId === tenantId)
          .filter((entry) => !channel || entry.channel === channel)
          .filter((entry) => !locale || entry.locale === locale)
          .sort((a, b) => `${a.code}${a.channel}${a.locale}`.localeCompare(`${b.code}${b.channel}${b.locale}`));
        return { body: { items: items.map(serializeTemplate), tenantsOverrides: items.filter((e) => e.tenantId).length } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/notifications/templates',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'notification:manage');
        const body = asObject(ctx.body);
        const code = requireString(body, 'code', { max: 64 }).toUpperCase();
        const channel = channelField(body.channel);
        const locale = localeField(body.locale);
        const existing = [...store.templates.values()].find(
          (entry) => entry.tenantId === tenantId && entry.code === code && entry.channel === channel && entry.locale === locale,
        );
        if (existing) throw HttpError.conflict('template_exists', 'Template personnalisé déjà défini pour cette combinaison.');
        const template: MessageTemplate = {
          id: `tpl_${tenantId}_${code.toLowerCase()}_${channel}_${locale}`,
          tenantId,
          code,
          name: requireString(body, 'name', { max: 120 }),
          channel,
          locale,
          subject: optionalString(body, 'subject', { max: 160 }) ?? null,
          body: requireString(body, 'body', { max: 4000 }),
          updatedAt: nowIso(),
          updatedBy: claims.sub,
        };
        store.templates.set(template.id, template);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'notification.template.created',
          targetType: 'message_template',
          targetId: template.id,
          meta: { code, channel, locale },
        });
        return { status: 201, body: { template: serializeTemplate(template) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/notifications/templates/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'notification:manage');
        const template = store.templates.get(ctx.params.id ?? '');
        if (!template || template.tenantId !== tenantId) throw HttpError.notFound('Modèle introuvable.');
        const body = asObject(ctx.body);
        const subject = optionalString(body, 'subject', { max: 160 });
        if (subject !== undefined) template.subject = subject;
        if (body.body !== undefined) template.body = requireString(body, 'body', { max: 4000 });
        if (body.name !== undefined) template.name = requireString(body, 'name', { max: 120 });
        template.updatedAt = nowIso();
        template.updatedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'notification.template.updated',
          targetType: 'message_template',
          targetId: template.id,
          meta: { code: template.code },
        });
        return { body: { template: serializeTemplate(template) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/notifications/summary',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'notification:view');
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const records = [...store.notifications.values()].filter((entry) => entry.tenantId === tenantId);
        const byChannel = { sms: 0, email: 0, push: 0 } as Record<TemplateChannel, number>;
        for (const record of records) if (record.channel !== 'realtime') byChannel[record.channel] += 1;
        return {
          body: {
            tenantId,
            total: records.length,
            sent24h: records.filter((entry) => entry.sentAt && entry.sentAt >= since).length,
            failed: records.filter((entry) => entry.status === 'failed').length,
            suppressed: records.filter((entry) => entry.status === 'supprime').length,
            queued: records.filter((entry) => entry.status === 'queued').length,
            byChannel,
            devices: [...store.devices.values()].filter((entry) => entry.tenantId === tenantId).length,
            templates: [...store.templates.values()].filter((entry) => entry.tenantId === null || entry.tenantId === tenantId)
              .length,
            roomMessages24h: store.rooms.filter((entry) => entry.tenantId === tenantId && entry.at >= since).length,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/notifications',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'notification:view');
        const channel = ctx.query.get('channel');
        const status = ctx.query.get('status');
        const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
        const items = [...store.notifications.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .filter((entry) => !channel || entry.channel === channel)
          .filter((entry) => !status || entry.status === status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);
        return { body: { items: items.map(serializeNotification), total: items.length } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/notifications',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'notification:manage');
        const body = asObject(ctx.body);
        const channel = channelField(body.channel);
        let recipient = optionalString(body, 'recipient', { max: 256 });
        const userId = optionalString(body, 'userId', { max: 64 }) ?? null;
        if (!recipient && userId) {
          const destination = await resolveDestination(options, userId, channel);
          if (!destination) {
            throw HttpError.unprocessable('recipient_unresolved', 'Aucun contact ne correspond à cet utilisateur.');
          }
          recipient = destination.recipient;
        }
        if (!recipient) throw HttpError.unprocessable('validation_error', 'Destinataire requis.', { field: 'recipient' });
        const room = body.room !== undefined && body.room !== null ? roomField(body.room) : null;
        const { record, duplicate } = await deliver(
          {
            tenantId,
            userId,
            recipient,
            recipientName: optionalString(body, 'recipientName', { max: 120 }) ?? null,
            channel,
            templateCode: optionalString(body, 'templateCode', { max: 64 }) ?? null,
            subject: optionalString(body, 'subject', { max: 160 }) ?? null,
            body: optionalString(body, 'body', { max: 4000 }) ?? null,
            data: body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {},
            room,
            eventId: optionalString(body, 'eventId', { max: 128 }) ?? null,
            kind: body.kind === 'marketing' ? 'marketing' : 'transactional',
            locale: localeField(body.locale),
          },
          claims.sub,
        );
        return { status: duplicate ? 200 : 201, body: { notification: serializeNotification(record), duplicate } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/notifications/:id/retry',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'notification:manage');
        const record = store.notifications.get(ctx.params.id ?? '');
        if (!record || record.tenantId !== tenantId) throw HttpError.notFound('Notification introuvable.');
        if (record.channel === 'realtime') {
          throw HttpError.unprocessable('validation_error', 'Les messages temps réel ne se rejouent pas.');
        }
        retryNotification(store, record);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'notification.retried',
          targetType: 'notification',
          targetId: record.id,
          meta: { status: record.status, attempts: record.attempts.length },
        });
        return { body: { notification: serializeNotification(record) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/notifications/realtime',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'notification:manage');
        const body = asObject(ctx.body);
        const room = roomField(body.room);
        const message = pushRoomMessage(store, {
          tenantId,
          room,
          type: optionalString(body, 'type', { max: 64 }) ?? 'manual',
          title: requireString(body, 'title', { max: 120 }),
          body: requireString(body, 'body', { max: 500 }),
          data: body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {},
        });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'notification.realtime.published',
          targetType: 'room_message',
          targetId: message.id,
          meta: { room, type: message.type },
        });
        return { status: 201, body: { message } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/notifications/audit',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'notification:view');
        const items = store.audit
          .filter((entry) => entry.tenantId === tenantId || entry.tenantId === null)
          .slice(-100)
          .reverse();
        return { body: { items, integrity: verifyAuditChain(store.audit) } };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/notifications/send',
      service: true,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const body = asObject(ctx.body);
        const channel = channelField(body.channel);
        let recipient = optionalString(body, 'recipient', { max: 256 });
        const userId = optionalString(body, 'userId', { max: 64 }) ?? null;
        let locale = body.locale !== undefined ? localeField(body.locale) : undefined;
        if (!recipient && userId) {
          const destination = await resolveDestination(options, userId, channel);
          if (!destination) {
            throw HttpError.unprocessable('recipient_unresolved', 'Aucun contact ne correspond à cet utilisateur.');
          }
          recipient = destination.recipient;
          locale = locale ?? destination.locale;
        }
        if (!recipient) throw HttpError.unprocessable('validation_error', 'Destinataire requis.', { field: 'recipient' });
        const room = body.room !== undefined && body.room !== null ? roomField(body.room) : null;
        const { record, duplicate } = await deliver(
          {
            tenantId,
            userId,
            recipient,
            recipientName: optionalString(body, 'recipientName', { max: 120 }) ?? null,
            channel,
            templateCode: optionalString(body, 'templateCode', { max: 64 }) ?? null,
            subject: optionalString(body, 'subject', { max: 160 }) ?? null,
            body: optionalString(body, 'body', { max: 4000 }) ?? null,
            data: body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {},
            room,
            eventId: optionalString(body, 'eventId', { max: 128 }) ?? null,
            kind: body.kind === 'marketing' ? 'marketing' : 'transactional',
            locale,
          },
          'notification-service',
        );
        return { status: duplicate ? 200 : 201, body: { notification: serializeNotification(record), duplicate } };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/notifications/realtime',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const body = asObject(ctx.body);
        const message = pushRoomMessage(store, {
          tenantId,
          room: roomField(body.room),
          type: optionalString(body, 'type', { max: 64 }) ?? 'event',
          title: requireString(body, 'title', { max: 120 }),
          body: requireString(body, 'body', { max: 500 }),
          data: body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {},
        });
        return { status: 201, body: { message } };
      },
    },
    {
      method: 'POST',
      path: '/internal/notifications/otp',
      service: true,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const phone = requireString(body, 'phone', { max: 40 });
        const code = requireString(body, 'code', { max: 12 });
        const tenantId = optionalString(body, 'tenantId', { max: 64 }) ?? 'platform';
        const { record } = queue(store, {
          tenantId,
          userId: null,
          recipient: phone,
          channel: 'sms',
          templateCode: 'AUTH_OTP',
          data: { code },
          eventId: optionalString(body, 'eventId', { max: 128 }) ?? null,
          kind: 'transactional',
          locale: localeField(body.locale),
        });
        return {
          body: {
            delivered: record.status === 'sent',
            status: record.status,
            messageId: record.attempts.at(-1)?.messageId ?? null,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/public/notifications/sms/webhook',
      auth: false,
      handler: async (ctx) => {
        if (!smsSecret) throw new HttpError(503, 'webhook_not_configured', 'Webhook SMS non configuré.');
        const body = asObject(ctx.body);
        const messageId = requireString(body, 'messageId', { max: 64 });
        const status = requireString(body, 'status', { max: 16 });
        if (status !== 'delivered' && status !== 'failed') {
          throw HttpError.unprocessable('validation_error', 'Statut de remise invalide.', { field: 'status' });
        }
        const signature = String(ctx.headers['x-sms-signature'] ?? '');
        const expected = createHmac('sha256', smsSecret).update(`${messageId}:${status}`).digest('hex');
        const provided = Buffer.from(signature, 'utf8');
        const target = Buffer.from(expected, 'utf8');
        if (provided.length !== target.length || !timingSafeEqual(provided, target)) {
          throw new HttpError(401, 'invalid_signature', 'Signature du webhook invalide.');
        }
        const record = [...store.notifications.values()].find((entry) =>
          entry.attempts.some((attempt) => attempt.messageId === messageId),
        );
        if (!record) throw HttpError.notFound('Message introuvable.');
        const attempt = [...record.attempts].reverse().find((entry) => entry.messageId === messageId);
        if (attempt) {
          attempt.status = status;
          if (status === 'failed') attempt.error = optionalString(body, 'error', { max: 160 }) ?? 'remise_refusee';
        }
        if (status === 'failed') record.status = 'failed';
        store.recordAudit({
          tenantId: record.tenantId,
          actorId: 'sms-provider',
          action: 'notification.delivery.reported',
          targetType: 'notification',
          targetId: record.id,
          meta: { messageId, status },
        });
        await publish('SmsDeliveryReported', record.tenantId, {
          tenantId: record.tenantId,
          notificationId: record.id,
          messageId,
          status,
          at: nowIso(),
        });
        return { body: { matched: true, notification: serializeNotification(record) } };
      },
    },
  ];
}
