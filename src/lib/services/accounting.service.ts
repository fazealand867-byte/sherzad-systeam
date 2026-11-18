import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { D, Decimal, DecimalValue, roundUsd, toUsd } from '../decimal';

export class AccountingError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AccountingError';
  }
}

export interface JournalLineInput {
  accountCode?: string;
  accountId?: string;
  description?: string;
  debitOriginal?: DecimalValue;
  creditOriginal?: DecimalValue;
  debitUsd?: DecimalValue;
  creditUsd?: DecimalValue;
  customerId?: string | null;
  supplierId?: string | null;
}

export interface PostJournalInput {
  date?: Date;
  description: string;
  referenceType:
    | 'SALE'
    | 'SALE_RETURN'
    | 'PURCHASE'
    | 'PURCHASE_RETURN'
    | 'EXPENSE'
    | 'DEBTOR_COLLECTION'
    | 'CREDITOR_PAYMENT'
    | 'CASH_TRANSACTION'
    | 'STOCK_ADJUSTMENT'
    | 'MANUAL'
    | 'REVERSAL';
  referenceId?: string | null;
  currency?: 'USD' | 'IQD' | string;
  exchangeRate?: DecimalValue;
  lines: JournalLineInput[];
  reversesEntryId?: string | null;
  isDemo?: boolean;
  createdById?: string | null;
}

export const EXPENSE_CATEGORY_TO_ACCOUNT_CODE: Record<string, string> = {
  SALARIES: '5110',
  RENT: '5120',
  ELECTRICITY: '5130',
  TRANSPORTATION: '5140',
  MAINTENANCE: '5150',
  MARKETING: '5160',
  COMMUNICATION: '5170',
  OFFICE_SUPPLIES: '5180',
  MISCELLANEOUS: '5190',
};

/**
 * Verifies that a transaction date does not fall within a closed or locked AccountingPeriod.
 */
export async function verifyPeriodOpen(
  tx: Prisma.TransactionClient,
  date: Date
): Promise<void> {
  const lockedPeriod = await tx.accountingPeriod.findFirst({
    where: {
      startDate: { lte: date },
      endDate: { gte: date },
      OR: [{ isLocked: true }, { isClosed: true }],
    },
  });

  if (lockedPeriod) {
    throw new AccountingError(
      `Cannot post or modify transactions in accounting period '${lockedPeriod.name}' because it is closed/locked.`
    );
  }
}

/**
 * Generates a unique sequential Journal Entry number.
 */
export async function generateJournalNumber(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.journalEntry.count();
  const year = new Date().getFullYear();
  const suffix = String(count + 1).padStart(5, '0');
  const candidate = `JRN-${year}-${suffix}`;
  const existing = await tx.journalEntry.findUnique({ where: { entryNumber: candidate } });
  if (existing) {
    return `JRN-${year}-${suffix}-${Math.floor(100 + Math.random() * 900)}`;
  }
  return candidate;
}

/**
 * Posts a balanced Double-Entry Journal Entry inside a Prisma transaction.
 * Strict Invariant: Total Debits === Total Credits and at least 2 lines.
 */
export async function postJournalEntryInTx(
  tx: Prisma.TransactionClient,
  input: PostJournalInput
) {
  const entryDate = input.date || new Date();
  await verifyPeriodOpen(tx, entryDate);

  const currency = input.currency || 'USD';
  const exchangeRate = D(input.exchangeRate || 1500);

  if (!input.lines || input.lines.length < 2) {
    throw new AccountingError(
      'Double-entry journal requires at least two lines (debit and credit).'
    );
  }

  // Filter out any zero-value lines that have 0 debit and 0 credit
  const activeLines: {
    accountId: string;
    account: { id: string; code: string; normalBalance: string; balanceUsd: Prisma.Decimal };
    description: string;
    debitUsd: Decimal;
    creditUsd: Decimal;
    debitOriginal: Decimal;
    creditOriginal: Decimal;
    customerId: string | null;
    supplierId: string | null;
  }[] = [];

  for (const line of input.lines) {
    let debitUsd: Decimal;
    let creditUsd: Decimal;
    let debitOriginal: Decimal;
    let creditOriginal: Decimal;

    if (line.debitUsd !== undefined || line.creditUsd !== undefined) {
      debitUsd = roundUsd(line.debitUsd || 0);
      creditUsd = roundUsd(line.creditUsd || 0);
      debitOriginal =
        line.debitOriginal !== undefined
          ? D(line.debitOriginal)
          : currency === 'IQD'
          ? debitUsd.mul(exchangeRate)
          : debitUsd;
      creditOriginal =
        line.creditOriginal !== undefined
          ? D(line.creditOriginal)
          : currency === 'IQD'
          ? creditUsd.mul(exchangeRate)
          : creditUsd;
    } else {
      debitOriginal = D(line.debitOriginal || 0);
      creditOriginal = D(line.creditOriginal || 0);
      debitUsd = toUsd(debitOriginal, currency, exchangeRate);
      creditUsd = toUsd(creditOriginal, currency, exchangeRate);
    }

    if (debitUsd.lt(0) || creditUsd.lt(0)) {
      throw new AccountingError('Journal line debit and credit amounts cannot be negative.');
    }

    if (debitUsd.gt(0) && creditUsd.gt(0)) {
      throw new AccountingError(
        'A single journal line cannot contain both a positive debit and a positive credit.'
      );
    }

    if (debitUsd.eq(0) && creditUsd.eq(0)) {
      continue;
    }

    let account = null;
    if (line.accountId) {
      account = await tx.account.findUnique({ where: { id: line.accountId } });
    } else if (line.accountCode) {
      account = await tx.account.findUnique({ where: { code: line.accountCode } });
    }

    if (!account) {
      throw new AccountingError(
        `Account not found for line (${line.accountCode || line.accountId || 'unknown'}).`
      );
    }

    activeLines.push({
      accountId: account.id,
      account,
      description: line.description || input.description,
      debitUsd,
      creditUsd,
      debitOriginal,
      creditOriginal,
      customerId: line.customerId || null,
      supplierId: line.supplierId || null,
    });
  }

  if (activeLines.length < 2) {
    throw new AccountingError(
      'Double-entry journal requires at least two non-zero lines.'
    );
  }

  let totalDebitUsd = new Decimal(0);
  let totalCreditUsd = new Decimal(0);

  for (const l of activeLines) {
    totalDebitUsd = totalDebitUsd.plus(l.debitUsd);
    totalCreditUsd = totalCreditUsd.plus(l.creditUsd);
  }

  totalDebitUsd = roundUsd(totalDebitUsd);
  totalCreditUsd = roundUsd(totalCreditUsd);

  if (!totalDebitUsd.equals(totalCreditUsd)) {
    throw new AccountingError(
      `Unbalanced journal entry rejected: Total Debits ($${totalDebitUsd.toFixed(
        2
      )}) !== Total Credits ($${totalCreditUsd.toFixed(2)}).`
    );
  }

  if (totalDebitUsd.lte(0)) {
    throw new AccountingError('Journal entry total must be greater than zero.');
  }

  const entryNumber = await generateJournalNumber(tx);

  const entry = await tx.journalEntry.create({
    data: {
      entryNumber,
      date: entryDate,
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId || null,
      currency,
      exchangeRate: exchangeRate.toNumber(),
      totalDebitUsd: totalDebitUsd.toNumber(),
      totalCreditUsd: totalCreditUsd.toNumber(),
      status: 'POSTED',
      reversesEntryId: input.reversesEntryId || null,
      isDemo: input.isDemo ?? false,
      createdById: input.createdById || null,
      lines: {
        create: activeLines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          debitUsd: l.debitUsd.toNumber(),
          creditUsd: l.creditUsd.toNumber(),
          debitOriginal: l.debitOriginal.toNumber(),
          creditOriginal: l.creditOriginal.toNumber(),
          currency,
          customerId: l.customerId,
          supplierId: l.supplierId,
        })),
      },
    },
    include: {
      lines: {
        include: { account: true },
      },
    },
  });

  // Update each account's running balance atomically
  // Group lines by accountId in case an account appears multiple times in the same entry
  const accountDeltas = new Map<
    string,
    { normalBalance: string; currentBalance: Decimal; debitSum: Decimal; creditSum: Decimal }
  >();

  for (const l of activeLines) {
    const existing = accountDeltas.get(l.accountId);
    if (existing) {
      existing.debitSum = existing.debitSum.plus(l.debitUsd);
      existing.creditSum = existing.creditSum.plus(l.creditUsd);
    } else {
      accountDeltas.set(l.accountId, {
        normalBalance: l.account.normalBalance,
        currentBalance: D(l.account.balanceUsd),
        debitSum: l.debitUsd,
        creditSum: l.creditUsd,
      });
    }
  }

  for (const [accountId, info] of accountDeltas.entries()) {
    const delta =
      info.normalBalance === 'DEBIT'
        ? info.debitSum.minus(info.creditSum)
        : info.creditSum.minus(info.debitSum);
    const newBalance = roundUsd(info.currentBalance.plus(delta));
    await tx.account.update({
      where: { id: accountId },
      data: { balanceUsd: newBalance.toNumber() },
    });
  }

  return entry;
}

/**
 * Standalone wrapper to post a journal entry in its own database transaction.
 */
export async function postJournalEntry(input: PostJournalInput) {
  return prisma.$transaction(async (tx) => {
    return postJournalEntryInTx(tx, input);
  });
}

/**
 * Reverses an existing posted Journal Entry by creating an opposite reversing entry.
 * Never deletes posted financial history.
 */
export async function reverseJournalEntryInTx(
  tx: Prisma.TransactionClient,
  journalEntryId: string,
  reason: string,
  userId?: string | null
) {
  const original = await tx.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: { lines: true },
  });

  if (!original) {
    throw new AccountingError('Journal entry not found.');
  }

  if (original.status === 'REVERSED' || original.reversedByEntryId) {
    throw new AccountingError(
      `Journal entry ${original.entryNumber} has already been reversed.`
    );
  }

  const reversalLines: JournalLineInput[] = original.lines.map((line) => ({
    accountId: line.accountId,
    description: `Reversal of ${original.entryNumber}: ${line.description || ''}`,
    debitUsd: line.creditUsd,
    creditUsd: line.debitUsd,
    debitOriginal: line.creditOriginal,
    creditOriginal: line.debitOriginal,
    customerId: line.customerId,
    supplierId: line.supplierId,
  }));

  const reversalEntry = await postJournalEntryInTx(tx, {
    date: new Date(),
    description: `Reversal of ${original.entryNumber} — ${reason}`,
    referenceType: 'REVERSAL',
    referenceId: original.id,
    currency: original.currency,
    exchangeRate: original.exchangeRate,
    lines: reversalLines,
    reversesEntryId: original.id,
    isDemo: original.isDemo,
    createdById: userId || null,
  });

  await tx.journalEntry.update({
    where: { id: original.id },
    data: {
      status: 'REVERSED',
      reversedByEntryId: reversalEntry.id,
    },
  });

  return reversalEntry;
}

export async function reverseJournalEntry(
  journalEntryId: string,
  reason: string,
  userId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    return reverseJournalEntryInTx(tx, journalEntryId, reason, userId);
  });
}

/**
 * Generates the Trial Balance from all JournalLines up to `endDate`.
 * Guarantees and verifies Total Debits === Total Credits.
 */
export async function getTrialBalance(params?: {
  startDate?: Date;
  endDate?: Date;
  includeDemo?: boolean;
}) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });

  const dateFilter: Prisma.DateTimeFilter = {};
  if (params?.startDate) dateFilter.gte = params.startDate;
  if (params?.endDate) dateFilter.lte = params.endDate;

  const entryWhere: Prisma.JournalEntryWhereInput = {};
  if (params?.startDate || params?.endDate) {
    entryWhere.date = dateFilter;
  }
  if (params?.includeDemo === false) {
    entryWhere.isDemo = false;
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: entryWhere,
    },
    include: {
      account: true,
    },
  });

  const map = new Map<
    string,
    {
      accountId: string;
      code: string;
      nameEn: string;
      nameAr: string;
      nameKu: string;
      type: string;
      normalBalance: string;
      totalDebit: Decimal;
      totalCredit: Decimal;
      debitBalance: Decimal;
      creditBalance: Decimal;
    }
  >();

  for (const acc of accounts) {
    map.set(acc.id, {
      accountId: acc.id,
      code: acc.code,
      nameEn: acc.nameEn,
      nameAr: acc.nameAr,
      nameKu: acc.nameKu,
      type: acc.type,
      normalBalance: acc.normalBalance,
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      debitBalance: new Decimal(0),
      creditBalance: new Decimal(0),
    });
  }

  for (const line of lines) {
    const row = map.get(line.accountId);
    if (row) {
      row.totalDebit = row.totalDebit.plus(D(line.debitUsd));
      row.totalCredit = row.totalCredit.plus(D(line.creditUsd));
    }
  }

  let sumDebits = new Decimal(0);
  let sumCredits = new Decimal(0);
  let sumDebitBalances = new Decimal(0);
  let sumCreditBalances = new Decimal(0);

  const rows = Array.from(map.values())
    .map((r) => {
      const net = r.totalDebit.minus(r.totalCredit);
      if (net.gt(0)) {
        r.debitBalance = roundUsd(net);
        r.creditBalance = new Decimal(0);
      } else if (net.lt(0)) {
        r.debitBalance = new Decimal(0);
        r.creditBalance = roundUsd(net.abs());
      }
      sumDebits = sumDebits.plus(r.totalDebit);
      sumCredits = sumCredits.plus(r.totalCredit);
      sumDebitBalances = sumDebitBalances.plus(r.debitBalance);
      sumCreditBalances = sumCreditBalances.plus(r.creditBalance);

      return {
        accountId: r.accountId,
        code: r.code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        nameKu: r.nameKu,
        type: r.type,
        normalBalance: r.normalBalance,
        totalDebitUsd: roundUsd(r.totalDebit).toNumber(),
        totalCreditUsd: roundUsd(r.totalCredit).toNumber(),
        debitBalanceUsd: r.debitBalance.toNumber(),
        creditBalanceUsd: r.creditBalance.toNumber(),
      };
    })
    .filter((r) => r.totalDebitUsd > 0 || r.totalCreditUsd > 0);

  return {
    rows,
    totalDebitUsd: roundUsd(sumDebits).toNumber(),
    totalCreditUsd: roundUsd(sumCredits).toNumber(),
    totalDebitBalanceUsd: roundUsd(sumDebitBalances).toNumber(),
    totalCreditBalanceUsd: roundUsd(sumCreditBalances).toNumber(),
    isBalanced:
      roundUsd(sumDebits).equals(roundUsd(sumCredits)) &&
      roundUsd(sumDebitBalances).equals(roundUsd(sumCreditBalances)),
  };
}

/**
 * Generates an Accrual Profit and Loss Statement (Income Statement) with product, category, and date breakdowns.
 */
export async function getProfitAndLoss(params?: {
  startDate?: Date;
  endDate?: Date;
  includeDemo?: boolean;
}) {
  const dateFilter: Prisma.DateTimeFilter = {};
  if (params?.startDate) dateFilter.gte = params.startDate;
  if (params?.endDate) dateFilter.lte = params.endDate;

  const entryWhere: Prisma.JournalEntryWhereInput = {};
  if (params?.startDate || params?.endDate) {
    entryWhere.date = dateFilter;
  }
  if (params?.includeDemo === false) {
    entryWhere.isDemo = false;
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: entryWhere,
      account: {
        type: { in: ['REVENUE', 'EXPENSE'] },
      },
    },
    include: {
      account: true,
      journalEntry: true,
    },
  });

  let grossSalesRevenue = new Decimal(0);
  let salesReturns = new Decimal(0);
  let salesDiscounts = new Decimal(0);
  let otherIncome = new Decimal(0);
  let costOfGoodsSold = new Decimal(0);
  let inventoryAdjustments = new Decimal(0);
  let operatingExpensesTotal = new Decimal(0);

  const expenseBreakdownMap = new Map<
    string,
    { code: string; nameEn: string; nameAr: string; nameKu: string; amountUsd: Decimal }
  >();

  for (const line of lines) {
    const acc = line.account;
    const debit = D(line.debitUsd);
    const credit = D(line.creditUsd);

    if (acc.type === 'REVENUE') {
      if (acc.subType === 'SALES_RETURN' || acc.code === '4050') {
        salesReturns = salesReturns.plus(debit.minus(credit));
      } else if (acc.subType === 'SALES_DISCOUNT' || acc.code === '4100') {
        salesDiscounts = salesDiscounts.plus(debit.minus(credit));
      } else if (acc.subType === 'OTHER_INCOME' || acc.code === '4200') {
        otherIncome = otherIncome.plus(credit.minus(debit));
      } else {
        grossSalesRevenue = grossSalesRevenue.plus(credit.minus(debit));
      }
    } else if (acc.type === 'EXPENSE') {
      const amount = debit.minus(credit);
      if (acc.code === '5000') {
        costOfGoodsSold = costOfGoodsSold.plus(amount);
      } else if (acc.code === '5200') {
        inventoryAdjustments = inventoryAdjustments.plus(amount);
      } else if (acc.subType === 'COGS') {
        costOfGoodsSold = costOfGoodsSold.plus(amount);
      } else {
        operatingExpensesTotal = operatingExpensesTotal.plus(amount);
        const existing = expenseBreakdownMap.get(acc.code);
        if (existing) {
          existing.amountUsd = existing.amountUsd.plus(amount);
        } else {
          expenseBreakdownMap.set(acc.code, {
            code: acc.code,
            nameEn: acc.nameEn,
            nameAr: acc.nameAr,
            nameKu: acc.nameKu,
            amountUsd: amount,
          });
        }
      }
    }
  }

  const netSalesRevenue = grossSalesRevenue.minus(salesReturns).minus(salesDiscounts);
  const totalRevenue = netSalesRevenue.plus(otherIncome);
  const totalCogs = costOfGoodsSold.plus(inventoryAdjustments);
  const grossProfit = totalRevenue.minus(totalCogs);
  const netProfit = grossProfit.minus(operatingExpensesTotal);

  const grossMarginPercent = totalRevenue.gt(0)
    ? roundUsd(grossProfit.div(totalRevenue).mul(100)).toNumber()
    : 0;
  const netMarginPercent = totalRevenue.gt(0)
    ? roundUsd(netProfit.div(totalRevenue).mul(100)).toNumber()
    : 0;

  // Profit by Product & Category from posted SalesInvoices
  const invoiceWhere: Prisma.SalesInvoiceWhereInput = {
    status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
  };
  if (params?.startDate || params?.endDate) {
    invoiceWhere.date = dateFilter;
  }
  if (params?.includeDemo === false) {
    invoiceWhere.isDemo = false;
  }

  const soldItems = await prisma.salesInvoiceItem.findMany({
    where: {
      salesInvoice: invoiceWhere,
    },
    include: {
      product: {
        include: { category: true },
      },
      salesInvoice: true,
    },
  });

  const productProfitMap = new Map<
    string,
    {
      productId: string;
      sku: string;
      nameEn: string;
      nameAr: string;
      nameKu: string;
      quantitySold: Decimal;
      revenueUsd: Decimal;
      costUsd: Decimal;
      profitUsd: Decimal;
    }
  >();

  const categoryProfitMap = new Map<
    string,
    {
      categoryId: string;
      nameEn: string;
      nameAr: string;
      nameKu: string;
      revenueUsd: Decimal;
      costUsd: Decimal;
      profitUsd: Decimal;
    }
  >();

  const dateProfitMap = new Map<
    string,
    { date: string; revenueUsd: Decimal; costUsd: Decimal; grossProfitUsd: Decimal }
  >();

  for (const item of soldItems) {
    const netQty = D(item.quantity).minus(D(item.returnedQty));
    if (netQty.lte(0)) continue;

    const ratio = netQty.div(D(item.quantity));
    const itemRev = D(item.lineTotalUsd).minus(D(item.taxUsd)).mul(ratio);
    const itemCost = D(item.unitCostUsd).mul(netQty);
    const itemProf = itemRev.minus(itemCost);

    const pEntry = productProfitMap.get(item.productId);
    if (pEntry) {
      pEntry.quantitySold = pEntry.quantitySold.plus(netQty);
      pEntry.revenueUsd = pEntry.revenueUsd.plus(itemRev);
      pEntry.costUsd = pEntry.costUsd.plus(itemCost);
      pEntry.profitUsd = pEntry.profitUsd.plus(itemProf);
    } else {
      productProfitMap.set(item.productId, {
        productId: item.productId,
        sku: item.product.sku,
        nameEn: item.product.nameEn,
        nameAr: item.product.nameAr,
        nameKu: item.product.nameKu,
        quantitySold: netQty,
        revenueUsd: itemRev,
        costUsd: itemCost,
        profitUsd: itemProf,
      });
    }

    const cat = item.product.category;
    const cEntry = categoryProfitMap.get(cat.id);
    if (cEntry) {
      cEntry.revenueUsd = cEntry.revenueUsd.plus(itemRev);
      cEntry.costUsd = cEntry.costUsd.plus(itemCost);
      cEntry.profitUsd = cEntry.profitUsd.plus(itemProf);
    } else {
      categoryProfitMap.set(cat.id, {
        categoryId: cat.id,
        nameEn: cat.nameEn,
        nameAr: cat.nameAr,
        nameKu: cat.nameKu,
        revenueUsd: itemRev,
        costUsd: itemCost,
        profitUsd: itemProf,
      });
    }

    const dayKey = item.salesInvoice.date.toISOString().slice(0, 10);
    const dEntry = dateProfitMap.get(dayKey);
    if (dEntry) {
      dEntry.revenueUsd = dEntry.revenueUsd.plus(itemRev);
      dEntry.costUsd = dEntry.costUsd.plus(itemCost);
      dEntry.grossProfitUsd = dEntry.grossProfitUsd.plus(itemProf);
    } else {
      dateProfitMap.set(dayKey, {
        date: dayKey,
        revenueUsd: itemRev,
        costUsd: itemCost,
        grossProfitUsd: itemProf,
      });
    }
  }

  return {
    grossSalesRevenueUsd: roundUsd(grossSalesRevenue).toNumber(),
    salesReturnsUsd: roundUsd(salesReturns).toNumber(),
    salesDiscountsUsd: roundUsd(salesDiscounts).toNumber(),
    netSalesRevenueUsd: roundUsd(netSalesRevenue).toNumber(),
    otherIncomeUsd: roundUsd(otherIncome).toNumber(),
    totalRevenueUsd: roundUsd(totalRevenue).toNumber(),
    costOfGoodsSoldUsd: roundUsd(costOfGoodsSold).toNumber(),
    inventoryAdjustmentsUsd: roundUsd(inventoryAdjustments).toNumber(),
    totalCogsUsd: roundUsd(totalCogs).toNumber(),
    grossProfitUsd: roundUsd(grossProfit).toNumber(),
    grossMarginPercent,
    operatingExpensesUsd: roundUsd(operatingExpensesTotal).toNumber(),
    operatingExpenseBreakdown: Array.from(expenseBreakdownMap.values()).map((e) => ({
      ...e,
      amountUsd: roundUsd(e.amountUsd).toNumber(),
    })),
    netProfitUsd: roundUsd(netProfit).toNumber(),
    netMarginPercent,
    profitByProduct: Array.from(productProfitMap.values())
      .map((p) => ({
        ...p,
        quantitySold: p.quantitySold.toNumber(),
        revenueUsd: roundUsd(p.revenueUsd).toNumber(),
        costUsd: roundUsd(p.costUsd).toNumber(),
        profitUsd: roundUsd(p.profitUsd).toNumber(),
      }))
      .sort((a, b) => b.profitUsd - a.profitUsd),
    profitByCategory: Array.from(categoryProfitMap.values())
      .map((c) => ({
        ...c,
        revenueUsd: roundUsd(c.revenueUsd).toNumber(),
        costUsd: roundUsd(c.costUsd).toNumber(),
        profitUsd: roundUsd(c.profitUsd).toNumber(),
      }))
      .sort((a, b) => b.profitUsd - a.profitUsd),
    profitByDate: Array.from(dateProfitMap.values())
      .map((d) => ({
        date: d.date,
        revenueUsd: roundUsd(d.revenueUsd).toNumber(),
        costUsd: roundUsd(d.costUsd).toNumber(),
        grossProfitUsd: roundUsd(d.grossProfitUsd).toNumber(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Generates the Balance Sheet up to `asOfDate`.
 * Verifies the fundamental accounting equation: Assets === Liabilities + Equity (including Net Profit).
 */
export async function getBalanceSheet(params?: {
  asOfDate?: Date;
  includeDemo?: boolean;
}) {
  const entryWhere: Prisma.JournalEntryWhereInput = {};
  if (params?.asOfDate) {
    entryWhere.date = { lte: params.asOfDate };
  }
  if (params?.includeDemo === false) {
    entryWhere.isDemo = false;
  }

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });

  const lines = await prisma.journalLine.findMany({
    where: { journalEntry: entryWhere },
    include: { account: true },
  });

  const balances = new Map<string, Decimal>();
  for (const acc of accounts) {
    balances.set(acc.id, new Decimal(0));
  }

  for (const line of lines) {
    const acc = line.account;
    const prev = balances.get(acc.id) || new Decimal(0);
    const debit = D(line.debitUsd);
    const credit = D(line.creditUsd);
    // For Balance Sheet: ASSET normal balance is DEBIT, LIABILITY & EQUITY normal balance is CREDIT
    // Note: Owner's Drawings (3200) is an EQUITY contra account with DEBIT normal balance;
    // On the Balance Sheet under Equity, we compute Equity in terms of Credit - Debit so Drawings reduces Equity!
    if (acc.type === 'ASSET') {
      balances.set(acc.id, prev.plus(debit.minus(credit)));
    } else if (acc.type === 'LIABILITY' || acc.type === 'EQUITY') {
      balances.set(acc.id, prev.plus(credit.minus(debit)));
    }
  }

  const pnl = await getProfitAndLoss({
    endDate: params?.asOfDate,
    includeDemo: params?.includeDemo,
  });

  const currentPeriodNetIncome = D(pnl.netProfitUsd);

  const assets: { code: string; nameEn: string; nameAr: string; nameKu: string; subType: string; balanceUsd: number }[] = [];
  const liabilities: { code: string; nameEn: string; nameAr: string; nameKu: string; subType: string; balanceUsd: number }[] = [];
  const equity: { code: string; nameEn: string; nameAr: string; nameKu: string; subType: string; balanceUsd: number }[] = [];

  let totalAssets = new Decimal(0);
  let totalLiabilities = new Decimal(0);
  let totalEquity = new Decimal(0);

  for (const acc of accounts) {
    const bal = roundUsd(balances.get(acc.id) || 0);
    if (bal.eq(0)) continue;

    const item = {
      code: acc.code,
      nameEn: acc.nameEn,
      nameAr: acc.nameAr,
      nameKu: acc.nameKu,
      subType: acc.subType,
      balanceUsd: bal.toNumber(),
    };

    if (acc.type === 'ASSET') {
      assets.push(item);
      totalAssets = totalAssets.plus(bal);
    } else if (acc.type === 'LIABILITY') {
      liabilities.push(item);
      totalLiabilities = totalLiabilities.plus(bal);
    } else if (acc.type === 'EQUITY') {
      equity.push(item);
      totalEquity = totalEquity.plus(bal);
    }
  }

  // Include Unappropriated Retained Earnings / Current Year Net Income in Equity
  if (!currentPeriodNetIncome.eq(0)) {
    equity.push({
      code: '3999',
      nameEn: 'Current Period Net Profit / (Loss)',
      nameAr: 'صافي الربح / (الخسارة) للفترة الحالية',
      nameKu: 'قازانجی سافی / (زیان)ی ماوەی ئێستا',
      subType: 'RETAINED_EARNINGS',
      balanceUsd: roundUsd(currentPeriodNetIncome).toNumber(),
    });
    totalEquity = totalEquity.plus(currentPeriodNetIncome);
  }

  totalAssets = roundUsd(totalAssets);
  totalLiabilities = roundUsd(totalLiabilities);
  totalEquity = roundUsd(totalEquity);
  const totalLiabilitiesAndEquity = roundUsd(totalLiabilities.plus(totalEquity));

  return {
    assets,
    liabilities,
    equity,
    totalAssetsUsd: totalAssets.toNumber(),
    totalLiabilitiesUsd: totalLiabilities.toNumber(),
    totalEquityUsd: totalEquity.toNumber(),
    totalLiabilitiesAndEquityUsd: totalLiabilitiesAndEquity.toNumber(),
    isBalanced: totalAssets.equals(totalLiabilitiesAndEquity),
  };
}

/**
 * Generates General Ledger statement for one or all accounts with running balance.
 */
export async function getGeneralLedger(params?: {
  accountId?: string;
  accountCode?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const whereLine: Prisma.JournalLineWhereInput = {};
  if (params?.accountId) {
    whereLine.accountId = params.accountId;
  } else if (params?.accountCode) {
    whereLine.account = { code: params.accountCode };
  }

  const dateFilter: Prisma.DateTimeFilter = {};
  if (params?.startDate) dateFilter.gte = params.startDate;
  if (params?.endDate) dateFilter.lte = params.endDate;

  if (params?.startDate || params?.endDate) {
    whereLine.journalEntry = { date: dateFilter };
  }

  const lines = await prisma.journalLine.findMany({
    where: whereLine,
    include: {
      account: true,
      journalEntry: true,
    },
    orderBy: [
      { journalEntry: { date: 'asc' } },
      { journalEntry: { createdAt: 'asc' } },
    ],
  });

  const runningByAccount = new Map<string, Decimal>();

  return lines.map((line) => {
    const acc = line.account;
    const prev = runningByAccount.get(acc.id) || new Decimal(0);
    const debit = D(line.debitUsd);
    const credit = D(line.creditUsd);
    const delta =
      acc.normalBalance === 'DEBIT' ? debit.minus(credit) : credit.minus(debit);
    const running = roundUsd(prev.plus(delta));
    runningByAccount.set(acc.id, running);

    return {
      lineId: line.id,
      entryId: line.journalEntryId,
      entryNumber: line.journalEntry.entryNumber,
      date: line.journalEntry.date,
      referenceType: line.journalEntry.referenceType,
      referenceId: line.journalEntry.referenceId,
      status: line.journalEntry.status,
      accountCode: acc.code,
      accountNameEn: acc.nameEn,
      accountNameAr: acc.nameAr,
      accountNameKu: acc.nameKu,
      description: line.description || line.journalEntry.description,
      debitUsd: roundUsd(debit).toNumber(),
      creditUsd: roundUsd(credit).toNumber(),
      runningBalanceUsd: running.toNumber(),
    };
  });
}
