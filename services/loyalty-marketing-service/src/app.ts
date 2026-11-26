import {
  HttpError,
  asObject,
  optionalString,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type RequestContext,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import {
  LOYALTY_TIERS,
  POINTS_PER_XOF,
  REWARDS,
  accountKey,
  activePromotions,
  applyEntry,
  campaignRecipients,
  discountFor,
  entriesFor,
  favoritesFor,
  findPromoCode,
  getOrCreateAccount,
  pointsForAmount,
  promotionStatus,
  reviewAggregate,
  tierFor,
  type Campaign,
  type CampaignChannel,
  type CampaignSegment,
  type DiscountType,
  type LoyaltyAccount,
  type LoyaltyStore,
  type PromoCode,
  type PromoRedemption,
  type Promotion,
  type ReviewRecord,
  type ReviewStatus,
} from './store.js';

export interface LoyaltyAppOptions {
  store: LoyaltyStore;
  order: ServiceClient;
  publish: (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}

interface OrderSnapshot {
  order: {
    id: string;
    number: string;
    tenantId: string;
    paymentStatus: string;
    totalXof: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function programView() {
  return {
    pointsPerXof: POINTS_PER_XOF,
    currency: 'XOF',
    tiers: LOYALTY_TIERS.map((tier) => ({ ...tier })),
    rewards: REWARDS.map((reward) => ({ ...reward })),
    rules:
      'Gagnez 1 point par tranche de 500 F CFA payée, hors promotions. 250 points = dessert offert.',
  };
}

function accountView(store: LoyaltyStore, account: LoyaltyAccount) {
  const tier = tierFor(account.lifetimePoints);
  const next = LOYALTY_TIERS.find((entry) => entry.minLifetimePoints > account.lifetimePoints);
  const history = entriesFor(store, account.userId, account.tenantId).slice(0, 20);
  return {
    tenantId: account.tenantId,
    points: account.points,
    lifetimePoints: account.lifetimePoints,
    tier: { code: tier.code, label: tier.label, multiplier: tier.multiplier },
    nextTier: next
      ? {
          code: next.code,
          label: next.label,
          pointsNeeded: next.minLifetimePoints - account.lifetimePoints,
        }
      : null,
    history,
    updatedAt: account.updatedAt,
  };
}

function serializeReview(review: ReviewRecord) {
  return {
    id: review.id,
    tenantId: review.tenantId,
    userId: review.userId,
    userName: review.userName,
    rating: review.rating,
    comment: review.comment ?? null,
    status: review.status,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    moderationNote: review.moderationNote ?? null,
    reply: review.reply ?? null,
  };
}

function serializePromotion(promotion: Promotion) {
  return { ...promotion, status: promotionStatus(promotion) };
}

function promoStatus(code: PromoCode): string {
  return promotionStatus({ active: code.active, startAt: code.startAt, endAt: code.endAt });
}

function serializePromoCode(code: PromoCode) {
  return {
    ...code,
    status: promoStatus(code),
    remainingUses: code.maxUses === null ? null : Math.max(0, code.maxUses - code.uses),
  };
}

function isoDateField(source: Record<string, unknown>, field: string): string {
  const value = requireString(source, field, { max: 40 });
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw HttpError.unprocessable('validation_error', `Date invalide pour ${field}.`, { field });
  }
  return new Date(time).toISOString();
}

function optionalNumberField(source: Record<string, unknown>, field: string, fallback = 0): number {
  const value = source[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw HttpError.unprocessable('validation_error', `Nombre positif attendu pour ${field}.`, {
      field,
    });
  }
  return value;
}

function discountFields(source: Record<string, unknown>): { type: DiscountType; value: number } {
  const type = requireString(source, 'type', { max: 10 });
  if (type !== 'percent' && type !== 'amount') {
    throw HttpError.unprocessable(
      'validation_error',
      'Type de remise attendu : percent ou amount.',
      { field: 'type' },
    );
  }
  const raw = source.value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw HttpError.unprocessable('validation_error', 'Valeur de remise positive attendue.', {
      field: 'value',
    });
  }
  if (type === 'percent' && raw > 100) {
    throw HttpError.unprocessable('validation_error', 'Un pourcentage ne peut dépasser 100.', {
      field: 'value',
    });
  }
  return { type, value: type === 'percent' ? raw : Math.round(raw) };
}

function validatePromoAgainstOrder(
  store: LoyaltyStore,
  code: PromoCode,
  userId: string,
  orderTotalXof: number,
): { discountXof: number } {
  const status = promoStatus(code);
  if (status !== 'active') {
    throw HttpError.unprocessable(
      'promo_code_inactive',
      'Ce code n’est pas actif sur la période en cours.',
      {
        status,
      },
    );
  }
  if (code.maxUses !== null && code.uses >= code.maxUses) {
    throw HttpError.unprocessable(
      'promo_code_exhausted',
      'Ce code a atteint sa limite d’utilisation.',
      {
        uses: code.uses,
        maxUses: code.maxUses,
      },
    );
  }
  const usedByUser = [...store.redemptions.values()].filter(
    (redemption) =>
      redemption.tenantId === code.tenantId &&
      redemption.codeId === code.id &&
      redemption.userId === userId,
  ).length;
  if (usedByUser >= code.perUserLimit) {
    throw HttpError.unprocessable(
      'promo_code_user_limit',
      'Limite d’utilisation atteinte pour ce client.',
      {
        usedByUser,
        perUserLimit: code.perUserLimit,
      },
    );
  }
  if (orderTotalXof < code.minOrderXof) {
    throw HttpError.unprocessable(
      'promo_code_min_order',
      'Montant minimum non atteint pour ce code.',
      {
        orderTotalXof,
        minOrderXof: code.minOrderXof,
      },
    );
  }
  return { discountXof: discountFor(code.type, code.value, orderTotalXof) };
}

function starRating(source: Record<string, unknown>): number {
  const value = source.rating;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw HttpError.unprocessable('validation_error', 'La note doit être un entier de 1 à 5.', {
      field: 'rating',
    });
  }
  return value;
}

export function buildLoyaltyApp(options: LoyaltyAppOptions): Route[] {
  const { store, order, publish } = options;

  const requireUser = (ctx: RequestContext) => {
    if (!ctx.auth) throw HttpError.unauthorized();
    return ctx.auth;
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/loyalty',
      auth: false,
      handler: (ctx) => ({
        body: {
          tenantId: ctx.params.tenantId ?? '',
          program: programView(),
          generatedAt: nowIso(),
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/reviews',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const limit = Math.min(50, Math.max(1, Number(ctx.query.get('limit') ?? 20) || 20));
        const items = [...store.reviews.values()]
          .filter((review) => review.tenantId === tenantId && review.status === 'approved')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map(serializeReview);
        return {
          body: {
            tenantId,
            aggregate: reviewAggregate(store, tenantId),
            items,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reviews',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const statusFilter = ctx.query.get('status');
        if (statusFilter && !['pending', 'approved', 'rejected'].includes(statusFilter)) {
          throw HttpError.unprocessable('validation_error', 'Statut de modération inconnu.', {
            field: 'status',
          });
        }
        const all = [...store.reviews.values()].filter((review) => review.tenantId === tenantId);
        const items = all
          .filter((review) => !statusFilter || review.status === statusFilter)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(serializeReview);
        return {
          body: {
            tenantId,
            items,
            counts: {
              pending: all.filter((review) => review.status === 'pending').length,
              approved: all.filter((review) => review.status === 'approved').length,
              rejected: all.filter((review) => review.status === 'rejected').length,
            },
            aggregate: reviewAggregate(store, tenantId),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/reviews/:id/moderate',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const review = store.reviews.get(ctx.params.id ?? '');
        if (!review || review.tenantId !== tenantId) throw HttpError.notFound('Avis introuvable.');
        const body = asObject(ctx.body);
        const action = body.action;
        if (action !== 'approve' && action !== 'reject') {
          throw HttpError.unprocessable(
            'validation_error',
            'Action attendue : approve ou reject.',
            { field: 'action' },
          );
        }
        const status: ReviewStatus = action === 'approve' ? 'approved' : 'rejected';
        if (review.status === status) {
          throw HttpError.unprocessable('status_unchanged', 'Cet avis est déjà dans ce statut.');
        }
        review.status = status;
        review.moderatedBy = claims.sub;
        review.moderationNote = optionalString(body, 'note', { max: 240 });
        review.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'loyalty.review.moderated',
          targetType: 'review',
          targetId: review.id,
          meta: { status, rating: review.rating },
        });
        await publish('ReviewModerated', tenantId, {
          tenantId,
          reviewId: review.id,
          status,
          rating: review.rating,
          actorId: claims.sub,
          at: review.updatedAt,
        });
        return {
          body: { review: serializeReview(review), aggregate: reviewAggregate(store, tenantId) },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/loyalty/accounts',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const accounts = [...store.accounts.values()]
          .filter((account) => account.tenantId === tenantId)
          .sort((a, b) => b.lifetimePoints - a.lifetimePoints)
          .map((account) => ({
            userId: account.userId,
            points: account.points,
            lifetimePoints: account.lifetimePoints,
            tier: tierFor(account.lifetimePoints).code,
            updatedAt: account.updatedAt,
          }));
        return {
          body: {
            tenantId,
            items: accounts,
            totals: {
              members: accounts.length,
              pointsOutstanding: accounts.reduce((sum, account) => sum + account.points, 0),
              pointsEarned: accounts.reduce((sum, account) => sum + account.lifetimePoints, 0),
            },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/me/loyalty',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const tenantId = ctx.query.get('tenantId');
        if (tenantId) {
          const account = store.accounts.get(accountKey(claims.sub, tenantId));
          const view = account
            ? accountView(store, account)
            : accountView(store, getOrCreateAccount(store, claims.sub, tenantId));
          return { body: { account: view, program: programView() } };
        }
        const accounts = [...store.accounts.values()]
          .filter((account) => account.userId === claims.sub)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((account) => accountView(store, account));
        return { body: { items: accounts, program: programView() } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/loyalty/claims',
      handler: async (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const orderId = requireString(body, 'orderId', { max: 64 });
        const existing = entriesFor(store, claims.sub, tenantId).find(
          (entry) => entry.type === 'gain' && entry.orderId === orderId,
        );
        if (existing) {
          const account = getOrCreateAccount(store, claims.sub, tenantId);
          return {
            body: { alreadyCredited: true, account: accountView(store, account), entry: existing },
          };
        }
        let snapshot: OrderSnapshot;
        try {
          snapshot = await order.get<OrderSnapshot>(
            `/internal/tenants/${tenantId}/orders/${orderId}`,
          );
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            throw HttpError.notFound('Commande introuvable pour cet établissement.');
          }
          throw error;
        }
        if (snapshot.order.paymentStatus !== 'payee') {
          throw HttpError.conflict('order_not_paid', 'Cette commande n’est pas encore payée.', {
            paymentStatus: snapshot.order.paymentStatus,
          });
        }
        const account = getOrCreateAccount(store, claims.sub, tenantId);
        const multiplier = tierFor(account.lifetimePoints).multiplier;
        const { account: updated, entry } = applyEntry(store, {
          tenantId,
          userId: claims.sub,
          type: 'gain',
          points: pointsForAmount(snapshot.order.totalXof),
          reason: `Commande ${snapshot.order.number}`,
          orderId,
          multiplier,
        });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'loyalty.points.claimed',
          targetType: 'order',
          targetId: orderId,
          meta: { points: entry.points, orderNumber: snapshot.order.number },
        });
        await publish('LoyaltyPointsEarned', tenantId, {
          tenantId,
          userId: claims.sub,
          orderId,
          points: entry.points,
          balance: updated.points,
          at: entry.at,
        });
        return {
          status: 201,
          body: { alreadyCredited: false, account: accountView(store, updated), entry },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/loyalty/redeem',
      handler: async (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const rewardId = requireString(body, 'rewardId', { max: 40 });
        const reward = REWARDS.find((entry) => entry.id === rewardId);
        if (!reward) {
          throw HttpError.notFound('Récompense introuvable.');
        }
        const account = getOrCreateAccount(store, claims.sub, tenantId);
        if (account.points < reward.costPoints) {
          throw HttpError.unprocessable(
            'loyalty_insufficient_points',
            'Solde de points insuffisant.',
            {
              balance: account.points,
              required: reward.costPoints,
            },
          );
        }
        const { account: updated, entry } = applyEntry(store, {
          tenantId,
          userId: claims.sub,
          type: 'redeem',
          points: -reward.costPoints,
          reason: `Récompense : ${reward.label}`,
          rewardId,
        });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'loyalty.reward.redeemed',
          targetType: 'reward',
          targetId: reward.id,
          meta: { points: reward.costPoints, balance: updated.points },
        });
        await publish('LoyaltyRewardRedeemed', tenantId, {
          tenantId,
          userId: claims.sub,
          rewardId,
          points: reward.costPoints,
          balance: updated.points,
          at: entry.at,
        });
        return { status: 201, body: { account: accountView(store, updated), entry, reward } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/me/favorites',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        return {
          body: {
            items: favoritesFor(store, claims.sub).map((favorite) => ({
              tenantId: favorite.tenantId,
              addedAt: favorite.createdAt,
            })),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/favorites',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const key = accountKey(claims.sub, tenantId);
        const existing = store.favorites.get(key);
        if (existing) {
          return {
            body: { favorite: { tenantId, addedAt: existing.createdAt }, alreadySaved: true },
          };
        }
        const favorite = { userId: claims.sub, tenantId, createdAt: nowIso() };
        store.favorites.set(key, favorite);
        return {
          status: 201,
          body: { favorite: { tenantId, addedAt: favorite.createdAt }, alreadySaved: false },
        };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/me/favorites/:tenantId',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const tenantId = ctx.params.tenantId ?? '';
        const removed = store.favorites.delete(accountKey(claims.sub, tenantId));
        return { body: { removed, tenantId } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/me/reviews',
      handler: (ctx) => {
        const claims = requireUser(ctx);
        const tenantId = ctx.query.get('tenantId');
        const items = [...store.reviews.values()]
          .filter(
            (review) => review.userId === claims.sub && (!tenantId || review.tenantId === tenantId),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(serializeReview);
        return { body: { items } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/reviews',
      handler: async (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const rating = starRating(body);
        const comment = optionalString(body, 'comment', { max: 500 });
        const existing = [...store.reviews.values()].find(
          (review) => review.userId === claims.sub && review.tenantId === tenantId,
        );
        const now = nowIso();
        if (existing) {
          existing.rating = rating;
          existing.comment = comment;
          existing.status = 'pending';
          existing.moderationNote = undefined;
          existing.moderatedBy = undefined;
          existing.updatedAt = now;
          await publish('ReviewSubmitted', tenantId, {
            tenantId,
            reviewId: existing.id,
            rating,
            userId: claims.sub,
            updated: true,
            at: now,
          });
          return { body: { review: serializeReview(existing), updated: true } };
        }
        const review: ReviewRecord = {
          id: `rev_${claims.sub}_${tenantId}`,
          tenantId,
          userId: claims.sub,
          userName: claims.name || 'Client RESTO-HUB',
          rating,
          comment,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        store.reviews.set(review.id, review);
        await publish('ReviewSubmitted', tenantId, {
          tenantId,
          reviewId: review.id,
          rating,
          userId: claims.sub,
          updated: false,
          at: now,
        });
        return { status: 201, body: { review: serializeReview(review), updated: false } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/reviews/:id/reply',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const review = store.reviews.get(ctx.params.id ?? '');
        if (!review || review.tenantId !== tenantId) throw HttpError.notFound('Avis introuvable.');
        const body = asObject(ctx.body);
        const message = requireString(body, 'message', { min: 2, max: 500 });
        review.reply = { message, by: claims.sub, byName: claims.name, at: nowIso() };
        review.updatedAt = review.reply.at;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'loyalty.review.replied',
          targetType: 'review',
          targetId: review.id,
          meta: { rating: review.rating },
        });
        await publish('ReviewReplied', tenantId, {
          tenantId,
          reviewId: review.id,
          userId: review.userId,
          rating: review.rating,
          actorId: claims.sub,
          at: review.reply.at,
        });
        return {
          body: { review: serializeReview(review), aggregate: reviewAggregate(store, tenantId) },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/loyalty/program',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const accounts = [...store.accounts.values()].filter(
          (account) => account.tenantId === tenantId,
        );
        return {
          body: {
            tenantId,
            program: programView(),
            stats: {
              members: accounts.length,
              pointsOutstanding: accounts.reduce((sum, account) => sum + account.points, 0),
              pointsEarned: accounts.reduce((sum, account) => sum + account.lifetimePoints, 0),
            },
            reviews: reviewAggregate(store, tenantId),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/loyalty/audit',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const entries = store.audit
          .filter((entry) => entry.tenantId === tenantId)
          .slice(-100)
          .reverse();
        return {
          body: { entries, integrity: verifyAuditChain(store.audit), generatedAt: nowIso() },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/marketing/dashboard',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const accounts = [...store.accounts.values()].filter(
          (account) => account.tenantId === tenantId,
        );
        const tierCounts = Object.fromEntries(
          LOYALTY_TIERS.map((tier) => [
            tier.code,
            accounts.filter((account) => tierFor(account.lifetimePoints).code === tier.code).length,
          ]),
        );
        const promotions = [...store.promotions.values()].filter(
          (entry) => entry.tenantId === tenantId,
        );
        const promoCodes = [...store.promoCodes.values()].filter(
          (entry) => entry.tenantId === tenantId,
        );
        const campaigns = [...store.campaigns.values()].filter(
          (entry) => entry.tenantId === tenantId,
        );
        const redemptions = [...store.redemptions.values()].filter(
          (entry) => entry.tenantId === tenantId,
        );
        const reviews = [...store.reviews.values()].filter((entry) => entry.tenantId === tenantId);
        return {
          body: {
            tenantId,
            members: accounts.length,
            tiers: tierCounts,
            pointsOutstanding: accounts.reduce((sum, account) => sum + account.points, 0),
            promotions: {
              total: promotions.length,
              active: promotions.filter((entry) => promotionStatus(entry) === 'active').length,
            },
            promoCodes: {
              total: promoCodes.length,
              active: promoCodes.filter((entry) => promoStatus(entry) === 'active').length,
              redemptions: redemptions.length,
              discountXof: redemptions.reduce((sum, entry) => sum + entry.discountXof, 0),
            },
            campaigns: {
              total: campaigns.length,
              envoyees: campaigns.filter((entry) => entry.status === 'envoyee').length,
              planifiees: campaigns.filter((entry) => entry.status === 'planifiee').length,
            },
            reviews: {
              ...reviewAggregate(store, tenantId),
              pending: reviews.filter((entry) => entry.status === 'pending').length,
            },
            generatedAt: nowIso(),
          },
        };
      },
    },
    /* ----------------------------- Promotions ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/promotions',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        return {
          body: {
            tenantId,
            items: activePromotions(store, tenantId).map(serializePromotion),
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/marketing/promotions',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const items = [...store.promotions.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(serializePromotion);
        return {
          body: {
            tenantId,
            items,
            counts: {
              active: items.filter((entry) => entry.status === 'active').length,
              planifiee: items.filter((entry) => entry.status === 'planifiee').length,
              terminee: items.filter((entry) => entry.status === 'terminee').length,
              desactivee: items.filter((entry) => entry.status === 'desactivee').length,
            },
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/marketing/promotions',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const body = asObject(ctx.body);
        const discount = discountFields(body);
        const appliesToRaw = optionalString(body, 'appliesTo', { max: 20 }) ?? 'all';
        if (!['all', 'dine_in', 'delivery', 'takeaway'].includes(appliesToRaw)) {
          throw HttpError.unprocessable('validation_error', 'Canal de promotion inconnu.', {
            field: 'appliesTo',
          });
        }
        const startAt = isoDateField(body, 'startAt');
        const endAt = isoDateField(body, 'endAt');
        if (endAt <= startAt) {
          throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', {
            field: 'endAt',
          });
        }
        const now = nowIso();
        const promotion: Promotion = {
          id: `promo_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          description: optionalString(body, 'description', { max: 300 }) ?? '',
          type: discount.type,
          value: discount.value,
          minOrderXof: optionalNumberField(body, 'minOrderXof', 0),
          appliesTo: appliesToRaw as Promotion['appliesTo'],
          startAt,
          endAt,
          active: body.active === false ? false : true,
          createdAt: now,
          createdBy: claims.sub,
          updatedAt: now,
        };
        store.promotions.set(promotion.id, promotion);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.promotion.created',
          targetType: 'promotion',
          targetId: promotion.id,
          meta: { name: promotion.name, type: promotion.type, value: promotion.value },
        });
        await publish('PromotionCreated', tenantId, {
          tenantId,
          promotionId: promotion.id,
          name: promotion.name,
          type: promotion.type,
          value: promotion.value,
          startAt,
          endAt,
        });
        return { status: 201, body: { promotion: serializePromotion(promotion) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/marketing/promotions/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const promotion = store.promotions.get(ctx.params.id ?? '');
        if (!promotion || promotion.tenantId !== tenantId)
          throw HttpError.notFound('Promotion introuvable.');
        const body = asObject(ctx.body);
        if (body.name !== undefined)
          promotion.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.description !== undefined)
          promotion.description = optionalString(body, 'description', { max: 300 }) ?? '';
        if (body.type !== undefined || body.value !== undefined) {
          const discount = discountFields({
            type: body.type ?? promotion.type,
            value: body.value ?? promotion.value,
          });
          promotion.type = discount.type;
          promotion.value = discount.value;
        }
        if (body.minOrderXof !== undefined)
          promotion.minOrderXof = optionalNumberField(body, 'minOrderXof', 0);
        if (body.startAt !== undefined) promotion.startAt = isoDateField(body, 'startAt');
        if (body.endAt !== undefined) promotion.endAt = isoDateField(body, 'endAt');
        if (promotion.endAt <= promotion.startAt) {
          throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', {
            field: 'endAt',
          });
        }
        if (body.active !== undefined) promotion.active = body.active !== false;
        promotion.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.promotion.updated',
          targetType: 'promotion',
          targetId: promotion.id,
          meta: { active: promotion.active },
        });
        return { body: { promotion: serializePromotion(promotion) } };
      },
    },
    /* ----------------------------- Codes promo ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/marketing/promo-codes',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const items = [...store.promoCodes.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(serializePromoCode);
        const redemptions = [...store.redemptions.values()].filter(
          (entry) => entry.tenantId === tenantId,
        );
        return {
          body: {
            tenantId,
            items,
            redemptions: redemptions
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 50)
              .map((entry) => ({ ...entry })),
            totals: {
              redemptions: redemptions.length,
              discountXof: redemptions.reduce((sum, entry) => sum + entry.discountXof, 0),
            },
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/marketing/promo-codes',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const body = asObject(ctx.body);
        const code = requireString(body, 'code', { min: 3, max: 24 }).trim().toUpperCase();
        if (!/^[A-Z0-9_-]+$/.test(code)) {
          throw HttpError.unprocessable(
            'validation_error',
            'Code attendu : lettres, chiffres, - et _.',
            { field: 'code' },
          );
        }
        if (findPromoCode(store, tenantId, code)) {
          throw HttpError.conflict(
            'promo_code_exists',
            'Ce code existe déjà pour cet établissement.',
          );
        }
        const discount = discountFields(body);
        const startAt = isoDateField(body, 'startAt');
        const endAt = isoDateField(body, 'endAt');
        if (endAt <= startAt) {
          throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', {
            field: 'endAt',
          });
        }
        const maxUses = optionalNumberField(body, 'maxUses', 0);
        const now = nowIso();
        const promoCode: PromoCode = {
          id: `pc_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          code,
          type: discount.type,
          value: discount.value,
          minOrderXof: optionalNumberField(body, 'minOrderXof', 0),
          maxUses: maxUses > 0 ? Math.round(maxUses) : null,
          uses: 0,
          perUserLimit: Math.max(1, Math.round(optionalNumberField(body, 'perUserLimit', 1))),
          startAt,
          endAt,
          active: body.active === false ? false : true,
          createdAt: now,
          createdBy: claims.sub,
          updatedAt: now,
        };
        store.promoCodes.set(promoCode.id, promoCode);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.promo_code.created',
          targetType: 'promo_code',
          targetId: promoCode.id,
          meta: { code, type: promoCode.type, value: promoCode.value },
        });
        return { status: 201, body: { promoCode: serializePromoCode(promoCode) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/marketing/promo-codes/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const promoCode = store.promoCodes.get(ctx.params.id ?? '');
        if (!promoCode || promoCode.tenantId !== tenantId)
          throw HttpError.notFound('Code promo introuvable.');
        const body = asObject(ctx.body);
        if (body.type !== undefined || body.value !== undefined) {
          const discount = discountFields({
            type: body.type ?? promoCode.type,
            value: body.value ?? promoCode.value,
          });
          promoCode.type = discount.type;
          promoCode.value = discount.value;
        }
        if (body.minOrderXof !== undefined)
          promoCode.minOrderXof = optionalNumberField(body, 'minOrderXof', 0);
        if (body.maxUses !== undefined) {
          const maxUses = optionalNumberField(body, 'maxUses', 0);
          promoCode.maxUses = maxUses > 0 ? Math.round(maxUses) : null;
        }
        if (body.perUserLimit !== undefined) {
          promoCode.perUserLimit = Math.max(
            1,
            Math.round(optionalNumberField(body, 'perUserLimit', 1)),
          );
        }
        if (body.startAt !== undefined) promoCode.startAt = isoDateField(body, 'startAt');
        if (body.endAt !== undefined) promoCode.endAt = isoDateField(body, 'endAt');
        if (promoCode.endAt <= promoCode.startAt) {
          throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', {
            field: 'endAt',
          });
        }
        if (body.active !== undefined) promoCode.active = body.active !== false;
        promoCode.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.promo_code.updated',
          targetType: 'promo_code',
          targetId: promoCode.id,
          meta: { active: promoCode.active },
        });
        return { body: { promoCode: serializePromoCode(promoCode) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/public/tenants/:tenantId/promo-codes/:code/validate',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const promoCode = findPromoCode(store, tenantId, ctx.params.code ?? '');
        if (!promoCode) {
          return {
            body: {
              valid: false,
              reason: 'promo_code_unknown',
              message: 'Code inconnu pour cet établissement.',
            },
          };
        }
        const body = asObject(ctx.body ?? {});
        const orderTotalXof = optionalNumberField(body, 'orderTotalXof', 0);
        const status = promoStatus(promoCode);
        if (status !== 'active') {
          return {
            body: {
              valid: false,
              reason: 'promo_code_inactive',
              status,
              message: 'Code inactif sur la période en cours.',
            },
          };
        }
        if (promoCode.maxUses !== null && promoCode.uses >= promoCode.maxUses) {
          return {
            body: {
              valid: false,
              reason: 'promo_code_exhausted',
              message: 'Ce code a atteint sa limite d’utilisation.',
            },
          };
        }
        if (orderTotalXof < promoCode.minOrderXof) {
          return {
            body: {
              valid: false,
              reason: 'promo_code_min_order',
              message: `Montant minimum : ${promoCode.minOrderXof} F CFA.`,
              minOrderXof: promoCode.minOrderXof,
            },
          };
        }
        return {
          body: {
            valid: true,
            code: promoCode.code,
            type: promoCode.type,
            value: promoCode.value,
            discountXof: discountFor(promoCode.type, promoCode.value, orderTotalXof),
            orderTotalXof,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/me/promo-codes/redeem',
      handler: async (ctx) => {
        const claims = requireUser(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 64 });
        const orderId = requireString(body, 'orderId', { max: 64 });
        const promoCode = findPromoCode(store, tenantId, requireString(body, 'code', { max: 24 }));
        if (!promoCode) throw HttpError.notFound('Code promo introuvable pour cet établissement.');
        const existing = [...store.redemptions.values()].find(
          (entry) =>
            entry.tenantId === tenantId &&
            entry.userId === claims.sub &&
            entry.orderId === orderId &&
            entry.codeId === promoCode.id,
        );
        if (existing) {
          return {
            body: {
              alreadyRedeemed: true,
              redemption: existing,
              promoCode: serializePromoCode(promoCode),
            },
          };
        }
        let orderTotalXof: number;
        try {
          const snapshot = await order.get<{ order: { totalXof: number; tenantId: string } }>(
            `/internal/tenants/${tenantId}/orders/${orderId}`,
          );
          orderTotalXof = snapshot.order.totalXof;
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            throw HttpError.notFound('Commande introuvable pour cet établissement.');
          }
          throw error;
        }
        const { discountXof } = validatePromoAgainstOrder(
          store,
          promoCode,
          claims.sub,
          orderTotalXof,
        );
        promoCode.uses += 1;
        promoCode.updatedAt = nowIso();
        const redemption: PromoRedemption = {
          id: `red_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          codeId: promoCode.id,
          code: promoCode.code,
          userId: claims.sub,
          orderId,
          orderTotalXof,
          discountXof,
          at: nowIso(),
        };
        store.redemptions.set(redemption.id, redemption);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.promo_code.redeemed',
          targetType: 'promo_code',
          targetId: promoCode.id,
          meta: { code: promoCode.code, orderId, discountXof },
        });
        await publish('PromoCodeRedeemed', tenantId, {
          tenantId,
          userId: claims.sub,
          code: promoCode.code,
          orderId,
          discountXof,
          orderTotalXof,
          at: redemption.at,
        });
        return {
          status: 201,
          body: { alreadyRedeemed: false, redemption, promoCode: serializePromoCode(promoCode) },
        };
      },
    },
    /* ----------------------------- Campagnes ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/marketing/campaigns',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'loyalty:view');
        const items = [...store.campaigns.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          body: {
            tenantId,
            items,
            segments: ['all', ...LOYALTY_TIERS.map((tier) => tier.code), 'inactifs'],
            channels: ['sms', 'email', 'push'],
            audience: Object.fromEntries(
              (
                ['all', ...LOYALTY_TIERS.map((tier) => tier.code), 'inactifs'] as CampaignSegment[]
              ).map((segment) => [segment, campaignRecipients(store, tenantId, segment).length]),
            ),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/marketing/campaigns',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const body = asObject(ctx.body);
        const channel = requireString(body, 'channel', { max: 10 });
        if (!['sms', 'email', 'push'].includes(channel)) {
          throw HttpError.unprocessable('validation_error', 'Canal attendu : sms, email ou push.', {
            field: 'channel',
          });
        }
        const segment = optionalString(body, 'segment', { max: 20 }) ?? 'all';
        const segments = ['all', ...LOYALTY_TIERS.map((tier) => tier.code), 'inactifs'];
        if (!segments.includes(segment)) {
          throw HttpError.unprocessable('validation_error', 'Segment inconnu.', {
            field: 'segment',
          });
        }
        const scheduledAt =
          body.scheduledAt === undefined || body.scheduledAt === null
            ? null
            : isoDateField(body, 'scheduledAt');
        if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) {
          throw HttpError.unprocessable('validation_error', 'La planification doit être future.', {
            field: 'scheduledAt',
          });
        }
        const now = nowIso();
        const campaign: Campaign = {
          id: `cmp_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          channel: channel as CampaignChannel,
          segment: segment as CampaignSegment,
          message: requireString(body, 'message', { min: 3, max: 500 }),
          scheduledAt,
          status: scheduledAt ? 'planifiee' : 'brouillon',
          recipients: null,
          sentAt: null,
          createdAt: now,
          createdBy: claims.sub,
          updatedAt: now,
        };
        store.campaigns.set(campaign.id, campaign);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.campaign.created',
          targetType: 'campaign',
          targetId: campaign.id,
          meta: { channel: campaign.channel, segment: campaign.segment, scheduledAt },
        });
        return { status: 201, body: { campaign } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/marketing/campaigns/:id/send',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const campaign = store.campaigns.get(ctx.params.id ?? '');
        if (!campaign || campaign.tenantId !== tenantId)
          throw HttpError.notFound('Campagne introuvable.');
        if (campaign.status === 'envoyee')
          throw HttpError.conflict('campaign_already_sent', 'Cette campagne a déjà été envoyée.');
        if (campaign.status === 'annulee')
          throw HttpError.conflict('campaign_cancelled', 'Cette campagne a été annulée.');
        const audience = campaignRecipients(store, tenantId, campaign.segment);
        campaign.status = 'envoyee';
        campaign.recipients = audience.length;
        campaign.sentAt = nowIso();
        campaign.updatedAt = campaign.sentAt;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.campaign.sent',
          targetType: 'campaign',
          targetId: campaign.id,
          meta: {
            channel: campaign.channel,
            segment: campaign.segment,
            recipients: audience.length,
          },
        });
        await publish('CampaignSent', tenantId, {
          tenantId,
          campaignId: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          segment: campaign.segment,
          message: campaign.message,
          recipients: audience.length,
          recipientUserIds: audience.map((account) => account.userId),
          at: campaign.sentAt,
        });
        return { body: { campaign } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/marketing/campaigns/:id/cancel',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'loyalty:manage');
        const campaign = store.campaigns.get(ctx.params.id ?? '');
        if (!campaign || campaign.tenantId !== tenantId)
          throw HttpError.notFound('Campagne introuvable.');
        if (campaign.status === 'envoyee')
          throw HttpError.conflict('campaign_already_sent', 'Campagne déjà envoyée.');
        if (campaign.status === 'annulee')
          throw HttpError.unprocessable('campaign_cancelled', 'Campagne déjà annulée.');
        campaign.status = 'annulee';
        campaign.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'marketing.campaign.cancelled',
          targetType: 'campaign',
          targetId: campaign.id,
          meta: {},
        });
        return { body: { campaign } };
      },
    },
  ];
}

export function handleLoyaltyEvent(
  store: LoyaltyStore,
  envelope: { type: string; tenantId: string | null; payload: Record<string, unknown> },
): void {
  if (envelope.type !== 'OrderPaid') return;
  const tenantId = envelope.payload.tenantId;
  const userId = envelope.payload.customerUserId;
  const orderId = envelope.payload.orderId;
  const amount = envelope.payload.totalXof ?? envelope.payload.amountXof;
  if (typeof tenantId !== 'string' || typeof userId !== 'string' || typeof orderId !== 'string')
    return;
  if (typeof amount !== 'number' || amount <= 0) return;
  const already = entriesFor(store, userId, tenantId).some(
    (entry) => entry.type === 'gain' && entry.orderId === orderId,
  );
  if (already) return;
  const account = getOrCreateAccount(store, userId, tenantId);
  const multiplier = tierFor(account.lifetimePoints).multiplier;
  applyEntry(store, {
    tenantId,
    userId,
    type: 'gain',
    points: pointsForAmount(amount),
    reason: `Commande ${String(envelope.payload.number ?? orderId)}`,
    orderId,
    multiplier,
  });
}
