import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PaymentTransaction } from './store.js';

const STATUS_LABEL: Record<string, string> = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  echouee: 'Échouée',
  expiree: 'Expirée',
  annulee: 'Annulée',
  remboursee_partielle: 'Remboursée partiellement',
  remboursee: 'Remboursée',
};

const METHOD_LABEL: Record<string, string> = {
  mobile_money: 'Mobile Money',
  carte: 'Carte bancaire',
  especes: 'Espèces (caisse)',
};

function dateFr(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Lome',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function header(): string[] {
  return [
    'ID',
    'Date',
    'Commande',
    'Moyen',
    'Fournisseur',
    'Statut',
    'Montant XOF',
    'Frais fournisseur',
    'Commission',
    'Net établissement',
    'Remboursé',
  ];
}

function row(transaction: PaymentTransaction): string[] {
  return [
    transaction.id,
    dateFr(transaction.confirmedAt ?? transaction.createdAt),
    transaction.orderNumber ?? transaction.orderId ?? '—',
    METHOD_LABEL[transaction.method] ?? transaction.method,
    transaction.provider,
    STATUS_LABEL[transaction.status] ?? transaction.status,
    String(transaction.amountXof),
    String(transaction.fees.providerFeeXof),
    String(transaction.fees.commissionXof),
    String(transaction.fees.netXof),
    String(transaction.refundedXof),
  ];
}

function csvCell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV compatible Excel (BOM UTF-8, séparateur point-virgule). */
export function transactionsCsv(items: PaymentTransaction[]): string {
  const lines = [header(), ...items.map(row)].map((cells) => cells.map(csvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Classeur Excel (SpreadsheetML 2003, ouvert nativement par Excel). */
export function transactionsXls(items: PaymentTransaction[], sheetName = 'Transactions'): string {
  const cell = (value: string, style?: string) =>
    `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  const headerRow = `<Row>${header()
    .map((value) => cell(value, 'head'))
    .join('')}</Row>`;
  const rows = items
    .map((transaction) => {
      const cells = row(transaction);
      return `<Row>${cells.map((value, index) => cell(value, index >= 6 && index <= 10 ? 'num' : undefined)).join('')}</Row>`;
    })
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#FDE8D7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="num"><NumberFormat ss:Format="#,##0"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(sheetName.slice(0, 31))}">
  <Table>
   ${headerRow}${rows}
  </Table>
 </Worksheet>
</Workbook>`;
}

/** PDF paysage A4 : synthèse + 40 premières transactions. */
export async function transactionsPdf(
  items: PaymentTransaction[],
  meta: { tenantName: string; generatedAt: string; walletAvailableXof: number; currency: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([842, 595]);
  const ink = rgb(0.12, 0.1, 0.09);
  const muted = rgb(0.42, 0.4, 0.38);
  const accent = rgb(0.76, 0.25, 0.05);
  const xof = (value: number) =>
    `${value.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} F CFA`;

  let y = 560;
  page.drawText('RESTO-HUB — Journal des transactions', {
    x: 40,
    y,
    size: 16,
    font: bold,
    color: ink,
  });
  y -= 20;
  page.drawText(`${meta.tenantName} · export du ${dateFr(meta.generatedAt)}`, {
    x: 40,
    y,
    size: 10,
    font,
    color: muted,
  });
  y -= 16;
  page.drawText(
    `Solde disponible : ${xof(meta.walletAvailableXof)} · ${items.length} transaction(s)`,
    {
      x: 40,
      y,
      size: 10,
      font,
      color: accent,
    },
  );
  y -= 28;

  const columns: Array<{ label: string; x: number; width: number; align?: 'right' }> = [
    { label: 'Date', x: 40, width: 90 },
    { label: 'Commande', x: 134, width: 120 },
    { label: 'Moyen', x: 258, width: 70 },
    { label: 'Fournisseur', x: 332, width: 70 },
    { label: 'Statut', x: 406, width: 90 },
    { label: 'Montant', x: 500, width: 80, align: 'right' },
    { label: 'Frais', x: 584, width: 60, align: 'right' },
    { label: 'Commission', x: 648, width: 70, align: 'right' },
    { label: 'Net', x: 722, width: 80, align: 'right' },
  ];

  for (const column of columns) {
    page.drawText(column.label, { x: column.x, y, size: 8, font: bold, color: muted });
  }
  y -= 6;
  page.drawLine({
    start: { x: 40, y },
    end: { x: 802, y },
    thickness: 0.6,
    color: rgb(0.8, 0.77, 0.74),
  });
  y -= 14;

  for (const transaction of items.slice(0, 40)) {
    const cells = [
      dateFr(transaction.createdAt).slice(0, 16),
      (transaction.orderNumber ?? '—').slice(0, 20),
      METHOD_LABEL[transaction.method] ?? transaction.method,
      transaction.provider,
      STATUS_LABEL[transaction.status] ?? transaction.status,
      xof(transaction.amountXof),
      xof(transaction.fees.providerFeeXof),
      xof(transaction.fees.commissionXof),
      xof(transaction.fees.netXof),
    ];
    cells.forEach((value, index) => {
      const column = columns[index];
      const size = 7.5;
      const text = value.length > 26 ? `${value.slice(0, 25)}…` : value;
      const width = font.widthOfTextAtSize(text, size);
      const x = column.align === 'right' ? column.x + column.width - width : column.x;
      page.drawText(text, { x, y, size, font, color: ink });
    });
    y -= 12;
    if (y < 50) break;
  }

  page.drawText('Document généré par payment-service — aucune donnée de carte stockée.', {
    x: 40,
    y: 30,
    size: 7,
    font,
    color: muted,
  });
  return doc.save();
}
