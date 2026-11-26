/**
 * Client HTTP des services identity (4001) et tenant (4002) pour le back-office
 * et les parcours publics. Aucune donnée n'est filtrée ici : l'isolation
 * tenant_id est garantie côté serveur (voir tests d'isolation).
 */

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
export const IDENTITY_URL = env.VITE_IDENTITY_URL ?? 'http://localhost:4001';
export const TENANT_URL = env.VITE_TENANT_URL ?? 'http://localhost:4002';
export const CATALOG_URL = env.VITE_CATALOG_URL ?? 'http://localhost:4003';
export const FLOOR_URL = env.VITE_FLOOR_URL ?? 'http://localhost:4004';
export const ORDER_URL = env.VITE_ORDER_URL ?? 'http://localhost:4005';
export const PAYMENT_URL = env.VITE_PAYMENT_URL ?? 'http://localhost:4007';
export const STAFF_URL = env.VITE_STAFF_URL ?? 'http://localhost:4008';
export const PAYROLL_URL = env.VITE_PAYROLL_URL ?? 'http://localhost:4009';
export const INVENTORY_URL = env.VITE_INVENTORY_URL ?? 'http://localhost:4010';
export const LOYALTY_URL = env.VITE_LOYALTY_URL ?? 'http://localhost:4006';
export const REPORTING_URL = env.VITE_REPORTING_URL ?? 'http://localhost:4012';
export const PLATFORM_ADMIN_URL = env.VITE_PLATFORM_ADMIN_URL ?? 'http://localhost:4013';

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

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

const SESSION_KEY = 'restohub.session';

function storedRefreshToken(): string | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { refreshToken?: string };
    return parsed.refreshToken ?? null;
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
  window.dispatchEvent(
    new CustomEvent<TokenBundle>('restohub:tokens-refreshed', { detail: bundle }),
  );
}

let refreshPromise: Promise<TokenBundle | null> | null = null;

function refreshSession(): Promise<TokenBundle | null> {
  refreshPromise ??= (async () => {
    const refreshToken = storedRefreshToken();
    if (!refreshToken) return null;
    try {
      const response = await fetch(`${IDENTITY_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
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
        'Service injoignable. Vérifiez que les services identity (4001) et tenant (4002) sont démarrés.',
      );
    }
  };

  let response = await send(token);
  if (response.status === 401 && token) {
    const bundle = await refreshSession();
    if (bundle) {
      response = await send(bundle.accessToken);
    } else {
      window.dispatchEvent(new Event('restohub:session-expired'));
    }
  }

  const text = await response.text();
  let payload: unknown = undefined;
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
const payment = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(PAYMENT_URL, method, path, body, options);
const staff = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(STAFF_URL, method, path, body, options);
const payroll = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(PAYROLL_URL, method, path, body, options);
const inventory = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(INVENTORY_URL, method, path, body, options);
const marketing = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(LOYALTY_URL, method, path, body, options);
const reports = <T>(method: Method, path: string, body?: unknown, options?: RequestOptions) =>
  request<T>(REPORTING_URL, method, path, body, options);

async function serviceBlob(baseUrl: string, path: string): Promise<Blob> {
  const fetchFile = (bearer: string | null) =>
    fetch(`${baseUrl}${path}`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });

  let response = await fetchFile(accessToken);
  if (response.status === 401 && accessToken) {
    const bundle = await refreshSession();
    if (bundle) {
      response = await fetchFile(bundle.accessToken);
    } else {
      window.dispatchEvent(new Event('restohub:session-expired'));
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'download_failed', 'Le fichier n’a pas pu être généré.');
  }
  return response.blob();
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  locale: 'fr' | 'en';
  status: string;
  platformRoles: string[];
  mfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface AuthClaimsView {
  platformRoles: string[];
  platformPermissions: string[];
  tenantPermissions: Record<string, string[]>;
  mfa: boolean;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  user: User;
}

export type LoginResult =
  | ({ mfaRequired: false } & TokenBundle)
  | { mfaRequired: true; mfaSetupRequired: boolean; ticket: string; user: User };

export interface MeResult {
  user: User;
  claims: AuthClaimsView;
  mfaPolicyRequired: boolean;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
  user: User;
}

export interface MfaConfirmation {
  mfaEnabled: boolean;
  recoveryCodes: string[];
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  sessionId?: string;
  user?: User;
  mfaRequired?: false;
}

export interface AuthConfig {
  otpDemo: boolean;
  socialProviders: string[];
  mfaRequiredForManagers: boolean;
  passwordPolicy: string;
}

export interface PhoneChallenge {
  challengeId: string;
  expiresAt: string;
  channel: string;
  devCode?: string;
}

export type PlanCode = 'starter' | 'pro' | 'enterprise';

export interface Plan {
  code: PlanCode;
  name: string;
  priceXof: number;
  maxSites: number | null;
  maxEmployees: number | null;
  highlight?: boolean;
  features?: string[];
}

export type ApplicationStatus = 'draft' | 'submitted' | 'info_requested' | 'approved' | 'rejected';

export interface ApplicationDocument {
  id: string;
  type: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Application {
  id: string;
  reference: string;
  status: ApplicationStatus;
  plan: PlanCode;
  currency: string;
  languages: string[];
  establishment: {
    brandName?: string;
    legalName?: string;
    city?: string;
    type?: string;
    logoUrl?: string;
    photos?: string[];
  };
  documents: ApplicationDocument[];
  review: {
    notes: Array<{ action: string; reason?: string; note?: string; at: string }>;
    decidedAt?: string;
    reason?: string;
  };
  tenantId?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationListItem extends Application {
  managerEmail?: string;
  managerName?: string;
  legalName?: string;
  nif?: string;
  rccm?: string;
  city?: string;
  documentCount: number;
}

export interface ApplicationDetail extends Application {
  establishmentFull: Record<string, unknown>;
  managerFull: { name?: string; email?: string; phone?: string };
}

export interface EstablishmentHours {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
}

export interface TenantSettings {
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  languages: Array<'fr' | 'en'>;
  currency: string;
  timezone: string;
  address?: Record<string, string>;
  contactPhone?: string;
  contactEmail?: string;
  hours?: EstablishmentHours[];
  description?: string;
}

export interface Tenant {
  id: string;
  slug: string;
  subdomain: string;
  legalName: string;
  brandName: string;
  nif: string;
  rccm: string;
  managerEmail: string;
  ownerUserId?: string;
  plan: PlanCode;
  status: 'active' | 'suspended';
  settings: TenantSettings;
  suspension?: { reason?: string; at?: string };
  createdAt: string;
  updatedAt: string;
}

export interface TenantSummary {
  id: string;
  brandName: string;
  legalName: string;
  slug: string;
  subdomain: string;
  status: 'active' | 'suspended';
  plan: PlanCode;
  role: string;
  permissions: string[];
  subscriptionStatus?: string;
  primaryColor?: string;
  logoUrl?: string;
  sites: number;
  createdAt: string;
}

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  phone?: string;
  isPrimary: boolean;
  status: 'active' | 'closed';
}

export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'void';

export interface Invoice {
  id: string;
  number: string;
  tenantId: string;
  plan: PlanCode;
  amountXof: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  provider?: string;
  reference?: string;
}

export interface Subscription {
  tenantId: string;
  plan: PlanCode;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialUsed: boolean;
}

export interface OnboardingItem {
  key: string;
  label: string;
  description: string;
  done: boolean;
  detail?: string;
}

export interface Onboarding {
  items: OnboardingItem[];
  progress: number;
  completed: number;
  total: number;
  tenant: { id: string; brandName: string; slug: string; subdomain: string };
}

export interface TeamMember {
  userId: string;
  name: string;
  email?: string;
  phone?: string;
  roles?: string[];
  mfaEnabled?: boolean;
  status?: string;
}

export interface AdminOverview {
  applications: {
    total: number;
    pending: number;
    infoRequested: number;
    approved: number;
    rejected: number;
  };
  tenants: { total: number; active: number; suspended: number };
  billing: {
    mrrXof: number;
    paidInvoices: number;
    pendingInvoices: number;
    overdueInvoices: number;
    collectedXof: number;
  };
  audit: { entries: number; integrity: boolean };
}

export interface AdminTenantRow {
  id: string;
  brandName: string;
  legalName: string;
  slug: string;
  subdomain: string;
  status: 'active' | 'suspended';
  plan: PlanCode;
  managerEmail: string;
  trialUsed: boolean;
  subscriptionStatus?: string;
  sites: number;
  createdAt: string;
  suspension?: { reason?: string; at?: string };
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const identityApi = {
  config: () => identity<AuthConfig>('GET', '/api/v1/auth/config'),
  emailLogin: (email: string, password: string) =>
    identity<LoginResult>('POST', '/api/v1/auth/email/login', { email, password }),
  emailRegister: (input: { name: string; email: string; password: string; phone?: string }) =>
    identity<LoginResult>('POST', '/api/v1/auth/email/register', input),
  phoneStart: (phone: string) =>
    identity<PhoneChallenge>('POST', '/api/v1/auth/phone/start', { phone }),
  phoneVerify: (challengeId: string, code: string, name?: string) =>
    identity<LoginResult>('POST', '/api/v1/auth/phone/verify', { challengeId, code, name }),
  social: (provider: 'google' | 'apple', idToken: string) =>
    identity<LoginResult>('POST', `/api/v1/auth/social/${provider}`, { idToken }),
  me: () => identity<MeResult>('GET', '/api/v1/auth/me'),
  refresh: (refreshToken: string) =>
    identity<TokenBundle>('POST', '/api/v1/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) =>
    identity<{ ok: true }>('POST', '/api/v1/auth/logout', { refreshToken }),
  mfaEnroll: (ticket?: string) =>
    identity<MfaEnrollment>('POST', '/api/v1/auth/mfa/enroll', ticket ? { ticket } : {}),
  mfaConfirm: (code: string, ticket?: string) =>
    identity<MfaConfirmation>(
      'POST',
      '/api/v1/auth/mfa/confirm',
      ticket ? { ticket, code } : { code },
    ),
  mfaVerify: (ticket: string, code: string) =>
    identity<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      sessionId: string;
      user: User;
    }>('POST', '/api/v1/auth/mfa/verify', { ticket, code }),
  sessions: () => identity<{ items: unknown[] }>('GET', '/api/v1/sessions'),
};

/* ------------------------------------------------------------------ */
/* Tenant                                                              */
/* ------------------------------------------------------------------ */

export interface DraftApplicationInput {
  establishment: Record<string, unknown>;
  manager: Record<string, unknown>;
  plan: PlanCode;
  languages: string[];
  currency: string;
  acceptTerms?: boolean;
}

export const tenantApi = {
  plans: () => tenant<{ items: Plan[] }>('GET', '/api/v1/plans'),
  createApplication: (input: DraftApplicationInput) =>
    tenant<{ applicationId: string; reference: string; status: string; applicationToken: string }>(
      'POST',
      '/api/v1/applications',
      input,
    ),
  getApplication: (id: string, applicationToken: string) =>
    tenant<{ application: Application }>('GET', `/api/v1/applications/${id}`, undefined, {
      headers: { 'x-application-token': applicationToken },
      token: null,
    }),
  updateApplication: (id: string, applicationToken: string, patch: Record<string, unknown>) =>
    tenant<{ application: Application }>('PATCH', `/api/v1/applications/${id}`, patch, {
      headers: { 'x-application-token': applicationToken },
      token: null,
    }),
  uploadDocument: (
    id: string,
    applicationToken: string,
    doc: { type: string; fileName: string; mimeType: string; dataBase64: string },
  ) =>
    tenant<{ document: ApplicationDocument }>('POST', `/api/v1/applications/${id}/documents`, doc, {
      headers: { 'x-application-token': applicationToken },
      token: null,
    }),
  submitApplication: (id: string, applicationToken: string) =>
    tenant<{ application: Application }>('POST', `/api/v1/applications/${id}/submit`, undefined, {
      headers: { 'x-application-token': applicationToken },
      token: null,
    }),

  adminApplications: (params?: { status?: string; q?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.q) query.set('q', params.q);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return tenant<{
      items: ApplicationListItem[];
      counts: Record<string, number>;
      reviewer: string;
    }>('GET', `/api/v1/admin/applications${suffix}`);
  },
  adminApplication: (id: string) =>
    tenant<{ application: ApplicationDetail }>('GET', `/api/v1/admin/applications/${id}`),
  adminDocument: async (applicationId: string, documentId: string) => {
    const response = await fetch(
      `${TENANT_URL}/api/v1/admin/applications/${applicationId}/documents/${documentId}`,
      { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} },
    );
    if (!response.ok)
      throw new ApiError(response.status, 'document_unavailable', 'Document indisponible.');
    return response.blob();
  },
  reviewApplication: (
    id: string,
    action: 'approve' | 'reject' | 'request_documents',
    payload: { reason?: string; note?: string },
  ) =>
    tenant<Record<string, unknown>>('POST', `/api/v1/admin/applications/${id}/review`, {
      action,
      ...payload,
    }),
  adminTenants: () => tenant<{ items: AdminTenantRow[] }>('GET', '/api/v1/admin/tenants'),
  suspendTenant: (id: string, reason: string) =>
    tenant<{ tenant: { id: string; status: string }; changed: boolean }>(
      'POST',
      `/api/v1/admin/tenants/${id}/suspend`,
      { reason },
    ),
  reactivateTenant: (id: string, note?: string) =>
    tenant<{ tenant: { id: string; status: string } }>(
      'POST',
      `/api/v1/admin/tenants/${id}/reactivate`,
      { note },
    ),
  overview: () => tenant<AdminOverview>('GET', '/api/v1/admin/overview'),

  myTenants: () => tenant<{ items: TenantSummary[] }>('GET', '/api/v1/tenants/mine'),
  tenant: (id: string) =>
    tenant<{
      tenant: Tenant;
      plan: Plan;
      sites: Site[];
      subscription?: Subscription;
      invoices: Invoice[];
    }>('GET', `/api/v1/tenants/${id}`),
  updateBranding: (
    id: string,
    branding: {
      logoUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      brandName?: string;
      languages?: string[];
      currency?: string;
      hours?: EstablishmentHours[];
    },
  ) =>
    tenant<{ tenant: { id: string; brandName: string; settings: TenantSettings } }>(
      'PATCH',
      `/api/v1/tenants/${id}/branding`,
      branding,
    ),
  sites: (id: string) =>
    tenant<{ items: Site[]; plan: Plan }>('GET', `/api/v1/tenants/${id}/sites`),
  createSite: (id: string, site: { name: string; address: string; phone?: string }) =>
    tenant<{ site: Site }>('POST', `/api/v1/tenants/${id}/sites`, site),
  deleteSite: (id: string, siteId: string) =>
    tenant<{ ok: true }>('DELETE', `/api/v1/tenants/${id}/sites/${siteId}`),
  onboarding: (id: string) => tenant<Onboarding>('GET', `/api/v1/tenants/${id}/onboarding`),
  subscription: (id: string) =>
    tenant<{
      subscription?: Subscription;
      plan: Plan;
      plans: Plan[];
      invoices: Invoice[];
      trialDays: number;
    }>('GET', `/api/v1/tenants/${id}/subscription`),
  checkout: (id: string, plan: PlanCode) =>
    tenant<{ invoice: Invoice; plan: Plan; message: string; demoBilling: boolean }>(
      'POST',
      `/api/v1/tenants/${id}/subscription/checkout`,
      { plan },
    ),
  payInvoiceDemo: (id: string, invoiceId: string) =>
    tenant<{ invoice: Invoice; tenant: { id: string; status: string } }>(
      'POST',
      `/api/v1/tenants/${id}/subscription/invoices/${invoiceId}/pay-demo`,
    ),
  team: (id: string) =>
    tenant<{ items?: TeamMember[] } | TeamMember[]>('GET', `/api/v1/tenants/${id}/team`),
  audit: (id: string, limit = 20) =>
    tenant<{ items: Array<Record<string, unknown>>; integrity: boolean }>(
      'GET',
      `/api/v1/tenants/${id}/audit?limit=${limit}`,
    ),
};

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export type Allergen =
  | 'gluten'
  | 'crustaces'
  | 'oeufs'
  | 'poisson'
  | 'arachides'
  | 'soja'
  | 'lait'
  | 'fruits_a_coque'
  | 'celeri'
  | 'moutarde'
  | 'sesame'
  | 'sulfites'
  | 'lupin'
  | 'mollusques';

export interface CatalogCategory {
  id: string;
  name: string;
  description?: string;
  position: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

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

export interface PriceRule {
  id: string;
  label: string;
  days: string[];
  start: string;
  end: string;
  priceXof: number;
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  photos: string[];
  allergens: Allergen[];
  basePriceXof: number;
  effectivePriceXof: number;
  activePriceRule: {
    id: string;
    label: string;
    start: string;
    end: string;
    priceXof: number;
  } | null;
  variants: ProductVariant[];
  options: ProductOptionGroup[];
  priceRules: PriceRule[];
  active: boolean;
  station: 'cuisine' | 'bar';
  availability: {
    available: boolean;
    reason?: string;
    until?: string;
    updatedAt: string;
    updatedBy: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ComposedMenu {
  id: string;
  name: string;
  description?: string;
  priceXof: number;
  items: Array<{ productId: string; quantity: number; variantId?: string; name?: string }>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Promotion {
  id: string;
  name: string;
  code?: string;
  type: 'percent' | 'amount';
  value: number;
  scope: 'all' | 'category' | 'product';
  targetId?: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export interface CatalogSnapshot {
  tenantId: string;
  effectiveAt: string;
  timeZone: string;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  menus: ComposedMenu[];
  promotions: Promotion[];
}

export interface ProductInput {
  categoryId: string;
  name: string;
  description?: string;
  photos?: string[];
  allergens?: Allergen[];
  basePriceXof: number;
  variants?: Array<{ id?: string; name: string; priceXof: number }>;
  options?: Array<{
    name: string;
    required?: boolean;
    minSelect?: number;
    maxSelect?: number;
    choices: Array<{ name: string; priceDeltaXof: number }>;
  }>;
  priceRules?: Array<{
    id?: string;
    label?: string;
    days: string[];
    start: string;
    end: string;
    priceXof: number;
  }>;
  active?: boolean;
}

export const catalogApi = {
  snapshot: (tenantId: string) =>
    catalog<CatalogSnapshot>('GET', `/api/v1/tenants/${tenantId}/catalog`),
  createCategory: (
    tenantId: string,
    input: { name: string; description?: string; position?: number },
  ) =>
    catalog<{ category: CatalogCategory }>(
      'POST',
      `/api/v1/tenants/${tenantId}/catalog/categories`,
      input,
    ),
  updateCategory: (tenantId: string, id: string, input: Record<string, unknown>) =>
    catalog<{ category: CatalogCategory }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/catalog/categories/${id}`,
      input,
    ),
  deleteCategory: (tenantId: string, id: string) =>
    catalog<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/catalog/categories/${id}`),
  createProduct: (tenantId: string, input: ProductInput) =>
    catalog<{ product: CatalogProduct }>(
      'POST',
      `/api/v1/tenants/${tenantId}/catalog/products`,
      input,
    ),
  updateProduct: (tenantId: string, id: string, input: Partial<ProductInput>) =>
    catalog<{ product: CatalogProduct }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/catalog/products/${id}`,
      input,
    ),
  setAvailability: (
    tenantId: string,
    id: string,
    input: { available: boolean; reason?: string; until?: string },
  ) =>
    catalog<{ product: CatalogProduct }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/catalog/products/${id}/availability`,
      input,
    ),
  deleteProduct: (tenantId: string, id: string) =>
    catalog<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/catalog/products/${id}`),
  createMenu: (
    tenantId: string,
    input: {
      name: string;
      description?: string;
      priceXof: number;
      items: Array<{ productId: string; quantity: number; variantId?: string }>;
    },
  ) => catalog<{ menu: ComposedMenu }>('POST', `/api/v1/tenants/${tenantId}/catalog/menus`, input),
  deleteMenu: (tenantId: string, id: string) =>
    catalog<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/catalog/menus/${id}`),
  createPromotion: (
    tenantId: string,
    input: {
      name: string;
      code?: string;
      type: 'percent' | 'amount';
      value: number;
      scope: 'all' | 'category' | 'product';
      targetId?: string;
      startsAt: string;
      endsAt: string;
    },
  ) =>
    catalog<{ promotion: Promotion }>(
      'POST',
      `/api/v1/tenants/${tenantId}/catalog/promotions`,
      input,
    ),
  deletePromotion: (tenantId: string, id: string) =>
    catalog<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/catalog/promotions/${id}`),
  publicMenu: (tenantId: string) =>
    catalog<PublicMenuPayload>('GET', `/api/v1/public/tenants/${tenantId}/menu`, undefined, {
      token: null,
    }),
};

/* ------------------------------------------------------------------ */
/* Plan de salle                                                       */
/* ------------------------------------------------------------------ */

export type FloorStatus =
  'libre' | 'reservee' | 'occupee' | 'addition' | 'nettoyage' | 'hors_service';
export type ZoneKind = 'salle' | 'terrasse' | 'vip' | 'bar' | 'etage';
export type TableType = 'table' | 'comptoir' | 'canape' | 'loge';

export interface FloorZone {
  id: string;
  name: string;
  kind: ZoneKind;
  code: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloorTable {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  zoneKind: ZoneKind;
  number: number;
  code: string;
  capacity: number;
  effectiveCapacity: number;
  type: TableType;
  status: FloorStatus;
  x: number;
  y: number;
  orderId?: string;
  reservationId?: string;
  mergedIntoId?: string;
  mergedIntoCode?: string;
  mergedIds: string[];
  mergedCodes: string[];
  qrUrl: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FloorSummary {
  tables: number;
  primaries: number;
  byStatus: Record<FloorStatus, number>;
  seatsTotal: number;
  seatsOccupied: number;
  occupancyRate: number;
  mergedGroups: number;
  mergedTables: number;
  serviceable: number;
}

export interface FloorSnapshot {
  tenantId: string;
  settings: { establishmentCode: string; updatedAt: string } | null;
  zones: FloorZone[];
  tables: FloorTable[];
  summary: FloorSummary;
  live: boolean;
  generatedAt: string;
}

export const floorApi = {
  snapshot: (tenantId: string) => floor<FloorSnapshot>('GET', `/api/v1/tenants/${tenantId}/floor`),
  updateSettings: (tenantId: string, establishmentCode: string) =>
    floor<FloorSnapshot>('PUT', `/api/v1/tenants/${tenantId}/floor/settings`, {
      establishmentCode,
    }),
  createZone: (tenantId: string, input: { name: string; kind: ZoneKind; code?: string }) =>
    floor<{ zone: FloorZone }>('POST', `/api/v1/tenants/${tenantId}/floor/zones`, input),
  updateZone: (tenantId: string, id: string, input: Record<string, unknown>) =>
    floor<{ zone: FloorZone }>('PATCH', `/api/v1/tenants/${tenantId}/floor/zones/${id}`, input),
  deleteZone: (tenantId: string, id: string) =>
    floor<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/floor/zones/${id}`),
  createTable: (
    tenantId: string,
    input: {
      zoneId: string;
      number?: number;
      capacity: number;
      type?: TableType;
      x?: number;
      y?: number;
    },
  ) => floor<{ table: FloorTable }>('POST', `/api/v1/tenants/${tenantId}/floor/tables`, input),
  updateTable: (tenantId: string, id: string, input: Record<string, unknown>) =>
    floor<{ table: FloorTable }>('PATCH', `/api/v1/tenants/${tenantId}/floor/tables/${id}`, input),
  deleteTable: (tenantId: string, id: string) =>
    floor<{ ok: true }>('DELETE', `/api/v1/tenants/${tenantId}/floor/tables/${id}`),
  setStatus: (
    tenantId: string,
    id: string,
    input: { status: FloorStatus; orderId?: string; reservationId?: string },
  ) =>
    floor<{ table: FloorTable }>(
      'POST',
      `/api/v1/tenants/${tenantId}/floor/tables/${id}/status`,
      input,
    ),
  merge: (tenantId: string, tableIds: string[], primaryId?: string) =>
    floor<{ primary: FloorTable; summary: FloorSummary }>(
      'POST',
      `/api/v1/tenants/${tenantId}/floor/tables/merge`,
      { tableIds, primaryId },
    ),
  split: (tenantId: string, id: string) =>
    floor<{ primary: FloorTable }>(
      'POST',
      `/api/v1/tenants/${tenantId}/floor/tables/${id}/split`,
      {},
    ),
  transfer: (tenantId: string, id: string, toTableId: string, releaseSource?: boolean) =>
    floor<{ source: FloorTable; target: FloorTable }>(
      'POST',
      `/api/v1/tenants/${tenantId}/floor/tables/${id}/transfer`,
      { toTableId, releaseSource },
    ),
  qrBlob: (tenantId: string, id: string, format: 'svg' | 'png' = 'png') =>
    serviceBlob(FLOOR_URL, `/api/v1/tenants/${tenantId}/floor/tables/${id}/qr?format=${format}`),
  qrSheetBlob: (tenantId: string) =>
    serviceBlob(FLOOR_URL, `/api/v1/tenants/${tenantId}/floor/qr-sheet.pdf`),
};

/* ------------------------------------------------------------------ */
/* Commandes, KDS, caisse                                              */
/* ------------------------------------------------------------------ */

export type OrderChannel = 'sur_place' | 'a_emporter' | 'livraison' | 'precommande';
export type OrderStatus = 'recue' | 'en_preparation' | 'prete' | 'servie' | 'annulee';
export type OrderPaymentStatus = 'impayee' | 'partielle' | 'payee';
export type PaymentMethod = 'especes' | 'mobile_money' | 'carte';
export type OrderStation = 'cuisine' | 'bar';
export type TicketStatus = 'nouvelle' | 'en_preparation' | 'prete';

export interface OrderLine {
  id: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  options: Array<{ id: string; name: string; priceXof: number }>;
  quantity: number;
  unitPriceXof: number;
  lineTotalXof: number;
  station: OrderStation;
  notes?: string;
}

export interface OrderDiscount {
  type: 'percent' | 'amount';
  value: number;
  reason: string;
  amountXof: number;
  authorizedBy: string;
  at: string;
}

export interface OrderPayment {
  id: string;
  method: PaymentMethod;
  amountXof: number;
  reference?: string;
  sessionId?: string;
  at: string;
  by: string;
}

export interface OrderTicket {
  id: string;
  station: OrderStation;
  status: TicketStatus;
  lineIds: string[];
}

export interface Order {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  statusLabel: string;
  source: 'client' | 'staff';
  tableId?: string;
  tableCode?: string;
  customer?: { name: string; phone?: string; address?: string; note?: string };
  guests?: number;
  scheduledFor?: string;
  lines: OrderLine[];
  subtotalXof: number;
  discount?: OrderDiscount;
  deliveryFeeXof: number;
  totalXof: number;
  netXof: number;
  taxXof: number;
  taxRate: number;
  paidXof: number;
  remainingXof: number;
  paymentStatus: OrderPaymentStatus;
  payments: OrderPayment[];
  invoiceNumber?: string;
  receiptNumber?: string;
  receiptIssuedAt?: string;
  cancel?: { reason: string; by: string; at: string };
  publicToken?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ status: OrderStatus; at: string }>;
  tickets: OrderTicket[];
}

export interface OrderSummary {
  total: number;
  byStatus: Record<OrderStatus, number>;
  unpaidXof: number;
  paidTodayXof: number;
}

export interface OrderListResponse {
  tenantId: string;
  generatedAt: string;
  summary: OrderSummary;
  items: Order[];
}

export interface CreateOrderInput {
  channel: OrderChannel;
  items: Array<{
    productId: string;
    quantity: number;
    variantId?: string;
    optionChoiceIds?: string[];
    notes?: string;
  }>;
  tableCode?: string;
  customer?: { name: string; phone?: string; address?: string; note?: string };
  guests?: number;
  scheduledFor?: string;
  deliveryFeeXof?: number;
  clientRequestId?: string;
}

export interface KdsTicketLine {
  name: string;
  variantName?: string;
  options: string[];
  quantity: number;
  notes?: string;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  orderNumber: string;
  channel: OrderChannel;
  tableCode?: string;
  orderStatus: OrderStatus;
  station: OrderStation;
  status: TicketStatus;
  createdAt: string;
  ageSeconds: number;
  urgent: boolean;
  critical: boolean;
  scheduledFor?: string;
  lines: KdsTicketLine[];
}

export interface KdsPayload {
  tenantId: string;
  station: OrderStation | 'all';
  live: boolean;
  generatedAt: string;
  counters: Record<TicketStatus, number>;
  tickets: KdsTicket[];
}

export interface CashSession {
  id: string;
  status: 'ouverte' | 'cloturee';
  openedBy: string;
  openedAt: string;
  openingFloatXof: number;
  closedBy?: string;
  closedAt?: string;
  countedXof?: number;
  expectedXof?: number;
  differenceXof?: number;
  notes?: string;
  payments: number;
  byMethod: Record<PaymentMethod, number>;
  collectedXof: number;
  liveExpectedXof: number;
}

export interface PosPayload {
  tenantId: string;
  generatedAt: string;
  session: CashSession | null;
  lastClosed: CashSession | null;
  today: { payments: number; revenueXof: number; byMethod: Record<PaymentMethod, number> };
  toPay: Order[];
  toPayTotalXof: number;
}

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
  paymentStatus: OrderPaymentStatus;
  scheduledFor?: string;
  createdAt: string;
  timeline: Array<{ status: OrderStatus; at: string }>;
  tickets: Array<{ station: OrderStation; status: TicketStatus }>;
}

export interface PublicMenuProduct {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  photos: string[];
  allergens: string[];
  station: OrderStation;
  priceXof: number;
  basePriceXof: number;
  variants: ProductVariant[];
  options: ProductOptionGroup[];
  available: boolean;
}

export interface PublicMenuPayload {
  tenantId: string;
  generatedAt: string;
  categories: Array<{ id: string; name: string; products: PublicMenuProduct[] }>;
  menus: ComposedMenu[];
  promotions: Promotion[];
}

function orderQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export const orderApi = {
  list: (
    tenantId: string,
    params: { status?: string; channel?: string; q?: string; limit?: number } = {},
  ) => order<OrderListResponse>('GET', `/api/v1/tenants/${tenantId}/orders${orderQuery(params)}`),
  get: (tenantId: string, id: string) =>
    order<{ order: Order }>('GET', `/api/v1/tenants/${tenantId}/orders/${id}`),
  create: (tenantId: string, input: CreateOrderInput) =>
    order<{ order: Order; replayed: boolean }>('POST', `/api/v1/tenants/${tenantId}/orders`, input),
  setStatus: (tenantId: string, id: string, status: OrderStatus, expectedVersion?: number) =>
    order<{ order: Order }>('POST', `/api/v1/tenants/${tenantId}/orders/${id}/status`, {
      status,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  cancel: (tenantId: string, id: string, reason: string) =>
    order<{ order: Order }>('POST', `/api/v1/tenants/${tenantId}/orders/${id}/cancel`, { reason }),
  discount: (
    tenantId: string,
    id: string,
    input: { type: 'percent' | 'amount'; value: number; reason: string },
  ) => order<{ order: Order }>('POST', `/api/v1/tenants/${tenantId}/orders/${id}/discount`, input),
  pay: (
    tenantId: string,
    id: string,
    input: { method: PaymentMethod; amountXof: number; reference?: string },
  ) =>
    order<{
      payment: OrderPayment;
      invoiceIssued: boolean;
      session: CashSession | null;
      order: Order;
    }>('POST', `/api/v1/tenants/${tenantId}/orders/${id}/payments`, input),
  invoice: (tenantId: string, id: string) =>
    order<{
      invoice: {
        number: string;
        totalXof: number;
        netXof: number;
        taxXof: number;
        at?: string;
      } | null;
      order: Order;
    }>('GET', `/api/v1/tenants/${tenantId}/orders/${id}/invoice`),
  receiptBlob: (tenantId: string, id: string) =>
    serviceBlob(ORDER_URL, `/api/v1/tenants/${tenantId}/orders/${id}/receipt.pdf`),
  exportCsvBlob: (tenantId: string, range: { from?: string; to?: string } = {}) =>
    serviceBlob(ORDER_URL, `/api/v1/tenants/${tenantId}/orders/export.csv${orderQuery(range)}`),
  kds: (tenantId: string, station: OrderStation | 'all' = 'all') =>
    order<KdsPayload>('GET', `/api/v1/tenants/${tenantId}/kds${orderQuery({ station })}`),
  ticketStatus: (
    tenantId: string,
    ticketId: string,
    status: 'en_preparation' | 'prete',
    expectedVersion?: number,
  ) =>
    order<{ ticket: OrderTicket; order: Order; kds: KdsPayload }>(
      'POST',
      `/api/v1/tenants/${tenantId}/kds/tickets/${ticketId}/status`,
      { status, ...(expectedVersion === undefined ? {} : { expectedVersion }) },
    ),
  pos: (tenantId: string) => order<PosPayload>('GET', `/api/v1/tenants/${tenantId}/pos`),
  openSession: (tenantId: string, openingFloatXof: number) =>
    order<{ session: CashSession }>('POST', `/api/v1/tenants/${tenantId}/pos/session/open`, {
      openingFloatXof,
    }),
  closeSession: (tenantId: string, countedXof: number, notes?: string) =>
    order<{ session: CashSession }>('POST', `/api/v1/tenants/${tenantId}/pos/session/close`, {
      countedXof,
      notes,
    }),
  audit: (tenantId: string) =>
    order<{
      entries: Array<{
        id: string;
        action: string;
        actorId: string;
        at: string;
        meta: Record<string, unknown>;
      }>;
      integrity: boolean;
    }>('GET', `/api/v1/tenants/${tenantId}/orders/audit`),
  publicTable: (tenantId: string, code: string) =>
    floor<{
      table: { id: string; code: string; status: FloorStatus; capacity: number; orderId?: string };
    }>('GET', `/api/v1/public/tenants/${tenantId}/tables/${encodeURIComponent(code)}`, undefined, {
      token: null,
    }),
  publicMenu: (tenantId: string) =>
    catalog<PublicMenuPayload>('GET', `/api/v1/public/tenants/${tenantId}/menu`, undefined, {
      token: null,
    }),
  publicCreate: (tenantId: string, input: CreateOrderInput & { tableToken?: string }) =>
    order<{ order: PublicOrder; trackingUrl: string; replayed: boolean }>(
      'POST',
      `/api/v1/public/tenants/${tenantId}/orders`,
      input,
      { token: null },
    ),
  publicTracking: (tenantId: string, id: string, key: string) =>
    order<{ order: PublicOrder }>(
      'GET',
      `/api/v1/public/tenants/${tenantId}/orders/${id}?k=${encodeURIComponent(key)}`,
      undefined,
      { token: null },
    ),
};

/* ------------------------------------------------------------------ */
/* Paiements, portefeuille, réconciliation                             */
/* ------------------------------------------------------------------ */

export type PaymentStatus =
  | 'en_attente'
  | 'confirmee'
  | 'echouee'
  | 'expiree'
  | 'annulee'
  | 'remboursee_partielle'
  | 'remboursee';

export type PaymentMethodKind = 'mobile_money' | 'carte' | 'especes';
export type SettlementMode = 'instant' | 'batch';
export type SettlementStatus = 'en_attente' | 'payee' | 'rejetee';
export type DisputeStatus = 'ouverte' | 'en_examen' | 'resolue' | 'rejetee';

export interface PaymentFees {
  providerFeeXof: number;
  commissionXof: number;
  commissionPercent: number;
  netXof: number;
}

export interface PaymentRouting {
  chosen: string;
  reason: string;
  switched: boolean;
  candidates: Array<{ provider: string; label: string; feeXof: number; available: boolean }>;
}

export interface PaymentTransaction {
  id: string;
  tenantId: string;
  orderId: string | null;
  orderNumber: string | null;
  amountXof: number;
  method: PaymentMethodKind;
  provider: string;
  providerLabel: string;
  providerReference: string;
  status: PaymentStatus;
  source: 'agregateur' | 'caisse';
  splitId: string | null;
  customerPhone: string | null;
  customerName: string | null;
  note: string | null;
  fees: PaymentFees;
  refunds: Array<{
    id: string;
    amountXof: number;
    reason: string;
    by: string;
    at: string;
    providerReference: string;
  }>;
  refundedXof: number;
  refundableXof: number;
  tipXof: number;
  tipAllocations: Array<{ staffId: string; amountXof: number }>;
  routing: PaymentRouting;
  instructions: string;
  requires3ds: boolean;
  threeDsUrl: string | null;
  simulated: boolean;
  invoiceNumber: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface WalletView {
  tenantId: string;
  currency: string;
  availableXof: number;
  lifetimeNetXof: number;
  settledXof: number;
  updatedAt: string;
}

export interface SettlementView {
  id: string;
  tenantId: string;
  amountXof: number;
  mode: SettlementMode;
  status: SettlementStatus;
  destination: string;
  requestedBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
}

export interface ReconciliationRun {
  id: string;
  tenantId: string;
  date: string;
  createdAt: string;
  statementRows: number;
  matched: number;
  missingInStatement: string[];
  amountMismatches: Array<{ reference: string; platformXof: number; statementXof: number }>;
  orphanRows: Array<{ provider: string; reference: string; amountXof: number }>;
  balanced: boolean;
  actorId: string;
}

export interface FraudBlockView {
  id: string;
  tenantId: string;
  userId: string;
  scope: string;
  rule: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  liftedAt: string | null;
  liftedBy: string | null;
}

export interface DisputeView {
  id: string;
  tenantId: string;
  transactionId: string;
  reason: string;
  description: string;
  status: DisputeStatus;
  openedBy: string;
  createdAt: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  refundId: string | null;
}

export interface LedgerLine {
  account: string;
  label: string;
  debitXof: number;
  creditXof: number;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  at: string;
  memo: string;
  reference: string;
  lines: LedgerLine[];
  prevHash: string | null;
  hash: string;
}

export interface LedgerView {
  entries: LedgerEntry[];
  balances: Array<{ account: string; debitXof: number; creditXof: number; balanceXof: number }>;
  integrity: { ok: boolean; entries: number; brokenAt: string | null };
  generatedAt: string;
}

export interface PaymentOverview {
  tenantId: string;
  currency: string;
  plan: string;
  commissionPercent: number;
  wallet: WalletView;
  stats: {
    todayVolumeXof: number;
    todayCount: number;
    commission30dXof: number;
    refundedXof: number;
    pendingCount: number;
    failedCount: number;
    pendingSettlementsXof: number;
    pendingSettlements: number;
  };
  activeBlocks: FraudBlockView[];
  lastReconciliation: ReconciliationRun | null;
  generatedAt: string;
}

export interface PaymentProviderView {
  id: string;
  label: string;
  methods: PaymentMethodKind[];
  percent: number;
  fixedXof: number;
  supports3ds: boolean;
  configured: boolean;
  sandbox: boolean;
  health: 'up' | 'down';
  instructions: string;
}

export interface PlatformPaymentSummary {
  tenantsWithWallet: number;
  transactions: number;
  confirmedCount: number;
  volumeXof: number;
  commissionXof: number;
  providerFeesXof: number;
  walletLiabilityXof: number;
  settledXof: number;
  pendingSettlements: number;
  openDisputes: number;
  activeBlocks: number;
  ledgerIntegrity: { ok: boolean; entries: number; brokenAt: string | null };
  generatedAt: string;
}

function paymentQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const paymentApi = {
  overview: (tenantId: string) =>
    payment<PaymentOverview>('GET', `/api/v1/tenants/${tenantId}/payments/overview`),
  providers: (tenantId: string) =>
    payment<{ tenantId: string; items: PaymentProviderView[]; sandbox: boolean }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/providers`,
    ),
  setProviderHealth: (tenantId: string, providerId: string, status: 'up' | 'down') =>
    payment<{ provider: string; status: string }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/providers/${providerId}/health`,
      { status },
    ),
  transactions: (
    tenantId: string,
    filters: {
      status?: string;
      method?: string;
      from?: string;
      to?: string;
      q?: string;
      limit?: number;
    } = {},
  ) =>
    payment<{ tenantId: string; items: PaymentTransaction[]; count: number }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/transactions${paymentQuery(filters)}`,
    ),
  transaction: (tenantId: string, id: string) =>
    payment<{ transaction: PaymentTransaction }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/transactions/${id}`,
    ),
  initiate: (
    tenantId: string,
    input: {
      orderId?: string;
      amountXof?: number;
      method: 'mobile_money' | 'carte';
      provider?: string;
      note?: string;
      customerPhone?: string;
      customerName?: string;
      tipXof?: number;
      tipStaffIds?: string[];
    },
  ) =>
    payment<{ transaction: PaymentTransaction; wallet: WalletView; sandbox: boolean }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/transactions`,
      input,
    ),
  cancel: (tenantId: string, id: string) =>
    payment<{ transaction: PaymentTransaction }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/transactions/${id}/cancel`,
      {},
    ),
  refund: (tenantId: string, id: string, input: { amountXof?: number; reason: string }) =>
    payment<{
      refund: { id: string; amountXof: number };
      transaction: PaymentTransaction;
      wallet: WalletView;
    }>('POST', `/api/v1/tenants/${tenantId}/payments/transactions/${id}/refund`, input),
  sandboxOutcome: (tenantId: string, id: string, outcome: 'confirme' | 'echoue' | 'expire') =>
    payment<{ transaction: PaymentTransaction; orderSynced?: boolean; warning?: string | null }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/transactions/${id}/sandbox`,
      { outcome },
    ),
  confirm3ds: (tenantId: string, id: string) =>
    payment<{ transaction: PaymentTransaction; orderSynced?: boolean }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/transactions/${id}/confirm-3ds`,
      {},
    ),
  createSplit: (
    tenantId: string,
    input: {
      orderId: string;
      tipXof?: number;
      parts: Array<{
        label?: string;
        amountXof: number;
        method: 'mobile_money' | 'carte';
        provider?: string;
      }>;
    },
  ) =>
    payment<{
      split: {
        id: string;
        status: string;
        totalXof: number;
        parts: Array<{ transactionId: string; label: string; amountXof: number; status: string }>;
      };
    }>('POST', `/api/v1/tenants/${tenantId}/payments/splits`, input),
  split: (tenantId: string, id: string) =>
    payment<{
      split: {
        id: string;
        status: string;
        totalXof: number;
        parts: Array<{ transactionId: string; label: string; amountXof: number; status: string }>;
      };
    }>('GET', `/api/v1/tenants/${tenantId}/payments/splits/${id}`),
  wallet: (tenantId: string) =>
    payment<{ wallet: WalletView; settlements: SettlementView[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/wallet`,
    ),
  requestSettlement: (
    tenantId: string,
    input: { amountXof: number; mode: SettlementMode; destination: string; note?: string },
  ) =>
    payment<{ settlement: SettlementView; wallet: WalletView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/settlements`,
      input,
    ),
  reconciliations: (tenantId: string) =>
    payment<{ tenantId: string; items: ReconciliationRun[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/reconciliation`,
    ),
  runReconciliation: (tenantId: string, input: { date?: string; injectAnomalies?: boolean }) =>
    payment<{ run: ReconciliationRun }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/reconciliation/run`,
      input,
    ),
  ledger: (tenantId: string, limit = 50) =>
    payment<LedgerView & { tenantId: string }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/ledger?limit=${limit}`,
    ),
  fraudBlocks: (tenantId: string) =>
    payment<{ tenantId: string; items: FraudBlockView[]; limits: Record<string, number> }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payments/fraud/blocks`,
    ),
  liftBlock: (tenantId: string, id: string) =>
    payment<{ block: FraudBlockView; alreadyLifted: boolean }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payments/fraud/blocks/${id}/lift`,
      {},
    ),
  audit: (tenantId: string) =>
    payment<{
      entries: Array<{ id: string; action: string; actorId: string; at: string }>;
      integrity: boolean;
    }>('GET', `/api/v1/tenants/${tenantId}/payments/audit`),
  exportBlob: (tenantId: string, format: 'csv' | 'xls' | 'pdf') =>
    serviceBlob(PAYMENT_URL, `/api/v1/tenants/${tenantId}/payments/exports/transactions.${format}`),
};

export const platformPaymentApi = {
  summary: () => payment<PlatformPaymentSummary>('GET', '/api/v1/platform/payments/summary'),
  transactions: (filters: { tenantId?: string; status?: string; limit?: number } = {}) =>
    payment<{ items: PaymentTransaction[]; count: number }>(
      'GET',
      `/api/v1/platform/payments/transactions${paymentQuery(filters)}`,
    ),
  settlements: (status?: string) =>
    payment<{ items: SettlementView[] }>(
      'GET',
      `/api/v1/platform/payments/settlements${paymentQuery({ status })}`,
    ),
  approveSettlement: (id: string, note?: string) =>
    payment<{ settlement: SettlementView }>(
      'POST',
      `/api/v1/platform/payments/settlements/${id}/approve`,
      note ? { note } : {},
    ),
  rejectSettlement: (id: string, reason: string) =>
    payment<{ settlement: SettlementView }>(
      'POST',
      `/api/v1/platform/payments/settlements/${id}/reject`,
      { reason },
    ),
  disputes: (status?: string) =>
    payment<{ items: DisputeView[] }>(
      'GET',
      `/api/v1/platform/payments/disputes${paymentQuery({ status })}`,
    ),
  openDispute: (input: {
    tenantId: string;
    transactionId: string;
    reason: string;
    description: string;
  }) => payment<{ dispute: DisputeView }>('POST', '/api/v1/platform/payments/disputes', input),
  resolveDispute: (
    id: string,
    input: { outcome: 'acceptee' | 'rejetee'; refundAmountXof?: number; note?: string },
  ) =>
    payment<{ dispute: DisputeView }>(
      'POST',
      `/api/v1/platform/payments/disputes/${id}/resolve`,
      input,
    ),
  ledger: () => payment<LedgerView>('GET', '/api/v1/platform/payments/ledger'),
};

/* ------------------------------------------------------------------ */
/* staff-service — équipes, plannings, pointage, performances          */
/* ------------------------------------------------------------------ */

export type StaffStatus = 'invite' | 'actif' | 'suspendu' | 'sorti';
export type StaffContractType = 'cdi' | 'cdd' | 'stage' | 'extra';
export type StaffShiftStation = 'salle' | 'cuisine' | 'bar' | 'caisse' | 'livraison';
export type StaffShiftStatus = 'planifie' | 'publie' | 'termine' | 'annule';
export type StaffLeaveType = 'conges_payes' | 'maladie' | 'sans_solde' | 'absence';
export type StaffLeaveStatus = 'en_attente' | 'approuve' | 'refuse';
export type StaffPaymentMethod = 'mobile_money' | 'bank' | 'cash';
export type StaffSwapStatus = 'en_attente' | 'approuve' | 'refuse';

export interface StaffDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

export interface StaffEmployee {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email: string | null;
  jobTitle: string;
  roleCode: string;
  contractType: StaffContractType;
  hireDate: string;
  baseSalaryXof: number;
  paymentMethod: StaffPaymentMethod;
  paymentDestination: string;
  documents: StaffDocument[];
  status: StaffStatus;
  pinMasked: string;
  qrToken: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface StaffShift {
  id: string;
  tenantId: string;
  employeeId: string;
  date: string;
  start: string;
  end: string;
  station: StaffShiftStation;
  status: StaffShiftStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  employeeName: string;
}

export interface StaffSwap {
  id: string;
  tenantId: string;
  shiftId: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  status: StaffSwapStatus;
  requestedBy: string;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  fromEmployeeName: string;
  toEmployeeName: string;
  shift: StaffShift | null;
}

export interface StaffLeave {
  id: string;
  tenantId: string;
  employeeId: string;
  type: StaffLeaveType;
  from: string;
  to: string;
  days: number;
  reason: string | null;
  status: StaffLeaveStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  employeeName: string;
}

export interface StaffAttendance {
  id: string;
  tenantId: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  method: 'pin' | 'qr' | 'manuel';
  minutesWorked: number;
  location: { lat: number; lng: number; withinFence: boolean } | null;
  employeeName?: string;
}

export interface StaffPerformanceRecord {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  roleCode: string;
  salesXof: number;
  orders: number;
  tablesServed: number;
  tipsXof: number;
  averageTicketXof: number;
  updatedAt: string;
}

export interface StaffSummary {
  tenantId: string;
  employees: { total: number; active: number; invited: number; suspended: number };
  today: { date: string; shifts: number; present: number; stillClockedIn: number };
  pending: { leaves: number; swaps: number };
  tipsXof: number;
  salesXof: number;
  generatedAt: string;
}

export interface StaffGeofence {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface StaffAuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export const staffApi = {
  summary: (tenantId: string) =>
    staff<StaffSummary>('GET', `/api/v1/tenants/${tenantId}/staff/summary`),
  employees: (tenantId: string, filters: { status?: string; q?: string } = {}) =>
    staff<{ tenantId: string; items: StaffEmployee[]; count: number }>(
      'GET',
      `/api/v1/tenants/${tenantId}/staff/employees${paymentQuery(filters)}`,
    ),
  employee: (tenantId: string, id: string) =>
    staff<{
      employee: StaffEmployee;
      performance: {
        tenantId: string;
        employeeId: string;
        salesXof: number;
        orders: number;
        tablesServed: number;
        tipsXof: number;
        updatedAt: string;
      };
      attendance: StaffAttendance[];
      shifts: StaffShift[];
    }>('GET', `/api/v1/tenants/${tenantId}/staff/employees/${id}`),
  createEmployee: (
    tenantId: string,
    input: {
      name: string;
      phone: string;
      email?: string;
      jobTitle: string;
      roleCode?: string;
      contractType?: StaffContractType;
      hireDate?: string;
      baseSalaryXof?: number;
      paymentMethod?: StaffPaymentMethod;
      paymentDestination?: string;
    },
  ) =>
    staff<{ employee: StaffEmployee }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/employees`,
      input,
    ),
  updateEmployee: (tenantId: string, id: string, input: Record<string, unknown>) =>
    staff<{ employee: StaffEmployee }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/staff/employees/${id}`,
      input,
    ),
  addDocument: (tenantId: string, id: string, input: { name: string; type?: string }) =>
    staff<{ document: StaffDocument; employee: StaffEmployee }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/employees/${id}/documents`,
      input,
    ),
  invite: (
    tenantId: string,
    input: { name: string; phone: string; email?: string; jobTitle: string; roleCode?: string },
  ) =>
    staff<{
      invitation: {
        token: string;
        channel: 'sms' | 'email';
        expiresAt: string;
        employeeId: string;
        employeeName: string;
        destination: string | null;
        link: string;
        delivery: string;
      };
      employee: StaffEmployee;
    }>('POST', `/api/v1/tenants/${tenantId}/staff/invitations`, input),
  resendInvitation: (tenantId: string, token: string) =>
    staff<{ invitation: { token: string; expiresAt: string }; delivery: string }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/invitations/${token}/resend`,
      {},
    ),
  acceptInvitation: (tenantId: string, token: string, input: { pin?: string }) =>
    staff<{ employee: StaffEmployee; acceptedAt: string }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/invitations/${token}/accept`,
      input,
    ),
  shifts: (tenantId: string, range: { from?: string; to?: string } = {}) =>
    staff<{ tenantId: string; items: StaffShift[]; count: number }>(
      'GET',
      `/api/v1/tenants/${tenantId}/staff/shifts${paymentQuery(range)}`,
    ),
  createShift: (
    tenantId: string,
    input: {
      employeeId: string;
      date: string;
      start: string;
      end: string;
      station: StaffShiftStation;
      status?: StaffShiftStatus;
      note?: string;
    },
  ) => staff<{ shift: StaffShift }>('POST', `/api/v1/tenants/${tenantId}/staff/shifts`, input),
  updateShift: (tenantId: string, id: string, input: Record<string, unknown>) =>
    staff<{ shift: StaffShift }>('PATCH', `/api/v1/tenants/${tenantId}/staff/shifts/${id}`, input),
  requestSwap: (tenantId: string, shiftId: string, toEmployeeId: string) =>
    staff<{ swap: StaffSwap }>('POST', `/api/v1/tenants/${tenantId}/staff/shifts/${shiftId}/swap`, {
      toEmployeeId,
    }),
  swaps: (tenantId: string) =>
    staff<{ tenantId: string; items: StaffSwap[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/staff/swaps`,
    ),
  decideSwap: (tenantId: string, id: string, decision: 'approuve' | 'refuse') =>
    staff<{ swap: StaffSwap; shift: StaffShift }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/swaps/${id}/decide`,
      { decision },
    ),
  leaves: (tenantId: string, status?: string) =>
    staff<{
      tenantId: string;
      items: StaffLeave[];
      counts: { en_attente: number; approuve: number };
    }>('GET', `/api/v1/tenants/${tenantId}/staff/leaves${paymentQuery({ status })}`),
  requestLeave: (
    tenantId: string,
    input: { employeeId: string; type: StaffLeaveType; from: string; to: string; reason?: string },
  ) => staff<{ leave: StaffLeave }>('POST', `/api/v1/tenants/${tenantId}/staff/leaves`, input),
  decideLeave: (tenantId: string, id: string, decision: 'approuve' | 'refuse') =>
    staff<{ leave: StaffLeave }>('POST', `/api/v1/tenants/${tenantId}/staff/leaves/${id}/decide`, {
      decision,
    }),
  recordAbsence: (tenantId: string, input: { employeeId: string; date: string; reason?: string }) =>
    staff<{ absence: StaffLeave }>('POST', `/api/v1/tenants/${tenantId}/staff/absences`, input),
  attendance: (tenantId: string, date?: string) =>
    staff<{ tenantId: string; date: string; items: StaffAttendance[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/staff/attendance${paymentQuery({ date })}`,
    ),
  clockIn: (
    tenantId: string,
    input: { pin?: string; qrToken?: string; lat?: number; lng?: number },
  ) =>
    staff<{ attendance: StaffAttendance }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/attendance/clock`,
      input,
    ),
  clockOut: (tenantId: string, id: string) =>
    staff<{ attendance: StaffAttendance }>(
      'POST',
      `/api/v1/tenants/${tenantId}/staff/attendance/${id}/clock-out`,
      {},
    ),
  performance: (tenantId: string) =>
    staff<{
      tenantId: string;
      items: StaffPerformanceRecord[];
      totals: { salesXof: number; orders: number; tablesServed: number; tipsXof: number };
    }>('GET', `/api/v1/tenants/${tenantId}/staff/performance`),
  settings: (tenantId: string) =>
    staff<{ tenantId: string; geofence: StaffGeofence | null }>(
      'GET',
      `/api/v1/tenants/${tenantId}/staff/settings`,
    ),
  saveSettings: (tenantId: string, geofence: StaffGeofence | null) =>
    staff<{ tenantId: string; geofence: StaffGeofence | null }>(
      'PUT',
      `/api/v1/tenants/${tenantId}/staff/settings`,
      { geofence },
    ),
  audit: (tenantId: string) =>
    staff<{
      tenantId: string;
      entries: StaffAuditEntry[];
      integrity: boolean;
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/staff/audit`),
};

/* ------------------------------------------------------------------ */
/* payroll-service — règles paramétrables, cycles, validation, paie    */
/* ------------------------------------------------------------------ */

export type PayRuleType = 'prime' | 'indemnite' | 'cotisation' | 'retenue' | 'impot' | 'avance';
export type PayRuleBase =
  | 'salaire_base'
  | 'salaire_journalier'
  | 'salaire_brut'
  | 'brut_imposable'
  | 'net_imposable'
  | 'heures_sup'
  | 'ventes'
  | 'pourboires'
  | 'jours_absence';
export type PayRuleKind = 'percent' | 'amount' | 'heures' | 'jours' | 'tranches';

export interface PayRuleTier {
  upTo: number | null;
  ratePercent: number;
}

export interface PayRule {
  id: string;
  label: string;
  code: string;
  type: PayRuleType;
  enabled: boolean;
  taxable: boolean;
  deductible: boolean;
  base: PayRuleBase;
  kind: PayRuleKind;
  ratePercent?: number;
  rateXof?: number;
  multiplier?: number;
  capXof?: number;
  tranches?: PayRuleTier[];
  description: string;
  legalReference?: string;
}

export interface PayRuleIssue {
  level: 'error' | 'warning';
  ruleId?: string;
  message: string;
}

export interface PayrollSettings {
  tenantId: string;
  currency: 'XOF';
  monthlyHours: number;
  workingDaysPerMonth: number;
  rules: PayRule[];
  updatedAt: string;
  updatedBy: string | null;
  validation: PayRuleIssue[];
}

export type PayrollAdjustmentType = 'prime' | 'retenue' | 'avance';

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  label: string;
  type: PayrollAdjustmentType;
  amountXof: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PayComponent {
  ruleId: string;
  code: string;
  label: string;
  type: PayRuleType;
  kind: PayRuleKind;
  base: PayRuleBase;
  baseValue: number;
  operation: string;
  amountXof: number;
  capApplied: boolean;
  taxable: boolean;
  deductible: boolean;
}

export interface Payslip {
  employeeId: string;
  name: string;
  jobTitle: string;
  contractType: string;
  baseSalaryXof: number;
  paymentMethod: StaffPaymentMethod;
  paymentDestination: string;
  daysPresent: number;
  hoursWorked: number;
  overtimeHours: number;
  unpaidLeaveDays: number;
  salesXof: number;
  tipsXof: number;
  components: PayComponent[];
  brutXof: number;
  brutImposableXof: number;
  cotisationsXof: number;
  retenuesXof: number;
  impotsXof: number;
  avancesXof: number;
  netXof: number;
  adjustments: PayrollAdjustment[];
  sentAt: string | null;
  pdf: { fileName: string; generatedAt: string } | null;
}

export type PayrollRunStatus =
  'brouillon' | 'preparee' | 'validee' | 'en_cours' | 'reussi' | 'echoue' | 'a_rejouer';
export type PayrollPaymentStatus = 'en_cours' | 'reussi' | 'echoue' | 'a_rejouer';

export interface PayrollPaymentAttempt {
  at: string;
  reference: string;
  status: PayrollPaymentStatus;
  message: string;
  walletAvailableXof?: number;
}

export interface PayrollTotals {
  headcount: number;
  baseSalaryXof: number;
  brutXof: number;
  brutImposableXof: number;
  cotisationsXof: number;
  retenuesXof: number;
  impotsXof: number;
  avancesXof: number;
  netXof: number;
}

export interface PayrollRunSummary {
  id: string;
  tenantId: string;
  period: string;
  periodLabel: string;
  status: PayrollRunStatus;
  notes: string;
  totals: PayrollTotals;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  preparedBy: string | null;
  preparedAt: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  paidAt: string | null;
  locked: boolean;
  lockReason: string | null;
  retentionBlocked: boolean;
  staleReason: string | null;
  payment: {
    reference: string;
    status: PayrollPaymentStatus;
    attemptedAt: string;
    message: string;
  } | null;
  attempts: PayrollPaymentAttempt[];
  pdfReady: boolean;
  sentCount: number;
}

export interface PayrollRunDetail extends PayrollRunSummary {
  adjustments: PayrollAdjustment[];
  payslips: Payslip[];
  snapshot: {
    fetchedAt: string;
    monthlyHours: number;
    workingDaysPerMonth: number;
    rules: PayRule[];
  };
}

export interface PayrollSummary {
  tenantId: string;
  currentPeriod: string;
  settings: PayrollSettings;
  counts: Record<string, number>;
  runCount: number;
  currentRun: PayrollRunSummary | null;
  latestPaid: PayrollRunSummary | null;
  generatedAt: string;
}

export const payrollApi = {
  summary: (tenantId: string) =>
    payroll<PayrollSummary>('GET', `/api/v1/tenants/${tenantId}/payroll/summary`),
  settings: (tenantId: string) =>
    payroll<{ settings: PayrollSettings }>('GET', `/api/v1/tenants/${tenantId}/payroll/settings`),
  validateSettings: (tenantId: string, rules: PayRule[]) =>
    payroll<{ valid: boolean; issues: PayRuleIssue[] }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/settings/validate`,
      { rules },
    ),
  saveSettings: (
    tenantId: string,
    input: { monthlyHours?: number; workingDaysPerMonth?: number; rules?: PayRule[] },
  ) =>
    payroll<{ settings: PayrollSettings; issues: PayRuleIssue[] }>(
      'PUT',
      `/api/v1/tenants/${tenantId}/payroll/settings`,
      input,
    ),
  resetSettings: (tenantId: string) =>
    payroll<{ settings: PayrollSettings }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/settings/reset`,
      {},
    ),
  runs: (tenantId: string, filters: { period?: string; status?: string } = {}) =>
    payroll<{ tenantId: string; items: PayrollRunSummary[]; count: number }>(
      'GET',
      `/api/v1/tenants/${tenantId}/payroll/runs${paymentQuery(filters)}`,
    ),
  run: (tenantId: string, id: string) =>
    payroll<{ run: PayrollRunDetail }>('GET', `/api/v1/tenants/${tenantId}/payroll/runs/${id}`),
  createRun: (tenantId: string, input: { period: string; notes?: string }) =>
    payroll<{ run: PayrollRunDetail }>('POST', `/api/v1/tenants/${tenantId}/payroll/runs`, input),
  recalculateRun: (tenantId: string, id: string) =>
    payroll<{ run: PayrollRunDetail }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}/recalculate`,
      {},
    ),
  updateRun: (
    tenantId: string,
    id: string,
    input: {
      notes?: string;
      adjustments?: Array<{
        employeeId: string;
        label: string;
        type: PayrollAdjustmentType;
        amountXof: number;
        note?: string;
      }>;
    },
  ) =>
    payroll<{ run: PayrollRunDetail }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}`,
      input,
    ),
  validateRun: (tenantId: string, id: string) =>
    payroll<{ run: PayrollRunDetail }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}/validate`,
      {},
    ),
  payRun: (tenantId: string, id: string) =>
    payroll<{ run: PayrollRunDetail }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}/pay`,
      {},
    ),
  batches: (tenantId: string, id: string) =>
    payroll<{
      tenantId: string;
      runId: string;
      status: PayrollRunStatus;
      payment: PayrollRunSummary['payment'];
      attempts: PayrollPaymentAttempt[];
      locked: boolean;
    }>('GET', `/api/v1/tenants/${tenantId}/payroll/runs/${id}/batches`),
  sendBulletins: (tenantId: string, id: string) =>
    payroll<{ sent: number; employees: string[]; delivery: string; sentAt: string }>(
      'POST',
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}/bulletins/send`,
      {},
    ),
  payslipPdf: (tenantId: string, id: string, employeeId: string) =>
    serviceBlob(
      PAYROLL_URL,
      `/api/v1/tenants/${tenantId}/payroll/runs/${id}/bulletins/${employeeId}/pdf`,
    ),
  exportBlob: (tenantId: string, id: string, format: 'csv' | 'xls' | 'pdf' | 'rules.csv') =>
    serviceBlob(PAYROLL_URL, `/api/v1/tenants/${tenantId}/payroll/runs/${id}/exports/${format}`),
  audit: (tenantId: string) =>
    payroll<{
      tenantId: string;
      entries: StaffAuditEntry[];
      integrity: boolean;
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/payroll/audit`),
};

/* ------------------------------------------------------------------ */
/* inventory-service — stocks, fiches techniques, fournisseurs         */
/* ------------------------------------------------------------------ */

export type StockUnit = 'kg' | 'g' | 'l' | 'cl' | 'pcs' | 'btl';
export type StockLocation = 'reserve' | 'cuisine' | 'bar';
export type StockMovementType = 'in' | 'out' | 'adjust' | 'waste';

export interface StockItem {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  unit: StockUnit;
  category: string;
  quantity: number;
  threshold: number;
  costXof: number;
  supplierId: string | null;
  supplierName?: string | null;
  location: StockLocation;
  createdAt: string;
  updatedAt: string;
  low: boolean;
  depleted: boolean;
  valueXof: number;
}

export interface StockMovement {
  id: string;
  tenantId: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  quantity: number;
  costXof: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  actor: string;
  at: string;
}

export interface RecipeLineView {
  itemId: string;
  quantity: number;
  itemName: string;
  unit: StockUnit;
  costXof: number;
}

export interface RecipeView {
  id: string;
  tenantId: string;
  productId: string;
  productName: string;
  productPriceXof: number;
  yieldQty: number;
  lines: RecipeLineView[];
  costXof: number;
  marginXof: number;
  marginRate: number;
  maxProducible: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StockSupplier {
  id: string;
  tenantId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  termsDays: number;
  notes: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface InventoryCountLine {
  itemId: string;
  itemName: string;
  unit: StockUnit;
  expected: number;
  counted: number;
  variance: number;
  varianceCostXof: number;
}

export interface InventoryCountView {
  id: string;
  tenantId: string;
  date: string;
  status: 'brouillon' | 'valide';
  lines: InventoryCountLine[];
  createdBy: string;
  createdAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
}

export interface InventorySummary {
  tenantId: string;
  itemCount: number;
  lowStockCount: number;
  stockValueXof: number;
  waste30dXof: number;
  supplierCount: number;
  recipeCount: number;
  countCount: number;
  lastCount: { id: string; date: string; status: string; varianceXof: number } | null;
  alerts: StockItem[];
  generatedAt: string;
}

export interface ReorderSuggestion {
  itemId: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  estimatedCostXof: number;
  supplierId: string | null;
  supplierName: string | null;
}

export interface PurchaseOrderView {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName: string;
  number: string;
  status: 'brouillon' | 'commandee' | 'recue';
  lines: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitCostXof: number;
    lineTotalXof: number;
  }>;
  totalXof: number;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface InventoryAuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export const inventoryApi = {
  summary: (tenantId: string) =>
    inventory<InventorySummary>('GET', `/api/v1/tenants/${tenantId}/inventory/summary`),
  items: (tenantId: string, filters: { q?: string; category?: string } = {}) =>
    inventory<{
      items: StockItem[];
      categories: string[];
      units: StockUnit[];
      locations: StockLocation[];
    }>('GET', `/api/v1/tenants/${tenantId}/inventory/items${paymentQuery(filters)}`),
  createItem: (
    tenantId: string,
    input: {
      name: string;
      sku: string;
      unit: StockUnit;
      category: string;
      quantity?: number;
      threshold: number;
      costXof: number;
      supplierId?: string;
      location?: StockLocation;
    },
  ) => inventory<{ item: StockItem }>('POST', `/api/v1/tenants/${tenantId}/inventory/items`, input),
  updateItem: (tenantId: string, id: string, input: Record<string, unknown>) =>
    inventory<{ item: StockItem }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/inventory/items/${id}`,
      input,
    ),
  movements: (
    tenantId: string,
    filters: { type?: string; itemId?: string; from?: string; to?: string } = {},
  ) =>
    inventory<{ movements: StockMovement[]; types: StockMovementType[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/movements${paymentQuery(filters)}`,
    ),
  createMovement: (
    tenantId: string,
    input: {
      itemId: string;
      type: 'in' | 'out' | 'adjust';
      quantity: number;
      reason: string;
      unitCostXof?: number;
    },
  ) =>
    inventory<{ movement: StockMovement; item: StockItem }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/movements`,
      input,
    ),
  createWaste: (tenantId: string, input: { itemId: string; quantity: number; reason: string }) =>
    inventory<{ movement: StockMovement; item: StockItem }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/waste`,
      input,
    ),
  recipes: (tenantId: string) =>
    inventory<{ recipes: RecipeView[] }>('GET', `/api/v1/tenants/${tenantId}/inventory/recipes`),
  createRecipe: (
    tenantId: string,
    input: {
      productId: string;
      productName: string;
      productPriceXof: number;
      yieldQty?: number;
      lines: Array<{ itemId: string; quantity: number }>;
    },
  ) =>
    inventory<{ recipe: RecipeView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/recipes`,
      input,
    ),
  suppliers: (tenantId: string) =>
    inventory<{ suppliers: StockSupplier[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/suppliers`,
    ),
  createSupplier: (
    tenantId: string,
    input: {
      name: string;
      contactName?: string;
      phone?: string;
      email?: string;
      termsDays?: number;
      notes?: string;
    },
  ) =>
    inventory<{ supplier: StockSupplier }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/suppliers`,
      input,
    ),
  counts: (tenantId: string) =>
    inventory<{ counts: InventoryCountView[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/counts`,
    ),
  createCount: (
    tenantId: string,
    input: { date?: string; lines: Array<{ itemId: string; counted: number }> },
  ) =>
    inventory<{ count: InventoryCountView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/counts`,
      input,
    ),
  validateCount: (tenantId: string, id: string) =>
    inventory<{ count: InventoryCountView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/counts/${id}/validate`,
      {},
    ),
  purchaseOrders: (tenantId: string) =>
    inventory<{ purchaseOrders: PurchaseOrderView[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/purchase-orders`,
    ),
  createPurchaseOrder: (
    tenantId: string,
    input: {
      supplierId: string;
      lines: Array<{ itemId: string; quantity: number; unitCostXof: number }>;
    },
  ) =>
    inventory<{ purchaseOrder: PurchaseOrderView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/purchase-orders`,
      input,
    ),
  receivePurchaseOrder: (tenantId: string, id: string) =>
    inventory<{ purchaseOrder: PurchaseOrderView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/inventory/purchase-orders/${id}/receive`,
      {},
    ),
  alerts: (tenantId: string) =>
    inventory<{ alerts: StockItem[]; suggestions: ReorderSuggestion[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/alerts`,
    ),
  audit: (tenantId: string) =>
    inventory<{ entries: InventoryAuditEntry[]; integrity: boolean; generatedAt: string }>(
      'GET',
      `/api/v1/tenants/${tenantId}/inventory/audit`,
    ),
};

/* ------------------------------------------------------------------ */
/* loyalty-marketing-service — fidélité, promotions, campagnes, avis   */
/* ------------------------------------------------------------------ */

export type DiscountType = 'percent' | 'amount';
export type PromotionStatus = 'active' | 'planifiee' | 'terminee' | 'desactivee';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type CampaignChannel = 'sms' | 'email' | 'push';
export type CampaignStatus = 'brouillon' | 'planifiee' | 'envoyee' | 'annulee';
export type CampaignSegment = 'all' | 'bronze' | 'argent' | 'or' | 'platine' | 'inactifs';

export interface PromotionView {
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
  status: PromotionStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface PromoCodeView {
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
  status: PromotionStatus;
  remainingUses: number | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface PromoRedemptionView {
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

export interface CampaignView {
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

export interface ReviewView {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  moderationNote: string | null;
  reply: { message: string; by: string; byName: string; at: string } | null;
}

export interface ReviewAggregate {
  count: number;
  average: number;
  distribution: Record<string, number>;
  pending?: number;
}

export interface LoyaltyDashboard {
  tenantId: string;
  members: number;
  tiers: Record<string, number>;
  pointsOutstanding: number;
  promotions: { total: number; active: number };
  promoCodes: { total: number; active: number; redemptions: number; discountXof: number };
  campaigns: { total: number; envoyees: number; planifiees: number };
  reviews: ReviewAggregate & { pending: number };
  generatedAt: string;
}

export interface LoyaltyProgramView {
  tenantId: string;
  program: {
    pointsPerXof: number;
    currency: string;
    tiers: Array<{ code: string; label: string; minLifetimePoints: number; multiplier: number }>;
    rewards: Array<{ id: string; label: string; description: string; costPoints: number }>;
    rules: string;
  };
  stats: { members: number; pointsOutstanding: number; pointsEarned: number };
  reviews: ReviewAggregate;
}

export const marketingApi = {
  dashboard: (tenantId: string) =>
    marketing<LoyaltyDashboard>('GET', `/api/v1/tenants/${tenantId}/marketing/dashboard`),
  program: (tenantId: string) =>
    marketing<LoyaltyProgramView>('GET', `/api/v1/tenants/${tenantId}/loyalty/program`),
  promotions: (tenantId: string) =>
    marketing<{ tenantId: string; items: PromotionView[]; counts: Record<string, number> }>(
      'GET',
      `/api/v1/tenants/${tenantId}/marketing/promotions`,
    ),
  createPromotion: (
    tenantId: string,
    input: {
      name: string;
      description?: string;
      type: DiscountType;
      value: number;
      minOrderXof?: number;
      appliesTo?: 'all' | 'dine_in' | 'delivery' | 'takeaway';
      startAt: string;
      endAt: string;
      active?: boolean;
    },
  ) =>
    marketing<{ promotion: PromotionView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/marketing/promotions`,
      input,
    ),
  updatePromotion: (tenantId: string, id: string, input: Record<string, unknown>) =>
    marketing<{ promotion: PromotionView }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/marketing/promotions/${id}`,
      input,
    ),
  promoCodes: (tenantId: string) =>
    marketing<{
      tenantId: string;
      items: PromoCodeView[];
      redemptions: PromoRedemptionView[];
      totals: { redemptions: number; discountXof: number };
    }>('GET', `/api/v1/tenants/${tenantId}/marketing/promo-codes`),
  createPromoCode: (
    tenantId: string,
    input: {
      code: string;
      type: DiscountType;
      value: number;
      minOrderXof?: number;
      maxUses?: number;
      perUserLimit?: number;
      startAt: string;
      endAt: string;
      active?: boolean;
    },
  ) =>
    marketing<{ promoCode: PromoCodeView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/marketing/promo-codes`,
      input,
    ),
  updatePromoCode: (tenantId: string, id: string, input: Record<string, unknown>) =>
    marketing<{ promoCode: PromoCodeView }>(
      'PATCH',
      `/api/v1/tenants/${tenantId}/marketing/promo-codes/${id}`,
      input,
    ),
  campaigns: (tenantId: string) =>
    marketing<{
      tenantId: string;
      items: CampaignView[];
      segments: CampaignSegment[];
      channels: CampaignChannel[];
      audience: Record<string, number>;
    }>('GET', `/api/v1/tenants/${tenantId}/marketing/campaigns`),
  createCampaign: (
    tenantId: string,
    input: {
      name: string;
      channel: CampaignChannel;
      segment?: CampaignSegment;
      message: string;
      scheduledAt?: string | null;
    },
  ) =>
    marketing<{ campaign: CampaignView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/marketing/campaigns`,
      input,
    ),
  sendCampaign: (tenantId: string, id: string) =>
    marketing<{ campaign: CampaignView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/marketing/campaigns/${id}/send`,
      {},
    ),
  cancelCampaign: (tenantId: string, id: string) =>
    marketing<{ campaign: CampaignView }>(
      'POST',
      `/api/v1/tenants/${tenantId}/marketing/campaigns/${id}/cancel`,
      {},
    ),
  reviews: (tenantId: string, status?: ReviewStatus) =>
    marketing<{
      tenantId: string;
      items: ReviewView[];
      counts: Record<ReviewStatus, number>;
      aggregate: ReviewAggregate;
    }>('GET', `/api/v1/tenants/${tenantId}/reviews${paymentQuery({ status })}`),
  moderateReview: (tenantId: string, id: string, action: 'approve' | 'reject', note?: string) =>
    marketing<{ review: ReviewView; aggregate: ReviewAggregate }>(
      'POST',
      `/api/v1/tenants/${tenantId}/reviews/${id}/moderate`,
      { action, note },
    ),
  replyReview: (tenantId: string, id: string, message: string) =>
    marketing<{ review: ReviewView; aggregate: ReviewAggregate }>(
      'POST',
      `/api/v1/tenants/${tenantId}/reviews/${id}/reply`,
      { message },
    ),
  audit: (tenantId: string) =>
    marketing<{ entries: InventoryAuditEntry[]; integrity: boolean; generatedAt: string }>(
      'GET',
      `/api/v1/tenants/${tenantId}/loyalty/audit`,
    ),
};

/* ------------------------------------------------------------------ */
/* reporting-service — tableaux de bord et exports                     */
/* ------------------------------------------------------------------ */

export type ReportName =
  'dashboard' | 'sales' | 'products' | 'occupancy' | 'taxes' | 'payroll' | 'stock' | 'reviews';
export type ReportFormat = 'csv' | 'xlsx' | 'pdf';
export type ReportGranularity = 'day' | 'month';

export interface ReportSite {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
}

export interface ProductRankRow {
  productId: string;
  productName: string;
  station: string;
  quantity: number;
  revenueXof: number;
  sharePct: number;
}

export interface ReportDashboard {
  tenantId: string;
  siteId: string | null;
  from: string;
  to: string;
  currency: string;
  revenueXof: number;
  netRevenueXof: number;
  orders: number;
  averageTicketXof: number;
  taxXof: number;
  subtotalXof: number;
  discountXof: number;
  refundsXof: number;
  refundCount: number;
  failedPayments: number;
  cogsXof: number | null;
  grossMarginXof: number | null;
  marginRatePct: number | null;
  paymentMix: Array<{
    method: string;
    amountXof: number;
    count: number;
    refundedXof: number;
    sharePct: number;
  }>;
  channelMix: Array<{ channel: string; amountXof: number; count: number; sharePct: number }>;
  topProducts: ProductRankRow[];
  peakHours: Array<{ hour: number; orders: number; revenueXof: number }>;
  occupancy: {
    days: number;
    covers: number;
    capacitySeats: number;
    ratePct: number;
    reservations: number;
    noShows: number;
  };
  reservations: { count: number; covers: number; cancelled: number };
  payroll: { runs: number; totalXof: number };
  reviews: ReviewAggregate;
  stock: { latestValueXof: number; wasteXof: number; lowStockCount: number };
  generatedAt: string;
}

export interface ReportTimeseriesPoint {
  bucket: string;
  orders: number;
  revenueXof: number;
  averageTicketXof: number;
  refundsXof: number;
}

export interface SalesReport {
  group: ReportGranularity;
  columns: string[];
  rows: Array<Array<string | number>>;
  totals: { orders: number; revenueXof: number; taxXof: number; refundsXof: number };
  generatedAt: string;
}

export interface ReportAuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

function reportQuery(params: Record<string, string | number | undefined>): string {
  return paymentQuery(params);
}

export const reportApi = {
  sites: (tenantId: string) =>
    reports<{ tenantId: string; items: ReportSite[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/reports/sites`,
    ),
  dashboard: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{ dashboard: ReportDashboard; sites: ReportSite[] }>(
      'GET',
      `/api/v1/tenants/${tenantId}/reports/dashboard${reportQuery(params)}`,
    ),
  timeseries: (
    tenantId: string,
    params: { from?: string; to?: string; siteId?: string; granularity?: ReportGranularity } = {},
  ) =>
    reports<{
      granularity: ReportGranularity;
      points: ReportTimeseriesPoint[];
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/timeseries${reportQuery(params)}`),
  sales: (
    tenantId: string,
    params: { from?: string; to?: string; siteId?: string; group?: ReportGranularity } = {},
  ) =>
    reports<SalesReport>('GET', `/api/v1/tenants/${tenantId}/reports/sales${reportQuery(params)}`),
  products: (
    tenantId: string,
    params: { from?: string; to?: string; siteId?: string; limit?: number } = {},
  ) =>
    reports<{ items: ProductRankRow[]; generatedAt: string }>(
      'GET',
      `/api/v1/tenants/${tenantId}/reports/products${reportQuery(params)}`,
    ),
  peakHours: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      buckets: Array<{ hour: number; orders: number; revenueXof: number }>;
      peak: Array<{ hour: number; orders: number; revenueXof: number }>;
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/peak-hours${reportQuery(params)}`),
  occupancy: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      summary: {
        days: number;
        covers: number;
        capacitySeats: number;
        ratePct: number;
        reservations: number;
        noShows: number;
      };
      items: Array<{
        id: string;
        date: string;
        seatsCapacity: number;
        covers: number;
        reservations: number;
        noShows: number;
        ratePct: number;
      }>;
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/occupancy${reportQuery(params)}`),
  liveOccupancy: (tenantId: string) =>
    reports<{ tenantId: string; seats: number; tables: number; generatedAt: string }>(
      'GET',
      `/api/v1/tenants/${tenantId}/reports/occupancy/live`,
    ),
  taxes: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      ratePct: number;
      rows: Array<{ month: string; taxableBaseXof: number; taxXof: number }>;
      totals: { taxableBaseXof: number; taxXof: number };
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/taxes${reportQuery(params)}`),
  payroll: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      items: Array<{
        id: string;
        runId: string;
        period: string;
        headcount: number;
        totalXof: number;
        paidAt: string;
      }>;
      totals: { runs: number; totalXof: number };
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/payroll${reportQuery(params)}`),
  stock: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      items: Array<{
        id: string;
        at: string;
        stockValueXof: number;
        wasteXof: number;
        lowStockCount: number;
      }>;
      latest: {
        id: string;
        at: string;
        stockValueXof: number;
        wasteXof: number;
        lowStockCount: number;
      } | null;
      totals: { wasteXof: number };
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/stock${reportQuery(params)}`),
  reviews: (tenantId: string, params: { from?: string; to?: string; siteId?: string } = {}) =>
    reports<{
      summary: ReviewAggregate;
      items: Array<{
        id: string;
        reviewId: string;
        rating: number;
        status: ReviewStatus;
        at: string;
      }>;
      generatedAt: string;
    }>('GET', `/api/v1/tenants/${tenantId}/reports/reviews${reportQuery(params)}`),
  exportBlob: (
    tenantId: string,
    params: {
      report: ReportName;
      format: ReportFormat;
      from?: string;
      to?: string;
      siteId?: string;
    },
  ) =>
    serviceBlob(REPORTING_URL, `/api/v1/tenants/${tenantId}/reports/export${reportQuery(params)}`),
  audit: (tenantId: string) =>
    reports<{ items: ReportAuditEntry[]; integrity: boolean }>(
      'GET',
      `/api/v1/tenants/${tenantId}/reports/audit`,
    ),
};

export interface PlatformDashboard {
  establishments: {
    total: number;
    active: number;
    suspended: number;
    byPlan: Record<'starter' | 'pro' | 'enterprise', number>;
    trials: number;
  };
  finance: {
    volume30dXof: number;
    commissions30dXof: number;
    net30dXof: number;
    refunds30dXof: number;
    failedPayments24h: number;
    openDisputes: number;
    mrrXof: number;
    averageCommissionRatePct: number;
  };
  operations: {
    services: number;
    servicesUp: number;
    servicesDown: number;
    openAlerts: number;
    events24h: number;
    pendingApplications: number;
  };
  subscriptionPlans: Array<{ plan: string; priceXof: number }>;
  generatedAt: string;
}

export interface PlatformEstablishmentRow {
  tenantId: string;
  brandName: string;
  slug: string;
  plan: string;
  status: 'active' | 'suspended';
  city: string | null;
  trial: boolean;
  createdAt: string;
  updatedAt: string;
  volume30dXof: number;
  commission30dXof: number;
  transactions30d: number;
  openDisputes: number;
}

export interface CommissionGroupRow {
  key: string;
  label: string;
  transactions: number;
  volumeXof: number;
  commissionXof: number;
  netXof: number;
}

export interface CommissionEntryView {
  id: string;
  tenantId: string;
  transactionId: string;
  reference: string;
  amountXof: number;
  commissionXof: number;
  netXof: number;
  method: string;
  provider: string;
  at: string;
}

export interface PlatformCommissionView {
  window: { days: number; from: string; to: string };
  summary: {
    transactions: number;
    volumeXof: number;
    commissionXof: number;
    netXof: number;
    averageBasketXof: number;
    averageRatePct: number;
  };
  groups: {
    tenant: CommissionGroupRow[];
    provider: CommissionGroupRow[];
    method: CommissionGroupRow[];
    day: CommissionGroupRow[];
  };
  transactions: CommissionEntryView[];
}

export interface PlatformTransactionRow {
  id: string;
  tenantId: string;
  kind: 'payment' | 'refund' | 'failed' | 'settlement' | 'subscription';
  reference: string;
  amountXof: number;
  method: string | null;
  provider: string | null;
  at: string;
}

export interface PlatformDisputeRow {
  id: string;
  tenantId: string;
  transactionId: string;
  reason: string;
  status: 'open' | 'resolved';
  openedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface SupervisionServiceRow {
  name: string;
  url: string;
  status: 'up' | 'down' | 'unknown';
  latencyMs: number;
  lastCheckAt: string | null;
  consecutiveFailures: number;
  checks: number;
  failures: number;
  uptimePct: number;
}

export interface PlatformAlertRow {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  service: string;
  code: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface PlatformLogRow {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  meta: Record<string, unknown> | null;
  at: string;
}

export interface PlatformSupervision {
  services: SupervisionServiceRow[];
  alerts: PlatformAlertRow[];
  logs: PlatformLogRow[];
  metrics: {
    eventsReceived: number;
    eventsByType: Record<string, number>;
    events24h: number;
    recentEvents: Array<{ type: string; at: string }>;
    checkedAt: string;
  };
  audit: { valid: boolean; length: number };
}

export interface PlatformCountrySetting {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  active: boolean;
  defaultTaxCode: string;
}

export interface PlatformTaxSetting {
  code: string;
  name: string;
  ratePct: number;
  scope: 'sales' | 'payroll' | 'service';
  active: boolean;
}

export interface PlatformProviderSetting {
  code: string;
  name: string;
  enabled: boolean;
  currencies: string[];
  channels: string[];
  priority: number;
}

export interface PlatformSettingsData {
  languages: Array<'fr' | 'en'>;
  defaultLanguage: 'fr' | 'en';
  currency: string;
  timezone: string;
  supportEmail: string;
  supportPhone: string;
  countries: PlatformCountrySetting[];
  taxes: PlatformTaxSetting[];
  providers: PlatformProviderSetting[];
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformAuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface PlatformSettingsResponse {
  settings: PlatformSettingsData;
  audit: { valid: boolean; length: number };
}

function platformQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const platformAdmin = <T>(method: Method, path: string, body?: unknown) =>
  request<T>(PLATFORM_ADMIN_URL, method, path, body);

export const platformAdminApi = {
  dashboard: () => platformAdmin<PlatformDashboard>('GET', '/api/v1/platform/dashboard'),
  establishments: (filters: { status?: string; plan?: string; q?: string } = {}) =>
    platformAdmin<{ items: PlatformEstablishmentRow[] }>(
      'GET',
      `/api/v1/platform/establishments${platformQuery(filters)}`,
    ),
  establishment: (tenantId: string) =>
    platformAdmin<{
      establishment: PlatformEstablishmentRow;
      transactions: PlatformTransactionRow[];
      disputes: PlatformDisputeRow[];
    }>('GET', `/api/v1/platform/establishments/${tenantId}`),
  commissions: (days = 30) =>
    platformAdmin<PlatformCommissionView>(
      'GET',
      `/api/v1/platform/commissions${platformQuery({ days })}`,
    ),
  transactions: (filters: { kind?: string; tenantId?: string; limit?: number } = {}) =>
    platformAdmin<{ items: PlatformTransactionRow[] }>(
      'GET',
      `/api/v1/platform/transactions${platformQuery(filters)}`,
    ),
  disputes: (status?: string) =>
    platformAdmin<{ items: PlatformDisputeRow[] }>(
      'GET',
      `/api/v1/platform/disputes${platformQuery({ status })}`,
    ),
  supervision: () => platformAdmin<PlatformSupervision>('GET', '/api/v1/platform/supervision'),
  checkSupervision: () =>
    platformAdmin<{ results: unknown[]; services: SupervisionServiceRow[] }>(
      'POST',
      '/api/v1/platform/supervision/check',
      {},
    ),
  updateAlert: (id: string, action: 'acknowledge' | 'resolve') =>
    platformAdmin<{ alert: PlatformAlertRow }>(
      'PATCH',
      `/api/v1/platform/supervision/alerts/${id}`,
      { action },
    ),
  logs: (filters: { level?: string; service?: string; limit?: number } = {}) =>
    platformAdmin<{ items: PlatformLogRow[] }>(
      'GET',
      `/api/v1/platform/supervision/logs${platformQuery(filters)}`,
    ),
  settings: () => platformAdmin<PlatformSettingsResponse>('GET', '/api/v1/platform/settings'),
  updateSettings: (settings: PlatformSettingsData) =>
    platformAdmin<{
      settings: PlatformSettingsData;
      audit: PlatformAuditEntry;
      changed: Record<string, boolean>;
    }>('PUT', '/api/v1/platform/settings', settings),
  audit: (limit = 100) =>
    platformAdmin<{ entries: PlatformAuditEntry[]; chain: { valid: boolean; length: number } }>(
      'GET',
      `/api/v1/platform/audit${platformQuery({ limit })}`,
    ),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}
