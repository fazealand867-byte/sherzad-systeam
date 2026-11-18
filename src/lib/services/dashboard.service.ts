import prisma from '../prisma';
import { D, roundUsd } from '../decimal';
import { getBalanceSheet, getProfitAndLoss, getTrialBalance } from './accounting.service';
import { getInventoryValuation } from './inventory.service';

export async function getDashboardAnalytics(params?: {
  period?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  includeDemo?: boolean;
}) {
  const settings = await prisma.companySettings.findFirst();
  const exchangeRate = D(settings?.usdToIqdRate || 1500).toNumber();

  // 1. Profit & Loss statement for accurate Revenue, COGS, Expenses, and Net Profit
  const pnl = await getProfitAndLoss({ includeDemo: params?.includeDemo });

  // 2. Inventory Valuation & Low-Stock items
  const inventoryVal = await getInventoryValuation();

  // 3. Posted Purchases Total
  const postedPurchases = await prisma.purchaseInvoice.findMany({
    where: {
      status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
      ...(params?.includeDemo === false ? { isDemo: false } : {}),
    },
    include: { supplier: true },
    orderBy: { date: 'desc' },
  });

  let totalPurchasesUsd = D(0);
  for (const p of postedPurchases) {
    totalPurchasesUsd = totalPurchasesUsd.plus(D(p.totalUsd));
  }

  // 4. Posted Sales Invoices
  const postedSales = await prisma.salesInvoice.findMany({
    where: {
      status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
      ...(params?.includeDemo === false ? { isDemo: false } : {}),
    },
    include: { customer: true },
    orderBy: { date: 'desc' },
  });

  let totalSalesInvoicedUsd = D(0);
  for (const s of postedSales) {
    totalSalesInvoicedUsd = totalSalesInvoicedUsd.plus(D(s.totalUsd));
  }

  // 5. Customers & Total Customer Debts (Debtors AR)
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    orderBy: { balanceUsd: 'desc' },
  });
  let totalCustomerDebtsUsd = D(0);
  for (const c of customers) {
    if (D(c.balanceUsd).gt(0)) {
      totalCustomerDebtsUsd = totalCustomerDebtsUsd.plus(D(c.balanceUsd));
    }
  }

  // 6. Suppliers & Total Supplier Liabilities (Creditors AP)
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { balanceUsd: 'desc' },
  });
  let totalSupplierLiabilitiesUsd = D(0);
  for (const s of suppliers) {
    if (D(s.balanceUsd).gt(0)) {
      totalSupplierLiabilitiesUsd = totalSupplierLiabilitiesUsd.plus(
        D(s.balanceUsd)
      );
    }
  }

  // 7. Cash & Bank Accounts Balance
  const financialAccounts = await prisma.financialAccount.findMany({
    where: { isActive: true },
    include: { ledgerAccount: true },
  });
  let totalCashAndBankUsd = D(0);
  let cashRegistersUsd = D(0);
  let bankAccountsUsd = D(0);
  for (const fa of financialAccounts) {
    const bal = D(fa.balanceUsd);
    totalCashAndBankUsd = totalCashAndBankUsd.plus(bal);
    if (fa.type === 'CASH_REGISTER') {
      cashRegistersUsd = cashRegistersUsd.plus(bal);
    } else {
      bankAccountsUsd = bankAccountsUsd.plus(bal);
    }
  }

  // 8. Unpaid & Overdue Invoices
  const now = new Date();
  const unpaidSalesInvoices = postedSales
    .filter((s) => D(s.dueUsd).gt(0))
    .map((s) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      partyName: s.customer.name,
      date: s.date,
      dueDate: s.dueDate,
      totalUsd: roundUsd(s.totalUsd).toNumber(),
      paidUsd: roundUsd(s.paidUsd).toNumber(),
      dueUsd: roundUsd(s.dueUsd).toNumber(),
      currency: s.currency,
      isOverdue: s.dueDate ? new Date(s.dueDate) < now : false,
      type: 'SALE' as const,
    }));

  const unpaidPurchaseInvoices = postedPurchases
    .filter((p) => D(p.dueUsd).gt(0))
    .map((p) => ({
      id: p.id,
      invoiceNumber: p.invoiceNumber,
      partyName: p.supplier.name,
      date: p.date,
      dueDate: p.dueDate,
      totalUsd: roundUsd(p.totalUsd).toNumber(),
      paidUsd: roundUsd(p.paidUsd).toNumber(),
      dueUsd: roundUsd(p.dueUsd).toNumber(),
      currency: p.currency,
      isOverdue: p.dueDate ? new Date(p.dueDate) < now : false,
      type: 'PURCHASE' as const,
    }));

  // 9. Pending Approval Expenses
  const pendingExpenses = await prisma.expense.findMany({
    where: { status: 'PENDING_APPROVAL' },
    orderBy: { date: 'desc' },
  });

  const postedExpenses = await prisma.expense.findMany({
    where: { status: 'POSTED' },
    orderBy: { date: 'desc' },
  });

  // 10. Low-Stock Products
  const lowStockProducts = inventoryVal.items.filter(
    (item) => item.isLowStock || item.isOutOfStock
  );

  // 11. Recent Transactions across Journal Entries
  const recentJournals = await prisma.journalEntry.findMany({
    take: 15,
    orderBy: { date: 'desc' },
    include: {
      lines: {
        include: { account: true },
      },
    },
  });

  // 12. Time-series chart data (Daily, Weekly, Monthly, Yearly)
  const dailyMap = new Map<
    string,
    { label: string; salesUsd: number; purchasesUsd: number; expensesUsd: number; profitUsd: number }
  >();
  const monthlyMap = new Map<
    string,
    { label: string; salesUsd: number; purchasesUsd: number; expensesUsd: number; profitUsd: number }
  >();

  // Seed last 14 days and last 6 months keys so charts are continuous and rich
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, {
      label: key.slice(5), // MM-DD
      salesUsd: 0,
      purchasesUsd: 0,
      expensesUsd: 0,
      profitUsd: 0,
    });
  }

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(key, {
      label: key,
      salesUsd: 0,
      purchasesUsd: 0,
      expensesUsd: 0,
      profitUsd: 0,
    });
  }

  for (const s of postedSales) {
    const dayKey = s.date.toISOString().slice(0, 10);
    const monthKey = dayKey.slice(0, 7);
    const rev = roundUsd(D(s.subtotalUsd).minus(D(s.discountUsd))).toNumber();
    const gp = roundUsd(s.grossProfitUsd).toNumber();

    const dRow = dailyMap.get(dayKey) || {
      label: dayKey.slice(5),
      salesUsd: 0,
      purchasesUsd: 0,
      expensesUsd: 0,
      profitUsd: 0,
    };
    dRow.salesUsd = roundUsd(D(dRow.salesUsd).plus(rev)).toNumber();
    dRow.profitUsd = roundUsd(D(dRow.profitUsd).plus(gp)).toNumber();
    dailyMap.set(dayKey, dRow);

    const mRow = monthlyMap.get(monthKey) || {
      label: monthKey,
      salesUsd: 0,
      purchasesUsd: 0,
      expensesUsd: 0,
      profitUsd: 0,
    };
    mRow.salesUsd = roundUsd(D(mRow.salesUsd).plus(rev)).toNumber();
    mRow.profitUsd = roundUsd(D(mRow.profitUsd).plus(gp)).toNumber();
    monthlyMap.set(monthKey, mRow);
  }

  for (const p of postedPurchases) {
    const dayKey = p.date.toISOString().slice(0, 10);
    const monthKey = dayKey.slice(0, 7);
    const amt = roundUsd(p.totalUsd).toNumber();

    const dRow = dailyMap.get(dayKey);
    if (dRow) {
      dRow.purchasesUsd = roundUsd(D(dRow.purchasesUsd).plus(amt)).toNumber();
    }
    const mRow = monthlyMap.get(monthKey);
    if (mRow) {
      mRow.purchasesUsd = roundUsd(D(mRow.purchasesUsd).plus(amt)).toNumber();
    }
  }

  for (const e of postedExpenses) {
    const dayKey = e.date.toISOString().slice(0, 10);
    const monthKey = dayKey.slice(0, 7);
    const amt = roundUsd(e.amountUsd).toNumber();

    const dRow = dailyMap.get(dayKey);
    if (dRow) {
      dRow.expensesUsd = roundUsd(D(dRow.expensesUsd).plus(amt)).toNumber();
      dRow.profitUsd = roundUsd(D(dRow.profitUsd).minus(amt)).toNumber();
    }
    const mRow = monthlyMap.get(monthKey);
    if (mRow) {
      mRow.expensesUsd = roundUsd(D(mRow.expensesUsd).plus(amt)).toNumber();
      mRow.profitUsd = roundUsd(D(mRow.profitUsd).minus(amt)).toNumber();
    }
  }

  return {
    kpis: {
      totalSalesUsd: pnl.netSalesRevenueUsd,
      totalSalesInvoicedUsd: roundUsd(totalSalesInvoicedUsd).toNumber(),
      totalPurchasesUsd: roundUsd(totalPurchasesUsd).toNumber(),
      totalExpensesUsd: pnl.operatingExpensesUsd,
      grossProfitUsd: pnl.grossProfitUsd,
      netProfitUsd: pnl.netProfitUsd,
      grossMarginPercent: pnl.grossMarginPercent,
      netMarginPercent: pnl.netMarginPercent,
      totalCustomerDebtsUsd: roundUsd(totalCustomerDebtsUsd).toNumber(),
      totalSupplierLiabilitiesUsd: roundUsd(totalSupplierLiabilitiesUsd).toNumber(),
      cashBalanceUsd: roundUsd(totalCashAndBankUsd).toNumber(),
      cashRegistersUsd: roundUsd(cashRegistersUsd).toNumber(),
      bankAccountsUsd: roundUsd(bankAccountsUsd).toNumber(),
      inventoryCostValueUsd: inventoryVal.totalCostValueUsd,
      inventoryRetailValueUsd: inventoryVal.totalRetailValueUsd,
      totalCustomers: customers.length,
      totalSuppliers: suppliers.length,
      totalProducts: inventoryVal.totalProducts,
      lowStockCount: lowStockProducts.length,
      unpaidSalesCount: unpaidSalesInvoices.length,
      unpaidPurchasesCount: unpaidPurchaseInvoices.length,
      pendingExpensesCount: pendingExpenses.length,
      exchangeRate,
    },
    financialAccounts: financialAccounts.map((fa) => ({
      id: fa.id,
      code: fa.code,
      nameEn: fa.nameEn,
      nameAr: fa.nameAr,
      nameKu: fa.nameKu,
      type: fa.type,
      currency: fa.currency,
      balanceOriginal: D(fa.balanceOriginal).toNumber(),
      balanceUsd: roundUsd(fa.balanceUsd).toNumber(),
    })),
    lowStockProducts: lowStockProducts.slice(0, 12),
    unpaidInvoices: [...unpaidSalesInvoices, ...unpaidPurchaseInvoices]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 15),
    pendingExpenses,
    recentTransactions: recentJournals.map((j) => ({
      id: j.id,
      entryNumber: j.entryNumber,
      date: j.date,
      description: j.description,
      referenceType: j.referenceType,
      totalDebitUsd: roundUsd(j.totalDebitUsd).toNumber(),
      totalCreditUsd: roundUsd(j.totalCreditUsd).toNumber(),
      status: j.status,
    })),
    charts: {
      daily: Array.from(dailyMap.values()),
      monthly: Array.from(monthlyMap.values()),
      expenseByCategory: pnl.operatingExpenseBreakdown,
      profitByCategory: pnl.profitByCategory,
    },
  };
}

/**
 * Generates comprehensive financial and operational reports for Section 3L.
 */
export async function generateFullSystemReport(params?: {
  startDate?: Date;
  endDate?: Date;
}) {
  const [trialBalance, profitAndLoss, balanceSheet, inventoryValuation, dashboard] =
    await Promise.all([
      getTrialBalance({ startDate: params?.startDate, endDate: params?.endDate }),
      getProfitAndLoss({ startDate: params?.startDate, endDate: params?.endDate }),
      getBalanceSheet({ asOfDate: params?.endDate }),
      getInventoryValuation(),
      getDashboardAnalytics(),
    ]);

  const cashTransactions = await prisma.cashTransaction.findMany({
    where:
      params?.startDate || params?.endDate
        ? {
            date: {
              ...(params.startDate ? { gte: params.startDate } : {}),
              ...(params.endDate ? { lte: params.endDate } : {}),
            },
          }
        : undefined,
    include: { financialAccount: true },
    orderBy: { date: 'desc' },
    take: 100,
  });

  let cashInflowsUsd = D(0);
  let cashOutflowsUsd = D(0);
  for (const ct of cashTransactions) {
    if (ct.type === 'TRANSFER') continue; // Internal transfers don't change total cash flow
    if (ct.direction === 'IN') {
      cashInflowsUsd = cashInflowsUsd.plus(D(ct.amountUsd));
    } else {
      cashOutflowsUsd = cashOutflowsUsd.plus(D(ct.amountUsd));
    }
  }

  return {
    trialBalance,
    profitAndLoss,
    balanceSheet,
    inventoryValuation,
    cashFlow: {
      totalInflowsUsd: roundUsd(cashInflowsUsd).toNumber(),
      totalOutflowsUsd: roundUsd(cashOutflowsUsd).toNumber(),
      netCashFlowUsd: roundUsd(cashInflowsUsd.minus(cashOutflowsUsd)).toNumber(),
      closingCashAndBankUsd: dashboard.kpis.cashBalanceUsd,
      recentCashMovements: cashTransactions.slice(0, 30),
    },
    summary: dashboard.kpis,
  };
}
