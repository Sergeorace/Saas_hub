import {
  HttpError,
  asObject,
  nowIso,
  optionalString,
  requireArray,
  requireEnum,
  requireString,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import {
  auditStatus,
  commissionGroups,
  dashboardSnapshot,
  PLAN_PRICES_XOF,
  serviceUptime,
  type PlatformAdminStore,
  type PlatformPlan,
  type PlatformSettings,
  type ProviderSetting,
  type TaxSetting,
  type CountrySetting,
} from './store.js';
import { type HealthCheckResult } from './supervision.js';

export interface PlatformAdminAppOptions {
  store: PlatformAdminStore;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown> | void;
  checkServices?: () => Promise<HealthCheckResult[]>;
}

function ensurePlatform(claims: AuthClaims | undefined, permissions: string[]): AuthClaims {
  if (!claims) throw HttpError.unauthorized();
  if (!permissions.some((permission) => claims.platformPermissions.includes(permission))) {
    throw new HttpError(403, 'platform_scope_denied', 'Permission plateforme requise pour cette opération.', {
      required: permissions,
    });
  }
  return claims;
}

function settingsView(store: PlatformAdminStore) {
  return {
    settings: store.settings,
    audit: auditStatus(store),
  };
}

function parseDays(value: string | null, fallback = 30): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(365, Math.round(parsed));
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function validateLanguages(body: Record<string, unknown>): Array<'fr' | 'en'> {
  const raw = requireArray(body, 'languages', 2);
  const languages = raw.map((entry) => {
    if (entry !== 'fr' && entry !== 'en') {
      throw HttpError.unprocessable('validation_error', 'Langues supportées : fr, en uniquement.');
    }
    return entry as 'fr' | 'en';
  });
  return [...new Set(languages)];
}

function validateCountries(value: unknown): CountrySetting[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw HttpError.unprocessable('validation_error', 'Au moins un pays est requis.');
  }
  return value.map((entry, index) => {
    let row: Record<string, unknown>;
    try {
      row = asObject(entry);
    } catch {
      throw HttpError.unprocessable('validation_error', `Pays invalide à l’index ${index}.`);
    }
    const code = requireString(row, 'code', { min: 2, max: 3 }).toUpperCase();
    return {
      code,
      name: requireString(row, 'name', { min: 2, max: 80 }),
      currency: requireString(row, 'currency', { min: 3, max: 3 }).toUpperCase(),
      dialCode: requireString(row, 'dialCode', { min: 2, max: 8 }),
      active: typeof row.active === 'boolean' ? row.active : true,
      defaultTaxCode: requireString(row, 'defaultTaxCode', { min: 2, max: 40 }),
    };
  });
}

function validateTaxes(value: unknown): TaxSetting[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw HttpError.unprocessable('validation_error', 'Au moins une taxe est requise.');
  }
  return value.map((entry, index) => {
    let row: Record<string, unknown>;
    try {
      row = asObject(entry);
    } catch {
      throw HttpError.unprocessable('validation_error', `Taxe invalide à l’index ${index}.`);
    }
    const ratePct = Number(row.ratePct);
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
      throw HttpError.unprocessable('validation_error', `Taux invalide pour taxes[${index}].`);
    }
    const scope = row.scope;
    if (scope !== 'sales' && scope !== 'payroll' && scope !== 'service') {
      throw HttpError.unprocessable('validation_error', `Périmètre de taxe invalide (${String(scope)}).`);
    }
    return {
      code: requireString(row, 'code', { min: 2, max: 40 }),
      name: requireString(row, 'name', { min: 2, max: 80 }),
      ratePct: Math.round(ratePct * 100) / 100,
      scope,
      active: typeof row.active === 'boolean' ? row.active : true,
    };
  });
}

function validateProviders(value: unknown): ProviderSetting[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw HttpError.unprocessable('validation_error', 'Au moins un fournisseur de paiement est requis.');
  }
  const providers = value.map((entry, index) => {
    let row: Record<string, unknown>;
    try {
      row = asObject(entry);
    } catch {
      throw HttpError.unprocessable('validation_error', `Fournisseur invalide à l’index ${index}.`);
    }
    const priority = Number(row.priority);
    return {
      code: requireString(row, 'code', { min: 2, max: 40 }),
      name: requireString(row, 'name', { min: 2, max: 80 }),
      enabled: Boolean(row.enabled),
      currencies: Array.isArray(row.currencies)
        ? row.currencies.filter((item): item is string => typeof item === 'string')
        : ['XOF'],
      channels: Array.isArray(row.channels)
        ? row.channels.filter((item): item is string => typeof item === 'string')
        : ['mobile_money'],
      priority: Number.isFinite(priority) ? Math.round(priority) : index + 1,
    };
  });
  if (!providers.some((provider) => provider.enabled)) {
    throw HttpError.unprocessable('validation_error', 'Au moins un fournisseur doit rester actif.');
  }
  return providers;
}

function clientSettings(settings: PlatformSettings) {
  return {
    languages: settings.languages,
    defaultLanguage: settings.defaultLanguage,
    currency: settings.currency,
    timezone: settings.timezone,
    supportEmail: settings.supportEmail,
    supportPhone: settings.supportPhone,
    countries: settings.countries,
    taxes: settings.taxes,
    providers: settings.providers,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

function levelFilter(ctx: RequestContext): string | undefined {
  const level = ctx.query.get('level');
  if (!level) return undefined;
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw HttpError.badRequest('invalid_level', 'Niveau de journal invalide.');
  }
  return level;
}

export function buildPlatformAdminApp(options: PlatformAdminAppOptions): Route[] {
  const { store, publish } = options;

  return [
    {
      method: 'GET',
      path: '/api/v1/platform/dashboard',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:logs:view', 'platform:establishments:review', 'platform:settings:manage', 'platform:operate']);
        return {
          body: {
            ...dashboardSnapshot(store),
            subscriptionPlans: (Object.keys(PLAN_PRICES_XOF) as PlatformPlan[]).map((plan) => ({
              plan,
              priceXof: PLAN_PRICES_XOF[plan],
            })),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/establishments',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:establishments:review', 'platform:operate']);
        const status = ctx.query.get('status');
        const plan = ctx.query.get('plan');
        const search = (ctx.query.get('q') ?? '').toLowerCase();
        const since30 = isoDaysAgo(30);
        const items = [...store.directory.values()]
          .filter((tenant) => (status ? tenant.status === status : true))
          .filter((tenant) => (plan ? tenant.plan === plan : true))
          .filter((tenant) => {
            if (!search) return true;
            return `${tenant.brandName} ${tenant.slug} ${tenant.tenantId}`.toLowerCase().includes(search);
          })
          .map((tenant) => {
            const commissions = store.commissions.filter(
              (entry) => entry.tenantId === tenant.tenantId && entry.at >= since30,
            );
            return {
              ...tenant,
              volume30dXof: commissions.reduce((sum, entry) => sum + entry.amountXof, 0),
              commission30dXof: commissions.reduce((sum, entry) => sum + entry.commissionXof, 0),
              transactions30d: commissions.length,
              openDisputes: [...store.disputes.values()].filter(
                (dispute) => dispute.tenantId === tenant.tenantId && dispute.status === 'open',
              ).length,
            };
          })
          .sort((a, b) => b.volume30dXof - a.volume30dXof);
        return { body: { items } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/establishments/:tenantId',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:establishments:review', 'platform:operate']);
        const entry = store.directory.get(ctx.params.tenantId);
        if (!entry) throw HttpError.notFound('Établissement introuvable dans l’annuaire plateforme.');
        const transactions = store.transactions
          .filter((transaction) => transaction.tenantId === entry.tenantId)
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, 20);
        const disputes = [...store.disputes.values()]
          .filter((dispute) => dispute.tenantId === entry.tenantId)
          .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
        return { body: { establishment: entry, transactions, disputes } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/commissions',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:disputes:manage', 'platform:operate', 'platform:settings:manage']);
        const days = parseDays(ctx.query.get('days'));
        const fromIso = isoDaysAgo(days);
        const toIso = nowIso();
        const entries = store.commissions
          .filter((entry) => entry.at >= fromIso && entry.at <= toIso)
          .sort((a, b) => (a.at < b.at ? 1 : -1));
        const volumeXof = entries.reduce((sum, entry) => sum + entry.amountXof, 0);
        const commissionXof = entries.reduce((sum, entry) => sum + entry.commissionXof, 0);
        const netXof = entries.reduce((sum, entry) => sum + entry.netXof, 0);
        return {
          body: {
            window: { days, from: fromIso, to: toIso },
            summary: {
              transactions: entries.length,
              volumeXof,
              commissionXof,
              netXof,
              averageBasketXof: entries.length ? Math.round(volumeXof / entries.length) : 0,
              averageRatePct: volumeXof ? Math.round((commissionXof / volumeXof) * 10000) / 100 : 0,
            },
            groups: {
              tenant: commissionGroups(store, fromIso, toIso, 'tenant'),
              provider: commissionGroups(store, fromIso, toIso, 'provider'),
              method: commissionGroups(store, fromIso, toIso, 'method'),
              day: commissionGroups(store, fromIso, toIso, 'day').sort((a, b) => (a.key < b.key ? -1 : 1)),
            },
            transactions: entries.slice(0, 40),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/transactions',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const kind = ctx.query.get('kind');
        const tenantId = ctx.query.get('tenantId');
        const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
        const items = store.transactions
          .filter((transaction) => (kind ? transaction.kind === kind : true))
          .filter((transaction) => (tenantId ? transaction.tenantId === tenantId : true))
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, limit);
        return { body: { items } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/disputes',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const status = ctx.query.get('status');
        const items = [...store.disputes.values()]
          .filter((dispute) => (status ? dispute.status === status : true))
          .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
        return { body: { items } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/supervision',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:logs:view', 'platform:operate']);
        const services = [...store.services.values()]
          .map((service) => ({
            name: service.name,
            url: service.url,
            status: service.status,
            latencyMs: service.latencyMs,
            lastCheckAt: service.lastCheckAt,
            consecutiveFailures: service.consecutiveFailures,
            checks: service.checks,
            failures: service.failures,
            uptimePct: serviceUptime(service),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const alerts = [...store.alerts.values()].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          return a.createdAt < b.createdAt ? 1 : -1;
        });
        const logs = [...store.logs].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
        return {
          body: {
            services,
            alerts,
            logs,
            metrics: {
              eventsReceived: store.metrics.eventsReceived,
              eventsByType: store.metrics.eventsByType,
              events24h: store.metrics.recentEvents.filter(
                (event) => event.at >= isoDaysAgo(1),
              ).length,
              recentEvents: store.metrics.recentEvents.slice(-12).reverse(),
              checkedAt: nowIso(),
            },
            audit: auditStatus(store),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/platform/supervision/check',
      handler: async (ctx) => {
        const claims = ensurePlatform(ctx.auth, ['platform:operate']);
        const results = options.checkServices ? await options.checkServices() : [];
        store.recordAudit({
          tenantId: null,
          actorId: claims.sub,
          action: 'supervision.checked',
          targetType: 'platform',
          targetId: 'services',
          meta: { services: results.length },
        });
        return {
          body: {
            results,
            services: [...store.services.values()].map((service) => ({
              name: service.name,
              status: service.status,
              latencyMs: service.latencyMs,
              lastCheckAt: service.lastCheckAt,
              uptimePct: serviceUptime(service),
            })),
          },
        };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/platform/supervision/alerts/:id',
      handler: (ctx) => {
        const claims = ensurePlatform(ctx.auth, ['platform:operate']);
        const alert = store.alerts.get(ctx.params.id);
        if (!alert) throw HttpError.notFound('Alerte introuvable.');
        const body = asObject(ctx.body);
        const action = requireEnum(body, 'action', ['acknowledge', 'resolve'] as const);
        if (alert.status === 'resolved') {
          throw HttpError.conflict('alert_resolved', 'Cette alerte est déjà résolue.');
        }
        const now = nowIso();
        if (action === 'acknowledge') {
          alert.status = 'acknowledged';
          alert.acknowledgedBy = claims.sub;
          alert.acknowledgedAt = now;
        } else {
          alert.status = 'resolved';
          alert.resolvedBy = claims.sub;
          alert.resolvedAt = now;
          if (!alert.acknowledgedAt) {
            alert.acknowledgedBy = claims.sub;
            alert.acknowledgedAt = now;
          }
        }
        store.recordAudit({
          tenantId: null,
          actorId: claims.sub,
          action: `alert.${action}`,
          targetType: 'alert',
          targetId: alert.id,
          meta: { service: alert.service, code: alert.code },
        });
        return { body: { alert } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/supervision/logs',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:logs:view', 'platform:operate']);
        const level = levelFilter(ctx);
        const service = ctx.query.get('service');
        const limit = Math.min(300, Math.max(1, Number(ctx.query.get('limit') ?? 100) || 100));
        const items = [...store.logs]
          .filter((entry) => (level ? entry.level === level : true))
          .filter((entry) => (service ? entry.service === service : true))
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, limit);
        return { body: { items } };
      },
    },
    {
      method: 'POST',
      path: '/internal/logs',
      service: true,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const level = requireEnum(body, 'level', ['debug', 'info', 'warn', 'error'] as const);
        const service = requireString(body, 'service', { min: 2, max: 80 });
        const message = requireString(body, 'message', { min: 1, max: 500 });
        const meta = body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null;
        const entry = store.log(level, service, message, meta);
        return { status: 201, body: { log: entry } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/settings',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:settings:manage', 'platform:operate']);
        return { body: settingsView(store) };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/platform/settings',
      handler: async (ctx) => {
        const claims = ensurePlatform(ctx.auth, ['platform:settings:manage']);
        const body = asObject(ctx.body);
        const languages = validateLanguages(body);
        const defaultLanguage = requireEnum(body, 'defaultLanguage', ['fr', 'en'] as const);
        if (!languages.includes(defaultLanguage)) {
          throw HttpError.unprocessable('validation_error', 'La langue par défaut doit être activée.');
        }
        const supportEmail = requireString(body, 'supportEmail', { min: 5, max: 120 });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
          throw HttpError.unprocessable('validation_error', 'Adresse e-mail de support invalide.');
        }
        const supportPhone = requireString(body, 'supportPhone', { min: 6, max: 30 });
        const timezone = optionalString(body, 'timezone', { max: 60 }) ?? store.settings.timezone;
        const countries = validateCountries(body.countries);
        const taxes = validateTaxes(body.taxes);
        const providers = validateProviders(body.providers);
        const taxCodes = new Set(taxes.map((tax) => tax.code));
        for (const country of countries) {
          if (!taxCodes.has(country.defaultTaxCode)) {
            throw HttpError.unprocessable('validation_error', `Taxe par défaut inconnue pour ${country.code}.`);
          }
        }

        const previous = store.settings;
        const settings: PlatformSettings = {
          languages,
          defaultLanguage,
          currency: 'XOF',
          timezone,
          supportEmail,
          supportPhone,
          countries,
          taxes,
          providers,
          updatedAt: nowIso(),
          updatedBy: claims.sub,
        };
        store.settings = settings;
        const changed = {
          languages: JSON.stringify(previous.languages) !== JSON.stringify(settings.languages),
          countries: JSON.stringify(previous.countries) !== JSON.stringify(settings.countries),
          taxes: JSON.stringify(previous.taxes) !== JSON.stringify(settings.taxes),
          providers: JSON.stringify(previous.providers) !== JSON.stringify(settings.providers),
          support: previous.supportEmail !== settings.supportEmail || previous.supportPhone !== settings.supportPhone,
          timezone: previous.timezone !== settings.timezone,
          defaultLanguage: previous.defaultLanguage !== settings.defaultLanguage,
        };
        const audit = store.recordAudit({
          tenantId: null,
          actorId: claims.sub,
          action: 'platform.settings.updated',
          targetType: 'platform',
          targetId: 'settings',
          meta: { changed },
        });
        await publish('PlatformSettingsUpdated', null, {
          updatedBy: claims.sub,
          languages: settings.languages,
          defaultLanguage: settings.defaultLanguage,
          providers: settings.providers,
          taxes: settings.taxes,
          at: settings.updatedAt,
        });
        return { body: { settings: clientSettings(settings), audit, changed } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/audit',
      handler: (ctx) => {
        ensurePlatform(ctx.auth, ['platform:logs:view', 'platform:operate', 'platform:settings:manage']);
        const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit') ?? 100) || 100));
        const entries = [...store.audit].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
        return {
          body: {
            entries,
            chain: { valid: verifyAuditChain(store.audit), length: store.audit.length },
          },
        };
      },
    },
  ];
}
