import prisma from '../prisma';
import { D, DecimalValue, fromUsd, roundCurrency, roundUsd, toUsd } from '../decimal';
import { postJournalEntryInTx } from './accounting.service';

export class CashBankError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CashBankError';
  }
}

export interface CashDepositOrWithdrawalInput {
  financialAccountId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amountOriginal: DecimalValue;
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  counterpartyAccountCode?: string; // defaults to '3000' (Owner's Capital) for DEPOSIT or '3200' (Owner's Drawings) for WITHDRAWAL
  category?: string;
  description: string;
  date?: Date;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

export interface InternalTransferInput {
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  amountOriginal: DecimalValue; // in fromFinancialAccount's currency
  exchangeRate?: DecimalValue;
  description?: string;
  date?: Date;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

/**
 * Records a Cash/Bank Deposit or Withdrawal and posts a balanced Double-Entry Journal Entry.
 */
export async function recordCashDepositOrWithdrawal(
  input: CashDepositOrWithdrawalInput
) {
  if (input.idempotencyKey) {
    const existing = await prisma.cashTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { financialAccount: true },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    const account = await tx.financialAccount.findUnique({
      where: { id: input.financialAccountId },
    });
    if (!account) {
      throw new CashBankError('Financial account not found.');
    }

    const settings = await tx.companySettings.findFirst();
    const currency = input.currency || account.currency;
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);
    const amountOrig = roundCurrency(input.amountOriginal, currency);

    if (amountOrig.lte(0)) {
      throw new CashBankError('Transaction amount must be greater than zero.');
    }

    const amountUsd = toUsd(amountOrig, currency, exchangeRate);
    const amountInAccountCurr =
      account.currency === currency
        ? amountOrig
        : fromUsd(amountUsd, account.currency, exchangeRate);

    if (input.type === 'WITHDRAWAL' && D(account.balanceUsd).lt(amountUsd)) {
      throw new CashBankError(
        `Insufficient funds in '${account.nameEn}'. Available: $${D(
          account.balanceUsd
        ).toFixed(2)}, Requested withdrawal: $${amountUsd.toFixed(2)}.`
      );
    }

    const deltaOrig =
      input.type === 'DEPOSIT' ? amountInAccountCurr : amountInAccountCurr.neg();
    const deltaUsd = input.type === 'DEPOSIT' ? amountUsd : amountUsd.neg();

    const newBalOrig = roundCurrency(
      D(account.balanceOriginal).plus(deltaOrig),
      account.currency
    );
    const newBalUsd = roundUsd(D(account.balanceUsd).plus(deltaUsd));

    await tx.financialAccount.update({
      where: { id: account.id },
      data: {
        balanceOriginal: newBalOrig.toNumber(),
        balanceUsd: newBalUsd.toNumber(),
      },
    });

    const counterpartyCode =
      input.counterpartyAccountCode ||
      (input.type === 'DEPOSIT' ? '3000' : '3200');

    const jrnLines =
      input.type === 'DEPOSIT'
        ? [
            {
              accountId: account.ledgerAccountId,
              description: input.description,
              debitUsd: amountUsd,
              creditUsd: 0,
            },
            {
              accountCode: counterpartyCode,
              description: input.description,
              debitUsd: 0,
              creditUsd: amountUsd,
            },
          ]
        : [
            {
              accountCode: counterpartyCode,
              description: input.description,
              debitUsd: amountUsd,
              creditUsd: 0,
            },
            {
              accountId: account.ledgerAccountId,
              description: input.description,
              debitUsd: 0,
              creditUsd: amountUsd,
            },
          ];

    const jrn = await postJournalEntryInTx(tx, {
      date: input.date || new Date(),
      description: input.description,
      referenceType: 'CASH_TRANSACTION',
      currency,
      exchangeRate,
      isDemo: input.isDemo ?? false,
      createdById: input.createdById || null,
      lines: jrnLines,
    });

    const count = await tx.cashTransaction.count();
    const transactionNumber = `CSH-${new Date().getFullYear()}-${String(
      count + 1
    ).padStart(5, '0')}-${Math.floor(10 + Math.random() * 89)}`;

    return tx.cashTransaction.create({
      data: {
        transactionNumber,
        date: input.date || new Date(),
        type: input.type,
        financialAccountId: account.id,
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: amountUsd.toNumber(),
        direction: input.type === 'DEPOSIT' ? 'IN' : 'OUT',
        balanceAfterOriginal: newBalOrig.toNumber(),
        balanceAfterUsd: newBalUsd.toNumber(),
        category: input.category || input.type,
        description: input.description,
        referenceType: 'CASH_TRANSACTION',
        journalEntryId: jrn.id,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
      },
      include: {
        financialAccount: true,
      },
    });
  });
}

/**
 * Transfers funds between two Cash Registers / Bank Accounts (including cross-currency USD <-> IQD transfers).
 */
export async function transferBetweenFinancialAccounts(
  input: InternalTransferInput
) {
  if (input.fromFinancialAccountId === input.toFinancialAccountId) {
    throw new CashBankError('Source and destination accounts must be different.');
  }

  if (input.idempotencyKey) {
    const existing = await prisma.cashTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { financialAccount: true, targetFinancialAccount: true },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    const fromAcc = await tx.financialAccount.findUnique({
      where: { id: input.fromFinancialAccountId },
    });
    const toAcc = await tx.financialAccount.findUnique({
      where: { id: input.toFinancialAccountId },
    });

    if (!fromAcc || !toAcc) {
      throw new CashBankError('Source or destination financial account not found.');
    }

    const settings = await tx.companySettings.findFirst();
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);
    const amountFromOrig = roundCurrency(input.amountOriginal, fromAcc.currency);

    if (amountFromOrig.lte(0)) {
      throw new CashBankError('Transfer amount must be greater than zero.');
    }

    const amountUsd = toUsd(amountFromOrig, fromAcc.currency, exchangeRate);

    if (D(fromAcc.balanceUsd).lt(amountUsd)) {
      throw new CashBankError(
        `Insufficient funds in '${fromAcc.nameEn}'. Available: $${D(
          fromAcc.balanceUsd
        ).toFixed(2)}, Transfer: $${amountUsd.toFixed(2)}.`
      );
    }

    const amountToOrig =
      toAcc.currency === fromAcc.currency
        ? amountFromOrig
        : fromUsd(amountUsd, toAcc.currency, exchangeRate);

    const newFromOrig = roundCurrency(
      D(fromAcc.balanceOriginal).minus(amountFromOrig),
      fromAcc.currency
    );
    const newFromUsd = roundUsd(D(fromAcc.balanceUsd).minus(amountUsd));

    const newToOrig = roundCurrency(
      D(toAcc.balanceOriginal).plus(amountToOrig),
      toAcc.currency
    );
    const newToUsd = roundUsd(D(toAcc.balanceUsd).plus(amountUsd));

    await tx.financialAccount.update({
      where: { id: fromAcc.id },
      data: {
        balanceOriginal: newFromOrig.toNumber(),
        balanceUsd: newFromUsd.toNumber(),
      },
    });

    await tx.financialAccount.update({
      where: { id: toAcc.id },
      data: {
        balanceOriginal: newToOrig.toNumber(),
        balanceUsd: newToUsd.toNumber(),
      },
    });

    const desc =
      input.description ||
      `Internal transfer from ${fromAcc.nameEn} to ${toAcc.nameEn}`;

    const jrn = await postJournalEntryInTx(tx, {
      date: input.date || new Date(),
      description: desc,
      referenceType: 'CASH_TRANSACTION',
      currency: fromAcc.currency,
      exchangeRate,
      isDemo: input.isDemo ?? false,
      createdById: input.createdById || null,
      lines: [
        {
          accountId: toAcc.ledgerAccountId,
          description: `Transfer in from ${fromAcc.nameEn}`,
          debitUsd: amountUsd,
          creditUsd: 0,
        },
        {
          accountId: fromAcc.ledgerAccountId,
          description: `Transfer out to ${toAcc.nameEn}`,
          debitUsd: 0,
          creditUsd: amountUsd,
        },
      ],
    });

    const count = await tx.cashTransaction.count();
    const txOutNum = `TRF-${new Date().getFullYear()}-${String(count + 1).padStart(
      5,
      '0'
    )}-OUT`;
    const txInNum = `TRF-${new Date().getFullYear()}-${String(count + 2).padStart(
      5,
      '0'
    )}-IN`;

    const outTx = await tx.cashTransaction.create({
      data: {
        transactionNumber: txOutNum,
        date: input.date || new Date(),
        type: 'TRANSFER',
        financialAccountId: fromAcc.id,
        targetFinancialAccountId: toAcc.id,
        currency: fromAcc.currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountFromOrig.toNumber(),
        amountUsd: amountUsd.toNumber(),
        direction: 'OUT',
        balanceAfterOriginal: newFromOrig.toNumber(),
        balanceAfterUsd: newFromUsd.toNumber(),
        category: 'INTERNAL_TRANSFER',
        description: desc,
        referenceType: 'INTERNAL_TRANSFER',
        journalEntryId: jrn.id,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
      },
      include: {
        financialAccount: true,
        targetFinancialAccount: true,
      },
    });

    await tx.cashTransaction.create({
      data: {
        transactionNumber: txInNum,
        date: input.date || new Date(),
        type: 'TRANSFER',
        financialAccountId: toAcc.id,
        targetFinancialAccountId: fromAcc.id,
        currency: toAcc.currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountToOrig.toNumber(),
        amountUsd: amountUsd.toNumber(),
        direction: 'IN',
        balanceAfterOriginal: newToOrig.toNumber(),
        balanceAfterUsd: newToUsd.toNumber(),
        category: 'INTERNAL_TRANSFER',
        description: desc,
        referenceType: 'INTERNAL_TRANSFER',
        referenceId: outTx.id,
        journalEntryId: jrn.id,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
      },
    });

    return outTx;
  });
}

/**
 * Reconciles a Financial Account against an external Bank Statement or Physical Cash Count.
 * If there is a discrepancy and `postAdjustment: true`, automatically posts a reconciliation journal entry.
 */
export async function reconcileFinancialAccount(params: {
  financialAccountId: string;
  statementBalanceOriginal: DecimalValue;
  transactionIds?: string[];
  postAdjustment?: boolean;
  notes?: string;
  userId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.financialAccount.findUnique({
      where: { id: params.financialAccountId },
    });
    if (!account) {
      throw new CashBankError('Financial account not found.');
    }

    const settings = await tx.companySettings.findFirst();
    const exchangeRate = D(settings?.usdToIqdRate || 1500);
    const statementBalOrig = roundCurrency(
      params.statementBalanceOriginal,
      account.currency
    );
    const currentBalOrig = roundCurrency(account.balanceOriginal, account.currency);
    const diffOrig = roundCurrency(
      statementBalOrig.minus(currentBalOrig),
      account.currency
    );
    const diffUsd = toUsd(diffOrig.abs(), account.currency, exchangeRate);

    if (params.transactionIds && params.transactionIds.length > 0) {
      await tx.cashTransaction.updateMany({
        where: {
          id: { in: params.transactionIds },
          financialAccountId: account.id,
        },
        data: {
          isReconciled: true,
          reconciledAt: new Date(),
        },
      });
    } else {
      await tx.cashTransaction.updateMany({
        where: {
          financialAccountId: account.id,
          isReconciled: false,
        },
        data: {
          isReconciled: true,
          reconciledAt: new Date(),
        },
      });
    }

    if (params.postAdjustment && !diffOrig.eq(0) && diffUsd.gt(0)) {
      const isSurplus = diffOrig.gt(0);
      const newBalUsd = isSurplus
        ? roundUsd(D(account.balanceUsd).plus(diffUsd))
        : roundUsd(D(account.balanceUsd).minus(diffUsd));

      await tx.financialAccount.update({
        where: { id: account.id },
        data: {
          balanceOriginal: statementBalOrig.toNumber(),
          balanceUsd: newBalUsd.toNumber(),
          lastReconciledAt: new Date(),
          lastReconciledBalance: statementBalOrig.toNumber(),
        },
      });

      const jrn = await postJournalEntryInTx(tx, {
        description: `Bank/Cash Reconciliation adjustment for ${account.nameEn}: ${
          params.notes || 'Statement reconciliation'
        }`,
        referenceType: 'CASH_TRANSACTION',
        currency: account.currency,
        exchangeRate,
        createdById: params.userId || null,
        lines: isSurplus
          ? [
              {
                accountId: account.ledgerAccountId,
                debitUsd: diffUsd,
                creditUsd: 0,
              },
              {
                accountCode: '4200', // Other Operating Income
                debitUsd: 0,
                creditUsd: diffUsd,
              },
            ]
          : [
              {
                accountCode: '5190', // Miscellaneous Operating Expense
                debitUsd: diffUsd,
                creditUsd: 0,
              },
              {
                accountId: account.ledgerAccountId,
                debitUsd: 0,
                creditUsd: diffUsd,
              },
            ],
      });

      const count = await tx.cashTransaction.count();
      await tx.cashTransaction.create({
        data: {
          transactionNumber: `REC-${new Date().getFullYear()}-${String(
            count + 1
          ).padStart(5, '0')}`,
          date: new Date(),
          type: 'RECONCILIATION_ADJUSTMENT',
          financialAccountId: account.id,
          currency: account.currency,
          exchangeRate: exchangeRate.toNumber(),
          amountOriginal: diffOrig.abs().toNumber(),
          amountUsd: diffUsd.toNumber(),
          direction: isSurplus ? 'IN' : 'OUT',
          balanceAfterOriginal: statementBalOrig.toNumber(),
          balanceAfterUsd: newBalUsd.toNumber(),
          category: 'RECONCILIATION',
          description: params.notes || `Reconciliation adjustment for ${account.nameEn}`,
          isReconciled: true,
          reconciledAt: new Date(),
          journalEntryId: jrn.id,
          createdById: params.userId || null,
        },
      });
    } else {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: {
          lastReconciledAt: new Date(),
          lastReconciledBalance: statementBalOrig.toNumber(),
        },
      });
    }

    return tx.financialAccount.findUnique({
      where: { id: account.id },
    });
  });
}
