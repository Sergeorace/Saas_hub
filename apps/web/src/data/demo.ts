import type { TableInfo, OrderRow } from './types';

export const kpis = {
  revenue: 486500,
  averageTicket: 9180,
  tickets: 53,
  occupancyRate: 0.78,
  revenueDelta: 0.124,
  averageDelta: 0.031,
  ticketsDelta: 0.087,
  occupancyDelta: 0.06,
};

export const tables: TableInfo[] = [
  { id: 'T01', zone: 'terrace', seats: 4, status: 'free' },
  {
    id: 'T02',
    zone: 'terrace',
    seats: 2,
    status: 'occupied',
    guests: 2,
    waiter: 'Awa',
    total: 18500,
  },
  {
    id: 'T03',
    zone: 'room',
    seats: 4,
    status: 'occupied',
    guests: 4,
    waiter: 'Mariam',
    total: 24500,
  },
  {
    id: 'T04',
    zone: 'room',
    seats: 2,
    status: 'bill',
    guests: 2,
    waiter: 'Kossi',
    total: 12800,
  },
  { id: 'T05', zone: 'room', seats: 6, status: 'reserved', guests: 6, waiter: 'Kossi' },
  {
    id: 'T06',
    zone: 'bar',
    seats: 2,
    status: 'occupied',
    guests: 2,
    waiter: 'Awa',
    total: 9200,
  },
  { id: 'T07', zone: 'terrace', seats: 4, status: 'cleaning' },
  { id: 'T08', zone: 'room', seats: 8, status: 'out' },
  {
    id: 'T09',
    zone: 'bar',
    seats: 4,
    status: 'occupied',
    guests: 3,
    waiter: 'Mariam',
    total: 21000,
  },
  { id: 'T10', zone: 'terrace', seats: 2, status: 'free' },
];

export const revenueSeries = [
  { day: 0, amount: 312000 },
  { day: 1, amount: 358000 },
  { day: 2, amount: 402000 },
  { day: 3, amount: 296000 },
  { day: 4, amount: 451000 },
  { day: 5, amount: 638000 },
  { day: 6, amount: 486500 },
];

export const orders: OrderRow[] = [
  { id: 'CMD-1048', table: 'T03', items: 5, total: 24500, status: 'served', time: '20:58' },
  { id: 'CMD-1049', table: 'T06', items: 2, total: 9200, status: 'ready', time: '21:01' },
  { id: 'CMD-1050', table: 'T02', items: 3, total: 18500, status: 'kitchen', time: '21:03' },
  { id: 'CMD-1047', table: 'T04', items: 4, total: 12800, status: 'paid', time: '20:47' },
  { id: 'CMD-1046', table: 'T09', items: 6, total: 21000, status: 'paid', time: '20:40' },
];

export const eventFeed = [
  {
    id: 'e1',
    name: 'OrderPaid',
    detail: 'CMD-1046 · T09 · 21 000 FCFA',
    time: '20:40',
    tone: 'success',
  },
  { id: 'e2', name: 'OrderCreated', detail: 'CMD-1049 · T06 · 2', time: '21:01', tone: 'primary' },
  {
    id: 'e3',
    name: 'TableStatusChanged',
    detail: 'T04 → bill_requested',
    time: '21:02',
    tone: 'info',
  },
  {
    id: 'e4',
    name: 'StockBelowThreshold',
    detail: 'SKU-RHUM-ARR · 4',
    time: '20:56',
    tone: 'warning',
  },
  {
    id: 'e5',
    name: 'PayrollApproved',
    detail: 'payroll-2026-11 · 12',
    time: '20:40',
    tone: 'accent',
  },
] as const;

export const auditTrail = [
  {
    id: 'a1',
    action: 'commands:refund',
    detail: 'CMD-1031 · 4 500 FCFA',
    who: 'Mariam K.',
    time: '21:03',
  },
  {
    id: 'a2',
    action: 'prices:update',
    detail: 'Cocktail Hibiscus · 3 500 → 3 800',
    who: 'Akouvi D.',
    time: '19:44',
  },
  {
    id: 'a3',
    action: 'payroll:approve',
    detail: 'Lot novembre · 2 840 000 FCFA',
    who: 'Akouvi D.',
    time: '19:12',
  },
];
