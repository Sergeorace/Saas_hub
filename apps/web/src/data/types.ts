import type { IconName, TableStatus } from '@resto-hub/design-system';

export interface TableInfo {
  id: string;
  zone: 'room' | 'terrace' | 'bar';
  seats: number;
  status: TableStatus;
  guests?: number;
  waiter?: string;
  total?: number;
}

export type OrderStatus = 'kitchen' | 'ready' | 'served' | 'paid';

export interface OrderRow {
  id: string;
  table: string;
  items: number;
  total: number;
  status: OrderStatus;
  time: string;
}

export interface ServiceItem {
  key: string;
  name: string;
  description: string;
  icon: IconName;
  port: string;
  group: 'core' | 'people' | 'growth' | 'platform';
  event: string;
}

export interface JourneyItem {
  key: string;
  role: string;
  title: string;
  description: string;
  icon: IconName;
  steps: string[];
  metric: string;
}

export interface DemoMenuItem {
  name: string;
  meta: string;
  price: number;
}

export interface ProviderItem {
  name: string;
  note: string;
}

export interface PaymentFeature {
  title: string;
  description: string;
  icon: IconName;
}

export interface PlanItem {
  key: string;
  name: string;
  price: number | null;
  tagline: string;
  features: string[];
  cta: string;
  badge?: string;
  commission: string;
}
