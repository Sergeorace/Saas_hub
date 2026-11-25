import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';

export const LOYALTY_TIERS = [
  { code: 'bronze', label: 'Bronze', minLifetimePoints: 0, multiplier: 1 },
  { code: 'argent', label: 'Argent', minLifetimePoints: 500, multiplier: 1.1 },
  { code: 'or', label: 'Or', minLifetimePoints: 2000, multiplier: 1.25 },
  { code: 'platine', label: 'Platine', minLifetimePoints: 5000, multiplier: 1.5 },
] as const;
export type LoyaltyTierCode = (typeof LOYALTY_TIERS)[number]['code'];

export const REWARDS = [
  {
    id: 'rw_dessert',
    label: 'Dessert offert',
    description: 'Un dessert maison au choix, sur place uniquement.',
    costPoints: 250,
  },
  {
    id: 'rw_boisson',
    label: 'Boisson maison offerte',
    description: 'Cocktail sans alcool ou jus frais du jour.',
    costPoints: 300,
  },
  {
    id: 'rw_remise10',
    label: 'Remise 10 %',
    description: '10 % de remise sur la prochaine addition.',
    costPoints: 600,
  },
] as const;

export const POINTS_PER_XOF = 500;

export type LoyaltyEntryType = 'gain' | 'redeem' | 'bonus' | 'adjustment';

export interface LoyaltyEntry {
  id: string;
  tenantId: string;
  userId: string;
  type: LoyaltyEntryType;
  points: number;
  reason: string;
  orderId?: string;
  rewardId?: string;
  balanceAfter: number;
  at: string;
}

export interface LoyaltyAccount {
  userId: string;
  tenantId: string;
  points: number;
  lifetimePoints: number;
  tier: LoyaltyTierCode;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteRecord {
  userId: string;
  tenantId: string;
  createdAt: string;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewReply {
  message: string;
  by: string;
  byName: string;
  at: string;
}

export interface ReviewRecord {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  rating: number;
  comment?: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  moderatedBy?: string;
  moderationNote?: string;
  reply?: ReviewReply;
}

export type DiscountType = 'percent' | 'amount';

export interface Promotion {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: DiscountType;
  value: number;
  minOrderXof: number;
  appliesTo: 'all' | 'dine_in' | 'delivery' | 'takeaway';
  startAt: string;
  endAt: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface PromoCode {
  id: string;
  tenantId: string;
  code: string;
  type: DiscountType;
  value: number;
  minOrderXof: number;
  maxUses: number | null;
  uses: number;
  perUserLimit: number;
  startAt: string;
  endAt: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface PromoRedemption {
  id: string;
  tenantId: string;
  codeId: string;
  code: string;
  userId: string;
  orderId: string;
  orderTotalXof: number;
  discountXof: number;
  at: string;
}

export type CampaignChannel = 'sms' | 'email' | 'push';
export type CampaignStatus = 'brouillon' | 'planifiee' | 'envoyee' | 'annulee';
export type CampaignSegment = 'all' | LoyaltyTierCode | 'inactifs';

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  channel: CampaignChannel;
  segment: CampaignSegment;
  message: string;
  scheduledAt: string | null;
  status: CampaignStatus;
  recipients: number | null;
  sentAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface LoyaltyStore {
  accounts: Map<string, LoyaltyAccount>;
  entries: Map<string, LoyaltyEntry>;
  favorites: Map<string, FavoriteRecord>;
  reviews: Map<string, ReviewRecord>;
  promotions: Map<string, Promotion>;
  promoCodes: Map<string, PromoCode>;
  redemptions: Map<string, PromoRedemption>;
  campaigns: Map<string, Campaign>;
  audit: AuditEntry[];
  recordAudit(input: {
    tenantId: string | null;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  }): AuditEntry;
}

export function accountKey(userId: string, tenantId: string): string {
  return `${tenantId}::${userId}`;
}

export function createLoyaltyStore(): LoyaltyStore {
  const store: LoyaltyStore = {
    accounts: new Map(),
    entries: new Map(),
    favorites: new Map(),
    reviews: new Map(),
    promotions: new Map(),
    promoCodes: new Map(),
    redemptions: new Map(),
    campaigns: new Map(),
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

export function tierFor(lifetimePoints: number) {
  return [...LOYALTY_TIERS].reverse().find((tier) => lifetimePoints >= tier.minLifetimePoints) ?? LOYALTY_TIERS[0];
}

export function getOrCreateAccount(store: LoyaltyStore, userId: string, tenantId: string): LoyaltyAccount {
  const key = accountKey(userId, tenantId);
  const existing = store.accounts.get(key);
  if (existing) return existing;
  const now = nowIso();
  const account: LoyaltyAccount = {
    userId,
    tenantId,
    points: 0,
    lifetimePoints: 0,
    tier: 'bronze',
    createdAt: now,
    updatedAt: now,
  };
  store.accounts.set(key, account);
  return account;
}

export function pointsForAmount(amountXof: number): number {
  return Math.max(1, Math.floor(amountXof / POINTS_PER_XOF));
}

export function applyEntry(
  store: LoyaltyStore,
  input: {
    tenantId: string;
    userId: string;
    type: LoyaltyEntryType;
    points: number;
    reason: string;
    orderId?: string;
    rewardId?: string;
    multiplier?: number;
  },
): { account: LoyaltyAccount; entry: LoyaltyEntry } {
  const account = getOrCreateAccount(store, input.userId, input.tenantId);
  const now = nowIso();
  if (input.type === 'gain') {
    const multiplier = input.multiplier ?? 1;
    const points = Math.max(1, Math.round(input.points * multiplier));
    account.points += points;
    account.lifetimePoints += points;
    input = { ...input, points };
  } else {
    account.points += input.points;
  }
  account.tier = tierFor(account.lifetimePoints).code;
  account.updatedAt = now;
  const entry: LoyaltyEntry = {
    id: newId('loy'),
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    points: input.points,
    reason: input.reason,
    orderId: input.orderId,
    rewardId: input.rewardId,
    balanceAfter: account.points,
    at: now,
  };
  store.entries.set(entry.id, entry);
  return { account, entry };
}

export function entriesFor(store: LoyaltyStore, userId: string, tenantId: string): LoyaltyEntry[] {
  return [...store.entries.values()]
    .filter((entry) => entry.userId === userId && entry.tenantId === tenantId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function favoritesFor(store: LoyaltyStore, userId: string): FavoriteRecord[] {
  return [...store.favorites.values()]
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function reviewAggregate(store: LoyaltyStore, tenantId: string) {
  const approved = [...store.reviews.values()].filter(
    (review) => review.tenantId === tenantId && review.status === 'approved',
  );
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const review of approved) {
    distribution[review.rating] = (distribution[review.rating] ?? 0) + 1;
    sum += review.rating;
  }
  return {
    count: approved.length,
    average: approved.length > 0 ? Math.round((sum / approved.length) * 10) / 10 : 0,
    distribution,
    replied: approved.filter((review) => review.reply).length,
  };
}

export type PromotionStatus = 'active' | 'planifiee' | 'terminee' | 'desactivee';

export function promotionStatus(
  promotion: { active: boolean; startAt: string; endAt: string },
  at = nowIso(),
): PromotionStatus {
  if (!promotion.active) return 'desactivee';
  if (at < promotion.startAt) return 'planifiee';
  if (at > promotion.endAt) return 'terminee';
  return 'active';
}

export function discountFor(type: DiscountType, value: number, totalXof: number): number {
  const raw = type === 'percent' ? (totalXof * value) / 100 : value;
  return Math.max(0, Math.min(totalXof, Math.round(raw)));
}

export function activePromotions(store: LoyaltyStore, tenantId: string, at = nowIso()): Promotion[] {
  return [...store.promotions.values()]
    .filter((promotion) => promotion.tenantId === tenantId && promotionStatus(promotion, at) === 'active')
    .sort((a, b) => a.endAt.localeCompare(b.endAt));
}

export function findPromoCode(store: LoyaltyStore, tenantId: string, code: string): PromoCode | undefined {
  const normalized = code.trim().toUpperCase();
  return [...store.promoCodes.values()].find(
    (entry) => entry.tenantId === tenantId && entry.code === normalized,
  );
}

export function campaignRecipients(
  store: LoyaltyStore,
  tenantId: string,
  segment: CampaignSegment,
): LoyaltyAccount[] {
  const accounts = [...store.accounts.values()].filter((account) => account.tenantId === tenantId);
  const inactiveSince = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  if (segment === 'all') return accounts;
  if (segment === 'inactifs') return accounts.filter((account) => account.updatedAt < inactiveSince);
  return accounts.filter((account) => tierFor(account.lifetimePoints).code === segment);
}

export function seedLoyaltyDemo(store: LoyaltyStore): void {
  if (store.reviews.size > 0) return;
  const now = nowIso();
  const review = (
    id: string,
    tenantId: string,
    userId: string,
    userName: string,
    rating: number,
    comment: string,
    status: ReviewStatus,
    daysAgo: number,
  ): ReviewRecord => {
    const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return {
      id,
      tenantId,
      userId,
      userName,
      rating,
      comment,
      status,
      createdAt: at,
      updatedAt: at,
      ...(status === 'approved' ? { moderatedBy: 'usr_demo_seed' } : {}),
    };
  };
  const reviews = [
    review('rev_demo_1', 'tnt_sahelgrill', 'usr_demo_visiteur', 'Akouvi M.', 5, 'Poulet braisé parfait, service rapide malgré le monde.', 'approved', 2),
    review('rev_demo_2', 'tnt_sahelgrill', 'usr_demo_kossi', 'Kossi A.', 4, 'Très bonne terrasse, addition un peu salée le week-end.', 'approved', 6),
    review('rev_demo_3', 'tnt_sahelgrill', 'usr_demo_sena', 'Sena A.', 5, 'Le bissap maison est incontournable.', 'approved', 12),
    review('rev_demo_4', 'tnt_sahelgrill', 'usr_demo_ami', 'Ami S.', 3, 'Attente longue samedi soir, mais plats généreux.', 'pending', 1),
    review('rev_demo_5', 'tnt_baobab', 'usr_demo_visiteur', 'Akouvi M.', 5, 'Cocktails signature et ambiance live au top.', 'approved', 3),
    review('rev_demo_6', 'tnt_baobab', 'usr_demo_sena', 'Sena A.', 4, 'Cuisine de rue relevée comme il faut.', 'approved', 9),
    review('rev_demo_7', 'tnt_lagune', 'usr_demo_kossi', 'Kossi A.', 5, 'Poisson grillé face à la lagune, coucher de soleil magique.', 'approved', 4),
  ];
  for (const entry of reviews) store.reviews.set(entry.id, entry);

  const demoAccount = getOrCreateAccount(store, 'usr_demo_visiteur', 'tnt_sahelgrill');
  demoAccount.points = 640;
  demoAccount.lifetimePoints = 640;
  demoAccount.tier = 'argent';
  store.accounts.set(accountKey('usr_demo_visiteur', 'tnt_sahelgrill'), demoAccount);
  const history: Array<[number, string, number]> = [
    [160, 'Commande CMD-2026-000004', 8],
    [180, 'Commande CMD-2026-000005', 5],
    [300, 'Bonus bienvenue', 30],
  ];
  let balance = 0;
  for (const [points, reason, daysAgo] of [...history].reverse()) {
    balance += points;
    const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const entry: LoyaltyEntry = {
      id: newId('loy'),
      tenantId: 'tnt_sahelgrill',
      userId: 'usr_demo_visiteur',
      type: points === 300 ? 'bonus' : 'gain',
      points,
      reason,
      balanceAfter: balance,
      at,
    };
    store.entries.set(entry.id, entry);
  }

  store.favorites.set(accountKey('usr_demo_visiteur', 'tnt_sahelgrill'), {
    userId: 'usr_demo_visiteur',
    tenantId: 'tnt_sahelgrill',
    createdAt: now,
  });

  const demoReview = store.reviews.get('rev_demo_1');
  if (demoReview) {
    demoReview.reply = {
      message: 'Merci Akouvi ! L’équipe vous attend avec plaisir autour d’un bissap offert.',
      by: 'usr_demo_gerant',
      byName: 'Gérant Sahel Grill',
      at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const promotions: Promotion[] = [
    {
      id: 'promo_heures_creuses',
      tenantId: 'tnt_sahelgrill',
      name: 'Happy hours 16h-18h',
      description: '−15 % sur les boissons maison en début de soirée.',
      type: 'percent',
      value: 15,
      minOrderXof: 1500,
      appliesTo: 'dine_in',
      startAt: daysFromNow(-10),
      endAt: daysFromNow(20),
      active: true,
      createdAt: now,
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
    {
      id: 'promo_famille',
      tenantId: 'tnt_sahelgrill',
      name: 'Menu famille',
      description: '2 000 F CFA offerts dès 15 000 F CFA d’addition.',
      type: 'amount',
      value: 2000,
      minOrderXof: 15000,
      appliesTo: 'dine_in',
      startAt: daysFromNow(-5),
      endAt: daysFromNow(25),
      active: true,
      createdAt: now,
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
  ];
  for (const promotion of promotions) store.promotions.set(promotion.id, promotion);

  const promoCodes: PromoCode[] = [
    {
      id: 'pc_bienvenue',
      tenantId: 'tnt_sahelgrill',
      code: 'BIENVENUE10',
      type: 'percent',
      value: 10,
      minOrderXof: 3000,
      maxUses: null,
      uses: 12,
      perUserLimit: 1,
      startAt: daysFromNow(-30),
      endAt: daysFromNow(60),
      active: true,
      createdAt: now,
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
    {
      id: 'pc_weekend',
      tenantId: 'tnt_sahelgrill',
      code: 'WEEKEND2000',
      type: 'amount',
      value: 2000,
      minOrderXof: 10000,
      maxUses: 100,
      uses: 96,
      perUserLimit: 2,
      startAt: daysFromNow(-14),
      endAt: daysFromNow(14),
      active: true,
      createdAt: now,
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
  ];
  for (const code of promoCodes) store.promoCodes.set(code.id, code);

  store.redemptions.set('red_demo_1', {
    id: 'red_demo_1',
    tenantId: 'tnt_sahelgrill',
    codeId: 'pc_bienvenue',
    code: 'BIENVENUE10',
    userId: 'usr_demo_visiteur',
    orderId: 'ord_demo_paid_1',
    orderTotalXof: 12000,
    discountXof: 1200,
    at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const campaigns: Campaign[] = [
    {
      id: 'cmp_demo_sms',
      tenantId: 'tnt_sahelgrill',
      name: 'Week-end grillades',
      channel: 'sms',
      segment: 'all',
      message: 'Ce week-end : brochettes + bissap à 4 500 F CFA. Réservez votre table !',
      scheduledAt: null,
      status: 'envoyee',
      recipients: 1,
      sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
    {
      id: 'cmp_demo_push',
      tenantId: 'tnt_sahelgrill',
      name: 'Nouveaux cocktails',
      channel: 'push',
      segment: 'argent',
      message: 'Découvrez les cocktails signature du barman Sena, points fidélité doublés cette semaine.',
      scheduledAt: daysFromNow(2),
      status: 'planifiee',
      recipients: null,
      sentAt: null,
      createdAt: now,
      createdBy: 'usr_demo_seed',
      updatedAt: now,
    },
  ];
  for (const campaign of campaigns) store.campaigns.set(campaign.id, campaign);

  store.recordAudit({
    tenantId: null,
    actorId: 'usr_demo_seed',
    action: 'loyalty.seeded',
    targetType: 'loyalty',
    targetId: 'demo',
    meta: {
      reviews: store.reviews.size,
      accounts: store.accounts.size,
      promotions: promotions.length,
      promoCodes: promoCodes.length,
      campaigns: campaigns.length,
    },
  });
}
