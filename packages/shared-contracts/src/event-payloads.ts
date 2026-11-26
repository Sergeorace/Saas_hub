import type { TableStatus } from './dto.js';
import type { DomainEventEnvelope } from './events.js';

export type OrderChannel = 'salle' | 'emporter' | 'livraison';

export type OrderCreatedPayload = {
  tenantId: string;
  orderId: string;
  number: string;
  channel: OrderChannel;
  tableCode: string | null;
  status: string;
};

export type OrderStatusChangedPayload = {
  tenantId: string;
  orderId: string;
  number: string;
  from: string;
  to: string;
  actorId: string;
};

export type OrderPaidPayload = {
  tenantId: string;
  orderId: string;
  number: string;
  invoiceNumber: string | null;
  method: string;
  amountXof: number;
  provider?: string;
};

export type PaymentFailedPayload = {
  tenantId: string;
  transactionId: string;
  orderId: string | null;
  amountXof: number;
  provider: string;
  reason: string;
};

export type TableStatusChangedPayload = {
  tenantId: string;
  tableId: string;
  code: string;
  zoneId: string | null;
  from: TableStatus;
  to: TableStatus;
  orderId: string | null;
  actorId: string;
  at: string;
};

export type ReservationCreatedPayload = {
  tenantId: string;
  reservationId: string;
  reference: string;
  date: string;
  time: string;
  partySize: number;
  tableId: string | null;
  tableCode: string | null;
  source: 'client' | 'salle';
  at: string;
};

export type PayrollApprovedPayload = {
  tenantId: string;
  runId: string;
  period: string;
  totalXof: number;
  headcount: number;
  approvedBy: string;
  preparedBy: string;
  at: string;
};

export type StockBelowThresholdPayload = {
  tenantId: string;
  itemId: string;
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
};

export type CatalogItemUpdatedPayload = {
  tenantId: string;
  itemType: string;
  itemId: string;
  change: 'created' | 'updated' | 'availability' | 'archived';
  at: string;
};

/**
 * Contrat de charge utile des événements imposés par le cahier des charges.
 * Les services producteurs doivent respecter cette forme ; les consommateurs
 * peuvent typer l'enveloppe avec `TypedDomainEvent`.
 */
export type DomainEventPayloads = {
  OrderCreated: OrderCreatedPayload;
  OrderStatusChanged: OrderStatusChangedPayload;
  OrderPaid: OrderPaidPayload;
  PaymentFailed: PaymentFailedPayload;
  TableStatusChanged: TableStatusChangedPayload;
  ReservationCreated: ReservationCreatedPayload;
  PayrollApproved: PayrollApprovedPayload;
  StockBelowThreshold: StockBelowThresholdPayload;
  CatalogItemUpdated: CatalogItemUpdatedPayload;
};

export type TypedDomainEvent<TName extends keyof DomainEventPayloads> = DomainEventEnvelope<
  DomainEventPayloads[TName]
> & { type: TName };
