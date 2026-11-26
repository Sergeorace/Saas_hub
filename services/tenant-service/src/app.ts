import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  HttpError,
  asObject,
  newId,
  nowIso,
  optionalBoolean,
  optionalString,
  randomToken,
  requireArray,
  requireEmail,
  requireEnum,
  requirePhone,
  requireString,
  sha256,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import { PLAN_CODES, PLANS, planByCode, type PlanCode } from './plans.js';
import {
  uniqueSlug,
  type ApplicationRecord,
  type DocumentType,
  type HourRange,
  type InvoiceRecord,
  type SiteRecord,
  type TenantRecord,
  type TenantStore,
} from './store.js';
import type { TenantConfig } from './config.js';

export interface TenantAppOptions {
  store: TenantStore;
  config: TenantConfig;
  identity: ServiceClient;
  catalog?: ServiceClient;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

const DEFAULT_COLORS = { primary: '#C2410C', secondary: '#0F766E' };
const DOC_TYPES: DocumentType[] = ['nif', 'rccm', 'id_card', 'business_license', 'other'];
const DAY_MS = 24 * 60 * 60 * 1000;

function hasPlatform(claims: AuthClaims, permission: string): boolean {
  return claims.platformPermissions.includes(permission) || claims.platformPermissions.includes('platform:operate');
}

function ensurePlatform(claims: AuthClaims | undefined, permission: string): AuthClaims {
  if (!claims) throw HttpError.unauthorized();
  if (!hasPlatform(claims, permission)) {
    throw new HttpError(403, 'platform_permission_denied', 'Permission plateforme requise.');
  }
  return claims;
}

function ensureTenant(
  store: TenantStore,
  claims: AuthClaims | undefined,
  tenantId: string,
  permission: string,
): TenantRecord {
  if (!claims) throw HttpError.unauthorized();
  const tenant = store.tenants.get(tenantId);
  if (!tenant) throw HttpError.notFound('Établissement introuvable.');
  if (hasPlatform(claims, 'platform:operate')) return tenant;
  if (!claims.tenantPermissions[tenantId]?.includes(permission)) {
    throw new HttpError(403, 'tenant_scope_denied', "Vous n'avez pas accès à cet établissement.");
  }
  return tenant;
}

function ensureWritable(tenant: TenantRecord): void {
  if (tenant.status === 'suspended') {
    throw new HttpError(403, 'tenant_suspended', 'Établissement suspendu : réactivez l’abonnement pour modifier.');
  }
}

function publicEstablishmentView(store: TenantStore, tenant: TenantRecord) {
  const sites = store.sitesForTenant(tenant.id).filter((site) => site.status === 'active');
  const primary = sites.find((site) => site.isPrimary) ?? sites[0];
  return {
    id: tenant.id,
    slug: tenant.slug,
    subdomain: tenant.subdomain,
    brandName: tenant.brandName,
    kind: tenant.settings.kind ?? 'restaurant',
    description: tenant.settings.description ?? '',
    logoUrl: tenant.settings.logoUrl ?? null,
    photos: tenant.settings.photos ?? [],
    primaryColor: tenant.settings.primaryColor,
    secondaryColor: tenant.settings.secondaryColor,
    languages: tenant.settings.languages,
    currency: tenant.settings.currency,
    timezone: tenant.settings.timezone,
    address: tenant.settings.address ?? null,
    geo: tenant.settings.geo ?? null,
    contactPhone: tenant.settings.contactPhone ?? null,
    hours: tenant.settings.hours ?? [],
    siteCount: sites.length,
    primarySite: primary
      ? { id: primary.id, name: primary.name, address: primary.address, phone: primary.phone ?? null }
      : null,
    updatedAt: tenant.updatedAt,
  };
}

function applicationFromToken(store: TenantStore, id: string, token: string): ApplicationRecord {
  const application = store.applications.get(id);
  if (!application) throw HttpError.notFound('Demande introuvable.');
  if (!application.tokenHash || sha256(token) !== application.tokenHash) {
    throw new HttpError(403, 'application_token_invalid', 'Jeton de demande invalide.');
  }
  return application;
}

function tokenFromHeaders(ctx: RequestContext): string {
  const header = ctx.headers['x-application-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) throw new HttpError(403, 'application_token_missing', 'Jeton de demande manquant.');
  return token;
}

function publicApplication(application: ApplicationRecord) {
  return {
    id: application.id,
    reference: application.reference,
    status: application.status,
    plan: application.plan,
    currency: application.currency,
    languages: application.languages,
    establishment: {
      brandName: application.establishment.brandName,
      legalName: application.establishment.legalName,
      city: application.establishment.address?.city,
      type: application.establishment.type,
      logoUrl: application.establishment.logoUrl,
      photos: application.establishment.photos ?? [],
    },
    documents: application.documents.map((doc) => ({
      id: doc.id,
      type: doc.type,
      fileName: doc.fileName,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
    })),
    review: {
      notes: application.review.notes.map((note) => ({ action: note.action, reason: note.reason, note: note.note, at: note.at })),
      decidedAt: application.review.decidedAt,
      reason: application.review.reason,
    },
    tenantId: application.tenantId,
    submittedAt: application.submittedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

function mergeEstablishment(
  existing: Partial<ApplicationRecord['establishment']>,
  input: unknown,
): Partial<ApplicationRecord['establishment']> {
  const source = asObject(input);
  const merged: Partial<ApplicationRecord['establishment']> = { ...existing };
  if (source.legalName !== undefined) merged.legalName = requireString(source, 'legalName', { min: 2, max: 120 });
  if (source.brandName !== undefined) merged.brandName = requireString(source, 'brandName', { min: 2, max: 80 });
  if (source.type !== undefined) merged.type = requireEnum(source, 'type', ['restaurant', 'bar', 'both'] as const);
  if (source.nif !== undefined) merged.nif = requireString(source, 'nif', { pattern: /^[A-Z0-9]{6,20}$/i }).toUpperCase();
  if (source.rccm !== undefined) merged.rccm = optionalString(source, 'rccm', { max: 40 })?.toUpperCase();
  if (source.description !== undefined) merged.description = optionalString(source, 'description', { max: 400 });
  if (source.logoUrl !== undefined) {
    const logoUrl = optionalString(source, 'logoUrl', { max: 500 });
    if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
      throw HttpError.unprocessable('validation_error', 'Le logo doit être une URL HTTPS.');
    }
    merged.logoUrl = logoUrl;
  }
  if (source.photos !== undefined) {
    if (!Array.isArray(source.photos) || source.photos.length > 6) {
      throw HttpError.unprocessable('validation_error', '« photos » doit être une liste de 6 URL maximum.');
    }
    merged.photos = source.photos.map((photo) => {
      const url = String(photo ?? '').trim();
      if (!/^https:\/\//i.test(url) || url.length > 500) {
        throw HttpError.unprocessable('validation_error', 'Chaque photo doit être une URL HTTPS (500 caractères max).');
      }
      return url;
    });
  }
  if (source.address !== undefined) {
    const address = asObject(source.address);
    merged.address = {
      street: optionalString(address, 'street', { max: 120 }) ?? '',
      district: requireString(address, 'district', { min: 2, max: 80 }),
      city: requireString(address, 'city', { min: 2, max: 80 }),
      country: optionalString(address, 'country', { max: 60 }) ?? 'Togo',
    };
  }
  if (source.contact !== undefined) {
    const contact = asObject(source.contact);
    merged.contact = {
      phone: requirePhone(contact),
      email: requireEmail(contact),
      website: optionalString(contact, 'website', { max: 120 }),
    };
  }
  if (source.hours !== undefined) {
    if (!Array.isArray(source.hours) || source.hours.length > 14) {
      throw HttpError.unprocessable('validation_error', '« hours » doit être une liste de créneaux.');
    }
    merged.hours = source.hours.map((entry) => {
      const slot = asObject(entry);
      return {
        day: requireString(slot, 'day', { max: 3 }),
        open: requireString(slot, 'open', { max: 5 }),
        close: requireString(slot, 'close', { max: 5 }),
        closed: optionalBoolean(slot, 'closed'),
      } satisfies HourRange;
    });
  }
  return merged;
}

function mergeManager(existing: Partial<ApplicationRecord['manager']>, input: unknown) {
  const source = asObject(input);
  const merged = { ...existing };
  if (source.name !== undefined) merged.name = requireString(source, 'name', { min: 2, max: 80 });
  if (source.email !== undefined) merged.email = requireEmail(source);
  if (source.phone !== undefined) merged.phone = requirePhone(source);
  if (source.password !== undefined) {
    const password = requireString(source, 'password', { max: 128 });
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      throw HttpError.unprocessable('weak_password', 'Mot de passe : 8 caractères minimum, lettres et chiffres.');
    }
    merged.password = password;
  }
  return merged;
}

function validateForSubmit(application: ApplicationRecord): string[] {
  const missing: string[] = [];
  const est = application.establishment;
  if (!est.legalName) missing.push('raison sociale');
  if (!est.brandName) missing.push('nom commercial');
  if (!est.nif) missing.push('NIF');
  if (!est.rccm) missing.push('RCCM');
  if (!est.type) missing.push('type d’établissement');
  if (!est.address?.city || !est.address.district) missing.push('adresse');
  if (!est.contact?.phone || !est.contact.email) missing.push('coordonnées');
  if (!application.manager.name) missing.push('nom du gérant');
  if (!application.manager.email) missing.push('e-mail du gérant');
  if (!application.manager.phone) missing.push('téléphone du gérant');
  if (!application.manager.password) missing.push('mot de passe du gérant');
  const docTypes = new Set(application.documents.map((doc) => doc.type));
  if (!docTypes.has('nif')) missing.push('pièce NIF');
  if (!docTypes.has('rccm')) missing.push('pièce RCCM');
  if (!application.acceptTerms) missing.push('acceptation des conditions');
  return missing;
}

function randomTempPassword(): string {
  return `Rh-${randomToken(9).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}9`;
}

export function buildTenantApp({ store, config, identity, catalog, publish }: TenantAppOptions): Route[] {
  const identityCall = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('[tenant-service] identity indisponible', error);
      throw new HttpError(502, 'identity_unavailable', 'Service d’identité indisponible. Réessayez.');
    }
  };

  const teamCount = async (tenantId: string): Promise<number | null> => {
    try {
      const members = await identity.get<{ count?: number; items?: unknown[] }>(`/internal/tenants/${tenantId}/members`);
      return members.count ?? members.items?.length ?? 0;
    } catch {
      return null;
    }
  };

  const catalogSummary = async (tenantId: string): Promise<{ products: number; categories: number } | null> => {
    if (!catalog) return null;
    try {
      const summary = await catalog.get<{ products?: number; categories?: number }>(
        `/internal/tenants/${tenantId}/catalog/summary`,
      );
      return { products: summary.products ?? 0, categories: summary.categories ?? 0 };
    } catch {
      return null;
    }
  };

  const createInvoice = (tenantId: string, plan: PlanCode, options: { dueDays?: number } = {}): InvoiceRecord => {
    const now = nowIso();
    const invoice: InvoiceRecord = {
      id: newId('inv'),
      number: store.nextInvoiceNumber(),
      tenantId,
      plan,
      amountXof: planByCode(plan).priceXof,
      status: 'pending',
      issuedAt: now,
      dueAt: new Date(Date.now() + (options.dueDays ?? 7) * DAY_MS).toISOString(),
      periodStart: now,
      periodEnd: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      createdAt: now,
    };
    store.invoices.set(invoice.id, invoice);
    store.recordAudit({
      tenantId,
      actorId: 'tenant-service',
      action: 'subscription.invoice_created',
      targetType: 'invoice',
      targetId: invoice.id,
      meta: { plan, amountXof: invoice.amountXof, number: invoice.number },
    });
    return invoice;
  };

  const markInvoicePaid = async (
    invoice: InvoiceRecord,
    provider: string,
    reference: string | undefined,
    actorId: string,
  ) => {
    if (invoice.status === 'paid') return { alreadyProcessed: true, reactivated: false };
    invoice.status = 'paid';
    invoice.paidAt = nowIso();
    invoice.provider = provider;
    invoice.reference = reference;
    const tenant = store.tenants.get(invoice.tenantId);
    const subscription = store.subscriptions.get(invoice.tenantId);
    if (subscription) {
      subscription.plan = invoice.plan;
      subscription.status = 'active';
      subscription.currentPeriodStart = nowIso();
      subscription.currentPeriodEnd = new Date(Date.now() + 30 * DAY_MS).toISOString();
      subscription.updatedAt = nowIso();
    }
    let reactivated = false;
    if (tenant) {
      tenant.plan = invoice.plan;
      tenant.updatedAt = nowIso();
      if (tenant.status === 'suspended') {
        tenant.status = 'active';
        delete tenant.suspension;
        reactivated = true;
      }
      await publish('SubscriptionInvoicePaid', tenant.id, {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        plan: invoice.plan,
        amountXof: invoice.amountXof,
        provider,
      });
      if (reactivated) {
        await publish('TenantReactivated', tenant.id, { tenantId: tenant.id, reason: 'payment_received' });
      }
    }
    store.recordAudit({
      tenantId: invoice.tenantId,
      actorId,
      action: 'subscription.invoice_paid',
      targetType: 'invoice',
      targetId: invoice.id,
      meta: { provider, reference, plan: invoice.plan, amountXof: invoice.amountXof },
    });
    return { alreadyProcessed: false, reactivated };
  };

  const suspend = async (tenant: TenantRecord, actorId: string, reason: string) => {
    if (tenant.status === 'suspended') return false;
    tenant.status = 'suspended';
    tenant.suspension = { reason, at: nowIso(), actorId };
    tenant.updatedAt = nowIso();
    const subscription = store.subscriptions.get(tenant.id);
    if (subscription) {
      subscription.status = 'suspended';
      subscription.updatedAt = nowIso();
    }
    store.recordAudit({
      tenantId: tenant.id,
      actorId,
      action: 'tenant.suspended',
      targetType: 'tenant',
      targetId: tenant.id,
      meta: { reason },
    });
    await publish('TenantSuspended', tenant.id, { tenantId: tenant.id, reason, actorId });
    return true;
  };

  const reactivate = async (tenant: TenantRecord, actorId: string, note?: string) => {
    const wasSuspended = tenant.status === 'suspended';
    tenant.status = 'active';
    delete tenant.suspension;
    tenant.updatedAt = nowIso();
    const subscription = store.subscriptions.get(tenant.id);
    if (subscription) {
      subscription.status = subscription.trialEndsAt && !subscription.trialUsed ? 'trialing' : 'active';
      subscription.updatedAt = nowIso();
    }
    store.recordAudit({
      tenantId: tenant.id,
      actorId,
      action: 'tenant.reactivated',
      targetType: 'tenant',
      targetId: tenant.id,
      meta: { note },
    });
    if (wasSuspended) {
      await publish('TenantReactivated', tenant.id, { tenantId: tenant.id, actorId });
    }
    return { wasSuspended };
  };

  return [
    {
      method: 'GET',
      path: '/health',
      auth: false,
      handler: () => ({ body: { service: 'tenant-service', status: 'ok', time: nowIso() } }),
    },
    {
      method: 'GET',
      path: '/api/v1/plans',
      auth: false,
      handler: () => ({ body: { plans: PLANS, currency: 'XOF', trialDays: config.trialDays } }),
    },
    {
      method: 'GET',
      path: '/api/v1/public/establishments',
      auth: false,
      handler: (ctx) => {
        const term = (ctx.query.get('q') ?? '').trim().toLowerCase();
        const kind = ctx.query.get('kind');
        const city = (ctx.query.get('city') ?? '').trim().toLowerCase();
        if (kind && !['restaurant', 'bar', 'both'].includes(kind)) {
          throw HttpError.unprocessable(
            'validation_error',
            'Type d’établissement inconnu : utilisez restaurant, bar ou both.',
          );
        }
        const items = [...store.tenants.values()]
          .filter((tenant) => tenant.status === 'active')
          .filter((tenant) => {
            if (!kind) return true;
            const tenantKind = tenant.settings.kind ?? 'restaurant';
            return tenantKind === kind || (tenantKind === 'both' && kind !== 'both');
          })
          .filter((tenant) => {
            if (!city) return true;
            return (tenant.settings.address?.city ?? '').toLowerCase().includes(city);
          })
          .filter((tenant) => {
            if (!term) return true;
            const haystack = [
              tenant.brandName,
              tenant.settings.description ?? '',
              tenant.settings.address?.district ?? '',
              tenant.settings.address?.city ?? '',
            ]
              .join(' ')
              .toLowerCase();
            return haystack.includes(term);
          })
          .sort((a, b) => a.brandName.localeCompare(b.brandName))
          .map((tenant) => publicEstablishmentView(store, tenant));
        return { body: { items, count: items.length, generatedAt: nowIso() } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/establishments/:tenantId',
      auth: false,
      handler: (ctx) => {
        const key = ctx.params.tenantId;
        const tenant = store.tenants.get(key) ?? store.tenantBySlug(key);
        if (!tenant || tenant.status !== 'active') {
          throw HttpError.notFound('Établissement introuvable.');
        }
        const sites = store
          .sitesForTenant(tenant.id)
          .filter((site) => site.status === 'active')
          .map((site) => ({
            id: site.id,
            name: site.name,
            address: site.address,
            phone: site.phone,
            isPrimary: site.isPrimary,
          }));
        return {
          body: {
            establishment: publicEstablishmentView(store, tenant),
            sites,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/applications',
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const establishmentInput = body.establishment === undefined ? {} : body.establishment;
        const managerInput = body.manager === undefined ? {} : body.manager;
        const establishment = mergeEstablishment({}, establishmentInput);
        const manager = mergeManager({}, managerInput);
        if (!establishment.legalName || !establishment.brandName) {
          throw HttpError.unprocessable('validation_error', 'Raison sociale et nom commercial requis.', {
            field: 'establishment',
          });
        }
        if (!manager.email || !manager.phone || !manager.name) {
          throw HttpError.unprocessable('validation_error', 'Coordonnées du gérant requises.', { field: 'manager' });
        }
        const plan = requireEnum(body, 'plan', PLAN_CODES as unknown as readonly string[]) as PlanCode;
        const languages = body.languages === undefined ? ['fr', 'en'] : requireArray(body, 'languages', 2);
        for (const language of languages) {
          if (language !== 'fr' && language !== 'en') {
            throw HttpError.unprocessable('validation_error', 'Langues supportées : fr, en.');
          }
        }
        const token = randomToken(32);
        const now = nowIso();
        const application: ApplicationRecord = {
          id: newId('app'),
          reference: store.nextReference(),
          status: 'draft',
          establishment,
          manager,
          plan,
          currency: optionalString(body, 'currency', { max: 3 })?.toUpperCase() ?? 'XOF',
          languages: languages as string[],
          documents: [],
          acceptTerms: optionalBoolean(body, 'acceptTerms') ?? false,
          review: { notes: [] },
          tokenHash: sha256(token),
          createdAt: now,
          updatedAt: now,
        };
        store.applications.set(application.id, application);
        return {
          status: 201,
          body: {
            applicationId: application.id,
            reference: application.reference,
            status: application.status,
            applicationToken: token,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/applications/:id',
      auth: false,
      handler: (ctx) => {
        const application = applicationFromToken(store, ctx.params.id, tokenFromHeaders(ctx));
        return { body: { application: publicApplication(application) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/applications/:id',
      auth: false,
      handler: (ctx) => {
        const application = applicationFromToken(store, ctx.params.id, tokenFromHeaders(ctx));
        if (application.status === 'approved' || application.status === 'rejected') {
          throw HttpError.conflict('application_locked', 'Cette demande est clôturée et ne peut plus être modifiée.');
        }
        const body = asObject(ctx.body);
        if (body.establishment !== undefined) {
          application.establishment = mergeEstablishment(application.establishment, body.establishment);
        }
        if (body.manager !== undefined) {
          application.manager = mergeManager(application.manager, body.manager);
        }
        if (body.plan !== undefined) {
          application.plan = requireEnum(body, 'plan', PLAN_CODES as unknown as readonly string[]) as PlanCode;
        }
        if (body.languages !== undefined) {
          const languages = requireArray(body, 'languages', 2);
          for (const language of languages) {
            if (language !== 'fr' && language !== 'en') {
              throw HttpError.unprocessable('validation_error', 'Langues supportées : fr, en.');
            }
          }
          application.languages = languages as string[];
        }
        if (body.currency !== undefined) {
          application.currency = requireEnum(body, 'currency', ['XOF', 'EUR', 'USD'] as const);
        }
        if (body.acceptTerms !== undefined) application.acceptTerms = optionalBoolean(body, 'acceptTerms') ?? false;
        application.updatedAt = nowIso();
        return { body: { application: publicApplication(application) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/applications/:id/documents',
      auth: false,
      handler: (ctx) => {
        const application = applicationFromToken(store, ctx.params.id, tokenFromHeaders(ctx));
        if (application.status === 'approved' || application.status === 'rejected') {
          throw HttpError.conflict('application_locked', 'Cette demande est clôturée.');
        }
        const body = asObject(ctx.body);
        const type = requireEnum(body, 'type', DOC_TYPES as unknown as readonly string[]) as DocumentType;
        const fileName = requireString(body, 'fileName', { max: 120 });
        const mimeType = optionalString(body, 'mimeType', { max: 80 }) ?? 'application/octet-stream';
        const dataBase64 = requireString(body, 'dataBase64', { max: 4_000_000 });
        const sizeBytes = Buffer.from(dataBase64, 'base64').length;
        if (sizeBytes === 0) throw HttpError.unprocessable('validation_error', 'Document vide.');
        if (sizeBytes > 2 * 1024 * 1024) {
          throw HttpError.unprocessable('document_too_large', 'Chaque pièce est limitée à 2 Mo.');
        }
        const doc = {
          id: newId('doc'),
          type,
          fileName,
          mimeType,
          sizeBytes,
          dataBase64,
          uploadedAt: nowIso(),
        };
        application.documents = application.documents.filter((existing) => existing.type !== type || existing.fileName !== fileName);
        application.documents.push(doc);
        application.updatedAt = nowIso();
        return {
          status: 201,
          body: { document: { id: doc.id, type: doc.type, fileName: doc.fileName, sizeBytes: doc.sizeBytes } },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/applications/:id/submit',
      auth: false,
      handler: async (ctx) => {
        const application = applicationFromToken(store, ctx.params.id, tokenFromHeaders(ctx));
        if (application.status === 'approved' || application.status === 'rejected') {
          throw HttpError.conflict('application_locked', 'Cette demande est clôturée.');
        }
        const missing = validateForSubmit(application);
        if (missing.length > 0) {
          throw HttpError.unprocessable('application_incomplete', 'Demande incomplète.', { missing });
        }
        application.status = 'submitted';
        application.submittedAt = nowIso();
        application.updatedAt = application.submittedAt;
        application.review.notes.push({ actorId: 'applicant', action: 'submitted', at: application.submittedAt });
        await publish('TenantApplicationSubmitted', null, {
          applicationId: application.id,
          reference: application.reference,
          brandName: application.establishment.brandName,
          plan: application.plan,
          city: application.establishment.address?.city,
        });
        return { body: { application: publicApplication(application) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/admin/applications',
      handler: (ctx) => {
        const claims = ensurePlatform(ctx.auth, 'platform:establishments:review');
        const statusFilter = ctx.query.get('status');
        const query = (ctx.query.get('q') ?? '').toLowerCase();
        const all = [...store.applications.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const counts = all.reduce<Record<string, number>>((acc, application) => {
          acc[application.status] = (acc[application.status] ?? 0) + 1;
          return acc;
        }, {});
        const items = all
          .filter((application) => (statusFilter ? application.status === statusFilter : true))
          .filter((application) => {
            if (!query) return true;
            const haystack = `${application.reference} ${application.establishment.brandName ?? ''} ${
              application.establishment.legalName ?? ''
            } ${application.manager.email ?? ''}`.toLowerCase();
            return haystack.includes(query);
          })
          .map((application) => ({
            ...publicApplication(application),
            managerEmail: application.manager.email,
            managerName: application.manager.name,
            legalName: application.establishment.legalName,
            nif: application.establishment.nif,
            rccm: application.establishment.rccm,
            city: application.establishment.address?.city,
            documentCount: application.documents.length,
          }));
        return { body: { items, counts, reviewer: claims.sub } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/admin/applications/:id',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, 'platform:establishments:review');
        const application = store.applications.get(ctx.params.id);
        if (!application) throw HttpError.notFound('Demande introuvable.');
        return {
          body: {
            application: {
              ...publicApplication(application),
              establishmentFull: application.establishment,
              managerFull: {
                name: application.manager.name,
                email: application.manager.email,
                phone: application.manager.phone,
              },
            },
            token: undefined,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/admin/applications/:id/documents/:docId',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, 'platform:establishments:review');
        const application = store.applications.get(ctx.params.id);
        if (!application) throw HttpError.notFound('Demande introuvable.');
        const doc = application.documents.find((entry) => entry.id === ctx.params.docId);
        if (!doc) throw HttpError.notFound('Document introuvable.');
        return {
          raw: {
            data: Buffer.from(doc.dataBase64, 'base64'),
            contentType: doc.mimeType,
            fileName: doc.fileName,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/admin/applications/:id/review',
      handler: async (ctx) => {
        const claims = ensurePlatform(ctx.auth, 'platform:establishments:review');
        const application = store.applications.get(ctx.params.id);
        if (!application) throw HttpError.notFound('Demande introuvable.');
        if (application.status === 'approved') {
          throw HttpError.conflict('already_approved', 'Cette demande est déjà validée.');
        }
        if (application.status === 'draft') {
          throw HttpError.conflict('not_submitted', 'La demande n’a pas encore été soumise.');
        }
        if (application.status === 'rejected') {
          throw HttpError.conflict('application_closed', 'Cette demande a été refusée définitivement.');
        }
        const body = asObject(ctx.body);
        const action = requireEnum(body, 'action', ['approve', 'reject', 'request_documents'] as const);
        const reason = optionalString(body, 'reason', { max: 400 });
        const note = optionalString(body, 'note', { max: 400 });
        const now = nowIso();

        if (action === 'reject') {
          if (!reason) throw HttpError.unprocessable('validation_error', 'Un motif de refus est requis.');
          application.status = 'rejected';
          application.review = {
            ...application.review,
            decidedBy: claims.sub,
            decidedAt: now,
            reason,
            notes: [...application.review.notes, { actorId: claims.sub, action: 'reject', reason, note, at: now }],
          };
          application.updatedAt = now;
          await publish('TenantApplicationRejected', null, {
            applicationId: application.id,
            reference: application.reference,
            reason,
          });
          return { body: { application: publicApplication(application) } };
        }

        if (action === 'request_documents') {
          if (!note) throw HttpError.unprocessable('validation_error', 'Précisez les pièces ou informations attendues.');
          application.status = 'info_requested';
          application.review.notes.push({ actorId: claims.sub, action: 'request_documents', note, at: now });
          application.updatedAt = now;
          await publish('TenantApplicationInfoRequested', null, {
            applicationId: application.id,
            reference: application.reference,
            note,
          });
          return { body: { application: publicApplication(application) } };
        }

        const missing = validateForSubmit(application).filter((item) => item !== 'mot de passe du gérant');
        if (missing.length > 0) {
          throw HttpError.unprocessable('application_incomplete', 'Dossier incomplet pour une validation.', { missing });
        }

        const managerEmail = application.manager.email as string;
        const temporaryPassword = application.manager.password ? undefined : randomTempPassword();
        const credentialsPassed = application.manager.password ?? temporaryPassword;

        const slug = uniqueSlug(store, application.establishment.brandName as string);
        const tenantId = newId('tnt');
        const provisioned = await identityCall(() =>
          identity.post<{ userId: string; created: boolean }>('/internal/provision-user', {
            tenantId,
            roleCode: 'owner',
            name: application.manager.name,
            email: managerEmail,
            phone: application.manager.phone,
            password: credentialsPassed,
            applicationId: application.id,
          }),
        );

        const settings = {
          logoUrl: application.establishment.logoUrl,
          photos: application.establishment.photos,
          primaryColor: DEFAULT_COLORS.primary,
          secondaryColor: DEFAULT_COLORS.secondary,
          languages: application.languages.includes('en') ? (['fr', 'en'] as Array<'fr' | 'en'>) : (['fr'] as Array<'fr' | 'en'>),
          currency: application.currency,
          timezone: 'Africa/Lome',
          address: application.establishment.address,
          contactPhone: application.establishment.contact?.phone,
          contactEmail: application.establishment.contact?.email,
          hours: application.establishment.hours,
          description: application.establishment.description,
        };
        const tenant: TenantRecord = {
          id: tenantId,
          slug,
          subdomain: `${slug}.resto-hub.tg`,
          legalName: application.establishment.legalName as string,
          brandName: application.establishment.brandName as string,
          nif: application.establishment.nif as string,
          rccm: application.establishment.rccm ?? '',
          managerEmail,
          ownerUserId: provisioned.userId,
          plan: application.plan,
          status: 'active',
          settings,
          applicationId: application.id,
          createdAt: now,
          updatedAt: now,
        };
        store.tenants.set(tenant.id, tenant);

        const trialUsed = [...store.tenants.values()].some(
          (existing) => existing.id !== tenant.id && existing.managerEmail.toLowerCase() === managerEmail.toLowerCase(),
        );
        const primarySite: SiteRecord = {
          id: newId('ste'),
          tenantId: tenant.id,
          name: `${tenant.brandName} — ${application.establishment.address?.city ?? 'Site principal'}`,
          address: [
            application.establishment.address?.street,
            application.establishment.address?.district,
            application.establishment.address?.city,
          ]
            .filter(Boolean)
            .join(', '),
          phone: application.establishment.contact?.phone,
          isPrimary: true,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        store.sites.set(primarySite.id, primarySite);

        store.subscriptions.set(tenant.id, {
          tenantId: tenant.id,
          plan: application.plan,
          status: trialUsed ? 'active' : 'trialing',
          trialStartedAt: trialUsed ? undefined : now,
          trialEndsAt: trialUsed ? undefined : new Date(Date.now() + config.trialDays * DAY_MS).toISOString(),
          currentPeriodStart: now,
          currentPeriodEnd: new Date(Date.now() + (trialUsed ? 30 : config.trialDays) * DAY_MS).toISOString(),
          trialUsed,
          updatedAt: now,
        });
        const invoice = trialUsed ? createInvoice(tenant.id, application.plan) : undefined;

        application.status = 'approved';
        application.tenantId = tenant.id;
        application.review = {
          ...application.review,
          decidedBy: claims.sub,
          decidedAt: now,
          notes: [...application.review.notes, { actorId: claims.sub, action: 'approve', note, at: now }],
        };
        application.updatedAt = now;

        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'tenant.provisioned',
          targetType: 'tenant',
          targetId: tenant.id,
          meta: { slug, plan: application.plan, trialUsed, applicationId: application.id },
        });
        await publish('TenantApproved', tenant.id, {
          tenantId: tenant.id,
          slug,
          subdomain: tenant.subdomain,
          plan: application.plan,
          ownerUserId: provisioned.userId,
          trial: !trialUsed,
        });

        return {
          body: {
            application: publicApplication(application),
            tenant,
            subscription: store.subscriptions.get(tenant.id),
            invoice,
            credentials: {
              email: managerEmail,
              temporaryPassword,
              mustChangePassword: Boolean(temporaryPassword),
            },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/admin/tenants',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, 'platform:establishments:review');
        const items = [...store.tenants.values()]
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map((tenant) => ({
            id: tenant.id,
            brandName: tenant.brandName,
            legalName: tenant.legalName,
            slug: tenant.slug,
            subdomain: tenant.subdomain,
            status: tenant.status,
            plan: tenant.plan,
            managerEmail: tenant.managerEmail,
            trialUsed: store.subscriptions.get(tenant.id)?.trialUsed ?? false,
            subscriptionStatus: store.subscriptions.get(tenant.id)?.status,
            sites: store.sitesForTenant(tenant.id).length,
            createdAt: tenant.createdAt,
            suspension: tenant.suspension,
          }));
        return { body: { items } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/admin/tenants/:id/suspend',
      handler: async (ctx) => {
        const claims = ensurePlatform(ctx.auth, 'platform:establishments:review');
        const tenant = store.tenants.get(ctx.params.id);
        if (!tenant) throw HttpError.notFound('Établissement introuvable.');
        const body = asObject(ctx.body);
        const reason = requireString(body, 'reason', { min: 3, max: 200 });
        const changed = await suspend(tenant, claims.sub, reason);
        return { body: { tenant: { id: tenant.id, status: tenant.status, suspension: tenant.suspension }, changed } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/admin/tenants/:id/reactivate',
      handler: async (ctx) => {
        const claims = ensurePlatform(ctx.auth, 'platform:establishments:review');
        const tenant = store.tenants.get(ctx.params.id);
        if (!tenant) throw HttpError.notFound('Établissement introuvable.');
        const body = asObject(ctx.body);
        const note = optionalString(body, 'note', { max: 200 });
        const result = await reactivate(tenant, claims.sub, note);
        return { body: { tenant: { id: tenant.id, status: tenant.status }, ...result } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/admin/overview',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, 'platform:establishments:review');
        const tenants = [...store.tenants.values()];
        const applications = [...store.applications.values()];
        const invoices = [...store.invoices.values()];
        const activeTenants = tenants.filter((tenant) => tenant.status === 'active');
        const mrr = activeTenants.reduce((sum, tenant) => {
          const subscription = store.subscriptions.get(tenant.id);
          return subscription && ['active', 'trialing'].includes(subscription.status)
            ? sum + planByCode(tenant.plan).priceXof
            : sum;
        }, 0);
        return {
          body: {
            applications: {
              total: applications.length,
              pending: applications.filter((a) => a.status === 'submitted').length,
              infoRequested: applications.filter((a) => a.status === 'info_requested').length,
              approved: applications.filter((a) => a.status === 'approved').length,
              rejected: applications.filter((a) => a.status === 'rejected').length,
            },
            tenants: {
              total: tenants.length,
              active: activeTenants.length,
              suspended: tenants.length - activeTenants.length,
            },
            billing: {
              mrrXof: mrr,
              paidInvoices: invoices.filter((invoice) => invoice.status === 'paid').length,
              pendingInvoices: invoices.filter((invoice) => invoice.status === 'pending').length,
              overdueInvoices: invoices.filter((invoice) => invoice.status === 'overdue').length,
              collectedXof: invoices
                .filter((invoice) => invoice.status === 'paid')
                .reduce((sum, invoice) => sum + invoice.amountXof, 0),
            },
            audit: { entries: store.audit.length, integrity: verifyAuditChain(store.audit) },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/mine',
      handler: (ctx) => {
        const claims = ctx.auth;
        if (!claims) throw HttpError.unauthorized();
        const known = new Set([...Object.keys(claims.tenantPermissions), ...Object.keys(claims.tenantPermissions)]);
        const items = [...store.tenants.values()]
          .filter((tenant) => known.has(tenant.id) || tenant.ownerUserId === claims.sub)
          .map((tenant) => {
            const subscription = store.subscriptions.get(tenant.id);
            return {
              id: tenant.id,
              brandName: tenant.brandName,
              legalName: tenant.legalName,
              slug: tenant.slug,
              subdomain: tenant.subdomain,
              status: tenant.status,
              plan: tenant.plan,
              role: claims.tenantPermissions[tenant.id]?.includes('team:manage') ? 'owner' : 'member',
              permissions: claims.tenantPermissions[tenant.id] ?? [],
              subscriptionStatus: subscription?.status,
              primaryColor: tenant.settings.primaryColor,
              logoUrl: tenant.settings.logoUrl,
              sites: store.sitesForTenant(tenant.id).length,
              createdAt: tenant.createdAt,
            };
          });
        return { body: { items } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:view');
        const plan = planByCode(tenant.plan);
        const invoices = store.invoicesForTenant(tenant.id).slice(0, 5);
        return {
          body: {
            tenant: {
              ...tenant,
              suspension: tenant.suspension,
            },
            plan,
            sites: store.sitesForTenant(tenant.id),
            subscription: store.subscriptions.get(tenant.id),
            invoices,
          },
        };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/branding',
      handler: async (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'settings:update');
        ensureWritable(tenant);
        const claims = ctx.auth as AuthClaims;
        const body = asObject(ctx.body);
        const before = { ...tenant.settings };
        if (body.logoUrl !== undefined) {
          const logoUrl = optionalString(body, 'logoUrl', { max: 2048 });
          if (logoUrl) tenant.settings.logoUrl = logoUrl;
          else delete tenant.settings.logoUrl;
        }
        if (body.primaryColor !== undefined) {
          tenant.settings.primaryColor = requireString(body, 'primaryColor', { pattern: /^#[0-9A-Fa-f]{6}$/ }).toUpperCase();
        }
        if (body.secondaryColor !== undefined) {
          tenant.settings.secondaryColor = requireString(body, 'secondaryColor', { pattern: /^#[0-9A-Fa-f]{6}$/ }).toUpperCase();
        }
        if (body.brandName !== undefined) {
          tenant.brandName = requireString(body, 'brandName', { min: 2, max: 80 });
        }
        if (body.languages !== undefined) {
          const languages = requireArray(body, 'languages', 2);
          for (const language of languages) {
            if (language !== 'fr' && language !== 'en') {
              throw HttpError.unprocessable('validation_error', 'Langues supportées : fr, en.');
            }
          }
          tenant.settings.languages = languages as Array<'fr' | 'en'>;
        }
        if (body.currency !== undefined) {
          tenant.settings.currency = requireEnum(body, 'currency', ['XOF', 'EUR', 'USD'] as const);
        }
        if (body.hours !== undefined) {
          const establishment = mergeEstablishment({ hours: tenant.settings.hours ?? [] }, { hours: body.hours });
          tenant.settings.hours = establishment.hours;
        }
        tenant.updatedAt = nowIso();
        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'tenant.branding_updated',
          targetType: 'tenant',
          targetId: tenant.id,
          meta: { before, after: tenant.settings },
        });
        await publish('TenantBrandingUpdated', tenant.id, {
          tenantId: tenant.id,
          primaryColor: tenant.settings.primaryColor,
          secondaryColor: tenant.settings.secondaryColor,
          languages: tenant.settings.languages,
          currency: tenant.settings.currency,
        });
        return { body: { tenant: { id: tenant.id, brandName: tenant.brandName, settings: tenant.settings } } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/sites',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:view');
        return { body: { items: store.sitesForTenant(tenant.id), plan: planByCode(tenant.plan) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/sites',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:update');
        ensureWritable(tenant);
        const claims = ctx.auth as AuthClaims;
        const plan = planByCode(tenant.plan);
        const existing = store.sitesForTenant(tenant.id);
        if (plan.maxSites !== null && existing.length >= plan.maxSites) {
          throw HttpError.unprocessable('plan_site_limit', `Le plan ${plan.name} est limité à ${plan.maxSites} établissement(s).`, {
            plan: plan.code,
            limit: plan.maxSites,
          });
        }
        const body = asObject(ctx.body);
        const now = nowIso();
        const site: SiteRecord = {
          id: newId('ste'),
          tenantId: tenant.id,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          address: requireString(body, 'address', { min: 3, max: 200 }),
          phone: optionalString(body, 'phone', { max: 20 }),
          isPrimary: existing.length === 0,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        store.sites.set(site.id, site);
        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'site.created',
          targetType: 'site',
          targetId: site.id,
          meta: { name: site.name },
        });
        return { status: 201, body: { site } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/sites/:siteId',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:update');
        ensureWritable(tenant);
        const claims = ctx.auth as AuthClaims;
        const site = store.sites.get(ctx.params.siteId);
        if (!site || site.tenantId !== tenant.id) throw HttpError.notFound('Site introuvable.');
        const body = asObject(ctx.body);
        if (body.name !== undefined) site.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.address !== undefined) site.address = requireString(body, 'address', { min: 3, max: 200 });
        if (body.phone !== undefined) site.phone = optionalString(body, 'phone', { max: 20 });
        if (body.status !== undefined) site.status = requireEnum(body, 'status', ['active', 'closed'] as const);
        site.updatedAt = nowIso();
        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'site.updated',
          targetType: 'site',
          targetId: site.id,
          meta: { name: site.name, status: site.status },
        });
        return { body: { site } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/sites/:siteId',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:update');
        ensureWritable(tenant);
        const claims = ctx.auth as AuthClaims;
        const site = store.sites.get(ctx.params.siteId);
        if (!site || site.tenantId !== tenant.id) throw HttpError.notFound('Site introuvable.');
        if (site.isPrimary) {
          throw HttpError.unprocessable('primary_site', 'Le site principal ne peut pas être supprimé.');
        }
        store.sites.delete(site.id);
        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'site.deleted',
          targetType: 'site',
          targetId: site.id,
          meta: { name: site.name },
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/onboarding',
      handler: async (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'tenant:view');
        const members = await teamCount(tenant.id);
        const catalogue = await catalogSummary(tenant.id);
        const subscription = store.subscriptions.get(tenant.id);
        const brandingCustomized =
          Boolean(tenant.settings.logoUrl) ||
          tenant.settings.primaryColor !== DEFAULT_COLORS.primary ||
          tenant.settings.secondaryColor !== DEFAULT_COLORS.secondary;
        const items = [
          {
            key: 'validated',
            label: 'Établissement validé',
            description: 'Dossier KYC/KYB approuvé par la plateforme.',
            done: true,
            detail: undefined as string | undefined,
          },
          {
            key: 'space',
            label: 'Espace créé',
            description: 'Identifiant unique et sous-domaine attribués.',
            done: true,
            detail: tenant.subdomain,
          },
          {
            key: 'branding',
            label: 'Personnalisez votre espace',
            description: 'Logo, couleurs et langues de votre établissement.',
            done: brandingCustomized,
            detail: brandingCustomized ? 'Personnalisation enregistrée' : 'À faire',
          },
          {
            key: 'hours',
            label: 'Renseignez vos horaires',
            description: 'Les horaires alimentent la page client et les réservations.',
            done: (tenant.settings.hours?.length ?? 0) > 0,
            detail: tenant.settings.hours ? `${tenant.settings.hours.length} créneau(x)` : 'À faire',
          },
          {
            key: 'team',
            label: 'Invitez votre équipe',
            description: 'Serveurs, cuisiniers, caissiers, barman…',
            done: (members ?? 0) > 1,
            detail: members === null ? 'Indisponible' : `${members} membre(s)`,
          },
          {
            key: 'catalog',
            label: 'Créez votre catalogue',
            description: 'Produits, menus, prix et promotions.',
            done: (catalogue?.products ?? 0) > 0,
            detail: catalogue
              ? `${catalogue.products} produit(s) · ${catalogue.categories} catégorie(s)`
              : 'Catalogue indisponible',
          },
          {
            key: 'payments',
            label: 'Activez les paiements',
            description: 'Mobile money, cartes et encaissement.',
            done: subscription?.status === 'active',
            detail: subscription ? subscription.status : 'À faire',
          },
          {
            key: 'subscription',
            label: 'Abonnement actif',
            description: 'Essai gratuit ou formule payante.',
            done: Boolean(subscription && ['trialing', 'active'].includes(subscription.status)),
            detail: subscription ? subscription.status : 'À faire',
          },
        ];
        const done = items.filter((item) => item.done).length;
        return {
          body: {
            items,
            progress: Math.round((done / items.length) * 100),
            completed: done,
            total: items.length,
            tenant: { id: tenant.id, brandName: tenant.brandName, slug: tenant.slug, subdomain: tenant.subdomain },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/subscription',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'subscription:view');
        const subscription = store.subscriptions.get(tenant.id);
        const invoices = store.invoicesForTenant(tenant.id);
        return {
          body: {
            subscription,
            plan: planByCode(tenant.plan),
            plans: PLANS,
            invoices,
            trialDays: config.trialDays,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/subscription/checkout',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'subscription:manage');
        ensureWritable(tenant);
        const claims = ctx.auth as AuthClaims;
        const body = asObject(ctx.body);
        const plan = requireEnum(body, 'plan', PLAN_CODES as unknown as readonly string[]) as PlanCode;
        const invoice = createInvoice(tenant.id, plan);
        void claims;
        return {
          status: 201,
          body: {
            invoice,
            plan: planByCode(plan),
            message: 'Facture créée. Réglez par mobile money pour activer la formule.',
            demoBilling: config.demoBilling,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/subscription/invoices/:invoiceId/pay-demo',
      handler: async (ctx) => {
        if (!config.demoBilling) {
          throw HttpError.notFound('Paiement de démonstration désactivé.');
        }
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'subscription:manage');
        const claims = ctx.auth as AuthClaims;
        const invoice = store.invoices.get(ctx.params.invoiceId);
        if (!invoice || invoice.tenantId !== tenant.id) throw HttpError.notFound('Facture introuvable.');
        const result = await markInvoicePaid(invoice, 'demo', `DEMO-${invoice.number}`, claims.sub);
        return { body: { invoice, ...result, tenant: { id: tenant.id, status: tenant.status } } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/team',
      handler: async (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'team:view');
        const members = await identityCall(() => identity.get(`/internal/tenants/${tenant.id}/members`));
        return { body: members };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/audit',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'audit:view');
        const limit = Math.min(Number(ctx.query.get('limit') ?? 50), 200);
        const items = store.audit.filter((entry) => entry.tenantId === tenant.id).slice(-limit).reverse();
        return { body: { items, integrity: verifyAuditChain(store.audit) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/export',
      handler: (ctx) => {
        const tenant = ensureTenant(store, ctx.auth, ctx.params.tenantId, 'report:export');
        const claims = ctx.auth as AuthClaims;
        const format = requireEnum({ format: ctx.query.get('format') ?? 'json' }, 'format', ['json', 'csv'] as const);
        const sites = store.sitesForTenant(tenant.id);
        const invoices = store.invoicesForTenant(tenant.id);
        const subscription = store.subscriptions.get(tenant.id);
        store.recordAudit({
          tenantId: tenant.id,
          actorId: claims.sub,
          action: 'tenant.exported',
          targetType: 'tenant',
          targetId: tenant.id,
          meta: { format, tenantId: tenant.id },
        });
        if (format === 'csv') {
          const header = 'numero,date,plan,montant_xof,statut,paye_le\n';
          const rows = invoices
            .map((invoice) =>
              [invoice.number, invoice.issuedAt.slice(0, 10), invoice.plan, invoice.amountXof, invoice.status, invoice.paidAt ?? ''].join(','),
            )
            .join('\n');
          const csv = `# ${tenant.brandName} (${tenant.slug})\n# Sites: ${sites.length} · Abonnement: ${subscription?.status ?? 'aucun'}\n${header}${rows}`;
          return {
            raw: {
              data: Buffer.from(csv, 'utf8'),
              contentType: 'text/csv; charset=utf-8',
              fileName: `${tenant.slug}-export.csv`,
            },
          };
        }
        return {
          body: {
            tenant: {
              id: tenant.id,
              brandName: tenant.brandName,
              slug: tenant.slug,
              status: tenant.status,
              plan: tenant.plan,
              settings: tenant.settings,
            },
            sites,
            subscription,
            invoices,
            exportedAt: nowIso(),
            integrity: verifyAuditChain(store.audit),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/internal/webhooks/billing',
      auth: false,
      handler: async (ctx) => {
        const signatureHeader = String(ctx.headers['x-billing-signature'] ?? '');
        const body = asObject(ctx.body);
        const expected = createHmac('sha256', config.billingWebhookSecret).update(JSON.stringify(body)).digest('hex');
        const actual = Buffer.from(signatureHeader);
        const wanted = Buffer.from(expected);
        if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
          throw HttpError.unauthorized('Signature de webhook invalide.');
        }
        const invoiceId = requireString(body, 'invoiceId');
        const provider = requireString(body, 'provider', { max: 40 });
        const reference = optionalString(body, 'reference', { max: 80 });
        const invoice = store.invoices.get(invoiceId);
        if (!invoice) throw HttpError.notFound('Facture introuvable.');
        const result = await markInvoicePaid(invoice, provider, reference, `webhook:${provider}`);
        return { body: { ok: true, invoice, ...result } };
      },
    },
    {
      method: 'POST',
      path: '/internal/billing/run-dunning',
      service: true,
      handler: async (ctx) => {
        const body = asObject(ctx.body);
        const graceDays = Number(body.graceDays ?? 0);
        const threshold = Date.now() - Math.max(graceDays, 0) * DAY_MS;
        const overdue: InvoiceRecord[] = [];
        for (const invoice of store.invoices.values()) {
          if (invoice.status !== 'pending') continue;
          if (new Date(invoice.dueAt).getTime() > threshold) continue;
          invoice.status = 'overdue';
          overdue.push(invoice);
        }
        const suspendIds = new Set(overdue.map((invoice) => invoice.tenantId));
        let suspended = 0;
        for (const tenantId of suspendIds) {
          const tenant = store.tenants.get(tenantId);
          if (!tenant) continue;
          const subscription = store.subscriptions.get(tenantId);
          if (subscription) subscription.status = 'past_due';
          if (await suspend(tenant, 'billing', 'Impayé : facture échue')) suspended += 1;
        }
        return { body: { overdueInvoices: overdue.length, suspendedTenants: suspended } };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/summary',
      service: true,
      handler: (ctx) => {
        const tenant = store.tenants.get(ctx.params.tenantId);
        if (!tenant) throw HttpError.notFound('Établissement introuvable.');
        return {
          body: {
            id: tenant.id,
            slug: tenant.slug,
            subdomain: tenant.subdomain,
            brandName: tenant.brandName,
            status: tenant.status,
            plan: tenant.plan,
            ownerUserId: tenant.ownerUserId,
            currency: tenant.settings.currency,
            languages: tenant.settings.languages,
          },
        };
      },
    },
  ];
}
