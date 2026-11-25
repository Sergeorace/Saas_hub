import { hashPassword, newId, nowIso, sha256 } from '@resto-hub/service-kit';
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_TEMPLATE,
  ROLE_TEMPLATES,
  type Permission,
  type RoleTemplate,
} from './permissions.js';

export const DEMO_TENANT_ID = 'tnt_sahelgrill';

export interface UserRecord {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  locale: 'fr' | 'en';
  status: 'active' | 'suspended';
  platformRoles: string[];
  platformPermissions: string[];
  mfaEnabled: boolean;
  mfaSecret?: string;
  mfaPendingSecret?: string;
  recoveryCodes: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface SocialRecord {
  provider: 'google' | 'apple';
  subject: string;
  userId: string;
  email?: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshHash: string;
  createdAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
  mfa: boolean;
  revokedAt?: string;
}

export interface OtpRecord {
  id: string;
  phone: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumedAt?: string;
}

export interface RoleRecord {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
  requiresMfa: boolean;
  system: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentRecord {
  id: string;
  userId: string;
  tenantId: string;
  roleCode: string;
  assignedBy: string;
  applicationId?: string;
  createdAt: string;
}

export interface AuditRecord {
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

export interface AuditInput {
  tenantId: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
}

export interface IdentityStore {
  users: Map<string, UserRecord>;
  socials: Map<string, SocialRecord>;
  sessions: Map<string, SessionRecord>;
  refreshIndex: Map<string, string>;
  otps: Map<string, OtpRecord>;
  roles: Map<string, RoleRecord>;
  assignments: Map<string, AssignmentRecord>;
  audit: AuditRecord[];
  lastOtpAt: Map<string, number>;
  findUserByEmail: (email: string) => UserRecord | undefined;
  findUserByPhone: (phone: string) => UserRecord | undefined;
  publicUser: (user: UserRecord) => Record<string, unknown>;
  recordAudit: (input: AuditInput) => AuditRecord;
  rolesForTenant: (tenantId: string | null) => RoleRecord[];
  resolveRole: (tenantId: string | null, code: string) => RoleRecord | undefined;
  assignmentsForUser: (userId: string) => AssignmentRecord[];
  assignmentsForTenant: (tenantId: string) => AssignmentRecord[];
  tenantPermissionsFor: (userId: string) => Record<string, string[]>;
  mfaRequiredFor: (userId: string) => boolean;
  createSession: (input: {
    userId: string;
    refreshHash: string;
    ip: string;
    userAgent: string;
    mfa: boolean;
    ttlDays: number;
  }) => SessionRecord;
  revokeTenantSessions: (tenantId: string, actorId: string, reason: string) => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function templateRecord(template: RoleTemplate, system: boolean): RoleRecord {
  const now = nowIso();
  return {
    id: newId('rol'),
    tenantId: null,
    code: template.code,
    name: template.name,
    description: template.description,
    permissions: [...template.permissions],
    requiresMfa: template.requiresMfa,
    system,
    createdAt: now,
    updatedAt: now,
  };
}

export function createIdentityStore(): IdentityStore {
  const store: IdentityStore = {
    users: new Map(),
    socials: new Map(),
    sessions: new Map(),
    refreshIndex: new Map(),
    otps: new Map(),
    roles: new Map(),
    assignments: new Map(),
    audit: [],
    lastOtpAt: new Map(),

    findUserByEmail(email) {
      const normalized = email.toLowerCase();
      return [...this.users.values()].find((user) => user.email?.toLowerCase() === normalized);
    },
    findUserByPhone(phone) {
      const digits = phone.replace(/[^\d+]/g, '');
      return [...this.users.values()].find((user) => user.phone === digits);
    },
    publicUser(user) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        locale: user.locale,
        status: user.status,
        platformRoles: user.platformRoles,
        mfaEnabled: user.mfaEnabled,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      };
    },
    recordAudit(input) {
      const previous = this.audit[this.audit.length - 1];
      const prevHash = previous?.hash ?? 'genesis';
      const canonical = JSON.stringify({
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: input.meta ?? {},
        createdAt: nowIso(),
        prevHash,
      });
      const createdAt = JSON.parse(canonical).createdAt as string;
      const record: AuditRecord = {
        id: newId('aud'),
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: input.meta ?? {},
        createdAt,
        prevHash,
        hash: sha256(canonical),
      };
      this.audit.push(record);
      return record;
    },
    rolesForTenant(tenantId) {
      const all = [...this.roles.values()];
      const templates = all.filter((role) => role.tenantId === null);
      const custom = tenantId ? all.filter((role) => role.tenantId === tenantId) : [];
      return [...templates, ...custom];
    },
    resolveRole(tenantId, code) {
      const all = [...this.roles.values()];
      if (tenantId) {
        const custom = all.find((role) => role.tenantId === tenantId && role.code === code);
        if (custom) return custom;
      }
      return all.find((role) => role.tenantId === null && role.code === code);
    },
    assignmentsForUser(userId) {
      return [...this.assignments.values()].filter((assignment) => assignment.userId === userId);
    },
    assignmentsForTenant(tenantId) {
      return [...this.assignments.values()].filter((assignment) => assignment.tenantId === tenantId);
    },
    tenantPermissionsFor(userId) {
      const result: Record<string, string[]> = {};
      for (const assignment of this.assignmentsForUser(userId)) {
        const role = this.resolveRole(assignment.tenantId, assignment.roleCode);
        if (!role) continue;
        const current = new Set(result[assignment.tenantId] ?? []);
        for (const permission of role.permissions) current.add(permission);
        result[assignment.tenantId] = [...current];
      }
      return result;
    },
    mfaRequiredFor(userId) {
      return this.assignmentsForUser(userId).some((assignment) => {
        const role = this.resolveRole(assignment.tenantId, assignment.roleCode);
        return role?.requiresMfa === true;
      });
    },
    createSession(input) {
      const createdAt = nowIso();
      const session: SessionRecord = {
        id: newId('ses'),
        userId: input.userId,
        refreshHash: input.refreshHash,
        createdAt,
        expiresAt: new Date(Date.now() + input.ttlDays * DAY_MS).toISOString(),
        ip: input.ip,
        userAgent: input.userAgent,
        mfa: input.mfa,
      };
      this.sessions.set(session.id, session);
      this.refreshIndex.set(input.refreshHash, session.id);
      return session;
    },
    revokeTenantSessions(tenantId, actorId, reason) {
      const userIds = new Set(this.assignmentsForTenant(tenantId).map((assignment) => assignment.userId));
      let revoked = 0;
      for (const session of this.sessions.values()) {
        if (!userIds.has(session.userId) || session.revokedAt) continue;
        const user = this.users.get(session.userId);
        if (user?.platformRoles.length) continue;
        session.revokedAt = nowIso();
        this.refreshIndex.delete(session.refreshHash);
        revoked += 1;
      }
      this.recordAudit({
        tenantId,
        actorId,
        action: 'session.tenant_revoked',
        targetType: 'tenant',
        targetId: tenantId,
        meta: { revoked, reason },
      });
      return revoked;
    },
  };

  for (const template of [...ROLE_TEMPLATES, ...PLATFORM_ROLES]) {
    const record = templateRecord(template, true);
    record.id = `rol_${record.tenantId ?? 'sys'}_${template.code}`;
    store.roles.set(record.id, record);
  }
  return store;
}

export async function seedDemo(store: IdentityStore): Promise<void> {
  const now = nowIso();
  const admin: UserRecord = {
    id: 'usr_platform_admin',
    name: 'Awa Kossi',
    email: 'admin@resto-hub.tg',
    phone: '+22890000001',
    passwordHash: await hashPassword('Admin#2026'),
    locale: 'fr',
    status: 'active',
    platformRoles: ['super_admin'],
    platformPermissions: [...PLATFORM_ROLE_TEMPLATE.permissions],
    mfaEnabled: false,
    recoveryCodes: [],
    createdAt: now,
    updatedAt: now,
  };
  const owner: UserRecord = {
    id: 'usr_gerant_sahel',
    name: 'Kossi Amegah',
    email: 'gerant@sahelgrill.tg',
    phone: '+22890112233',
    passwordHash: await hashPassword('Gerant#2026'),
    locale: 'fr',
    status: 'active',
    platformRoles: [],
    platformPermissions: [],
    mfaEnabled: false,
    recoveryCodes: [],
    createdAt: now,
    updatedAt: now,
  };
  const waiter: UserRecord = {
    id: 'usr_serveur_sahel',
    name: 'Yao Mensah',
    email: 'serveur@sahelgrill.tg',
    phone: '+22890778899',
    passwordHash: await hashPassword('Serveur#2026'),
    locale: 'fr',
    status: 'active',
    platformRoles: [],
    platformPermissions: [],
    mfaEnabled: false,
    recoveryCodes: [],
    createdAt: now,
    updatedAt: now,
  };
  const accountant: UserRecord = {
    id: 'usr_comptable_sahel',
    name: 'Afi Sodji',
    email: 'comptable@sahelgrill.tg',
    phone: '+22890554433',
    passwordHash: await hashPassword('Comptable#2026'),
    locale: 'fr',
    status: 'active',
    platformRoles: [],
    platformPermissions: [],
    mfaEnabled: false,
    recoveryCodes: [],
    createdAt: now,
    updatedAt: now,
  };
  for (const user of [admin, owner, waiter, accountant]) store.users.set(user.id, user);

  store.assignments.set('asg_demo_owner', {
    id: 'asg_demo_owner',
    userId: owner.id,
    tenantId: DEMO_TENANT_ID,
    roleCode: 'owner',
    assignedBy: 'system',
    createdAt: now,
  });
  store.assignments.set('asg_demo_accountant', {
    id: 'asg_demo_accountant',
    userId: accountant.id,
    tenantId: DEMO_TENANT_ID,
    roleCode: 'accountant',
    assignedBy: 'system',
    createdAt: now,
  });
  store.assignments.set('asg_demo_waiter', {
    id: 'asg_demo_waiter',
    userId: waiter.id,
    tenantId: DEMO_TENANT_ID,
    roleCode: 'waiter',
    assignedBy: 'system',
    createdAt: now,
  });
}
