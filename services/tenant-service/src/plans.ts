export type PlanCode = 'starter' | 'pro' | 'enterprise';

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tagline: string;
  priceXof: number;
  maxSites: number | null;
  maxEmployees: number | null;
  features: string[];
  highlight?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    code: 'starter',
    name: 'Starter',
    tagline: 'Le premier service, sans friction',
    priceXof: 15000,
    maxSites: 1,
    maxEmployees: 5,
    features: [
      '1 établissement',
      '5 employés',
      'Commandes & plan de salle',
      'Encaissement mobile money',
      'Rapports essentiels',
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    tagline: 'Le rythme d’un restaurant qui tourne',
    priceXof: 35000,
    maxSites: 3,
    maxEmployees: 25,
    highlight: true,
    features: [
      'Jusqu’à 3 établissements',
      '25 employés',
      'KDS cuisine, stocks, fidélité',
      'Paie & plannings',
      'Exports PDF / Excel',
      'Support prioritaire',
    ],
  },
  {
    code: 'enterprise',
    name: 'Entreprise',
    tagline: 'Groupes, franchises et bars multi-sites',
    priceXof: 75000,
    maxSites: null,
    maxEmployees: null,
    features: [
      'Établissements illimités',
      'Employés illimités',
      'Comptes multi-sites consolidés',
      'API & webhooks',
      'Accompagnement dédié',
    ],
  },
];

export const PLAN_CODES: PlanCode[] = PLANS.map((plan) => plan.code);

export function planByCode(code: string): PlanDefinition {
  return PLANS.find((plan) => plan.code === code) ?? PLANS[0];
}

export const STATUS_LABELS: Record<string, { fr: string; en: string }> = {
  draft: { fr: 'Brouillon', en: 'Draft' },
  submitted: { fr: 'En attente de validation', en: 'Awaiting review' },
  info_requested: { fr: 'Complément demandé', en: 'Information requested' },
  approved: { fr: 'Validée', en: 'Approved' },
  rejected: { fr: 'Refusée', en: 'Rejected' },
};
