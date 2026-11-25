import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INK = rgb(0.13, 0.11, 0.1);
const MUTED = rgb(0.42, 0.38, 0.35);
const ACCENT = rgb(0.85, 0.42, 0.16);
const LINE = rgb(0.88, 0.85, 0.82);
const ZEBRA = rgb(0.97, 0.95, 0.93);

export interface PdfReportInput {
  title: string;
  subtitle: string;
  tenantName: string;
  periodLabel: string;
  generatedAt: string;
  kpis: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
  note?: string;
}

function ascii(value: string): string {
  return value
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/\u2192/g, '->')
    .replace(/[^\x00-\xFF\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u20ac\u0153\u0152]/g, '?');
}

function stamp(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Lome',
  }).format(new Date(iso));
}

type Page = ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>['addPage']>;

function text(page: Page, value: string, options: Parameters<Page['drawText']>[1]): void {
  page.drawText(ascii(value), options);
}

export async function reportPdf(input: PdfReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 44;
  const width = 595;
  const height = 842;
  let page = doc.addPage([width, height]);
  let y = height - 56;

  const header = () => {
    text(page, 'RESTO-HUB', { x: margin, y, size: 18, font: bold, color: ACCENT });
    text(page, input.title, { x: margin, y: y - 20, size: 13, font: bold, color: INK });
    text(page, input.subtitle, { x: margin, y: y - 36, size: 9, font, color: MUTED });
    text(page, input.tenantName, { x: 360, y, size: 10, font: bold, color: INK });
    text(page, input.periodLabel, { x: 360, y: y - 15, size: 9, font, color: INK });
    text(page, `Édité le ${stamp(input.generatedAt)}`, { x: 360, y: y - 29, size: 8, font, color: MUTED });
    y -= 54;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: LINE });
    y -= 22;
  };
  header();

  if (input.kpis.length > 0) {
    const cellWidth = (width - 2 * margin) / 2;
    input.kpis.slice(0, 8).forEach((kpi, index) => {
      const column = index % 2;
      if (column === 0 && index > 0) y -= 26;
      const x = margin + column * cellWidth;
      text(page, kpi.label, { x, y, size: 8, font, color: MUTED });
      text(page, kpi.value, { x, y: y - 12, size: 11, font: bold, color: INK });
    });
    y -= 34;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: LINE });
    y -= 20;
  }

  const tableWidth = width - 2 * margin;
  const columnWidth = tableWidth / input.columns.length;
  const drawHeaderRow = () => {
    text(page, input.columns[0] ?? '', { x: margin + 4, y, size: 8, font: bold, color: MUTED });
    input.columns.slice(1).forEach((column, index) => {
      text(page, column, {
        x: margin + columnWidth * (index + 1) + 4,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
    });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: LINE });
    y -= 14;
  };
  drawHeaderRow();

  const newPage = () => {
    page = doc.addPage([width, height]);
    y = height - 56;
    header();
    drawHeaderRow();
  };

  input.rows.forEach((row, rowIndex) => {
    if (y < 70) newPage();
    if (rowIndex % 2 === 1) {
      page.drawRectangle({
        x: margin - 2,
        y: y - 4,
        width: tableWidth + 4,
        height: 15,
        color: ZEBRA,
      });
    }
    row.forEach((cell, index) => {
      text(page, cell, {
        x: margin + columnWidth * index + 4,
        y,
        size: 8,
        font: index === 0 ? bold : font,
        color: INK,
      });
    });
    y -= 15;
  });

  if (input.note) {
    if (y < 90) newPage();
    y -= 10;
    text(page, input.note, { x: margin, y, size: 8, font, color: MUTED });
  }

  text(page, 'Document généré automatiquement par RESTO-HUB — devise XOF.', {
    x: margin,
    y: 38,
    size: 7,
    font,
    color: MUTED,
  });
  return doc.save();
}
