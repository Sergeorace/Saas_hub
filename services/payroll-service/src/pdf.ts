import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { periodLabel, type PayrollRun, type Payslip } from './store.js';

const INK = rgb(0.13, 0.11, 0.1);
const MUTED = rgb(0.42, 0.38, 0.35);
const ACCENT = rgb(0.85, 0.42, 0.16);
const LINE = rgb(0.88, 0.85, 0.82);

function xof(value: number): string {
  const formatted = new Intl.NumberFormat('fr-FR').format(Math.round(value));
  return `${formatted.replace(/[\u202f\u00a0]/g, ' ')} F CFA`;
}

function stamp(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Lome',
  }).format(new Date(iso));
}

const TYPE_LABEL: Record<string, string> = {
  prime: 'Prime',
  indemnite: 'Indemnité',
  cotisation: 'Cotisation',
  retenue: 'Retenue',
  impot: 'Impôt',
  avance: 'Avance',
};

type DrawPage = ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>['addPage']>;

/** Les polices standard PDF n’acceptent pas les espaces fines produits par Intl. */
function text(page: DrawPage, value: string, options: Parameters<DrawPage['drawText']>[1]): void {
  page.drawText(value.replace(/[\u202f\u00a0]/g, ' '), options);
}

export async function payslipPdf(
  payslip: Payslip,
  meta: { tenantName: string; period: string; generatedAt: string; archivedReference: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const margin = 46;
  let y = 790;

  text(page, 'RESTO-HUB', { x: margin, y, size: 20, font: bold, color: ACCENT });
  text(page, 'Bulletin de paie', { x: margin, y: y - 22, size: 13, font: bold, color: INK });
  text(page, meta.tenantName, { x: margin, y: y - 40, size: 10, font, color: MUTED });
  text(page, `Période : ${periodLabel(meta.period)}`, { x: 380, y, size: 10, font, color: INK });
  text(page, `Édité le ${stamp(meta.generatedAt)}`, { x: 380, y: y - 16, size: 9, font, color: MUTED });
  text(page, `Réf. archive : ${meta.archivedReference}`, { x: 380, y: y - 30, size: 8, font, color: MUTED });
  y -= 64;
  page.drawLine({ start: { x: margin, y }, end: { x: 549, y }, thickness: 1, color: LINE });

  y -= 26;
  text(page, payslip.name, { x: margin, y, size: 14, font: bold, color: INK });
  text(page, `${payslip.jobTitle} — contrat ${payslip.contractType.toUpperCase()}`, {
    x: margin, y: y - 15, size: 9, font, color: MUTED,
  });
  const payment =
    payslip.paymentMethod === 'bank'
      ? `Virement : ${payslip.paymentDestination}`
      : payslip.paymentMethod === 'cash'
        ? 'Paiement en espèces (caisse)'
        : `Mobile Money : ${payslip.paymentDestination}`;
  text(page, payment, { x: 300, y, size: 9, font, color: MUTED });
  text(page, `Salaire de base : ${xof(payslip.baseSalaryXof)}`, { x: 300, y: y - 15, size: 9, font, color: MUTED });

  y -= 42;
  text(page, 'Éléments de rémunération', { x: margin, y, size: 11, font: bold, color: INK });
  y -= 18;
  text(page, 'Libellé', { x: margin, y, size: 9, font: bold, color: MUTED });
  text(page, 'Base', { x: 300, y, size: 9, font: bold, color: MUTED });
  text(page, 'Opération', { x: 350, y, size: 9, font: bold, color: MUTED });
  text(page, 'Montant', { x: 480, y, size: 9, font: bold, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: 549, y }, thickness: 0.7, color: LINE });
  y -= 14;

  for (const component of payslip.components) {
    if (component.amountXof === 0 && component.type !== 'prime' && component.type !== 'indemnite') continue;
    const label = `${component.label}`.slice(0, 46);
    text(page, label, { x: margin, y, size: 8.5, font, color: INK });
    text(page, TYPE_LABEL[component.type] ?? component.type, { x: 300, y, size: 8, font, color: MUTED });
    text(page, component.operation.slice(0, 30), { x: 350, y, size: 8, font, color: MUTED });
    text(page, `${component.type === 'prime' || component.type === 'indemnite' ? '+' : '-'} ${xof(component.amountXof)}`, {
      x: 480, y, size: 8.5, font, color: INK,
    });
    y -= 15;
    if (y < 240) break;
  }

  if (payslip.components.length === 0) {
    text(page, 'Aucun élément variable ce mois-ci.', { x: margin, y, size: 9, font, color: MUTED });
    y -= 16;
  }

  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: 549, y }, thickness: 0.7, color: LINE });
  y -= 20;

  const summary: Array<[string, number]> = [
    ['Salaire brut', payslip.brutXof],
    ['Brut imposable', payslip.brutImposableXof],
    ['Cotisations sociales', -payslip.cotisationsXof],
    ['Retenues', -payslip.retenuesXof],
    ['Impôt sur le revenu', -payslip.impotsXof],
    ['Avances', -payslip.avancesXof],
  ];
  for (const [label, value] of summary) {
    text(page, label, { x: 330, y, size: 9.5, font, color: INK });
    text(page, value === summary[0][1] || value >= 0 ? xof(Math.abs(value)) : `- ${xof(Math.abs(value))}`, {
      x: 470, y, size: 9.5, font, color: value < 0 ? rgb(0.65, 0.22, 0.15) : INK,
    });
    y -= 15;
  }
  y -= 6;
  page.drawRectangle({ x: 320, y: y - 8, width: 229, height: 30, color: rgb(0.99, 0.94, 0.9) });
  text(page, 'NET À PAYER', { x: 330, y, size: 10, font: bold, color: INK });
  text(page, xof(payslip.netXof), { x: 450, y, size: 11, font: bold, color: ACCENT });

  text(page, 
    'Document généré automatiquement par RESTO-HUB et archivé. Les règles de calcul sont paramétrables et consultables dans le module Paie.',
    { x: margin, y: 60, size: 7.5, font, color: MUTED, maxWidth: 500 },
  );
  text(page, 
    `Pointage : ${payslip.daysPresent} jours — Heures : ${payslip.hoursWorked} h — Heures sup. : ${payslip.overtimeHours} h — Absences non payées : ${payslip.unpaidLeaveDays} j`,
    { x: margin, y: 80, size: 8, font, color: MUTED, maxWidth: 500 },
  );
  return doc.save();
}

export async function payrollJournalPdf(
  run: PayrollRun,
  meta: { tenantName: string; generatedAt: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([842, 595]);
  const margin = 40;
  let y = 545;

  text(page, 'RESTO-HUB', { x: margin, y, size: 18, font: bold, color: ACCENT });
  text(page, `Journal de paie — ${periodLabel(run.period)}`, { x: margin, y: y - 20, size: 12, font: bold, color: INK });
  text(page, meta.tenantName, { x: margin, y: y - 36, size: 9, font, color: MUTED });
  text(page, `Statut : ${run.status} — Édité le ${stamp(meta.generatedAt)}`, { x: 560, y, size: 9, font, color: MUTED });

  y -= 64;
  const columns: Array<[string, number]> = [
    ['Collaborateur', 40],
    ['Poste', 190],
    ['Brut', 330],
    ['Cotisations', 410],
    ['Retenues', 485],
    ['Impôt', 560],
    ['Net', 640],
    ['Moyen', 720],
  ];
  for (const [label, x] of columns) text(page, label, { x, y, size: 8.5, font: bold, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: 802, y }, thickness: 0.7, color: LINE });
  y -= 14;

  for (const line of run.payslips) {
    text(page, line.name.slice(0, 26), { x: 40, y, size: 8.5, font, color: INK });
    text(page, line.jobTitle.slice(0, 22), { x: 190, y, size: 8.5, font, color: MUTED });
    text(page, xof(line.brutXof), { x: 330, y, size: 8.5, font, color: INK });
    text(page, xof(line.cotisationsXof), { x: 410, y, size: 8.5, font, color: INK });
    text(page, xof(line.retenuesXof + line.avancesXof), { x: 485, y, size: 8.5, font, color: INK });
    text(page, xof(line.impotsXof), { x: 560, y, size: 8.5, font, color: INK });
    text(page, xof(line.netXof), { x: 640, y, size: 8.5, font: bold, color: INK });
    text(page, line.paymentMethod === 'bank' ? 'Virement' : line.paymentMethod === 'cash' ? 'Espèces' : 'Mobile', {
      x: 720, y, size: 8, font, color: MUTED,
    });
    y -= 14;
    if (y < 80) break;
  }

  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: 802, y }, thickness: 0.7, color: LINE });
  y -= 16;
  text(page, `Effectif : ${run.totals.headcount}`, { x: 40, y, size: 9, font: bold, color: INK });
  text(page, `Brut : ${xof(run.totals.brutXof)}`, { x: 180, y, size: 9, font, color: INK });
  text(page, `Cotisations : ${xof(run.totals.cotisationsXof)}`, { x: 340, y, size: 9, font, color: INK });
  text(page, `Impôts : ${xof(run.totals.impotsXof)}`, { x: 500, y, size: 9, font, color: INK });
  text(page, `Net total : ${xof(run.totals.netXof)}`, { x: 640, y, size: 9, font: bold, color: ACCENT });
  return doc.save();
}
