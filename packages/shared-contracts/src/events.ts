export const REQUIRED_DOMAIN_EVENTS = [
  'OrderCreated',
  'OrderStatusChanged',
  'OrderPaid',
  'PaymentFailed',
  'TableStatusChanged',
  'ReservationCreated',
  'PayrollApproved',
  'StockBelowThreshold',
  'CatalogItemUpdated',
] as const;

export const DOMAIN_EVENTS = [
  ...REQUIRED_DOMAIN_EVENTS,
  'AttendanceClocked',
  'CampaignSent',
  'DisbursementPaid',
  'DisputeOpened',
  'DisputeResolved',
  'FloorLayoutUpdated',
  'FloorOrderTransferred',
  'FloorTablesMerged',
  'FloorTablesSplit',
  'LeaveDecided',
  'LoyaltyPointsEarned',
  'LoyaltyRewardRedeemed',
  'PaymentCancelled',
  'PaymentConfirmed',
  'PaymentInitiated',
  'PayrollPaid',
  'PayrollPaymentFailed',
  'PayrollRunCreated',
  'PayrollSettingsUpdated',
  'PayslipsSent',
  'PlatformSettingsUpdated',
  'PromoCodeRedeemed',
  'PromotionCreated',
  'ReconciliationCompleted',
  'RefundIssued',
  'ReportExported',
  'ReservationStatusChanged',
  'ReviewModerated',
  'ReviewReplied',
  'ReviewSubmitted',
  'SettlementPaid',
  'SettlementRequested',
  'ShiftPublished',
  'ShiftSwapDecided',
  'SmsDeliveryReported',
  'SplitCompleted',
  'StaffActivated',
  'StaffInvited',
  'StaffUpdated',
  'StockDepleted',
  'StockReplenished',
  'SubscriptionInvoicePaid',
  'TenantApplicationInfoRequested',
  'TenantApplicationRejected',
  'TenantApplicationSubmitted',
  'TenantApproved',
  'TenantBrandingUpdated',
  'TenantReactivated',
  'TenantSuspended',
  'TipDistributed',
  'WasteRecorded',
] as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[number];
export type RequiredDomainEventName = (typeof REQUIRED_DOMAIN_EVENTS)[number];

export interface DomainEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  type: DomainEventName;
  tenantId: string | null;
  occurredAt: string;
  payload: TPayload;
}

const DOMAIN_EVENT_SET: ReadonlySet<string> = new Set(DOMAIN_EVENTS);

export function isDomainEventName(value: string): value is DomainEventName {
  return DOMAIN_EVENT_SET.has(value);
}

export function isDomainEventEnvelope(value: unknown): value is DomainEventEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.type === 'string' &&
    isDomainEventName(candidate.type) &&
    (candidate.tenantId === null || typeof candidate.tenantId === 'string') &&
    typeof candidate.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.occurredAt)) &&
    !!candidate.payload &&
    typeof candidate.payload === 'object' &&
    !Array.isArray(candidate.payload)
  );
}
