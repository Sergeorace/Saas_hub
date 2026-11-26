import { createHash } from 'node:crypto';
import { newId, nowIso } from '@resto-hub/service-kit';

export const LEDGER_ACCOUNTS = {
  provider_receivable: { label: 'Créances fournisseurs', kind: 'asset' },
  provider_fee_expense: { label: 'Frais fournisseurs (charge)', kind: 'expense' },
  provider_fee_payable: { label: 'Frais fournisseurs à régler', kind: 'liability' },
  tenant_wallet: { label: 'Portefeuille établissements', kind: 'liability' },
  platform_commission: { label: 'Commissions plateforme (produit)', kind: 'revenue' },
  cash: { label: 'Trésorerie / comptes de règlement', kind: 'asset' },
  sales: { label: 'Ventes encaissées en caisse', kind: 'revenue' },
  provider_refund_payable: { label: 'Remboursements à reverser', kind: 'liability' },
  refund_clearing: { label: 'Frais non récupérés sur remboursements', kind: 'expense' },
  salary_payable: { label: 'Salaires et décaissements à régler', kind: 'liability' },
} as const;

export type LedgerAccountCode = keyof typeof LEDGER_ACCOUNTS;

export interface JournalLine {
  account: LedgerAccountCode;
  label: string;
  debitXof: number;
  creditXof: number;
}

export interface JournalEntry {
  id: string;
  tenantId: string | null;
  at: string;
  memo: string;
  reference: string;
  lines: JournalLine[];
  prevHash: string;
  hash: string;
}

export interface Ledger {
  entries: JournalEntry[];
}

export interface EntryInput {
  tenantId: string | null;
  at?: string;
  memo: string;
  reference: string;
  lines: JournalLine[];
}

export function createLedger(): Ledger {
  return { entries: [] };
}

function totals(lines: JournalLine[]): { debit: number; credit: number } {
  return lines.reduce(
    (sum, line) => ({ debit: sum.debit + line.debitXof, credit: sum.credit + line.creditXof }),
    { debit: 0, credit: 0 },
  );
}

/** Journal en partie double : toute écriture déséquilibrée est refusée. */
export function appendEntry(ledger: Ledger, input: EntryInput): JournalEntry {
  const { debit, credit } = totals(input.lines);
  if (debit !== credit) {
    throw new Error(`Écriture comptable déséquilibrée (${debit} ≠ ${credit}) : ${input.memo}`);
  }
  const previous = ledger.entries[ledger.entries.length - 1];
  const prevHash = previous?.hash ?? 'genesis';
  const at = input.at ?? nowIso();
  const id = newId('jnl');
  const canonical = JSON.stringify({
    id,
    tenantId: input.tenantId,
    at,
    memo: input.memo,
    reference: input.reference,
    lines: input.lines,
    prevHash,
  });
  const entry: JournalEntry = {
    id,
    tenantId: input.tenantId,
    at,
    memo: input.memo,
    reference: input.reference,
    lines: input.lines,
    prevHash,
    hash: createHash('sha256').update(canonical).digest('hex'),
  };
  ledger.entries.push(entry);
  return entry;
}

export interface LedgerBalance {
  account: LedgerAccountCode;
  label: string;
  kind: string;
  debitXof: number;
  creditXof: number;
  balanceXof: number;
}

export function ledgerBalances(ledger: Ledger, tenantId?: string): LedgerBalance[] {
  const accounts = Object.keys(LEDGER_ACCOUNTS) as LedgerAccountCode[];
  return accounts.map((account) => {
    let debit = 0;
    let credit = 0;
    for (const entry of ledger.entries) {
      if (tenantId && entry.tenantId !== tenantId) continue;
      for (const line of entry.lines) {
        if (line.account !== account) continue;
        debit += line.debitXof;
        credit += line.creditXof;
      }
    }
    const meta = LEDGER_ACCOUNTS[account];
    return {
      account,
      label: meta.label,
      kind: meta.kind,
      debitXof: debit,
      creditXof: credit,
      balanceXof: debit - credit,
    };
  });
}

export function verifyLedger(ledger: Ledger): {
  ok: boolean;
  entries: number;
  brokenAt: string | null;
} {
  let previous = 'genesis';
  for (const entry of ledger.entries) {
    if (entry.prevHash !== previous)
      return { ok: false, entries: ledger.entries.length, brokenAt: entry.id };
    const canonical = JSON.stringify({
      id: entry.id,
      tenantId: entry.tenantId,
      at: entry.at,
      memo: entry.memo,
      reference: entry.reference,
      lines: entry.lines,
      prevHash: entry.prevHash,
    });
    const expected = createHash('sha256').update(canonical).digest('hex');
    if (expected !== entry.hash)
      return { ok: false, entries: ledger.entries.length, brokenAt: entry.id };
    const { debit, credit } = totals(entry.lines);
    if (debit !== credit) return { ok: false, entries: ledger.entries.length, brokenAt: entry.id };
    previous = entry.hash;
  }
  return { ok: true, entries: ledger.entries.length, brokenAt: null };
}
