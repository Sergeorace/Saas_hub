import { createHmac } from 'node:crypto';
import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildNotificationApp, handleNotificationEvent } from '../app.js';
import { createNotificationStore, seedNotificationDemo, type NotificationStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';
const SMS_SECRET = 'test-sms-secret';

function claims(
  sub: string,
  name: string,
  tenantPermissions: Record<string, string[]> = {},
): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: true,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

async function main() {
  const store: NotificationStore = createNotificationStore();
  seedNotificationDemo(store);
  const bus = createEventBus({
    name: 'notification-test',
    internalKey: INTERNAL_KEY,
    subscribers: [],
  });
  const published: string[] = [];
  const publish = async (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => {
    published.push(type);
    return bus.publish(type, tenantId, payload);
  };

  const contacts = new Map<
    string,
    { name: string; email: string | null; phone: string | null; locale: 'fr' | 'en' }
  >([
    [
      'usr_demo_visiteur',
      { name: 'Akouvi M.', email: 'akouvi@example.tg', phone: '+228 90 12 34 56', locale: 'fr' },
    ],
    ['usr_bad_phone', { name: 'Kossi', email: null, phone: '000 00 00', locale: 'fr' }],
  ]);
  const staff = new Set(['usr_gerant_sahel']);

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const owner = register(
    'token-owner',
    claims('usr_gerant_sahel', 'Gérant Sahel', {
      [SAHEL]: [
        'notification:view',
        'notification:manage',
        'floor:view',
        'order:view',
        'pos:operate',
      ],
    }),
  );
  const visitor = register('token-visitor', claims('usr_demo_visiteur', 'Akouvi'));
  const waiter = register(
    'token-waiter',
    claims('usr_serveur', 'Serveur', {
      [SAHEL]: ['floor:view', 'order:view', 'pos:operate'],
    }),
  );
  const ownerBaobab = register(
    'token-baobab',
    claims('usr_baobab', 'Gérant Baobab', {
      [BAOBAB]: ['notification:view', 'notification:manage', 'floor:view'],
    }),
  );

  const options = {
    store,
    publish,
    smsSecret: SMS_SECRET,
    resolveContact: async (userId: string) => contacts.get(userId) ?? null,
    resolveStaff: async () => staff,
  };

  const server = await startServer(
    {
      name: 'notification-service-test',
      routes: buildNotificationApp(options),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const A = `/api/v1/tenants/${SAHEL}`;
  const byEvent = (eventId: string) =>
    [...store.notifications.values()].find((entry) => entry.eventId === eventId);

  const cases: TestCase[] = [
    {
      name: 'Modèles : catalogue FR/EN, surcharge établissement et doublon',
      run: async () => {
        const list = await api(base, 'GET', `${A}/notifications/templates`, undefined, {
          token: owner,
        });
        assertStatus(list, 200, 'Catalogue accessible');
        assertEqual(list.body.items.length, 14, '14 modèles plateforme');
        const otp = list.body.items.filter((entry: { code: string }) => entry.code === 'AUTH_OTP');
        assert(
          otp.some((entry: { locale: string }) => entry.locale === 'fr'),
          'OTP français',
        );
        assert(
          otp.some((entry: { locale: string }) => entry.locale === 'en'),
          'OTP anglais',
        );

        const created = await api(
          base,
          'POST',
          `${A}/notifications/templates`,
          {
            code: 'order_ready',
            channel: 'push',
            locale: 'fr',
            name: 'Commande prête (Sahel)',
            body: '{{number}} : à retirer au comptoir du bar !',
          },
          { token: owner },
        );
        assertStatus(created, 201, 'Surcharge créée');
        assertEqual(created.body.template.source, 'tenant', 'Origine établissement');

        const duplicate = await api(
          base,
          'POST',
          `${A}/notifications/templates`,
          { code: 'ORDER_READY', channel: 'push', locale: 'fr', name: 'Doublon', body: 'x' },
          { token: owner },
        );
        assertStatus(duplicate, 409, 'Doublon refusé');
        assertEqual(duplicate.body.error.code, 'template_exists', 'Code doublon');

        const patched = await api(
          base,
          'PATCH',
          `${A}/notifications/templates/${created.body.template.id}`,
          { body: '{{number}} : prête au comptoir.' },
          { token: owner },
        );
        assertStatus(patched, 200, 'Surcharge modifiée');
        assert(patched.body.template.body.includes('comptoir'), 'Nouveau corps enregistré');
      },
    },
    {
      name: 'Envoi interne idempotent, modèle surchargé et échec de remise',
      run: async () => {
        const first = await api(
          base,
          'POST',
          `/internal/tenants/${SAHEL}/notifications/send`,
          {
            userId: 'usr_demo_visiteur',
            channel: 'push',
            templateCode: 'ORDER_READY',
            data: { number: 'CMD-42' },
            eventId: 'ord-42',
            kind: 'transactional',
          },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(first, 201, 'Notification créée');
        assertEqual(
          first.body.notification.body,
          'CMD-42 : prête au comptoir.',
          'Surcharge appliquée',
        );
        assertEqual(first.body.notification.status, 'sent', 'Remise simulée');
        assertEqual(
          first.body.notification.recipient,
          'tok_demo_client_visiteur',
          'Jeton push du client',
        );

        const again = await api(
          base,
          'POST',
          `/internal/tenants/${SAHEL}/notifications/send`,
          {
            userId: 'usr_demo_visiteur',
            channel: 'push',
            templateCode: 'ORDER_READY',
            data: { number: 'CMD-42' },
            eventId: 'ord-42',
          },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(again, 200, 'Deuxième envoi dédupliqué');
        assertEqual(again.body.duplicate, true, 'Doublon signalé');
        assertEqual(again.body.notification.id, first.body.notification.id, 'Même notification');

        const failed = await api(
          base,
          'POST',
          `${A}/notifications`,
          {
            channel: 'sms',
            recipient: '000 00 00',
            templateCode: 'AUTH_OTP',
            data: { code: '123456' },
          },
          { token: owner },
        );
        assertStatus(failed, 201, 'Tentative enregistrée');
        assertEqual(failed.body.notification.status, 'failed', 'Échec fournisseur simulé');
        assertEqual(
          failed.body.notification.attempts[0].error,
          'destinataire_sms_invalide',
          'Motif explicite',
        );

        const record = store.notifications.get(failed.body.notification.id);
        if (!record) throw new Error('notification absente');
        record.recipient = '+228 90 00 00 00';
        const retried = await api(
          base,
          'POST',
          `${A}/notifications/${record.id}/retry`,
          undefined,
          { token: owner },
        );
        assertStatus(retried, 200, 'Nouvelle tentative');
        assertEqual(retried.body.notification.status, 'sent', 'Remise réussie au second essai');
        assertEqual(retried.body.notification.attempts.length, 2, 'Historique conservé');

        const unauthorized = await api(base, 'POST', `/internal/notifications/otp`, {
          phone: '+228 90 11 22 33',
          code: '654321',
        });
        assertStatus(unauthorized, 401, 'Clé interne exigée');
        const otp = await api(
          base,
          'POST',
          `/internal/notifications/otp`,
          { phone: '+228 90 11 22 33', code: '654321' },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(otp, 200, 'OTP transmis');
        assertEqual(otp.body.delivered, true, 'OTP livré');
      },
    },
    {
      name: 'Fil client : notifications, lecture et compteur',
      run: async () => {
        const feed = await api(
          base,
          'GET',
          `/api/v1/me/notifications?tenantId=${SAHEL}`,
          undefined,
          { token: visitor },
        );
        assertStatus(feed, 200, 'Fil accessible');
        assert(feed.body.total >= 2, 'Notifications du visiteur');
        assert(feed.body.unread >= 1, 'Au moins une non lue');

        const unread = feed.body.items.find((entry: { readAt: string | null }) => !entry.readAt);
        const read = await api(
          base,
          'POST',
          `/api/v1/me/notifications/${unread.id}/read`,
          undefined,
          { token: visitor },
        );
        assertStatus(read, 200, 'Marquée lue');
        assert(read.body.notification.readAt !== null, 'Horodatage de lecture');

        const readAll = await api(
          base,
          'POST',
          `/api/v1/me/notifications/read-all`,
          { tenantId: SAHEL },
          { token: visitor },
        );
        assertStatus(readAll, 200, 'Tout lire');
        const after = await api(
          base,
          'GET',
          `/api/v1/me/notifications?tenantId=${SAHEL}`,
          undefined,
          { token: visitor },
        );
        assertEqual(after.body.unread, 0, 'Plus aucune non lue');

        const foreign = await api(
          base,
          'POST',
          `/api/v1/me/notifications/${unread.id}/read`,
          undefined,
          { token: owner },
        );
        assertStatus(foreign, 404, 'Notification d’un autre utilisateur masquée');
      },
    },
    {
      name: 'Préférences : désabonnement, heures calmes et appareils',
      run: async () => {
        const initial = await api(
          base,
          'GET',
          `/api/v1/me/notification-preferences?tenantId=${SAHEL}`,
          undefined,
          {
            token: owner,
          },
        );
        assertStatus(initial, 200, 'Préférences lues');
        assertEqual(initial.body.preference.sms, false, 'SMS désactivés pour le gérant');

        const updated = await api(
          base,
          'PUT',
          `/api/v1/me/notification-preferences`,
          { tenantId: SAHEL, push: false, locale: 'en', quietFrom: '00:00', quietTo: '23:59' },
          { token: visitor },
        );
        assertStatus(updated, 200, 'Préférences mises à jour');
        assertEqual(updated.body.preference.locale, 'en', 'Langue anglaise');

        const optedOut = await api(
          base,
          'POST',
          `${A}/notifications`,
          {
            channel: 'push',
            userId: 'usr_demo_visiteur',
            templateCode: 'ORDER_READY',
            data: { number: 'CMD-43' },
            kind: 'marketing',
            eventId: 'mkt-1',
          },
          { token: owner },
        );
        assertStatus(optedOut, 201, 'Envoi marketing enregistré');
        assertEqual(optedOut.body.notification.status, 'supprime', 'Push désactivé par préférence');
        assertEqual(
          optedOut.body.notification.data.suppression,
          'preference_desactivee',
          'Motif de suppression',
        );

        await api(
          base,
          'PUT',
          `/api/v1/me/notification-preferences`,
          { tenantId: SAHEL, push: true },
          { token: visitor },
        );
        const quiet = await api(
          base,
          'POST',
          `${A}/notifications`,
          {
            channel: 'sms',
            userId: 'usr_demo_visiteur',
            body: 'Offre du soir',
            kind: 'marketing',
            eventId: 'mkt-2',
          },
          { token: owner },
        );
        assertStatus(quiet, 201, 'Marketing SMS enregistré');
        assertEqual(quiet.body.notification.status, 'supprime', 'Heures calmes appliquées');
        assertEqual(
          quiet.body.notification.data.suppression,
          'heures_calmes',
          'Motif heures calmes',
        );

        const transactional = await api(
          base,
          'POST',
          `${A}/notifications`,
          {
            channel: 'sms',
            userId: 'usr_demo_visiteur',
            body: 'Votre table est prête',
            kind: 'transactional',
            eventId: 'tx-1',
          },
          { token: owner },
        );
        assertEqual(transactional.body.notification.status, 'sent', 'Transactionnel non filtré');

        const device = await api(
          base,
          'POST',
          `/api/v1/me/device-tokens`,
          { tenantId: SAHEL, token: 'tok_visitor_browser', platform: 'web' },
          { token: visitor },
        );
        assertStatus(device, 201, 'Appareil enregistré');
        const again = await api(
          base,
          'POST',
          `/api/v1/me/device-tokens`,
          { tenantId: SAHEL, token: 'tok_visitor_browser', platform: 'web' },
          { token: visitor },
        );
        assertEqual(again.body.created, false, 'Jeton réutilisé');
        const removed = await api(
          base,
          'DELETE',
          `/api/v1/me/device-tokens/tok_visitor_browser`,
          undefined,
          {
            token: visitor,
          },
        );
        assertStatus(removed, 200, 'Appareil supprimé');

        await api(
          base,
          'PUT',
          `/api/v1/me/notification-preferences`,
          { tenantId: SAHEL, quietFrom: null, quietTo: null, locale: 'fr' },
          { token: visitor },
        );
      },
    },
    {
      name: 'Temps réel : salles isolées, droits et filtre temporel',
      run: async () => {
        const floorFeed = await api(base, 'GET', `${A}/realtime/rooms/floor/messages`, undefined, {
          token: waiter,
        });
        assertStatus(floorFeed, 200, 'Serveur lit la salle');
        assert(floorFeed.body.items.length >= 1, 'Messages historiques');

        const adminDenied = await api(
          base,
          'GET',
          `${A}/realtime/rooms/admin/messages`,
          undefined,
          { token: waiter },
        );
        assertStatus(adminDenied, 403, 'Salle admin refusée au serveur');

        const created = await api(
          base,
          'POST',
          `${A}/notifications/realtime`,
          { room: 'kds', type: 'rush', title: 'Coup de feu', body: 'Trois tickets en attente' },
          { token: owner },
        );
        assertStatus(created, 201, 'Message temps réel publié');
        const since = new Date(Date.parse(created.body.message.at) - 5000).toISOString();
        const fresh = await api(
          base,
          'GET',
          `${A}/realtime/rooms/kds/messages?since=${encodeURIComponent(since)}`,
          undefined,
          {
            token: owner,
          },
        );
        assertEqual(fresh.body.items.length, 1, 'Un seul message postérieur');

        const foreign = await api(
          base,
          'POST',
          `/internal/tenants/${BAOBAB}/notifications/realtime`,
          {
            room: 'floor',
            title: 'x',
            body: 'y',
          },
        );
        assertStatus(foreign, 401, 'Interne protégé');

        const internal = await api(
          base,
          'POST',
          `/internal/tenants/${BAOBAB}/notifications/realtime`,
          { room: 'floor', title: 'Info', body: 'Service du soir' },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(internal, 201, 'Message interne accepté');
        const baobabFeed = await api(
          base,
          'GET',
          `/api/v1/tenants/${BAOBAB}/realtime/rooms/floor/messages`,
          undefined,
          {
            token: ownerBaobab,
          },
        );
        assertEqual(baobabFeed.body.items.length, 1, 'Aucun message Sahel visible');
      },
    },
    {
      name: 'Événements métier : salle, cuisine, caisse, stock et paie',
      run: async () => {
        const before = store.rooms.length;
        await handleNotificationEvent(options, SAHEL, {
          type: 'OrderCreated',
          payload: {
            tenantId: SAHEL,
            orderId: 'ord_evt_1',
            number: 'CMD-77',
            channel: 'dine_in',
            tableCode: 'T5',
            totalXof: 9000,
          },
        });
        await handleNotificationEvent(options, SAHEL, {
          type: 'OrderCreated',
          payload: {
            tenantId: SAHEL,
            orderId: 'ord_evt_1',
            number: 'CMD-77',
            channel: 'dine_in',
            tableCode: 'T5',
            totalXof: 9000,
          },
        });
        assertEqual(store.rooms.length - before, 2, 'Salle et cuisine, sans doublon');
        const kds = store.rooms.at(-1);
        if (!kds) throw new Error('message manquant');
        assertEqual(kds.room, 'kds', 'Ticket cuisine');
        assertEqual(kds.body, 'CMD-77 · 9 000 F CFA', 'Montant formaté XOF');

        await handleNotificationEvent(options, SAHEL, {
          type: 'TableStatusChanged',
          payload: {
            tenantId: SAHEL,
            tableId: 'tbl_5',
            code: 'T5',
            from: 'libre',
            to: 'occupee',
            orderId: 'ord_evt_1',
          },
        });
        assertEqual(store.rooms.at(-1)?.body, 'occupée', 'Statut de table traduit');

        await handleNotificationEvent(options, SAHEL, {
          type: 'ReservationCreated',
          payload: {
            tenantId: SAHEL,
            reservationId: 'res_evt_1',
            reference: 'RES-2026-0001',
            date: '2026-11-26',
            time: '19:30',
            partySize: 4,
            tableCode: 'T2',
          },
        });
        assertEqual(store.rooms.at(-1)?.type, 'reservation_created', 'Réservation diffusée');

        await handleNotificationEvent(options, SAHEL, {
          type: 'OrderPaid',
          payload: {
            tenantId: SAHEL,
            orderId: 'ord_evt_1',
            number: 'CMD-77',
            method: 'tmoney',
            amountXof: 9000,
          },
        });
        const paid = store.rooms.at(-1);
        assertEqual(paid?.room, 'pos', 'Addition signalée en caisse');
        assertEqual(paid?.body, 'CMD-77 · 9 000 F CFA · tmoney', 'Montant et moyen de paiement');

        await handleNotificationEvent(options, SAHEL, {
          type: 'PaymentFailed',
          payload: {
            tenantId: SAHEL,
            orderId: 'ord_evt_2',
            amountXof: 4500,
            reason: 'solde insuffisant',
          },
        });
        assertEqual(store.rooms.at(-1)?.room, 'admin', 'Échec remonté à la supervision');

        const stockBefore = store.notifications.size;
        await handleNotificationEvent(options, SAHEL, {
          type: 'StockBelowThreshold',
          payload: {
            tenantId: SAHEL,
            itemId: 'itm_tomate',
            name: 'Tomates fraîches',
            quantity: 6.75,
            threshold: 8,
            unit: 'kg',
          },
        });
        const pushes = [...store.notifications.values()].slice(stockBefore);
        assertEqual(pushes.length, 1, 'Un seul appareil du personnel');
        assertEqual(pushes[0].recipient, 'tok_demo_gerant_sahel', 'Push au gérant');
        assertEqual(pushes[0].templateCode, 'STOCK_ALERT', 'Modèle stock');
        assert(pushes[0].body.includes('Tomates fraîches'), 'Article nommé');
        assertEqual(store.rooms.at(-1)?.type, 'stock_below_threshold', 'Alerte admin');

        await handleNotificationEvent(options, SAHEL, {
          type: 'PayrollPaid',
          payload: {
            tenantId: SAHEL,
            runId: 'run_1',
            period: '2026-10',
            headcount: 8,
            totalXof: 1250000,
          },
        });
        assertEqual(
          store.rooms.at(-1)?.body,
          '2026-10 · 8 employés · 1 250 000 F CFA',
          'Paie formatée',
        );
      },
    },
    {
      name: 'Campagnes : contacts résolus, échecs et déduplication',
      run: async () => {
        const payload = {
          tenantId: SAHEL,
          campaignId: 'cmp_evt_1',
          name: 'Soirée grillades',
          channel: 'sms',
          segment: 'all',
          message: 'Ce soir : brochettes à 3 000 F CFA.',
          recipients: 3,
          recipientUserIds: ['usr_demo_visiteur', 'usr_bad_phone', 'usr_ghost'],
          at: new Date().toISOString(),
        };
        await handleNotificationEvent(options, SAHEL, { type: 'CampaignSent', payload });
        const sent = byEvent('campaign:cmp_evt_1');
        assert(sent !== undefined, 'SMS de campagne envoyé');
        assertEqual(sent?.recipient, '+228 90 12 34 56', 'Téléphone résolu');
        assertEqual(sent?.status, 'sent', 'Remise réussie');
        assertEqual(sent?.userId, 'usr_demo_visiteur', 'Rattachement utilisateur');
        const failed = [...store.notifications.values()].find(
          (entry) => entry.eventId === 'campaign:cmp_evt_1' && entry.userId === 'usr_bad_phone',
        );
        assertEqual(failed?.status, 'failed', 'Numéro invalide signalé');
        assertEqual(failed?.recipient, '000 00 00', 'Destinataire conservé');
        assert(
          ![...store.notifications.values()].some((entry) => entry.userId === 'usr_ghost'),
          'Contact introuvable ignoré',
        );

        await handleNotificationEvent(options, SAHEL, { type: 'CampaignSent', payload });
        const matches = [...store.notifications.values()].filter(
          (entry) => entry.eventId === 'campaign:cmp_evt_1',
        );
        assertEqual(matches.length, 2, 'Rejeu de l’événement ignoré');
      },
    },
    {
      name: 'Webhook SMS : signature HMAC obligatoire',
      run: async () => {
        const record = byEvent('ord-42');
        if (!record) throw new Error('notification ord-42 absente');
        const messageId = record.attempts[0]?.messageId;
        assert(typeof messageId === 'string', 'Identifiant fournisseur présent');

        const unsigned = await api(base, 'POST', `/api/v1/public/notifications/sms/webhook`, {
          messageId,
          status: 'delivered',
        });
        assertStatus(unsigned, 401, 'Signature absente refusée');

        const body = { messageId, status: 'delivered' };
        const signature = createHmac('sha256', SMS_SECRET)
          .update(`${messageId}:delivered`)
          .digest('hex');
        const headerRequest = await fetch(`${base}/api/v1/public/notifications/sms/webhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sms-signature': signature },
          body: JSON.stringify(body),
        });
        assertEqual(headerRequest.status, 200, 'Signature valide acceptée');
        const payload = (await headerRequest.json()) as {
          notification: { attempts: Array<{ status: string }> };
        };
        assertEqual(
          payload.notification.attempts.at(-1)?.status,
          'delivered',
          'Accusé de remise enregistré',
        );
        assert(published.includes('SmsDeliveryReported'), 'Événement de remise publié');

        const unknownBody = { messageId: 'SMS-999999', status: 'delivered' };
        const unknownSignature = createHmac('sha256', SMS_SECRET)
          .update('SMS-999999:delivered')
          .digest('hex');
        const unknown = await fetch(`${base}/api/v1/public/notifications/sms/webhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sms-signature': unknownSignature },
          body: JSON.stringify(unknownBody),
        });
        assertEqual(unknown.status, 404, 'Message inconnu signalé après vérification');
      },
    },
    {
      name: 'Synthèse, journal d’audit et isolation inter-établissements',
      run: async () => {
        const summary = await api(base, 'GET', `${A}/notifications/summary`, undefined, {
          token: owner,
        });
        assertStatus(summary, 200, 'Synthèse accessible');
        assert(summary.body.total > 0, 'Volumes présents');
        assert(
          summary.body.byChannel.sms > 0 && summary.body.byChannel.push > 0,
          'Répartition par canal',
        );
        assertEqual(summary.body.devices, 2, 'Deux appareils déclarés');

        const list = await api(base, 'GET', `${A}/notifications`, undefined, { token: owner });
        assert(
          list.body.items.every((entry: { tenantId: string }) => entry.tenantId === SAHEL),
          'Aucune notification étrangère',
        );

        const denied = await api(base, 'GET', `${A}/notifications`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(denied, 403, 'Établissement croisé refusé');
        const deniedWrite = await api(
          base,
          'POST',
          `${A}/notifications`,
          { channel: 'sms', recipient: '000', body: 'x' },
          { token: ownerBaobab },
        );
        assertStatus(deniedWrite, 403, 'Écriture croisée refusée');

        const audit = await api(base, 'GET', `${A}/notifications/audit`, undefined, {
          token: owner,
        });
        assertStatus(audit, 200, 'Journal accessible');
        assertEqual(audit.body.integrity, true, 'Chaîne d’audit intègre');
        const actions = audit.body.items.map((entry: { action: string }) => entry.action);
        assert(actions.includes('notification.sent'), 'Envois audités');
        assert(actions.includes('notification.delivery.reported'), 'Remises auditées');
        assert(actions.includes('notification.retried'), 'Tentatives auditées');
        assert(
          audit.body.items.every(
            (entry: { tenantId: string | null }) =>
              entry.tenantId === SAHEL || entry.tenantId === null,
          ),
          'Audit filtré par établissement',
        );
      },
    },
  ];

  await runTests('NOTIFICATION-SERVICE — envois, temps réel, préférences et webhooks', cases);
  await server.close();
}

await main();
