import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface QrSheetEntry {
  code: string;
  zoneName: string;
  capacity: number;
  payload: string;
}

export interface QrSheetInput {
  establishmentCode: string;
  tenantId: string;
  tables: QrSheetEntry[];
}

export async function qrSvg(payload: string): Promise<Buffer> {
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1C1917', light: '#FFFFFF' },
  });
  return Buffer.from(svg, 'utf8');
}

export async function qrPng(payload: string, width = 512): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    margin: 1,
    width,
    errorCorrectionLevel: 'M',
    color: { dark: '#1C1917', light: '#FFFFFF' },
  });
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 32;
const COLUMNS = 3;
const ROWS = 4;
const CELL_WIDTH = (PAGE_WIDTH - MARGIN * 2) / COLUMNS;
const CELL_HEIGHT = (PAGE_HEIGHT - MARGIN * 2 - 40) / ROWS;
const QR_SIZE = 118;

export async function buildQrSheetPdf(input: QrSheetInput): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`QR plan de salle — ${input.establishmentCode}`);
  document.setAuthor('RESTO-HUB');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.1, 0.09);
  const muted = rgb(0.42, 0.39, 0.36);
  const accent = rgb(0.76, 0.25, 0.05);

  const perPage = COLUMNS * ROWS;
  const pages = Math.max(1, Math.ceil(input.tables.length / perPage));

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 34,
      width: PAGE_WIDTH,
      height: 34,
      color: rgb(0.98, 0.96, 0.93),
    });
    page.drawText('RESTO-HUB — QR des places', {
      x: MARGIN,
      y: PAGE_HEIGHT - 23,
      size: 11,
      font: bold,
      color: ink,
    });
    page.drawText(
      `Etablissement ${input.establishmentCode} · ${input.tables.length} place(s) · page ${pageIndex + 1}/${pages}`,
      {
        x: PAGE_WIDTH - MARGIN - 250,
        y: PAGE_HEIGHT - 22,
        size: 8,
        font,
        color: muted,
      },
    );

    const slice = input.tables.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    for (let index = 0; index < slice.length; index += 1) {
      const entry = slice[index];
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const cellX = MARGIN + column * CELL_WIDTH;
      const cellY = PAGE_HEIGHT - 34 - (row + 1) * CELL_HEIGHT;
      page.drawRectangle({
        x: cellX + 4,
        y: cellY + 4,
        width: CELL_WIDTH - 8,
        height: CELL_HEIGHT - 8,
        borderColor: rgb(0.9, 0.87, 0.83),
        borderWidth: 0.8,
      });
      try {
        const png = await document.embedPng(await qrPng(entry.payload, 400));
        page.drawImage(png, {
          x: cellX + (CELL_WIDTH - QR_SIZE) / 2,
          y: cellY + CELL_HEIGHT - QR_SIZE - 42,
          width: QR_SIZE,
          height: QR_SIZE,
        });
      } catch {
        page.drawText('QR indisponible', {
          x: cellX + 20,
          y: cellY + CELL_HEIGHT - 70,
          size: 9,
          font,
          color: muted,
        });
      }
      page.drawText(entry.code, {
        x: cellX + 14,
        y: cellY + 34,
        size: 11,
        font: bold,
        color: accent,
      });
      page.drawText(`${entry.zoneName} · ${entry.capacity} couvert(s)`, {
        x: cellX + 14,
        y: cellY + 20,
        size: 8,
        font,
        color: muted,
      });
    }
  }

  return document.save();
}
