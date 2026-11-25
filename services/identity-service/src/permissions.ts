export const PERMISSIONS = [
  'tenant:view',
  'tenant:update',
  'subscription:view',
  'subscription:manage',
  'team:view',
  'team:manage',
  'role:view',
  'role:manage',
  'catalog:view',
  'catalog:manage',
  'catalog:availability',
  'floor:view',
  'floor:manage',
  'floor:status',
  'order:view',
  'order:create',
  'order:update',
  'order:cancel',
  'order:discount',
  'pos:operate',
  'pos:close',
  'payment:view',
  'payment:refund',
  'payment:manage',
  'staff:view',
  'staff:manage',
  'payroll:view',
  'payroll:prepare',
  'payroll:approve',
  'payroll:pay',
  'inventory:view',
  'inventory:manage',
  'loyalty:view',
  'loyalty:manage',
  'notification:view',
  'notification:manage',
  'report:view',
  'report:export',
  'settings:update',
  'audit:view',
  'session:manage',
  'platform:establishments:review',
  'platform:subscriptions:manage',
  'platform:disputes:manage',
  'platform:settings:manage',
  'platform:logs:view',
  'platform:users:manage',
  'platform:operate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  jobTitle: string;
  requiresMfa: boolean;
  permissions: Permission[];
}

const ALL_TENANT_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => !p.startsWith('platform:'));

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: 'owner',
    name: 'Gérant principal',
    description: 'Accès complet à son établissement, aux finances et aux paramètres.',
    jobTitle: 'gerant',
    requiresMfa: true,
    permissions: [...ALL_TENANT_PERMISSIONS],
  },
  {
    code: 'floor_manager',
    name: 'Manager de salle',
    description: 'Pilote le plan de salle, les réservations et les commandes du service.',
    jobTitle: 'manager_salle',
    requiresMfa: false,
    permissions: [
      'tenant:view', 'floor:view', 'floor:manage', 'floor:status', 'order:view', 'order:create', 'order:update', 'order:cancel',
      'order:discount', 'catalog:view', 'team:view', 'staff:view', 'report:view', 'audit:view', 'loyalty:view', 'loyalty:manage',
      'notification:view', 'notification:manage',
    ],
  },
  {
    code: 'waiter',
    name: 'Serveur',
    description: 'Prend les commandes et suit les tables dont il a la charge.',
    jobTitle: 'serveur',
    requiresMfa: false,
    permissions: ['tenant:view', 'floor:view', 'floor:status', 'order:view', 'order:create', 'order:update', 'pos:operate', 'catalog:view'],
  },
  {
    code: 'cashier',
    name: 'Caissier',
    description: 'Encaisse, clôture la caisse et suit les paiements.',
    jobTitle: 'caissier',
    requiresMfa: false,
    permissions: ['tenant:view', 'order:view', 'order:update', 'pos:operate', 'pos:close', 'payment:view', 'report:view'],
  },
  {
    code: 'cook',
    name: 'Cuisinier',
    description: 'Consulte le KDS et fait avancer le statut des plats.',
    jobTitle: 'cuisinier',
    requiresMfa: false,
    permissions: ['tenant:view', 'order:view', 'order:update', 'catalog:view', 'catalog:availability', 'inventory:view'],
  },
  {
    code: 'bartender',
    name: 'Barman',
    description: 'Gère le bar : commandes, stock de boissons et disponibilité des produits.',
    jobTitle: 'barman',
    requiresMfa: false,
    permissions: ['tenant:view', 'order:view', 'order:update', 'catalog:view', 'catalog:availability', 'inventory:view'],
  },
  {
    code: 'driver',
    name: 'Livreur',
    description: 'Suit les commandes de livraison et leurs paiements.',
    jobTitle: 'livreur',
    requiresMfa: false,
    permissions: ['tenant:view', 'order:view', 'order:update', 'payment:view'],
  },
  {
    code: 'accountant',
    name: 'Comptable',
    description: 'Contrôle les finances, prépare la paie et exporte les rapports.',
    jobTitle: 'comptable',
    requiresMfa: false,
    permissions: [
      'tenant:view', 'subscription:view', 'report:view', 'report:export', 'payment:view', 'payroll:view',
      'payroll:prepare', 'inventory:view', 'audit:view', 'team:view',
    ],
  },
];

export const PLATFORM_ROLE_TEMPLATE: RoleTemplate = {
  code: 'super_admin',
  name: 'Super-administrateur plateforme',
  description: 'Valide les établissements, gère les abonnements, litiges et la supervision.',
  jobTitle: 'super_admin',
  requiresMfa: false,
  permissions: [
    'platform:establishments:review',
    'platform:subscriptions:manage',
    'platform:disputes:manage',
    'platform:settings:manage',
    'platform:logs:view',
    'platform:users:manage',
    'platform:operate',
    'tenant:view',
    'report:export',
  ],
};

export const PLATFORM_ROLES: RoleTemplate[] = [
  PLATFORM_ROLE_TEMPLATE,
  {
    code: 'support',
    name: 'Support plateforme',
    description: 'Consulte les établissements et les journaux pour assister les gérants.',
    jobTitle: 'support',
    requiresMfa: false,
    permissions: ['platform:establishments:review', 'platform:logs:view', 'tenant:view'],
  },
];

export function isValidPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const TENANT_JOB_TITLES = ROLE_TEMPLATES.filter((role) => role.code !== 'owner').map((role) => ({
  code: role.jobTitle,
  label: role.name,
  requiresMfa: role.requiresMfa,
}));
