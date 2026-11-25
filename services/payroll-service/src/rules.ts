/**
 * Moteur de paie 100 % piloté par les données.
 *
 * Aucun taux, plafond ou barème n'est codé dans la logique : chaque règle est
 * un objet JSON persisté (voir PayrollSettings.rules) que le gérant peut
 * modifier sans redéploiement. `evaluateRules` interprète ces objets et
 * produit une trace ligne par ligne, destinée à la validation par un expert
 * comptable (base, valeur de base, opération, plafond appliqué, montant).
 */

export const RULE_TYPES = ['prime', 'indemnite', 'cotisation', 'retenue', 'impot', 'avance'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_BASES = [
  'salaire_base',
  'salaire_journalier',
  'salaire_brut',
  'brut_imposable',
  'net_imposable',
  'heures_sup',
  'ventes',
  'pourboires',
  'jours_absence',
] as const;
export type RuleBase = (typeof RULE_BASES)[number];

export const RULE_KINDS = ['percent', 'amount', 'heures', 'jours', 'tranches'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface RuleTier {
  /** Borne supérieure de la tranche (montant XOF inclus) ; null = dernière tranche. */
  upTo: number | null;
  ratePercent: number;
}

export interface PayRule {
  id: string;
  label: string;
  code: string;
  type: RuleType;
  enabled: boolean;
  /** Vrai si l’élément entre dans l’assiette imposable (primes, indemnités). */
  taxable: boolean;
  /** Vrai si la retenue/cotisation diminue l’assiette de l’impôt. */
  deductible: boolean;
  base: RuleBase;
  kind: RuleKind;
  ratePercent?: number;
  rateXof?: number;
  multiplier?: number;
  capXof?: number;
  tranches?: RuleTier[];
  description: string;
  legalReference?: string;
}

export interface PayrollContext {
  baseSalaryXof: number;
  monthlyHours: number;
  workingDaysPerMonth: number;
  overtimeHours: number;
  salesXof: number;
  tipsXof: number;
  unpaidLeaveDays: number;
}

export interface PayComponent {
  ruleId: string;
  code: string;
  label: string;
  type: RuleType;
  kind: RuleKind;
  base: RuleBase;
  baseValue: number;
  operation: string;
  amountXof: number;
  capApplied: boolean;
  taxable: boolean;
  deductible: boolean;
}

export interface PayrollComputation {
  components: PayComponent[];
  brutXof: number;
  brutImposableXof: number;
  cotisationsXof: number;
  retenuesXof: number;
  impotsXof: number;
  avancesXof: number;
  netXof: number;
}

const RULE_ORDER: RuleType[][] = [['prime', 'indemnite'], ['cotisation'], ['retenue'], ['impot'], ['avance']];

function round0(value: number): number {
  return Math.round(value);
}

function baseValue(base: RuleBase, state: {
  baseSalaryXof: number;
  workingDaysPerMonth: number;
  brut: number;
  brutImposable: number;
  netImposable: number;
  ctx: PayrollContext;
}): number {
  switch (base) {
    case 'salaire_base':
      return state.baseSalaryXof;
    case 'salaire_journalier':
      return state.workingDaysPerMonth > 0 ? state.baseSalaryXof / state.workingDaysPerMonth : 0;
    case 'salaire_brut':
      return state.brut;
    case 'brut_imposable':
      return state.brutImposable;
    case 'net_imposable':
      return state.netImposable;
    case 'heures_sup':
      return state.ctx.overtimeHours;
    case 'ventes':
      return state.ctx.salesXof;
    case 'pourboires':
      return state.ctx.tipsXof;
    case 'jours_absence':
      return state.ctx.unpaidLeaveDays;
    default:
      return 0;
  }
}

function applyTranches(value: number, tranches: RuleTier[]): { amount: number; detail: string } {
  const ordered = tranches
    .map((tier, index) => ({ ...tier, index }))
    .sort((a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY));
  let lower = 0;
  let amount = 0;
  const parts: string[] = [];
  for (const tier of ordered) {
    const upper = tier.upTo ?? value;
    if (value <= lower) break;
    const slice = Math.max(0, Math.min(value, upper) - lower);
    if (slice > 0 && tier.ratePercent > 0) {
      const part = (slice * tier.ratePercent) / 100;
      amount += part;
      parts.push(`${Math.round(slice)} × ${tier.ratePercent} %`);
    } else if (slice > 0) {
      parts.push(`${Math.round(slice)} × 0 %`);
    }
    lower = upper;
    if (tier.upTo === null) break;
  }
  return { amount, detail: parts.join(' + ') || 'assiette nulle' };
}

function describeAmount(rule: PayRule, value: number): string {
  switch (rule.kind) {
    case 'percent':
      return `${Math.round(value)} × ${rule.ratePercent ?? 0} %`;
    case 'amount':
      return `forfait ${Math.round(rule.rateXof ?? 0)} F`;
    case 'heures':
      return `${value} h × taux horaire × ${rule.multiplier ?? 1}`;
    case 'jours':
      return `${value} j × salaire de base × ${rule.ratePercent ?? 0} %`;
    case 'tranches':
      return 'barème progressif';
    default:
      return '';
  }
}

export function evaluateRules(rules: PayRule[], ctx: PayrollContext): PayrollComputation {
  const state = {
    baseSalaryXof: ctx.baseSalaryXof,
    workingDaysPerMonth: ctx.workingDaysPerMonth,
    brut: ctx.baseSalaryXof,
    brutImposable: ctx.baseSalaryXof,
    netImposable: ctx.baseSalaryXof,
    ctx,
  };
  const components: PayComponent[] = [];
  let cotisations = 0;
  let retenues = 0;
  let impots = 0;
  let avances = 0;

  for (const group of RULE_ORDER) {
    for (const rule of rules) {
      if (!rule.enabled || !group.includes(rule.type)) continue;
      const value = baseValue(rule.base, state);
      let amount = 0;
      if (rule.kind === 'percent') {
        amount = (value * (rule.ratePercent ?? 0)) / 100;
      } else if (rule.kind === 'amount') {
        amount = rule.rateXof ?? 0;
      } else if (rule.kind === 'heures') {
        const hourly = ctx.monthlyHours > 0 ? ctx.baseSalaryXof / ctx.monthlyHours : 0;
        amount = ctx.overtimeHours > 0 ? ctx.overtimeHours * hourly * (rule.multiplier ?? 1) : 0;
      } else if (rule.kind === 'jours') {
        amount = ((ctx.baseSalaryXof * (rule.ratePercent ?? 0)) / 100) * ctx.unpaidLeaveDays;
      } else if (rule.kind === 'tranches') {
        amount = applyTranches(Math.max(0, value), rule.tranches ?? []).amount;
      }
      let capApplied = false;
      if (rule.capXof !== undefined && rule.capXof !== null && amount > rule.capXof) {
        amount = rule.capXof;
        capApplied = true;
      }
      const rounded = round0(Math.max(0, amount));
      const operation =
        rule.kind === 'tranches' ? applyTranches(Math.max(0, value), rule.tranches ?? []).detail : describeAmount(rule, value);

      if (rule.type === 'prime' || rule.type === 'indemnite') {
        state.brut += rounded;
        if (rule.taxable) {
          state.brutImposable += rounded;
          state.netImposable += rounded;
        }
      } else if (rule.type === 'cotisation') {
        cotisations += rounded;
        if (rule.deductible) state.netImposable -= rounded;
      } else if (rule.type === 'retenue') {
        retenues += rounded;
        if (rule.deductible) state.netImposable -= rounded;
      } else if (rule.type === 'impot') {
        impots += rounded;
      } else if (rule.type === 'avance') {
        avances += rounded;
      }

      components.push({
        ruleId: rule.id,
        code: rule.code,
        label: rule.label,
        type: rule.type,
        kind: rule.kind,
        base: rule.base,
        baseValue: round0(value),
        operation,
        amountXof: rounded,
        capApplied,
        taxable: rule.taxable,
        deductible: rule.deductible,
      });
    }
  }

  const net = round0(Math.max(0, state.brut - cotisations - retenues - impots - avances));
  return {
    components,
    brutXof: round0(state.brut),
    brutImposableXof: round0(Math.max(0, state.brutImposable)),
    cotisationsXof: round0(cotisations),
    retenuesXof: round0(retenues),
    impotsXof: round0(impots),
    avancesXof: round0(avances),
    netXof: net,
  };
}

export interface RuleIssue {
  level: 'error' | 'warning';
  ruleId?: string;
  message: string;
}

export function validateRules(rules: PayRule[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (rules.length === 0) {
    issues.push({ level: 'error', message: 'Au moins une règle de paie est requise.' });
    return issues;
  }
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const rule of rules) {
    if (!rule.id || ids.has(rule.id)) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Identifiant de règle manquant ou dupliqué.' });
    }
    ids.add(rule.id);
    if (!rule.code || codes.has(rule.code)) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Code de règle manquant ou dupliqué.' });
    }
    codes.add(rule.code);
    if (!RULE_TYPES.includes(rule.type)) {
      issues.push({ level: 'error', ruleId: rule.id, message: `Type inconnu : ${String(rule.type)}.` });
    }
    if (!RULE_BASES.includes(rule.base)) {
      issues.push({ level: 'error', ruleId: rule.id, message: `Base inconnue : ${String(rule.base)}.` });
    }
    if (!RULE_KINDS.includes(rule.kind)) {
      issues.push({ level: 'error', ruleId: rule.id, message: `Mode de calcul inconnu : ${String(rule.kind)}.` });
    }
    if (rule.kind === 'percent' && (typeof rule.ratePercent !== 'number' || rule.ratePercent < 0)) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Un pourcentage positif est requis.' });
    }
    if ((rule.kind === 'amount' || rule.kind === 'tranches') && rule.kind === 'amount' && rule.rateXof === undefined) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Un montant forfaitaire (rateXof) est requis.' });
    }
    if (rule.kind === 'heures' && (typeof rule.multiplier !== 'number' || rule.multiplier <= 0)) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Un coefficient d’heures supplémentaires positif est requis.' });
    }
    if (rule.kind === 'jours' && (typeof rule.ratePercent !== 'number' || rule.ratePercent <= 0)) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Un pourcentage journalier positif est requis.' });
    }
    if (rule.kind === 'tranches') {
      const tranches = rule.tranches ?? [];
      if (tranches.length === 0) {
        issues.push({ level: 'error', ruleId: rule.id, message: 'Un barème par tranches est requis.' });
      }
      const sorted = [...tranches].sort(
        (a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY),
      );
      if (tranches[tranches.length - 1]?.upTo !== null) {
        issues.push({ level: 'error', ruleId: rule.id, message: 'La dernière tranche doit avoir upTo = null.' });
      }
      for (let index = 0; index < sorted.length; index += 1) {
        const tier = sorted[index];
        if (tier.ratePercent < 0 || tier.ratePercent > 100) {
          issues.push({ level: 'error', ruleId: rule.id, message: 'Chaque taux de tranche doit être compris entre 0 et 100 %.' });
        }
        if (index > 0 && tier.upTo !== null) {
          const previous = sorted[index - 1].upTo;
          if (previous !== null && tier.upTo <= previous) {
            issues.push({ level: 'error', ruleId: rule.id, message: 'Les bornes de tranches doivent être croissantes.' });
          }
        }
      }
    }
    if (rule.capXof !== undefined && rule.capXof !== null && rule.capXof < 0) {
      issues.push({ level: 'error', ruleId: rule.id, message: 'Un plafond négatif est invalide.' });
    }
    if (!rule.description || rule.description.trim().length < 10) {
      issues.push({ level: 'warning', ruleId: rule.id, message: 'Une description lisible par l’expert est recommandée.' });
    }
  }
  if (!rules.some((rule) => rule.enabled)) {
    issues.push({ level: 'error', message: 'Aucune règle active : la paie serait nulle.' });
  }
  if (!rules.some((rule) => rule.enabled && rule.type === 'cotisation')) {
    issues.push({ level: 'warning', message: 'Aucune cotisation sociale active pour cet établissement.' });
  }
  if (!rules.some((rule) => rule.enabled && rule.type === 'impot')) {
    issues.push({ level: 'warning', message: 'Aucun impôt sur le revenu actif pour cet établissement.' });
  }
  return issues;
}

/**
 * Jeu de règles par défaut (Togo / XOF), fourni à titre de configuration
 * initiale : chaque valeur est modifiable dans l’interface Paie et doit être
 * validée par un expert-comptable de l’établissement.
 */
export const PRESET_RULES: PayRule[] = [
  {
    id: 'rule_heures_sup',
    label: 'Heures supplémentaires (majoration 25 %)',
    code: 'HEURES_SUP',
    type: 'prime',
    enabled: true,
    taxable: true,
    deductible: false,
    base: 'heures_sup',
    kind: 'heures',
    multiplier: 1.25,
    description:
      'Heures pointées au-delà de 8 h par jour × taux horaire × 1,25. Taux horaire = salaire de base ÷ heures mensuelles (paramètre).',
    legalReference: 'Convention collective restauration — coefficient à valider par expert.',
  },
  {
    id: 'rule_prime_ventes',
    label: 'Prime de performance (0,5 % des ventes)',
    code: 'PRIME_VENTES',
    type: 'prime',
    enabled: true,
    taxable: true,
    deductible: false,
    base: 'ventes',
    kind: 'percent',
    ratePercent: 0.5,
    description: 'Prime mensuelle calculée sur les ventes attribuées au collaborateur par le service Salon.',
    legalReference: 'Politique interne — montant librement paramétrable.',
  },
  {
    id: 'rule_transport',
    label: 'Indemnité de transport',
    code: 'IND_TRANSPORT',
    type: 'indemnite',
    enabled: true,
    taxable: false,
    deductible: false,
    base: 'salaire_base',
    kind: 'amount',
    rateXof: 15000,
    description: 'Forfait mensuel exonéré d’impôt, à ajuster selon la politique de l’établissement.',
    legalReference: 'Barème interne — exonération à confirmer par expert.',
  },
  {
    id: 'rule_cnss',
    label: 'Cotisation CNSS salariale',
    code: 'CNSS_SAL',
    type: 'cotisation',
    enabled: true,
    taxable: false,
    deductible: true,
    base: 'brut_imposable',
    kind: 'percent',
    ratePercent: 4,
    capXof: 15000,
    description: 'Part salariale de la cotisation sociale, calculée sur le brut imposable, plafonnée.',
    legalReference: 'Loi n° 2019-014 (protection sociale) — taux à confirmer auprès de la CNSS.',
  },
  {
    id: 'rule_absence',
    label: 'Retenue absence non rémunérée',
    code: 'ABSENCE',
    type: 'retenue',
    enabled: true,
    taxable: false,
    deductible: false,
    base: 'jours_absence',
    kind: 'jours',
    ratePercent: 3.85,
    description: 'Salaire de base × 3,85 % par jour d’absence non payé (équivalent 1/26e).',
    legalReference: 'Politique interne — à valider selon le contrat de travail.',
  },
  {
    id: 'rule_irpp',
    label: 'IRPP — barème progressif',
    code: 'IRPP',
    type: 'impot',
    enabled: true,
    taxable: false,
    deductible: false,
    base: 'net_imposable',
    kind: 'tranches',
    tranches: [
      { upTo: 60000, ratePercent: 0 },
      { upTo: 200000, ratePercent: 3 },
      { upTo: null, ratePercent: 7 },
    ],
    description:
      'Barème progressif par tranches : 0–60 000 F à 0 %, 60 000–200 000 F à 3 %, au-delà à 7 %. Chaque borne et taux est modifiable.',
    legalReference: 'Barème indicatif — à valider par un expert-comptable togolais.',
  },
  {
    id: 'rule_avance',
    label: 'Avance sur salaire',
    code: 'AVANCE',
    type: 'avance',
    enabled: false,
    taxable: false,
    deductible: false,
    base: 'salaire_base',
    kind: 'amount',
    rateXof: 0,
    description: 'Avance mensuelle forfaitaire, désactivée par défaut. Préférer les variables par collaborateur.',
    legalReference: 'Politique interne.',
  },
];

export function cloneRules(rules: PayRule[] = PRESET_RULES): PayRule[] {
  return JSON.parse(JSON.stringify(rules)) as PayRule[];
}
