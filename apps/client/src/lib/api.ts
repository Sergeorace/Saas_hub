/**
 * Client HTTP de l'application cliente RESTO-HUB (PWA).
 * L'application ne fait aucun filtrage d'isolation : le tenant_id est contrôlé
 * côté serveur par chaque service (voir tests d'isolation des services).
 */

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const IDENTITY_URL = env.VITE_IDENTITY_URL ?? 'http://localhost:4001';
export const TENANT_URL = env.VITE_TENANT_URL ?? 'http://localhost:4002';
export const CATALOG_URL = env.VITE_CATALOG_URL ?? 'http://localhost:4003';
export const FLOOR_URL = env.VITE_FLOOR_URL ?? 'http://localhost:4004';
export const ORDER_URL = env.VITE_ORDER_URL ?? 'http://localhost:4005';
export const LOYALTY_URL = env.VITE_LOYALTY_URL ?? 'http://localhost:4006';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export const SESSION_KEY = 'restohub.client.session';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistRefreshedTokens(bundle: TokenBundle) {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.accessToken = bundle.accessToken;
      parsed.refreshToken = bundle.refreshToken;
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
    }
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new CustomEvent<TokenBundle>('restohub:client-tokens', { detail: bundle }));
}

let refreshPromise: Promise<TokenBundle | null> | null = null;

function refreshSession(): Promise<TokenBundle | null> {
  refreshPromise ??= (async () => {
    const stored = readStoredSession();
    if (!stored) return null;
    try {
      const response = await fetch(`${IDENTITY_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });
      if (!response.ok) return null;
      const bundle = (await response.json()) as TokenBundle;
      setAccessToken(bundle.accessToken);
      persistRefreshedTokens(bundle);
      return bundle;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

interface RequestOptions {
  token?: string | null;
  headers?: Record<string, string>;
}

async function request<T>(
  baseUrl: string,
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const token = options.token === undefined ? accessToken : options.token;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const send = async (bearer: string | null): Promise<Response> => {
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    else delete headers.authorization;
    try {
      return await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'Service injoignable. Vérifiez la connexion ou que les services sont démarrés.',
      );
    }
  };

  let response = await send(token);
  if (response.status === 401 && token) {
    const bundle = await refreshSession();
    if (bundle) response = await send(bundle.accessToken);
    else window.dispatchEvent(new Event('restohub:client-session-expired'));
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiErrorPayload } | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? 'La requête a échoué.',
      error?.details,
    );
  }

  return payload as T;
}

const identity = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(IDENTITY_URL, method, path, body, options);
const tenant = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(TENANT_URL, method, path, body, options);
const catalog = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(CATALOG_URL, method, path, body, options);
const floor = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(FLOOR_URL, method, path, body, options);
const order = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(ORDER_URL, method, path, body, options);
const loyalty = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(LOYALTY_URL, method, path, body, options);

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ClientUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  locale: 'fr' | 'en';
  status: string;
  createdAt: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  user: ClientUser;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: ClientUser;
}

export interface PhoneChallenge {
  challengeId: string;
  expiresAt: string;
  channel: string;
  devCode?: string;
}

export interface MeResult {
  user: ClientUser;
  claims: { platformRoles: string[]; platformPermissions: string[]; tenantPermissions: Record<string, string[]>; mfa: boolean };
  mfaPolicyRequired: boolean;
}

export interface EstablishmentHours {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
}

export interface Establishment {
  id: string;
  slug: string;
  subdomain: string;
  brandName: string;
  kind: 'restaurant' | 'bar' | 'both';
  description: string;
  logoUrl: string | null;
  photos: string[];
  primaryColor: string;
  secondaryColor: string;
  languages: string[];
  currency: string;
  timezone: string;
  address: { street?: string; district?: string; city?: string; country?: string } | null;
  geo: { lat: number; lng: number } | null;
  contactPhone: string | null;
  hours: EstablishmentHours[];
  siteCount: number;
  primarySite: { id: string; name: string; address: string; phone: string | null } | null;
  updatedAt: string;
}

export interface EstablishmentSite {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  isPrimary: boolean;
}

export interface ReviewAggregate {
  count: number;
  average: number;
  distribution: Record<string, number>;
}

export interface Review {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyTier {
  code: string;
  label: string;
  minLifetimePoints: number;
  multiplier: number;
}

export interface LoyaltyReward {
  id: string;
  label: string;
  costPoints: number;
}

export interface LoyaltyProgram {
  pointsPerXof: number;
  currency: string;
  tiers: LoyaltyTier[];
  rewards: LoyaltyReward[];
  rules: string;
}

export interface LoyaltyHistoryEntry {
  id: string;
  type: 'gain' | 'redeem' | 'adjustment';
  points: number;
  reason: string;
  orderId?: string;
  balanceAfter: number;
  at: string;
}

export interface LoyaltyAccount {
  tenantId: string;
  points: number;
  lifetimePoints: number;
  tier: { code: string; label: string; multiplier: number };
  nextTier: { code: string; label: string; pointsNeeded: number } | null;
  history: LoyaltyHistoryEntry[];
  updatedAt: string;
}

export type Allergen =
  | 'gluten' | 'crustaces' | 'oeufs' | 'poisson' | 'arachides' | 'soja' | 'lait'
  | 'fruits_a_coque' | 'celeri' | 'moutarde' | 'sesame' | 'sulfites' | 'lupin' | 'mollusques';

export interface ProductVariant {
  id: string;
  name: string;
  priceXof: number;
}

export interface OptionChoice {
  id: string;
  name: string;
  priceDeltaXof: number;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  choices: OptionChoice[];
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  photos: string[];
  allergens: string[];
  station: 'cuisine' | 'bar';
  priceXof: number;
  basePriceXof: number;
  variants: ProductVariant[];
  options: ProductOptionGroup[];
  available: boolean;
}

export interface ComposedMenu {
  id: string;
  name: string;
  description?: string;
  priceXof: number;
  items: Array<{ name: string; quantity: number }>;
}

export interface PublicMenuPayload {
  tenantId: string;
  generatedAt: string;
  categories: Array<{ id: string; name: string; products: PublicMenuProduct[] }>;
  menus: ComposedMenu[];
  promotions: Array<{ id: string; name: string; code?: string; type: 'percent' | 'amount'; value: number }>;
}

export type ReservationStatus = 'confirmee' | 'installee' | 'annulee' | 'no_show';

export interface Reservation {
  id: string;
  reference: string;
  date: string;
  time: string;
  partySize: number;
  status: ReservationStatus;
  tableId: string | null;
  tableCode: string | null;
  zoneName: string | null;
  note: string | null;
  source: 'client' | 'staff';
  createdAt: string;
  updatedAt: string;
  seatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface ReservationAvailability {
  tenantId: string;
  date: string;
  partySize: number;
  slots: Array<{ time: string; tablesAvailable: number; available: boolean }>;
  tables: Array<{
    id: string;
    code: string;
    capacity: number;
    effectiveCapacity: number;
    type: string;
    zoneId: string;
    zoneName: string | null;
  }>;
  generatedAt: string;
}

export type OrderChannel = 'sur_place' | 'a_emporter' | 'livraison' | 'precommande';
export type OrderStatus = 'recue' | 'en_preparation' | 'prete' | 'servie' | 'annulee';
export type PaymentStatus = 'impayee' | 'partielle' | 'payee';

export interface PublicOrder {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  statusLabel: string;
  tableCode?: string;
  lines: Array<{ name: string; variantName?: string; quantity: number; lineTotalXof: number }>;
  totalXof: number;
  paidXof: number;
  paymentStatus: PaymentStatus;
  scheduledFor?: string;
  createdAt: string;
  timeline: Array<{ status: OrderStatus; at: string }>;
  tickets: Array<{ station: 'cuisine' | 'bar'; status: 'nouvelle' | 'en_preparation' | 'prete' }>;
}

export interface PublicTable {
  tenantId: string;
  table: {
    id: string;
    code: string;
    capacity: number;
    type: string;
    status: string;
    zoneName: string | null;
    zoneKind: string | null;
  };
  orderUrl: string;
}

export interface CreatePublicOrderInput {
  channel: OrderChannel;
  items: Array<{
    productId: string;
    quantity: number;
    variantId?: string;
    optionChoiceIds?: string[];
    notes?: string;
  }>;
  tableCode?: string;
  tableToken?: string;
  customer?: { name: string; phone?: string; address?: string; note?: string };
  clientRequestId?: string;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const publicApi = {
  establishments: (params: { q?: string; kind?: string; city?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.kind && params.kind !== 'all') query.set('kind', params.kind);
    if (params.city && params.city !== 'all') query.set('city', params.city);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return tenant<{ items: Establishment[]; count: number; generatedAt: string }>(
      'GET',
      `/api/v1/public/establishments${suffix}`,
      undefined,
      { token: null },
    );
  },
  establishment: (key: string) =>
    tenant<{ establishment: Establishment; sites: EstablishmentSite[] }>(
      'GET',
      `/api/v1/public/establishments/${encodeURIComponent(key)}`,
      undefined,
      { token: null },
    ),
  menu: (tenantId: string) =>
    catalog<PublicMenuPayload>('GET', `/api/v1/public/tenants/${tenantId}/menu`, undefined, { token: null }),
  reviews: (tenantId: string, limit = 20) =>
    loyalty<{ tenantId: string; aggregate: ReviewAggregate; items: Review[]; generatedAt: string }>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/reviews?limit=${limit}`,
      undefined,
      { token: null },
    ),
  loyaltyProgram: (tenantId: string) =>
    loyalty<{ tenantId: string; program: LoyaltyProgram; generatedAt: string }>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/loyalty`,
      undefined,
      { token: null },
    ),
  table: (tenantId: string, code: string) =>
    floor<PublicTable>('GET', `/api/v1/public/tenants/${tenantId}/tables/${encodeURIComponent(code)}`, undefined, {
      token: null,
    }),
  reservationAvailability: (tenantId: string, date: string, partySize: number) =>
    floor<ReservationAvailability>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/reservations/availability?date=${encodeURIComponent(date)}&partySize=${partySize}`,
      undefined,
      { token: null },
    ),
  createReservation: (
    tenantId: string,
    input: { date: string; time: string; partySize: number; customerName: string; customerPhone: string; note?: string; tableId?: string },
  ) =>
    floor<{ reservation: Reservation; publicToken: string; trackUrl: string }>(
      'POST',
      `/api/v1/public/tenants/${tenantId}/reservations`,
      input,
      { token: null },
    ),
  reservation: (tenantId: string, id: string, token: string) =>
    floor<{ reservation: Reservation; tableStatus: string | null }>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/reservations/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`,
      undefined,
      { token: null },
    ),
  cancelReservation: (tenantId: string, id: string, token: string) =>
    floor<{ reservation: Reservation }>(
      'POST',
      `/api/v1/public/tenants/${tenantId}/reservations/${encodeURIComponent(id)}/cancel`,
      { k: token },
      { token: null },
    ),
  createOrder: (tenantId: string, input: CreatePublicOrderInput) =>
    order<{ order: PublicOrder; trackingUrl: string; replayed: boolean }>(
      'POST',
      `/api/v1/public/tenants/${tenantId}/orders`,
      input,
      { token: null },
    ),
  orderTracking: (tenantId: string, id: string, token: string) =>
    order<{ order: PublicOrder }>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/orders/${encodeURIComponent(id)}?k=${encodeURIComponent(token)}`,
      undefined,
      { token: null },
    ),
};

export const authApi = {
  phoneStart: (phone: string) => identity<PhoneChallenge>('POST', '/api/v1/auth/phone/start', { phone }),
  phoneVerify: (challengeId: string, code: string, name?: string) =>
    identity<TokenBundle>('POST', '/api/v1/auth/phone/verify', { challengeId, code, name }),
  me: () => identity<MeResult>('GET', '/api/v1/auth/me'),
  logout: (refreshToken: string) => identity<{ ok: true }>('POST', '/api/v1/auth/logout', { refreshToken }),
};

export const accountApi = {
  favorites: () => loyalty<{ items: Array<{ tenantId: string; addedAt: string }> }>('GET', '/api/v1/me/favorites'),
  addFavorite: (tenantId: string) =>
    loyalty<{ favorite: { tenantId: string; addedAt: string }; alreadySaved: boolean }>('POST', '/api/v1/me/favorites', {
      tenantId,
    }),
  removeFavorite: (tenantId: string) =>
    loyalty<{ removed: boolean; tenantId: string }>('DELETE', `/api/v1/me/favorites/${encodeURIComponent(tenantId)}`),
  myReviews: (tenantId?: string) =>
    loyalty<{ items: Review[] }>(
      'GET',
      `/api/v1/me/reviews${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`,
    ),
  submitReview: (input: { tenantId: string; rating: number; comment?: string }) =>
    loyalty<{ review: Review; updated: boolean }>('POST', '/api/v1/me/reviews', input),
  loyalty: (tenantId: string) =>
    loyalty<{ account: LoyaltyAccount; program: LoyaltyProgram }>(
      'GET',
      `/api/v1/me/loyalty?tenantId=${encodeURIComponent(tenantId)}`,
    ),
  myLoyalty: () => loyalty<{ items: LoyaltyAccount[]; program: LoyaltyProgram }>('GET', '/api/v1/me/loyalty'),
  claim: (tenantId: string, orderId: string) =>
    loyalty<{ alreadyCredited?: boolean; account: LoyaltyAccount; entry: LoyaltyHistoryEntry }>(
      'POST',
      '/api/v1/me/loyalty/claims',
      { tenantId, orderId },
    ),
  redeem: (tenantId: string, rewardId: string) =>
    loyalty<{ account: LoyaltyAccount; entry: LoyaltyHistoryEntry }>('POST', '/api/v1/me/loyalty/redeem', {
      tenantId,
      rewardId,
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export function trackingKey(trackingUrl: string): string {
  try {
    const url = new URL(trackingUrl);
    return url.searchParams.get('k') ?? '';
  } catch {
    const match = /[?&]k=([^&]+)/.exec(trackingUrl);
    return match ? decodeURIComponent(match[1]) : '';
  }
}
