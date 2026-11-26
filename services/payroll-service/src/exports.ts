import type { PayrollRun } from './store.js';

function csvCell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function header(): string[] {
  return [
    'Collaborateur',
    'Poste',
    'Contrat',
    'Jours pointés',
    'Heures travaillées',
    'Heures sup.',
    'Salaire de base',
    'Brut',
    'Brut imposable',
    'Cotisations',
    'Retenues',
    'Impôt',
    'Avances',
    'Net à payer',
    'Moyen de paiement',
    'Destination',
    'Bulletin envoyé',
  ];
}

function row(run: PayrollRun, index: number): string[] {
  const line = run.payslips[index];
  return [
    line.name,
    line.jobTitle,
    line.contractType,
    String(line.daysPresent),
    String(line.hoursWorked),
    String(line.overtimeHours),
    String(line.baseSalaryXof),
    String(line.brutXof),
    String(line.brutImposableXof),
    String(line.cotisationsXof),
    String(line.retenuesXof),
    String(line.impotsXof),
    String(line.avancesXof),
    String(line.netXof),
    line.paymentMethod,
    line.paymentDestination,
    line.sentAt ? 'oui' : 'non',
  ];
}

export function payrollCsv(run: PayrollRun): string {
  const lines = [header(), ...run.payslips.map((_, index) => row(run, index))].map((cells) =>
    cells.map(csvCell).join(';'),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function payrollXls(run: PayrollRun, sheetName = `Paie ${run.period}`): string {
  const cell = (value: string, style?: string) =>
    `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  const headerRow = `<Row>${header()
    .map((value) => cell(value, 'head'))
    .join('')}</Row>`;
  const rows = run.payslips
    .map((_, index) => {
      const cells = row(run, index);
      return `<Row>${cells.map((value, column) => cell(value, column >= 6 && column <= 13 ? 'num' : undefined)).join('')}</Row>`;
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

export function rulesCsv(run: PayrollRun): string {
  const rules = run.snapshot.settings.rules;
  const lines = [
    [
      'Code',
      'Libellé',
      'Type',
      'Base',
      'Mode',
      'Taux %',
      'Montant F',
      'Coefficient',
      'Plafond F',
      'Actif',
      'Imposable',
      'Déductible',
      'Description',
    ],
    ...rules.map((rule) => [
      rule.code,
      rule.label,
      rule.type,
      rule.base,
      rule.kind,
      rule.ratePercent !== undefined ? String(rule.ratePercent) : '',
      rule.rateXof !== undefined ? String(rule.rateXof) : '',
      rule.multiplier !== undefined ? String(rule.multiplier) : '',
      rule.capXof !== undefined && rule.capXof !== null ? String(rule.capXof) : '',
      rule.enabled ? 'oui' : 'non',
      rule.taxable ? 'oui' : 'non',
      rule.deductible ? 'oui' : 'non',
      rule.description,
    ]),
  ].map((cells) => cells.map(csvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
