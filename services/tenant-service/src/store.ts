import { buildAuditEntry, newId, nowIso, slugify, type AuditEntry } from '@resto-hub/service-kit';
import type { PlanCode } from './plans.js';

export const DEMO_TENANT_ID = 'tnt_sahelgrill';

export type ApplicationStatus = 'draft' | 'submitted' | 'info_requested' | 'approved' | 'rejected';
export type DocumentType = 'nif' | 'rccm' | 'id_card' | 'business_license' | 'other';

export interface HourRange {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
}

export interface EstablishmentInfo {
  legalName: string;
  brandName: string;
  type: 'restaurant' | 'bar' | 'both';
  nif: string;
  rccm: string;
  description?: string;
  logoUrl?: string;
  photos?: string[];
  address: { street: string; district: string; city: string; country: string };
  contact: { phone: string; email: string; website?: string };
  hours: HourRange[];
}

export interface ManagerInfo {
  name: string;
  email: string;
  phone: string;
  password?: string;
}

export interface DocumentRecord {
  id: string;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  uploadedAt: string;
}

export interface ReviewNote {
  actorId: string;
  action: 'approve' | 'reject' | 'request_documents' | 'submitted';
  reason?: string;
  note?: string;
  at: string;
}

export interface ApplicationRecord {
  id: string;
  reference: string;
  status: ApplicationStatus;
  establishment: Partial<EstablishmentInfo>;
  manager: Partial<ManagerInfo>;
  plan: PlanCode;
  currency: string;
  languages: string[];
  documents: DocumentRecord[];
  acceptTerms: boolean;
  review: {
    decidedBy?: string;
    decidedAt?: string;
    reason?: string;
    notes: ReviewNote[];
  };
  tokenHash: string;
  submittedAt?: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  logoUrl?: string;
  photos?: string[];
  primaryColor: string;
  secondaryColor: string;
  languages: Array<'fr' | 'en'>;
  currency: string;
  timezone: string;
  address?: EstablishmentInfo['address'];
  contactPhone?: string;
  contactEmail?: string;
  hours?: HourRange[];
  description?: string;
  kind?: 'restaurant' | 'bar' | 'both';
  geo?: { lat: number; lng: number };
}

export type TenantStatus = 'active' | 'suspended';

export interface TenantRecord {
  id: string;
  slug: string;
  subdomain: string;
  legalName: string;
  brandName: string;
  nif: string;
  rccm: string;
  managerEmail: string;
  ownerUserId: string;
  plan: PlanCode;
  status: TenantStatus;
  settings: TenantSettings;
  suspension?: { reason: string; at: string; actorId: string };
  applicationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteRecord {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  phone?: string;
  isPrimary: boolean;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';

export interface SubscriptionRecord {
  tenantId: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialUsed: boolean;
  updatedAt: string;
}

export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'void';

export interface InvoiceRecord {
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
  createdAt: string;
}

export interface TenantAuditInput {
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
}

export interface TenantStore {
  applications: Map<string, ApplicationRecord>;
  tenants: Map<string, TenantRecord>;
  sites: Map<string, SiteRecord>;
  subscriptions: Map<string, SubscriptionRecord>;
  invoices: Map<string, InvoiceRecord>;
  audit: AuditEntry[];
  referenceCounter: number;
  invoiceCounter: number;
  recordAudit: (input: TenantAuditInput) => AuditEntry;
  nextReference: () => string;
  nextInvoiceNumber: () => string;
  sitesForTenant: (tenantId: string) => SiteRecord[];
  invoicesForTenant: (tenantId: string) => InvoiceRecord[];
  tenantBySlug: (slug: string) => TenantRecord | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createTenantStore(): TenantStore {
  const store: TenantStore = {
    applications: new Map(),
    tenants: new Map(),
    sites: new Map(),
    subscriptions: new Map(),
    invoices: new Map(),
    audit: [],
    referenceCounter: 0,
    invoiceCounter: 0,

    recordAudit(input) {
      const previous = this.audit[this.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      this.audit.push(entry);
      return entry;
    },
    nextReference() {
      this.referenceCounter += 1;
      return `APP-${new Date().getFullYear()}-${String(this.referenceCounter).padStart(4, '0')}`;
    },
    nextInvoiceNumber() {
      this.invoiceCounter += 1;
      return `FAC-${new Date().getFullYear()}-${String(this.invoiceCounter).padStart(5, '0')}`;
    },
    sitesForTenant(tenantId) {
      return [...this.sites.values()]
        .filter((site) => site.tenantId === tenantId)
        .sort((a, b) => (a.isPrimary === b.isPrimary ? a.createdAt.localeCompare(b.createdAt) : a.isPrimary ? -1 : 1));
    },
    invoicesForTenant(tenantId) {
      return [...this.invoices.values()]
        .filter((invoice) => invoice.tenantId === tenantId)
        .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
    },
    tenantBySlug(slug) {
      return [...this.tenants.values()].find((tenant) => tenant.slug === slug);
    },
  };
  return store;
}

function seedDocument(type: DocumentType, fileName: string, content: string): DocumentRecord {
  const buffer = Buffer.from(content, 'utf8');
  return {
    id: newId('doc'),
    type,
    fileName,
    mimeType: 'text/plain',
    sizeBytes: buffer.length,
    dataBase64: buffer.toString('base64'),
    uploadedAt: nowIso(),
  };
}

export function seedTenantDemo(store: TenantStore): void {
  const now = nowIso();
  const tenant: TenantRecord = {
    id: DEMO_TENANT_ID,
    slug: 'sahel-grill',
    subdomain: 'sahel-grill.resto-hub.tg',
    legalName: 'SAHEL GRILL SARL',
    brandName: 'Sahel Grill',
    nif: '1001234567',
    rccm: 'TG-LOM-2024-B-1234',
    managerEmail: 'gerant@sahelgrill.tg',
    ownerUserId: 'usr_gerant_sahel',
    plan: 'pro',
    status: 'active',
    settings: {
      primaryColor: '#C2410C',
      secondaryColor: '#0F766E',
      languages: ['fr', 'en'],
      currency: 'XOF',
      timezone: 'Africa/Lome',
      address: { street: 'Boulevard du Mono 24', district: 'Bè', city: 'Lomé', country: 'Togo' },
      contactPhone: '+22890112233',
      contactEmail: 'contact@sahelgrill.tg',
      hours: [
        { day: 'lun', open: '11:00', close: '23:00' },
        { day: 'mar', open: '11:00', close: '23:00' },
        { day: 'mer', open: '11:00', close: '23:00' },
        { day: 'jeu', open: '11:00', close: '00:30' },
        { day: 'ven', open: '11:00', close: '01:30' },
        { day: 'sam', open: '12:00', close: '01:30' },
        { day: 'dim', open: '12:00', close: '22:00' },
      ],
      description: 'Grillades au feu de bois, cocktails et terrasse face au Mono.',
      kind: 'restaurant',
      geo: { lat: 6.1319, lng: 1.2228 },
      photos: [
        'https://picsum.photos/seed/rh-sahel-hero/1200/800',
        'https://picsum.photos/seed/rh-sahel-grill/800/600',
      ],
    },
    applicationId: 'app_demo_sahel',
    createdAt: now,
    updatedAt: now,
  };
  store.tenants.set(tenant.id, tenant);

  const primarySite: SiteRecord = {
    id: newId('ste'),
    tenantId: tenant.id,
    name: 'Sahel Grill — Lomé',
    address: 'Boulevard du Mono 24, Bè, Lomé',
    phone: '+22890112233',
    isPrimary: true,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  store.sites.set(primarySite.id, primarySite);

  store.subscriptions.set(tenant.id, {
    tenantId: tenant.id,
    plan: 'pro',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    trialUsed: true,
    updatedAt: now,
  });

  const paidInvoice: InvoiceRecord = {
    id: 'inv_demo_sahel',
    number: 'FAC-2026-00001',
    tenantId: tenant.id,
    plan: 'pro',
    amountXof: 35000,
    status: 'paid',
    issuedAt: now,
    dueAt: now,
    periodStart: now,
    periodEnd: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    paidAt: now,
    provider: 'cinetpay',
    reference: 'CINETPAY-DEMO-0001',
    createdAt: now,
  };
  store.invoices.set(paidInvoice.id, paidInvoice);
  store.invoiceCounter = 1;

  const pendingApplication: ApplicationRecord = {
    id: 'app_demo_baobab',
    reference: 'APP-2026-0001',
    status: 'submitted',
    establishment: {
      legalName: 'LE BAOBAB SARL',
      brandName: 'Le Baobab',
      type: 'both',
      nif: '1009876543',
      rccm: 'TG-LOM-2025-B-8842',
      description: 'Bar à cocktails et cuisine de rue, quartier Kodjoviakopé.',
      address: { street: 'Rue des Palmiers 8', district: 'Kodjoviakopé', city: 'Lomé', country: 'Togo' },
      contact: { phone: '+22892445566', email: 'hello@lebaobab.tg' },
      hours: [
        { day: 'lun', open: '17:00', close: '01:00' },
        { day: 'mar', open: '17:00', close: '01:00' },
      ],
    },
    manager: { name: 'Ami Sokpé', email: 'ami@lebaobab.tg', phone: '+22892445566' },
    plan: 'pro',
    currency: 'XOF',
    languages: ['fr', 'en'],
    documents: [
      seedDocument('nif', 'NIF-Le-Baobab.txt', 'NIF 1009876543 — DGI Togo (document de démonstration)'),
      seedDocument('rccm', 'RCCM-Le-Baobab.txt', 'RCCM TG-LOM-2025-B-8842 — CFE Lomé (document de démonstration)'),
    ],
    acceptTerms: true,
    review: { notes: [] },
    tokenHash: '',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  store.applications.set(pendingApplication.id, pendingApplication);
  store.referenceCounter = 1;

  const infoApplication: ApplicationRecord = {
    ...pendingApplication,
    id: 'app_demo_lagune',
    reference: 'APP-2026-0002',
    status: 'info_requested',
    establishment: {
      ...pendingApplication.establishment,
      legalName: 'LAGUNE BEACH CLUB',
      brandName: 'Lagune Beach Club',
      nif: '1007744112',
      rccm: '',
      type: 'restaurant',
      address: { street: 'Route de la plage', district: 'Agoè', city: 'Lomé', country: 'Togo' },
    },
    manager: { name: 'Sena Adjovi', email: 'sena@lagune.tg', phone: '+22893556677' },
    plan: 'starter',
    documents: [seedDocument('nif', 'NIF-Lagune.txt', 'NIF 1007744112 — DGI Togo (document de démonstration)')],
    review: {
      notes: [
        {
          actorId: 'usr_platform_admin',
          action: 'request_documents',
          note: 'Merci de joindre le RCCM de la société.',
          at: now,
        },
      ],
    },
  };
  store.applications.set(infoApplication.id, infoApplication);
  store.referenceCounter = 2;

  // Deux établissements actifs supplémentaires pour la découverte et la carte
  // de l'application cliente (menus et plans de salle semés côté services métier).
  const extra: Array<Pick<TenantRecord, 'id' | 'slug' | 'brandName' | 'legalName' | 'settings'>> = [
    {
      id: 'tnt_baobab',
      slug: 'le-baobab',
      brandName: 'Le Baobab',
      legalName: 'LE BAOBAB SARL',
      settings: {
        primaryColor: '#6D28D9',
        secondaryColor: '#C2410C',
        languages: ['fr', 'en'],
        currency: 'XOF',
        timezone: 'Africa/Lome',
        address: { street: 'Rue des Palmiers 8', district: 'Kodjoviakopé', city: 'Lomé', country: 'Togo' },
        contactPhone: '+22892445566',
        contactEmail: 'hello@lebaobab.tg',
        description: 'Cocktails signature, cuisine de rue et scène live le week-end.',
        hours: [
          { day: 'lun', open: '17:00', close: '01:00' },
          { day: 'mar', open: '17:00', close: '01:00' },
          { day: 'mer', open: '17:00', close: '01:00' },
          { day: 'jeu', open: '17:00', close: '02:00' },
          { day: 'ven', open: '17:00', close: '03:00' },
          { day: 'sam', open: '16:00', close: '03:00' },
          { day: 'dim', open: '16:00', close: '00:00' },
        ],
        kind: 'bar',
        geo: { lat: 6.1288, lng: 1.2113 },
        photos: [
          'https://picsum.photos/seed/rh-baobab-hero/1200/800',
          'https://picsum.photos/seed/rh-baobab-cocktail/800/600',
        ],
      },
    },
    {
      id: 'tnt_lagune',
      slug: 'lagune-beach-club',
      brandName: 'Lagune Beach Club',
      legalName: 'LAGUNE BEACH CLUB',
      settings: {
        primaryColor: '#0E7490',
        secondaryColor: '#EA580C',
        languages: ['fr', 'en'],
        currency: 'XOF',
        timezone: 'Africa/Lome',
        address: { street: 'Route de la plage', district: 'Agoè', city: 'Lomé', country: 'Togo' },
        contactPhone: '+22893556677',
        contactEmail: 'bonjour@lagune.tg',
        description: 'Poissons grillés, fruits de mer et coucher de soleil sur la lagune.',
        hours: [
          { day: 'mer', open: '12:00', close: '22:00' },
          { day: 'jeu', open: '12:00', close: '22:00' },
          { day: 'ven', open: '12:00', close: '23:00' },
          { day: 'sam', open: '11:00', close: '23:00' },
          { day: 'dim', open: '11:00', close: '21:00' },
        ],
        kind: 'restaurant',
        geo: { lat: 6.175, lng: 1.24 },
        photos: [
          'https://picsum.photos/seed/rh-lagune-hero/1200/800',
          'https://picsum.photos/seed/rh-lagune-table/800/600',
        ],
      },
    },
  ];

  for (const entry of extra) {
    const record: TenantRecord = {
      ...entry,
      subdomain: `${entry.slug}.resto-hub.tg`,
      nif: '1000000000',
      rccm: 'TG-LOM-2025-B-0000',
      managerEmail: `gerant@${entry.slug}.tg`,
      ownerUserId: `usr_gerant_${entry.slug.replace(/-/g, '_')}`,
      plan: 'pro',
      status: 'active',
      applicationId: `app_seed_${entry.id}`,
      createdAt: now,
      updatedAt: now,
    };
    store.tenants.set(record.id, record);
    const site: SiteRecord = {
      id: newId('ste'),
      tenantId: record.id,
      name: `${record.brandName} — Lomé`,
      address: `${record.settings.address?.street ?? ''}, ${record.settings.address?.district ?? ''}, Lomé`.replace(/^, /, ''),
      phone: record.settings.contactPhone,
      isPrimary: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    store.sites.set(site.id, site);
    store.subscriptions.set(record.id, {
      tenantId: record.id,
      plan: 'pro',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      trialUsed: true,
      updatedAt: now,
    });
  }
}

export function uniqueSlug(store: TenantStore, brandName: string): string {
  const base = slugify(brandName) || 'etablissement';
  let slug = base;
  let index = 2;
  while (store.tenantBySlug(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  return slug;
}
