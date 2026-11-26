import { randomBytes } from 'node:crypto';
import {
  HttpError,
  asObject,
  base32Encode,
  generateTotp,
  hashPassword,
  newId,
  nowIso,
  optionalBoolean,
  optionalEmail,
  optionalPhone,
  optionalString,
  randomDigits,
  randomToken,
  requireArray,
  requireEmail,
  requireEnum,
  requirePhone,
  requireString,
  sha256,
  signToken,
  slugify,
  verifyAuditChain,
  verifyPassword,
  verifyToken,
  type AuthClaims,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import type { IdentityConfig } from './config.js';
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_TEMPLATE,
  PERMISSIONS,
  TENANT_JOB_TITLES,
  isValidPermission,
  type Permission,
} from './permissions.js';
import type { IdentityStore, RoleRecord, SessionRecord, UserRecord } from './store.js';

export interface IdentityAppOptions {
  store: IdentityStore;
  config: IdentityConfig;
}

export interface IdentityApp {
  routes: Route[];
  authenticate: (token: string) => Promise<AuthClaims | undefined>;
}

const TABLE = {
  emailRegister: '/api/v1/auth/email/register',
  emailLogin: '/api/v1/auth/email/login',
  phoneStart: '/api/v1/auth/phone/start',
  phoneVerify: '/api/v1/auth/phone/verify',
  social: '/api/v1/auth/social/:provider',
  refresh: '/api/v1/auth/refresh',
  logout: '/api/v1/auth/logout',
  me: '/api/v1/auth/me',
  mfaEnroll: '/api/v1/auth/mfa/enroll',
  mfaConfirm: '/api/v1/auth/mfa/confirm',
  mfaVerify: '/api/v1/auth/mfa/verify',
  mfaDisable: '/api/v1/auth/mfa/disable',
  sessions: '/api/v1/sessions',
  session: '/api/v1/sessions/:id',
  roles: '/api/v1/roles',
  role: '/api/v1/roles/:id',
  permissions: '/api/v1/permissions',
  team: '/api/v1/tenants/:tenantId/team',
  teamMember: '/api/v1/tenants/:tenantId/team/:userId',
  teamMemberRoles: '/api/v1/tenants/:tenantId/team/:userId/roles',
  audit: '/api/v1/audit',
  auditIntegrity: '/api/v1/audit/integrity',
  health: '/health',
  authConfig: '/api/v1/auth/config',
  introspect: '/internal/introspect',
  provisionUser: '/internal/provision-user',
  provisionPlatformUser: '/internal/provision-platform-user',
  revokeSessions: '/internal/revoke-sessions',
  tenantMembers: '/internal/tenants/:tenantId/members',
} as const;

function requireAuth(ctx: RequestContext): AuthClaims {
  if (!ctx.auth) throw HttpError.unauthorized();
  return ctx.auth;
}

function hasPlatformOperate(claims: AuthClaims): boolean {
  return claims.platformPermissions.includes('platform:operate');
}

function ensureTenantPermission(claims: AuthClaims, tenantId: string, permission: string): void {
  if (hasPlatformOperate(claims)) return;
  if (!tenantId || !claims.tenantPermissions[tenantId]?.includes(permission)) {
    throw new HttpError(403, 'tenant_scope_denied', "Vous n'avez pas accès à cet établissement.");
  }
}

function ensurePlatformPermission(claims: AuthClaims, permission: string): void {
  if (!claims.platformPermissions.includes(permission)) {
    throw new HttpError(403, 'platform_permission_denied', 'Permission plateforme requise.');
  }
}

function passwordProblem(password: string): void {
  if (password.length < 8) {
    throw HttpError.unprocessable(
      'weak_password',
      'Le mot de passe doit contenir au moins 8 caractères.',
    );
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw HttpError.unprocessable(
      'weak_password',
      'Le mot de passe doit mélanger lettres et chiffres.',
    );
  }
}

function bearer(ctx: RequestContext): string | undefined {
  const header = String(ctx.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

export function buildIdentityApp({ store, config }: IdentityAppOptions): IdentityApp {
  const secret = config.tokenSecret;

  const authenticate = async (token: string): Promise<AuthClaims | undefined> => {
    const tokenClaims = verifyToken(token, secret, 'access');
    if (!tokenClaims) return undefined;
    const session = store.sessions.get(tokenClaims.sid);
    if (!session || session.revokedAt || session.userId !== tokenClaims.sub) return undefined;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return undefined;
    const user = store.users.get(session.userId);
    if (!user || user.status !== 'active') return undefined;
    return claimsFor(user, session);
  };

  function claimsFor(user: UserRecord, session: SessionRecord): AuthClaims {
    return {
      sub: user.id,
      sid: session.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      mfa: session.mfa,
      platformRoles: user.platformRoles,
      platformPermissions: user.platformPermissions,
      tenantPermissions: store.tenantPermissionsFor(user.id),
    };
  }

  function issueTokens(user: UserRecord, mfa: boolean, ctx: RequestContext) {
    const refreshToken = randomToken(32);
    const session = store.createSession({
      userId: user.id,
      refreshHash: sha256(refreshToken),
      ip: ctx.ip,
      userAgent: String(ctx.headers['user-agent'] ?? 'inconnu'),
      mfa,
      ttlDays: config.refreshTtlDays,
    });
    const accessToken = signToken(
      {
        sub: user.id,
        sid: session.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        kind: 'access',
      },
      secret,
      config.accessTtlSeconds,
    );
    user.lastLoginAt = nowIso();
    user.updatedAt = user.lastLoginAt;
    return {
      accessToken,
      refreshToken,
      expiresIn: config.accessTtlSeconds,
      sessionId: session.id,
      user: store.publicUser(user),
    };
  }

  function issueTicket(user: UserRecord, purpose: 'mfa-verify' | 'mfa-setup'): string {
    return signToken(
      {
        sub: user.id,
        sid: '',
        name: user.name,
        email: user.email,
        phone: user.phone,
        kind: 'mfa',
        purpose,
      },
      secret,
      600,
    );
  }

  function startLogin(user: UserRecord, ctx: RequestContext) {
    if (user.status !== 'active') {
      throw new HttpError(
        403,
        'account_suspended',
        'Ce compte est suspendu. Contactez le support.',
      );
    }
    const requiresMfa = user.mfaEnabled || store.mfaRequiredFor(user.id);
    if (requiresMfa) {
      const setupRequired = !user.mfaEnabled;
      return {
        mfaRequired: true,
        mfaSetupRequired: setupRequired,
        ticket: issueTicket(user, setupRequired ? 'mfa-setup' : 'mfa-verify'),
        user: store.publicUser(user),
      };
    }
    return { mfaRequired: false, ...issueTokens(user, false, ctx) };
  }

  function userFromTicket(token: string, purpose: 'mfa-verify' | 'mfa-setup'): UserRecord {
    const claims = verifyToken(token, secret, 'mfa');
    if (!claims || claims.purpose !== purpose) {
      throw HttpError.unauthorized('Jeton MFA invalide ou expiré.');
    }
    const user = store.users.get(claims.sub);
    if (!user) throw HttpError.unauthorized('Compte introuvable.');
    if (user.status !== 'active') {
      throw new HttpError(403, 'account_suspended', 'Ce compte est suspendu.');
    }
    return user;
  }

  function totpValid(secretBase32: string, code: string): boolean {
    const now = Date.now();
    for (const offset of [-1, 0, 1]) {
      if (generateTotp(secretBase32, now + offset * 30_000) === code) return true;
    }
    return false;
  }

  function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const plain: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const bytes = randomBytes(8);
      let code = '';
      for (const byte of bytes) code += alphabet[byte % alphabet.length];
      plain.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    return { plain, hashed: plain.map((code) => sha256(code.replace('-', ''))) };
  }

  function consumeRecoveryCode(user: UserRecord, code: string): boolean {
    const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const hash = sha256(normalized);
    const index = user.recoveryCodes.indexOf(hash);
    if (index === -1) return false;
    user.recoveryCodes.splice(index, 1);
    user.updatedAt = nowIso();
    return true;
  }

  function tenantRoles(tenantId: string): RoleRecord[] {
    return [...store.roles.values()].filter(
      (role) => role.tenantId === null || role.tenantId === tenantId,
    );
  }

  const routes: Route[] = [
    {
      method: 'GET',
      path: TABLE.health,
      auth: false,
      handler: () => ({ body: { service: 'identity-service', status: 'ok', time: nowIso() } }),
    },
    {
      method: 'GET',
      path: TABLE.authConfig,
      auth: false,
      handler: () => ({
        body: {
          otpDemo: config.demoOtp,
          socialProviders: ['google', 'apple'],
          mfaRequiredForManagers: true,
          passwordPolicy: '8 caractères minimum, lettres et chiffres',
        },
      }),
    },
    {
      method: 'POST',
      path: TABLE.emailRegister,
      auth: false,
      handler: async (ctx) => {
        const body = asObject(ctx.body);
        const name = requireString(body, 'name', { min: 2, max: 80 });
        const email = requireEmail(body);
        const password = requireString(body, 'password', { max: 128 });
        passwordProblem(password);
        const phone = optionalPhone(body);
        if (store.findUserByEmail(email)) {
          throw HttpError.conflict('email_taken', 'Cet e-mail est déjà utilisé.', {
            field: 'email',
          });
        }
        if (phone && store.findUserByPhone(phone)) {
          throw HttpError.conflict('phone_taken', 'Ce numéro est déjà utilisé.', {
            field: 'phone',
          });
        }
        const now = nowIso();
        const user: UserRecord = {
          id: newId('usr'),
          name,
          email,
          phone,
          passwordHash: await hashPassword(password),
          locale: 'fr',
          status: 'active',
          platformRoles: [],
          platformPermissions: [],
          mfaEnabled: false,
          recoveryCodes: [],
          createdAt: now,
          updatedAt: now,
        };
        store.users.set(user.id, user);
        store.recordAudit({
          tenantId: null,
          actorId: user.id,
          action: 'user.registered',
          targetType: 'user',
          targetId: user.id,
          meta: { channel: 'email' },
        });
        return { status: 201, body: startLogin(user, ctx) };
      },
    },
    {
      method: 'POST',
      path: TABLE.emailLogin,
      auth: false,
      handler: async (ctx) => {
        const body = asObject(ctx.body);
        const email = requireEmail(body);
        const password = requireString(body, 'password', { max: 128 });
        const user = store.findUserByEmail(email);
        const valid = user?.passwordHash
          ? await verifyPassword(password, user.passwordHash)
          : false;
        if (!user || !valid) {
          throw HttpError.unauthorized('E-mail ou mot de passe incorrect.');
        }
        return { body: startLogin(user, ctx) };
      },
    },
    {
      method: 'POST',
      path: TABLE.phoneStart,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const phone = requirePhone(body);
        const last = store.lastOtpAt.get(phone) ?? 0;
        if (Date.now() - last < 60_000) {
          throw HttpError.tooMany('Un code a déjà été envoyé. Patientez une minute.');
        }
        const code = randomDigits(6);
        const otp: import('./store.js').OtpRecord = {
          id: newId('otp'),
          phone,
          codeHash: sha256(`${code}:${phone}`),
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + config.otpTtlSeconds * 1000).toISOString(),
          attempts: 0,
        };
        store.otps.set(otp.id, otp);
        store.lastOtpAt.set(phone, Date.now());
        console.log(
          `[identity-service] OTP demandé pour ${phone} (livraison SMS via notification-service)`,
        );
        return {
          body: {
            challengeId: otp.id,
            expiresAt: otp.expiresAt,
            channel: 'sms',
            ...(config.demoOtp ? { devCode: code } : {}),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.phoneVerify,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const challengeId = requireString(body, 'challengeId');
        const code = requireString(body, 'code', { pattern: /^\d{4,8}$/ });
        const otp = store.otps.get(challengeId);
        if (!otp || otp.consumedAt) {
          throw HttpError.badRequest('challenge_invalid', 'Code expiré. Demandez un nouveau code.');
        }
        if (new Date(otp.expiresAt).getTime() <= Date.now()) {
          throw HttpError.badRequest('challenge_expired', 'Code expiré. Demandez un nouveau code.');
        }
        otp.attempts += 1;
        if (otp.attempts > 5) {
          otp.consumedAt = nowIso();
          throw HttpError.tooMany('Trop de tentatives. Demandez un nouveau code.');
        }
        if (sha256(`${code}:${otp.phone}`) !== otp.codeHash) {
          throw HttpError.unauthorized('Code incorrect.');
        }
        otp.consumedAt = nowIso();
        let user = store.findUserByPhone(otp.phone);
        let created = false;
        if (!user) {
          const name = optionalString(body, 'name', { max: 80 }) ?? 'Client';
          const now = nowIso();
          user = {
            id: newId('usr'),
            name: name.slice(0, 80),
            phone: otp.phone,
            locale: 'fr',
            status: 'active',
            platformRoles: [],
            platformPermissions: [],
            mfaEnabled: false,
            recoveryCodes: [],
            createdAt: now,
            updatedAt: now,
          };
          store.users.set(user.id, user);
          created = true;
          store.recordAudit({
            tenantId: null,
            actorId: user.id,
            action: 'user.registered',
            targetType: 'user',
            targetId: user.id,
            meta: { channel: 'otp' },
          });
        }
        return { status: created ? 201 : 200, body: startLogin(user, ctx) };
      },
    },
    {
      method: 'POST',
      path: TABLE.social,
      auth: false,
      handler: async (ctx) => {
        const provider = requireEnum(ctx.params, 'provider', ['google', 'apple'] as const);
        const body = asObject(ctx.body);
        const idToken = requireString(body, 'idToken', { max: 4096 });
        let subject: string | undefined;
        let email: string | undefined;
        if (idToken.startsWith('demo:')) {
          email = idToken.slice(5).trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            throw HttpError.badRequest('token_invalid', 'Jeton de démonstration invalide.');
          }
          subject = email;
        } else {
          const verifierUrl = process.env.SOCIAL_VERIFIER_URL;
          if (!verifierUrl) {
            throw new HttpError(
              501,
              'provider_not_configured',
              'Ce fournisseur social n’est pas encore configuré.',
            );
          }
          const response = await fetch(`${verifierUrl.replace(/\/$/, '')}/${provider}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
          if (!response.ok) throw HttpError.unauthorized('Jeton social invalide.');
          const verified = (await response.json()) as { subject?: string; email?: string };
          subject = verified.subject;
          email = verified.email?.toLowerCase();
        }
        if (!subject) throw HttpError.unauthorized('Jeton social invalide.');
        const key = `${provider}:${subject}`;
        const existing = store.socials.get(key);
        let user = existing ? store.users.get(existing.userId) : undefined;
        if (!user && email) user = store.findUserByEmail(email);
        if (!user) {
          const name =
            optionalString(body, 'name', { max: 80 }) ?? email?.split('@')[0] ?? 'Utilisateur';
          const now = nowIso();
          user = {
            id: newId('usr'),
            name,
            email,
            locale: 'fr',
            status: 'active',
            platformRoles: [],
            platformPermissions: [],
            mfaEnabled: false,
            recoveryCodes: [],
            createdAt: now,
            updatedAt: now,
          };
          store.users.set(user.id, user);
        }
        if (!existing) {
          store.socials.set(key, {
            provider,
            subject,
            userId: user.id,
            email,
            createdAt: nowIso(),
          });
        }
        return { body: startLogin(user, ctx) };
      },
    },
    {
      method: 'POST',
      path: TABLE.refresh,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const refreshToken = requireString(body, 'refreshToken', { min: 20 });
        const hash = sha256(refreshToken);
        const sessionId = store.refreshIndex.get(hash);
        const session = sessionId ? store.sessions.get(sessionId) : undefined;
        if (!session || session.revokedAt) {
          throw HttpError.unauthorized('Session expirée. Reconnectez-vous.');
        }
        if (new Date(session.expiresAt).getTime() <= Date.now()) {
          throw HttpError.unauthorized('Session expirée. Reconnectez-vous.');
        }
        const user = store.users.get(session.userId);
        if (!user || user.status !== 'active') {
          throw HttpError.unauthorized('Compte indisponible.');
        }
        store.refreshIndex.delete(hash);
        const nextRefresh = randomToken(32);
        session.refreshHash = sha256(nextRefresh);
        store.refreshIndex.set(session.refreshHash, session.id);
        const accessToken = signToken(
          {
            sub: user.id,
            sid: session.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            kind: 'access',
          },
          secret,
          config.accessTtlSeconds,
        );
        return {
          body: {
            accessToken,
            refreshToken: nextRefresh,
            expiresIn: config.accessTtlSeconds,
            sessionId: session.id,
            user: store.publicUser(user),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.logout,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const session = store.sessions.get(claims.sid);
        if (session && !session.revokedAt) {
          session.revokedAt = nowIso();
          store.refreshIndex.delete(session.refreshHash);
        }
        store.recordAudit({
          tenantId: null,
          actorId: claims.sub,
          action: 'session.revoked',
          targetType: 'session',
          targetId: claims.sid,
          meta: { reason: 'logout' },
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: TABLE.me,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const user = store.users.get(claims.sub);
        if (!user) throw HttpError.notFound('Compte introuvable.');
        return {
          body: {
            user: store.publicUser(user),
            claims: {
              platformRoles: claims.platformRoles,
              platformPermissions: claims.platformPermissions,
              tenantPermissions: claims.tenantPermissions,
              mfa: claims.mfa,
            },
            mfaPolicyRequired: store.mfaRequiredFor(user.id),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.mfaEnroll,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        let user: UserRecord | undefined;
        const ticket = typeof body.ticket === 'string' ? body.ticket : undefined;
        if (ticket) {
          user = userFromTicket(ticket, 'mfa-setup');
        } else {
          const token = bearer(ctx);
          const tokenClaims = token ? verifyToken(token, secret, 'access') : null;
          const session = tokenClaims ? store.sessions.get(tokenClaims.sid) : undefined;
          if (!tokenClaims || !session || session.revokedAt) throw HttpError.unauthorized();
          user = store.users.get(tokenClaims.sub);
        }
        if (!user) throw HttpError.unauthorized();
        const pendingSecret = base32Encode(randomBytes(20));
        user.mfaPendingSecret = pendingSecret;
        user.updatedAt = nowIso();
        const label = encodeURIComponent(user.email ?? user.phone ?? user.name);
        return {
          body: {
            secret: pendingSecret,
            otpauthUrl: `otpauth://totp/RESTO-HUB:${label}?secret=${pendingSecret}&issuer=RESTO-HUB&digits=6&period=30`,
            user: store.publicUser(user),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.mfaConfirm,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const ticket = typeof body.ticket === 'string' ? body.ticket : undefined;
        const code = requireString(body, 'code', { pattern: /^\d{6}$/ });
        let user: UserRecord | undefined;
        if (ticket) {
          user = userFromTicket(ticket, 'mfa-setup');
        } else {
          const token = bearer(ctx);
          const tokenClaims = token ? verifyToken(token, secret, 'access') : null;
          const session = tokenClaims ? store.sessions.get(tokenClaims.sid) : undefined;
          if (!tokenClaims || !session || session.revokedAt) throw HttpError.unauthorized();
          user = store.users.get(tokenClaims.sub);
        }
        if (!user?.mfaPendingSecret) {
          throw HttpError.badRequest('mfa_not_pending', 'Aucune activation MFA en cours.');
        }
        if (!totpValid(user.mfaPendingSecret, code)) {
          throw HttpError.unprocessable('mfa_code_invalid', 'Code de vérification incorrect.');
        }
        user.mfaSecret = user.mfaPendingSecret;
        delete user.mfaPendingSecret;
        user.mfaEnabled = true;
        const recovery = generateRecoveryCodes();
        user.recoveryCodes = recovery.hashed;
        user.updatedAt = nowIso();
        store.recordAudit({
          tenantId: null,
          actorId: user.id,
          action: 'mfa.enabled',
          targetType: 'user',
          targetId: user.id,
          meta: { method: 'totp', recoveryCodes: recovery.plain.length },
        });
        const tokens = ticket ? issueTokens(user, true, ctx) : undefined;
        return {
          body: {
            mfaEnabled: true,
            recoveryCodes: recovery.plain,
            ...(tokens ? { ...tokens, mfaRequired: false } : {}),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.mfaVerify,
      auth: false,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const ticket = requireString(body, 'ticket');
        const user = userFromTicket(ticket, 'mfa-verify');
        if (!user.mfaEnabled || !user.mfaSecret) {
          throw HttpError.badRequest('mfa_not_enabled', 'MFA non activé pour ce compte.');
        }
        const rawCode = requireString(body, 'code', { max: 20 });
        const numeric = /^\d{6}$/.test(rawCode.trim());
        const valid = numeric
          ? totpValid(user.mfaSecret, rawCode.trim())
          : consumeRecoveryCode(user, rawCode);
        if (!valid) throw HttpError.unauthorized('Code MFA invalide.');
        store.recordAudit({
          tenantId: null,
          actorId: user.id,
          action: 'mfa.verified',
          targetType: 'user',
          targetId: user.id,
          meta: { method: numeric ? 'totp' : 'recovery' },
        });
        return { body: issueTokens(user, true, ctx) };
      },
    },
    {
      method: 'POST',
      path: TABLE.mfaDisable,
      handler: async (ctx) => {
        const claims = requireAuth(ctx);
        const user = store.users.get(claims.sub);
        if (!user) throw HttpError.notFound('Compte introuvable.');
        if (store.mfaRequiredFor(user.id)) {
          throw new HttpError(
            403,
            'mfa_policy',
            'Le MFA est obligatoire pour votre rôle et ne peut être désactivé.',
          );
        }
        const body = asObject(ctx.body);
        const password = requireString(body, 'password', { max: 128 });
        if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
          throw HttpError.unauthorized('Mot de passe incorrect.');
        }
        user.mfaEnabled = false;
        delete user.mfaSecret;
        user.recoveryCodes = [];
        user.updatedAt = nowIso();
        store.recordAudit({
          tenantId: null,
          actorId: user.id,
          action: 'mfa.disabled',
          targetType: 'user',
          targetId: user.id,
          meta: {},
        });
        return { body: { mfaEnabled: false } };
      },
    },
    {
      method: 'GET',
      path: TABLE.sessions,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const items = [...store.sessions.values()]
          .filter((session) => session.userId === claims.sub)
          .map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            ip: session.ip,
            userAgent: session.userAgent,
            mfa: session.mfa,
            current: session.id === claims.sid,
            revokedAt: session.revokedAt,
          }))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return { body: { items } };
      },
    },
    {
      method: 'DELETE',
      path: TABLE.session,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const session = store.sessions.get(ctx.params.id);
        if (!session || (session.userId !== claims.sub && !hasPlatformOperate(claims))) {
          throw HttpError.notFound('Session introuvable.');
        }
        if (!session.revokedAt) {
          session.revokedAt = nowIso();
          store.refreshIndex.delete(session.refreshHash);
        }
        store.recordAudit({
          tenantId: null,
          actorId: claims.sub,
          action: 'session.revoked',
          targetType: 'session',
          targetId: session.id,
          meta: { reason: 'manual' },
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: TABLE.roles,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const tenantId = ctx.query.get('tenantId') ?? undefined;
        if (tenantId) ensureTenantPermission(claims, tenantId, 'role:view');
        else if (!hasPlatformOperate(claims)) {
          throw HttpError.badRequest('tenant_required', 'Précisez l’établissement.');
        }
        const roles = store.rolesForTenant(tenantId ?? null).map((role) => ({
          id: role.id,
          tenantId: role.tenantId,
          code: role.code,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          requiresMfa: role.requiresMfa,
          system: role.system,
        }));
        return { body: { items: roles } };
      },
    },
    {
      method: 'POST',
      path: TABLE.roles,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId');
        ensureTenantPermission(claims, tenantId, 'role:manage');
        const name = requireString(body, 'name', { min: 2, max: 60 });
        const permissionsRaw = requireArray(body, 'permissions', 80);
        const permissions: Permission[] = [];
        for (const value of permissionsRaw) {
          if (typeof value !== 'string' || !isValidPermission(value)) {
            throw HttpError.unprocessable(
              'invalid_permission',
              `Permission inconnue : ${String(value)}.`,
            );
          }
          permissions.push(value);
        }
        const requiresMfa = optionalBoolean(body, 'requiresMfa') ?? false;
        const code = slugify(optionalString(body, 'code', { max: 40 }) ?? name);
        if (!code) throw HttpError.unprocessable('validation_error', 'Nom de rôle invalide.');
        if (
          tenantRoles(tenantId).some((role) => role.tenantId === tenantId && role.code === code)
        ) {
          throw HttpError.conflict('role_exists', 'Un rôle avec ce code existe déjà.', {
            field: 'code',
          });
        }
        const now = nowIso();
        const role: RoleRecord = {
          id: newId('rol'),
          tenantId,
          code,
          name,
          description: optionalString(body, 'description', { max: 200 }) ?? '',
          permissions,
          requiresMfa,
          system: false,
          createdAt: now,
          updatedAt: now,
        };
        store.roles.set(role.id, role);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'role.created',
          targetType: 'role',
          targetId: role.id,
          meta: { code, permissions, requiresMfa },
        });
        return { status: 201, body: { role } };
      },
    },
    {
      method: 'PATCH',
      path: TABLE.role,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const role = store.roles.get(ctx.params.id);
        if (!role) throw HttpError.notFound('Rôle introuvable.');
        if (role.system || !role.tenantId) {
          throw new HttpError(
            403,
            'system_role',
            'Les modèles de rôles système ne sont pas modifiables.',
          );
        }
        ensureTenantPermission(claims, role.tenantId, 'role:manage');
        const body = asObject(ctx.body);
        const before = { permissions: [...role.permissions], requiresMfa: role.requiresMfa };
        if (body.permissions !== undefined) {
          const values = requireArray(body, 'permissions', 80);
          const permissions: Permission[] = [];
          for (const value of values) {
            if (typeof value !== 'string' || !isValidPermission(value)) {
              throw HttpError.unprocessable(
                'invalid_permission',
                `Permission inconnue : ${String(value)}.`,
              );
            }
            permissions.push(value);
          }
          role.permissions = permissions;
        }
        if (body.name !== undefined) role.name = requireString(body, 'name', { min: 2, max: 60 });
        if (body.description !== undefined)
          role.description = optionalString(body, 'description', { max: 200 }) ?? '';
        if (body.requiresMfa !== undefined)
          role.requiresMfa = optionalBoolean(body, 'requiresMfa') ?? false;
        role.updatedAt = nowIso();
        store.recordAudit({
          tenantId: role.tenantId,
          actorId: claims.sub,
          action: 'role.updated',
          targetType: 'role',
          targetId: role.id,
          meta: { before, after: { permissions: role.permissions, requiresMfa: role.requiresMfa } },
        });
        return { body: { role } };
      },
    },
    {
      method: 'DELETE',
      path: TABLE.role,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const role = store.roles.get(ctx.params.id);
        if (!role) throw HttpError.notFound('Rôle introuvable.');
        if (role.system || !role.tenantId) {
          throw new HttpError(
            403,
            'system_role',
            'Les modèles système ne peuvent pas être supprimés.',
          );
        }
        ensureTenantPermission(claims, role.tenantId, 'role:manage');
        const inUse = [...store.assignments.values()].some(
          (assignment) =>
            assignment.tenantId === role.tenantId && assignment.roleCode === role.code,
        );
        if (inUse)
          throw HttpError.conflict('role_in_use', 'Ce rôle est encore attribué à des membres.');
        store.roles.delete(role.id);
        store.recordAudit({
          tenantId: role.tenantId,
          actorId: claims.sub,
          action: 'role.deleted',
          targetType: 'role',
          targetId: role.id,
          meta: { code: role.code },
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: TABLE.permissions,
      handler: () => ({
        body: {
          permissions: PERMISSIONS,
          jobTitles: TENANT_JOB_TITLES,
          platformRoles: PLATFORM_ROLES.map((role) => ({ code: role.code, name: role.name })),
        },
      }),
    },
    {
      method: 'GET',
      path: TABLE.team,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const tenantId = ctx.params.tenantId;
        ensureTenantPermission(claims, tenantId, 'team:view');
        const byUser = new Map<string, string[]>();
        for (const assignment of store.assignmentsForTenant(tenantId)) {
          const list = byUser.get(assignment.userId) ?? [];
          list.push(assignment.roleCode);
          byUser.set(assignment.userId, list);
        }
        const items = [...byUser.entries()].map(([userId, roleCodes]) => {
          const user = store.users.get(userId);
          return {
            userId,
            name: user?.name ?? 'Utilisateur supprimé',
            email: user?.email,
            phone: user?.phone,
            status: user?.status,
            mfaEnabled: user?.mfaEnabled ?? false,
            lastLoginAt: user?.lastLoginAt,
            roles: roleCodes,
          };
        });
        return { body: { items } };
      },
    },
    {
      method: 'PUT',
      path: TABLE.teamMemberRoles,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const tenantId = ctx.params.tenantId;
        ensureTenantPermission(claims, tenantId, 'team:manage');
        const userId = ctx.params.userId;
        const user = store.users.get(userId);
        if (!user) throw HttpError.notFound('Membre introuvable.');
        const body = asObject(ctx.body);
        const rawRoles = requireArray(body, 'roleCodes', 10);
        const roleCodes: string[] = [];
        for (const value of rawRoles) {
          if (typeof value !== 'string')
            throw HttpError.unprocessable('validation_error', 'Rôle invalide.');
          const role = store.resolveRole(tenantId, value);
          if (!role) throw HttpError.unprocessable('unknown_role', `Rôle inconnu : ${value}.`);
          roleCodes.push(value);
        }
        const current = store.assignmentsForTenant(tenantId).filter((a) => a.userId === userId);
        const owners = store
          .assignmentsForTenant(tenantId)
          .filter((assignment) => assignment.roleCode === 'owner')
          .map((assignment) => assignment.userId);
        const removingOwner =
          current.some((a) => a.roleCode === 'owner') && !roleCodes.includes('owner');
        if (removingOwner && owners.filter((id) => id === userId).length === owners.length) {
          throw HttpError.unprocessable(
            'last_owner',
            'L’établissement doit conserver au moins un gérant principal.',
          );
        }
        for (const assignment of current) store.assignments.delete(assignment.id);
        const now = nowIso();
        for (const code of roleCodes) {
          const id = newId('asg');
          store.assignments.set(id, {
            id,
            userId,
            tenantId,
            roleCode: code,
            assignedBy: claims.sub,
            createdAt: now,
          });
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'team.roles_updated',
          targetType: 'user',
          targetId: userId,
          meta: { before: current.map((a) => a.roleCode), after: roleCodes },
        });
        return { body: { userId, roles: roleCodes } };
      },
    },
    {
      method: 'DELETE',
      path: TABLE.teamMember,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const tenantId = ctx.params.tenantId;
        ensureTenantPermission(claims, tenantId, 'team:manage');
        const userId = ctx.params.userId;
        const current = store.assignmentsForTenant(tenantId).filter((a) => a.userId === userId);
        if (current.length === 0) throw HttpError.notFound('Membre introuvable.');
        if (current.some((a) => a.roleCode === 'owner')) {
          const owners = new Set(
            store
              .assignmentsForTenant(tenantId)
              .filter((assignment) => assignment.roleCode === 'owner')
              .map((assignment) => assignment.userId),
          );
          if (owners.size <= 1) {
            throw HttpError.unprocessable(
              'last_owner',
              'L’établissement doit conserver au moins un gérant principal.',
            );
          }
        }
        for (const assignment of current) store.assignments.delete(assignment.id);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'team.member_removed',
          targetType: 'user',
          targetId: userId,
          meta: { roles: current.map((a) => a.roleCode) },
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: TABLE.audit,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        const tenantId = ctx.query.get('tenantId') ?? undefined;
        const limit = Math.min(Number(ctx.query.get('limit') ?? 50), 200);
        if (!tenantId) {
          ensurePlatformPermission(claims, 'platform:logs:view');
          const items = [...store.audit].slice(-limit).reverse();
          return { body: { items } };
        }
        ensureTenantPermission(claims, tenantId, 'audit:view');
        const items = store.audit
          .filter((entry) => entry.tenantId === tenantId)
          .slice(-limit)
          .reverse();
        return { body: { items } };
      },
    },
    {
      method: 'GET',
      path: TABLE.auditIntegrity,
      handler: (ctx) => {
        const claims = requireAuth(ctx);
        ensurePlatformPermission(claims, 'platform:logs:view');
        return { body: { valid: verifyAuditChain(store.audit), entries: store.audit.length } };
      },
    },
    {
      method: 'POST',
      path: TABLE.introspect,
      service: true,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const token = requireString(body, 'token', { max: 4096 });
        const tokenClaims = verifyToken(token, secret, 'access');
        if (!tokenClaims) throw HttpError.unauthorized('Jeton invalide.');
        const session = store.sessions.get(tokenClaims.sid);
        if (!session || session.revokedAt || session.userId !== tokenClaims.sub) {
          throw HttpError.unauthorized('Session révoquée.');
        }
        if (new Date(session.expiresAt).getTime() <= Date.now()) {
          throw HttpError.unauthorized('Session expirée.');
        }
        const user = store.users.get(tokenClaims.sub);
        if (!user || user.status !== 'active') throw HttpError.unauthorized('Compte suspendu.');
        return {
          body: {
            claims: claimsFor(user, session),
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.provisionUser,
      service: true,
      handler: async (ctx) => {
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId');
        const roleCode = requireString(body, 'roleCode');
        const name = requireString(body, 'name', { min: 2, max: 80 });
        const email = optionalEmail(body);
        const phone = optionalPhone(body);
        const password = optionalString(body, 'password', { max: 128 });
        const applicationId = optionalString(body, 'applicationId', { max: 64 });
        if (!email && !phone) {
          throw HttpError.unprocessable(
            'validation_error',
            'E-mail ou téléphone requis pour le gérant.',
          );
        }
        const role = store.resolveRole(tenantId, roleCode);
        if (!role) throw HttpError.unprocessable('unknown_role', `Rôle inconnu : ${roleCode}.`);
        if (applicationId) {
          const existingAssignment = [...store.assignments.values()].find(
            (assignment) => assignment.applicationId === applicationId,
          );
          const existingUser = existingAssignment
            ? store.users.get(existingAssignment.userId)
            : undefined;
          if (existingUser) {
            return {
              body: {
                userId: existingUser.id,
                created: false,
                email: existingUser.email,
                phone: existingUser.phone,
                roles: store.assignmentsForUser(existingUser.id).map((a) => a.roleCode),
              },
            };
          }
        }
        let user =
          (email ? store.findUserByEmail(email) : undefined) ??
          (phone ? store.findUserByPhone(phone) : undefined);
        let created = false;
        if (!user) {
          const now = nowIso();
          if (password) passwordProblem(password);
          user = {
            id: newId('usr'),
            name,
            email,
            phone,
            passwordHash: password ? await hashPassword(password) : undefined,
            locale: body.locale === 'en' ? 'en' : 'fr',
            status: 'active',
            platformRoles: [],
            platformPermissions: [],
            mfaEnabled: false,
            recoveryCodes: [],
            createdAt: now,
            updatedAt: now,
          };
          store.users.set(user.id, user);
          created = true;
        }
        const alreadyAssigned = store
          .assignmentsForUser(user.id)
          .some(
            (assignment) => assignment.tenantId === tenantId && assignment.roleCode === roleCode,
          );
        if (!alreadyAssigned) {
          const id = newId('asg');
          store.assignments.set(id, {
            id,
            userId: user.id,
            tenantId,
            roleCode,
            assignedBy: 'tenant-service',
            applicationId,
            createdAt: nowIso(),
          });
        }
        store.recordAudit({
          tenantId,
          actorId: 'tenant-service',
          action: 'user.provisioned',
          targetType: 'user',
          targetId: user.id,
          meta: { roleCode, applicationId, created },
        });
        return {
          status: created ? 201 : 200,
          body: {
            userId: user.id,
            created,
            email: user.email,
            phone: user.phone,
            roles: store.assignmentsForUser(user.id).map((a) => a.roleCode),
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.provisionPlatformUser,
      service: true,
      handler: async (ctx) => {
        const body = asObject(ctx.body);
        const name = requireString(body, 'name', { min: 2, max: 80 });
        const email = requireEmail(body);
        const password = requireString(body, 'password', { max: 128 });
        passwordProblem(password);
        const platformRole = requireEnum(
          body,
          'platformRole',
          PLATFORM_ROLES.map((role) => role.code) as unknown as readonly string[],
        );
        const template = PLATFORM_ROLES.find((role) => role.code === platformRole);
        if (!template) throw HttpError.unprocessable('unknown_role', 'Rôle plateforme inconnu.');
        let user = store.findUserByEmail(email);
        if (!user) {
          const now = nowIso();
          user = {
            id: newId('usr'),
            name,
            email,
            passwordHash: await hashPassword(password),
            locale: 'fr',
            status: 'active',
            platformRoles: [platformRole],
            platformPermissions: [...template.permissions],
            mfaEnabled: false,
            recoveryCodes: [],
            createdAt: now,
            updatedAt: now,
          };
          store.users.set(user.id, user);
        } else {
          user.platformRoles = [platformRole];
          user.platformPermissions = [...template.permissions];
          user.updatedAt = nowIso();
        }
        return {
          body: {
            userId: user.id,
            platformRoles: user.platformRoles,
            permissions: user.platformPermissions,
          },
        };
      },
    },
    {
      method: 'POST',
      path: TABLE.revokeSessions,
      service: true,
      handler: (ctx) => {
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId');
        const reason = optionalString(body, 'reason', { max: 120 }) ?? 'tenant_suspended';
        const revoked = store.revokeTenantSessions(tenantId, 'tenant-service', reason);
        return { body: { revoked } };
      },
    },
    {
      method: 'GET',
      path: TABLE.tenantMembers,
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId;
        const byUser = new Map<string, string[]>();
        for (const assignment of store.assignmentsForTenant(tenantId)) {
          const list = byUser.get(assignment.userId) ?? [];
          list.push(assignment.roleCode);
          byUser.set(assignment.userId, list);
        }
        const items = [...byUser.entries()].map(([userId, roleCodes]) => {
          const user = store.users.get(userId);
          return {
            userId,
            name: user?.name ?? 'Utilisateur supprimé',
            email: user?.email,
            phone: user?.phone,
            mfaEnabled: user?.mfaEnabled ?? false,
            roles: roleCodes,
          };
        });
        return { body: { items, count: items.length } };
      },
    },
    {
      method: 'GET',
      path: '/internal/users/:userId/contacts',
      service: true,
      handler: (ctx) => {
        const user = store.users.get(ctx.params.userId ?? '');
        if (!user) throw HttpError.notFound('Utilisateur introuvable.');
        return {
          body: {
            user: {
              id: user.id,
              name: user.name,
              email: user.email ?? null,
              phone: user.phone ?? null,
              locale: user.locale,
              status: user.status,
            },
          },
        };
      },
    },
  ];

  return { routes, authenticate };
}

export { PLATFORM_ROLE_TEMPLATE };
