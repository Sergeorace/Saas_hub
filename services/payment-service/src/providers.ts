import { createHash } from 'node:crypto';

export const PAYMENT_METHODS = ['mobile_money', 'carte'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ProviderId =
  | 'tmoney'
  | 'moov_money'
  | 'cinetpay'
  | 'paydunya'
  | 'fedapay'
  | 'paygate'
  | 'stripe';

export interface ProviderQuote {
  feeXof: number;
  percent: number;
  fixedXof: number;
}

export interface InitiationInput {
  intentId: string;
  amountXof: number;
  phone?: string;
  customerName?: string;
  method: PaymentMethod;
}

export interface InitiationResult {
  reference: string;
  instructions: string;
  requires3ds: boolean;
  threeDsUrl?: string;
  redirectUrl?: string;
}

export interface RefundInput {
  reference: string;
  amountXof: number;
}

/** Interface commune : un adaptateur par fournisseur (pattern adapter). */
export interface PaymentProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly methods: PaymentMethod[];
  readonly supports3ds: boolean;
  readonly envKey: string;
  readonly sandboxInstructions: string;
  isConfigured(keys: Record<string, string | undefined>): boolean;
  quote(amountXof: number): ProviderQuote;
  initiate(input: InitiationInput): InitiationResult;
  refund(input: RefundInput): { reference: string };
}

interface Descriptor {
  id: ProviderId;
  label: string;
  methods: PaymentMethod[];
  percent: number;
  fixedXof: number;
  supports3ds: boolean;
  envKey: string;
  instructions: string;
  prefix: string;
}

function sandboxReference(prefix: string, intentId: string): string {
  const digest = createHash('sha256').update(`${prefix}:${intentId}:${Date.now()}`).digest('hex').slice(0, 10);
  return `${prefix}_${digest.toUpperCase()}`;
}

/** Adaptateur simulé (sandbox) : aucune donnée de carte, aucun appel réseau. */
function makeSandboxAdapter(descriptor: Descriptor): PaymentProvider {
  return {
    id: descriptor.id,
    label: descriptor.label,
    methods: descriptor.methods,
    supports3ds: descriptor.supports3ds,
    envKey: descriptor.envKey,
    sandboxInstructions: descriptor.instructions,
    isConfigured(keys) {
      return Boolean(keys[descriptor.id]);
    },
    quote(amountXof) {
      const feeXof = Math.round((amountXof * descriptor.percent) / 100) + descriptor.fixedXof;
      return { feeXof, percent: descriptor.percent, fixedXof: descriptor.fixedXof };
    },
    initiate(input) {
      const reference = sandboxReference(descriptor.prefix, input.intentId);
      if (descriptor.supports3ds && input.method === 'carte') {
        return {
          reference,
          instructions: `${descriptor.label} — authentification 3-D Secure requise (sandbox).`,
          requires3ds: true,
          threeDsUrl: `https://sandbox.resto-hub.tg/3ds/${encodeURIComponent(reference)}`,
        };
      }
      return {
        reference,
        instructions: descriptor.instructions,
        requires3ds: false,
      };
    },
    refund(input) {
      return { reference: sandboxReference(`${descriptor.prefix}-REF`, input.reference) };
    },
  };
}

const DESCRIPTORS: Descriptor[] = [
  {
    id: 'tmoney',
    label: 'T-Money (Togocom)',
    methods: ['mobile_money'],
    percent: 1.5,
    fixedXof: 0,
    supports3ds: false,
    envKey: 'TMONEY_API_KEY',
    instructions: 'Sandbox T-Money : composez *844# puis validez avec le code de démonstration.',
    prefix: 'TMN',
  },
  {
    id: 'moov_money',
    label: 'Moov Money (Moov Africa)',
    methods: ['mobile_money'],
    percent: 1.5,
    fixedXof: 0,
    supports3ds: false,
    envKey: 'MOOV_MONEY_API_KEY',
    instructions: 'Sandbox Moov Money : composez *155# puis validez avec le code de démonstration.',
    prefix: 'MOOV',
  },
  {
    id: 'cinetpay',
    label: 'CinetPay',
    methods: ['mobile_money', 'carte'],
    percent: 2.5,
    fixedXof: 0,
    supports3ds: true,
    envKey: 'CINETPAY_API_KEY',
    instructions: 'Sandbox CinetPay : page de paiement hébergée, confirmation automatique.',
    prefix: 'CIN',
  },
  {
    id: 'paydunya',
    label: 'PayDunya',
    methods: ['mobile_money', 'carte'],
    percent: 2,
    fixedXof: 0,
    supports3ds: true,
    envKey: 'PAYDUNYA_API_KEY',
    instructions: 'Sandbox PayDunya : validation via l’application marchand de démonstration.',
    prefix: 'PYD',
  },
  {
    id: 'fedapay',
    label: 'FedaPay',
    methods: ['mobile_money', 'carte'],
    percent: 1.5,
    fixedXof: 0,
    supports3ds: true,
    envKey: 'FEDAPAY_API_KEY',
    instructions: 'Sandbox FedaPay : paiement mobile money simulé, notification signée.',
    prefix: 'FDP',
  },
  {
    id: 'paygate',
    label: 'PayGate',
    methods: ['mobile_money', 'carte'],
    percent: 1.8,
    fixedXof: 0,
    supports3ds: true,
    envKey: 'PAYGATE_API_KEY',
    instructions: 'Sandbox PayGate : redirection sécurisée puis retour marchand.',
    prefix: 'PGT',
  },
  {
    id: 'stripe',
    label: 'Stripe (optionnel)',
    methods: ['carte'],
    percent: 2.9,
    fixedXof: 100,
    supports3ds: true,
    envKey: 'STRIPE_SECRET_KEY',
    instructions: 'Sandbox Stripe : PaymentIntent carte avec 3-D Secure obligatoire.',
    prefix: 'STR',
  },
];

export const PROVIDERS: PaymentProvider[] = DESCRIPTORS.map(makeSandboxAdapter);

export function getProvider(id: string): PaymentProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export interface RouteCandidate {
  provider: ProviderId;
  label: string;
  feeXof: number;
  configured: boolean;
  available: boolean;
  reason?: string;
}

export interface RoutingDecision {
  chosen: PaymentProvider | null;
  candidates: RouteCandidate[];
  reason: string;
  switched: boolean;
}

export interface RoutingInput {
  method: PaymentMethod;
  amountXof: number;
  preferred?: string;
  health: Record<string, 'up' | 'down'>;
  keys: Record<string, string | undefined>;
}

/**
 * Routage par coût et disponibilité : le fournisseur préféré est retenu s'il est
 * disponible, sinon bascule automatique vers le moins cher des fournisseurs sains.
 */
export function routeProvider(input: RoutingInput): RoutingDecision {
  const candidates: RouteCandidate[] = PROVIDERS
    .filter((provider) => provider.methods.includes(input.method))
    .map((provider) => {
      const available = provider.isConfigured(input.keys) && input.health[provider.id] !== 'down';
      return {
        provider: provider.id,
        label: provider.label,
        feeXof: provider.quote(input.amountXof).feeXof,
        configured: provider.isConfigured(input.keys),
        available,
        reason: !provider.isConfigured(input.keys)
          ? 'Clé API absente (mode sandbox simulé)'
          : input.health[provider.id] === 'down'
            ? 'Fournisseur indisponible'
            : undefined,
      };
    })
    .sort((left, right) => left.feeXof - right.feeXof);

  const preferred = input.preferred ? getProvider(input.preferred) : undefined;
  if (preferred) {
    const row = candidates.find((candidate) => candidate.provider === preferred.id);
    if (row?.available) {
      return { chosen: preferred, candidates, reason: 'fournisseur préféré', switched: false };
    }
  }

  const best = candidates.find((candidate) => candidate.available);
  if (!best) {
    return { chosen: null, candidates, reason: 'aucun fournisseur disponible', switched: Boolean(preferred) };
  }
  const chosen = getProvider(best.provider) ?? null;
  return {
    chosen,
    candidates,
    reason: preferred && preferred.id !== best.provider
      ? `bascule automatique vers ${best.label} (frais les plus bas disponibles)`
      : 'frais les plus bas',
    switched: Boolean(preferred) && preferred?.id !== best.provider,
  };
}

export function providerFromReference(reference: string): ProviderId | undefined {
  const prefix = reference.split('_')[0];
  const byPrefix: Record<string, ProviderId> = {
    TMN: 'tmoney',
    MOOV: 'moov_money',
    CIN: 'cinetpay',
    PYD: 'paydunya',
    FDP: 'fedapay',
    PGT: 'paygate',
    STR: 'stripe',
  };
  return byPrefix[prefix];
}
