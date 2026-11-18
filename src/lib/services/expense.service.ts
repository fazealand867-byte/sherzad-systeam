import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { D, DecimalValue, fromUsd, roundCurrency, roundUsd, toUsd } from '../decimal';
import {
  EXPENSE_CATEGORY_TO_ACCOUNT_CODE,
  postJournalEntryInTx,
} from './accounting.service';

export class ExpenseError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export interface CreateExpenseInput {
  date?: Date;
  category:
    | 'SALARIES'
    | 'RENT'
    | 'ELECTRICITY'
    | 'TRANSPORTATION'
    | 'MAINTENANCE'
    | 'MARKETING'
    | 'COMMUNICATION'
    | 'OFFICE_SUPPLIES'
    | 'MISCELLANEOUS'
    | string;
  title: string;
  description?: string;
  vendorName?: string;
  expenseAccountId?: string;
  financialAccountId?: string | null;
  supplierId?: string | null;
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CREDIT' | string;
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  amountOriginal: DecimalValue;
  isRecurring?: boolean;
  recurringInterval?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null;
  attachmentName?: string;
  attachmentUrl?: string;
  bypassApprovalThreshold?: boolean;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

function computeNextOccurrence(
  baseDate: Date,
  interval?: string | null
): Date | null {
  if (!interval) return null;
  const d = new Date(baseDate.getTime());
  switch (interval) {
    case 'DAILY':
      d.setDate(d.getDate() + 1);
      break;
    case 'WEEKLY':
      d.setDate(d.getDate() + 7);
      break;
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'YEARLY':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return null;
  }
  return d;
}

/**
 * Posts an approved Expense inside a transaction:
 * 1. Deducts from Cash/Bank account (or increases Supplier AP liability if on credit)
 * 2. Creates Double-Entry Journal Entry (Debit Expense Account 51xx, Credit Cash/Bank or AP 2100/2300)
 */
export async function postExpenseInTx(
  tx: Prisma.TransactionClient,
  expenseId: string,
  userId?: string | null
) {
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    include: {
      expenseAccount: true,
      financialAccount: true,
      supplier: true,
    },
  });

  if (!expense) {
    throw new ExpenseError('Expense not found.');
  }

  if (expense.status === 'POSTED' && expense.journalEntryId) {
    throw new ExpenseError(`Expense ${expense.expenseNumber} is already posted.`);
  }

  if (expense.status === 'REJECTED') {
    throw new ExpenseError(`Expense ${expense.expenseNumber} was rejected and cannot be posted.`);
  }

  const amountUsd = roundUsd(expense.amountUsd);
  const amountOrig = roundCurrency(expense.amountOriginal, expense.currency);

  let financialAccount = expense.financialAccount;
  let creditAccountId: string | undefined;
  let creditAccountCode: string | undefined;

  if (expense.paymentMethod === 'CREDIT') {
    if (expense.supplierId && expense.supplier) {
      const newSuppBal = roundUsd(D(expense.supplier.balanceUsd).plus(amountUsd));
      await tx.supplier.update({
        where: { id: expense.supplierId },
        data: { balanceUsd: newSuppBal.toNumber() },
      });
      creditAccountCode = '2100'; // Accounts Payable
    } else {
      creditAccountCode = '2300'; // Accrued Expenses Payable
    }
  } else {
    if (!financialAccount && expense.financialAccountId) {
      financialAccount = await tx.financialAccount.findUnique({
        where: { id: expense.financialAccountId },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { currency: expense.currency, isActive: true },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { isActive: true },
      });
    }
    if (!financialAccount) {
      throw new ExpenseError('No active Cash or Bank account found to pay expense.');
    }

    if (D(financialAccount.balanceUsd).lt(amountUsd)) {
      throw new ExpenseError(
        `Insufficient funds in '${financialAccount.nameEn}'. Available: $${D(
          financialAccount.balanceUsd
        ).toFixed(2)}, Required: $${amountUsd.toFixed(2)}.`
      );
    }

    const amountInAccCurr =
      financialAccount.currency === expense.currency
        ? amountOrig
        : fromUsd(amountUsd, financialAccount.currency, expense.exchangeRate);

    const newBalOrig = roundCurrency(
      D(financialAccount.balanceOriginal).minus(amountInAccCurr),
      financialAccount.currency
    );
    const newBalUsd = roundUsd(D(financialAccount.balanceUsd).minus(amountUsd));

    await tx.financialAccount.update({
      where: { id: financialAccount.id },
      data: {
        balanceOriginal: newBalOrig.toNumber(),
        balanceUsd: newBalUsd.toNumber(),
      },
    });

    const cashTxCount = await tx.cashTransaction.count();
    await tx.cashTransaction.create({
      data: {
        transactionNumber: `CSH-${new Date().getFullYear()}-${String(
          cashTxCount + 1
        ).padStart(5, '0')}-${Math.floor(10 + Math.random() * 89)}`,
        date: expense.date,
        type: 'EXPENSE_PAYMENT',
        financialAccountId: financialAccount.id,
        currency: expense.currency,
        exchangeRate: D(expense.exchangeRate).toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: amountUsd.toNumber(),
        direction: 'OUT',
        balanceAfterOriginal: newBalOrig.toNumber(),
        balanceAfterUsd: newBalUsd.toNumber(),
        category: expense.category,
        description: `Expense Payment: ${expense.title} (${expense.expenseNumber})`,
        referenceType: 'EXPENSE',
        referenceId: expense.id,
        isDemo: expense.isDemo,
        createdById: userId || expense.createdById,
      },
    });

    creditAccountId = financialAccount.ledgerAccountId;
  }

  const jrn = await postJournalEntryInTx(tx, {
    date: expense.date,
    description: `Expense ${expense.expenseNumber}: ${expense.title}`,
    referenceType: 'EXPENSE',
    referenceId: expense.id,
    currency: expense.currency,
    exchangeRate: expense.exchangeRate,
    isDemo: expense.isDemo,
    createdById: userId || expense.createdById,
    lines: [
      {
        accountId: expense.expenseAccountId,
        description: `${expense.category}: ${expense.title}`,
        debitUsd: amountUsd,
        creditUsd: 0,
        supplierId: expense.supplierId,
      },
      {
        accountId: creditAccountId,
        accountCode: creditAccountCode,
        description: `Payment/Payable for ${expense.expenseNumber}`,
        debitUsd: 0,
        creditUsd: amountUsd,
        supplierId: expense.supplierId,
      },
    ],
  });

  return tx.expense.update({
    where: { id: expense.id },
    data: {
      status: 'POSTED',
      financialAccountId: financialAccount?.id || expense.financialAccountId,
      journalEntryId: jrn.id,
      approvedById: userId || expense.approvedById,
      approvedAt: expense.approvedAt || new Date(),
    },
    include: {
      expenseAccount: true,
      financialAccount: true,
      supplier: true,
    },
  });
}

/**
 * Creates an Expense. If the amount reaches or exceeds `expenseApprovalThresholdUsd`
 * and `bypassApprovalThreshold` is not set, holds it in `PENDING_APPROVAL` status.
 */
export async function createExpense(input: CreateExpenseInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.expense.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        expenseAccount: true,
        financialAccount: true,
        supplier: true,
      },
    });
    if (existing) {
      return existing;
    }
  }

  return prisma.$transaction(async (tx) => {
    const settings = await tx.companySettings.findFirst();
    const currency = input.currency || 'USD';
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);
    const amountOrig = roundCurrency(input.amountOriginal, currency);

    if (amountOrig.lte(0)) {
      throw new ExpenseError('Expense amount must be greater than zero.');
    }

    const amountUsd = toUsd(amountOrig, currency, exchangeRate);

    let expenseAccountId = input.expenseAccountId;
    if (!expenseAccountId) {
      const targetCode =
        EXPENSE_CATEGORY_TO_ACCOUNT_CODE[input.category] || '5190';
      const acc =
        (await tx.account.findUnique({ where: { code: targetCode } })) ||
        (await tx.account.findFirst({ where: { type: 'EXPENSE' } }));
      if (!acc) {
        throw new ExpenseError('No expense account configured in Chart of Accounts.');
      }
      expenseAccountId = acc.id;
    }

    const count = await tx.expense.count();
    const prefix = settings?.expensePrefix || 'EXP-';
    const expenseNumber = `${prefix}${new Date().getFullYear()}-${String(
      count + 1
    ).padStart(4, '0')}`;

    const thresholdUsd = D(settings?.expenseApprovalThresholdUsd ?? 1000);
    const requiresApproval =
      !input.bypassApprovalThreshold &&
      thresholdUsd.gt(0) &&
      amountUsd.gte(thresholdUsd);

    const expDate = input.date || new Date();
    const nextOccurrenceDate = input.isRecurring
      ? computeNextOccurrence(expDate, input.recurringInterval)
      : null;

    const created = await tx.expense.create({
      data: {
        expenseNumber,
        date: expDate,
        category: input.category,
        title: input.title,
        description: input.description || null,
        vendorName: input.vendorName || null,
        expenseAccountId,
        financialAccountId: input.financialAccountId || null,
        supplierId: input.supplierId || null,
        paymentMethod: input.paymentMethod || 'CASH',
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: amountUsd.toNumber(),
        isRecurring: input.isRecurring ?? false,
        recurringInterval: input.recurringInterval || null,
        nextOccurrenceDate,
        status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED',
        attachmentName: input.attachmentName || null,
        attachmentUrl: input.attachmentUrl || null,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
      },
      include: {
        expenseAccount: true,
        financialAccount: true,
        supplier: true,
      },
    });

    if (!requiresApproval) {
      return postExpenseInTx(tx, created.id, input.createdById);
    }

    return created;
  });
}

/**
 * Approves and posts a pending large expense.
 */
export async function approveExpense(expenseId: string, approverUserId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const exp = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!exp) {
      throw new ExpenseError('Expense not found.');
    }
    if (exp.status !== 'PENDING_APPROVAL' && exp.status !== 'APPROVED') {
      throw new ExpenseError(
        `Expense cannot be approved from status '${exp.status}'.`
      );
    }
    return postExpenseInTx(tx, expenseId, approverUserId);
  });
}

/**
 * Rejects a pending expense without affecting ledger balances.
 */
export async function rejectExpense(expenseId: string, userId?: string | null) {
  const exp = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!exp) {
    throw new ExpenseError('Expense not found.');
  }
  if (exp.status === 'POSTED') {
    throw new ExpenseError('Posted expenses cannot be rejected directly; use journal reversal.');
  }
  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      status: 'REJECTED',
      approvedById: userId || null,
      approvedAt: new Date(),
    },
  });
}
