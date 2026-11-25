import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Order } from './store.js';

export interface ReceiptInput {
  order: Order;
  tenantName: string;
  tenantAddress?: string;
  printedAt: string;
}

const CHANNEL_LABEL: Record<Order['channel'], string> = {
  sur_place: 'Sur place',
  a_emporter: 'À emporter',
  livraison: 'Livraison',
  precommande: 'Précommande',
};

const METHOD_LABEL: Record<string, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  carte: 'Carte bancaire',
};

function xof(value: number): string {
  return `${value.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} F CFA`;
}

function dateFr(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Lome',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export async function buildReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  const { order, tenantName, tenantAddress, printedAt } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = 226;
  const lineCount = order.lines.reduce((sum, line) => sum + 1 + (line.options.length > 0 ? 1 : 0), 0);
  const height = Math.max(420, 250 + lineCount * 14);
  const page = doc.addPage([width, height]);
  const ink = rgb(0.12, 0.1, 0.09);
  const muted = rgb(0.42, 0.4, 0.38);
  const accent = rgb(0.76, 0.25, 0.05);
  let y = height - 24;

  const text = (value: string, size: number, options: { bold?: boolean; color?: typeof ink; align?: 'left' | 'right'; x?: number } = {}) => {
    const usedFont = options.bold ? bold : font;
    const usedSize = size;
    const usedWidth = usedFont.widthOfTextAtSize(value, usedSize);
    const x = options.align === 'right' ? width - 16 - usedWidth : options.x ?? 16;
    page.drawText(value, { x, y, size: usedSize, font: usedFont, color: options.color ?? ink });
  };

  text(tenantName, 13, { bold: true });
  y -= 14;
  if (tenantAddress) {
    text(tenantAddress, 7, { color: muted });
    y -= 10;
  }
  text('Reçu / facture simplifiée', 7, { color: muted });
  y -= 14;
  page.drawLine({ start: { x: 16, y }, end: { x: width - 16, y }, thickness: 1, color: accent });

  y -= 14;
  text(`N° ${order.invoiceNumber ?? order.number}`, 8, { bold: true });
  text(order.number, 7, { color: muted, align: 'right' });
  y -= 11;
  text(dateFr(printedAt), 7, { color: muted });
  y -= 11;
  text(
    order.channel === 'sur_place' && order.tableCode ? `${CHANNEL_LABEL[order.channel]} · ${order.tableCode}` : CHANNEL_LABEL[order.channel],
    7,
    { color: muted },
  );
  if (order.customer?.name) {
    y -= 11;
    text(`Client : ${order.customer.name}`, 7, { color: muted });
  }

  y -= 14;
  page.drawLine({ start: { x: 16, y }, end: { x: width - 16, y }, thickness: 0.5, color: rgb(0.82, 0.8, 0.78) });
  y -= 12;

  for (const line of order.lines) {
    text(`${line.quantity} × ${line.productName}${line.variantName ? ` (${line.variantName})` : ''}`, 8);
    text(xof(line.lineTotalXof), 8, { align: 'right' });
    y -= 11;
    if (line.options.length > 0) {
      text(line.options.map((option) => option.name).join(', '), 6.5, { color: muted, x: 22 });
      y -= 9;
    }
    if (line.notes) {
      text(`« ${line.notes} »`, 6.5, { color: muted, x: 22 });
      y -= 9;
    }
  }

  y -= 4;
  page.drawLine({ start: { x: 16, y }, end: { x: width - 16, y }, thickness: 0.5, color: rgb(0.82, 0.8, 0.78) });
  y -= 12;

  text('Sous-total', 7.5, { color: muted });
  text(xof(order.subtotalXof), 7.5, { align: 'right' });
  y -= 10;
  if (order.discount) {
    text(`Remise (${order.discount.reason})`, 7.5, { color: muted });
    text(`-${xof(order.discount.amountXof)}`, 7.5, { align: 'right' });
    y -= 10;
  }
  if (order.deliveryFeeXof > 0) {
    text('Frais de livraison', 7.5, { color: muted });
    text(xof(order.deliveryFeeXof), 7.5, { align: 'right' });
    y -= 10;
  }
  text(`TVA ${Math.round(order.taxRate * 100)} %`, 7.5, { color: muted });
  text(xof(order.taxXof), 7.5, { align: 'right' });
  y -= 10;
  text('Net HT', 7.5, { color: muted });
  text(xof(order.netXof), 7.5, { align: 'right' });
  y -= 14;
  text('TOTAL TTC', 10, { bold: true });
  text(xof(order.totalXof), 10, { bold: true, align: 'right' });
  y -= 18;

  const paid = order.payments.reduce((sum, payment) => sum + payment.amountXof, 0);
  for (const payment of order.payments) {
    text(METHOD_LABEL[payment.method] ?? payment.method, 7.5, { color: muted });
    text(xof(payment.amountXof), 7.5, { align: 'right' });
    y -= 10;
  }
  if (order.paymentStatus !== 'payee') {
    text('Reste à payer', 8, { bold: true });
    text(xof(order.totalXof - paid), 8, { bold: true, align: 'right' });
    y -= 10;
  }

  y -= 6;
  page.drawLine({ start: { x: 16, y }, end: { x: width - 16, y }, thickness: 0.5, color: rgb(0.82, 0.8, 0.78) });
  y -= 12;
  text('Merci de votre visite !', 7.5, { color: muted });
  y -= 9;
  text('RESTO-HUB · paiement sécurisé, aucune carte stockée.', 6, { color: muted });

  return doc.save();
}
