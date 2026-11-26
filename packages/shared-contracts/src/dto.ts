export const TABLE_STATUSES = [
  'libre',
  'reservee',
  'occupee',
  'addition',
  'nettoyage',
  'hors_service',
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const ORDER_STATUSES = ['recue', 'en_preparation', 'prete', 'servie', 'annulee'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['especes', 'mobile_money', 'carte'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRANSACTION_STATUSES = [
  'en_attente',
  'confirmee',
  'echouee',
  'expiree',
  'annulee',
  'remboursee_partielle',
  'remboursee',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const DISPUTE_STATUSES = ['ouverte', 'en_examen', 'resolue', 'rejetee'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_CURRENCY = 'XOF' as const;
export type CurrencyCode = typeof DEFAULT_CURRENCY;

export interface MoneyXof {
  amountXof: number;
}

export interface DateRangeQuery {
  from: string;
  to: string;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function isMoneyXof(value: unknown): value is MoneyXof {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger((value as MoneyXof).amountXof) &&
    (value as MoneyXof).amountXof >= 0
  );
}
