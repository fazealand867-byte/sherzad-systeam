import fs from 'fs';
import path from 'path';
import prisma from '../src/lib/prisma';

async function exportPhpSeed() {
  const [
    settings,
    rateHistory,
    rolePermissions,
    users,
    auditLogs,
    periods,
    accounts,
    journals,
    journalLines,
    warehouses,
    categories,
    products,
    warehouseStocks,
    movements,
    transfers,
    customers,
    suppliers,
    financialAccounts,
    cashTransactions,
    salesInvoices,
    salesInvoiceItems,
    purchaseInvoices,
    purchaseInvoiceItems,
    debtPayments,
    expenses,
  ] = await Promise.all([
    prisma.companySettings.findFirst(),
    prisma.exchangeRateHistory.findMany({ orderBy: { effectiveDate: 'desc' } }),
    prisma.rolePermission.findMany(),
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.accountingPeriod.findMany({ orderBy: { startDate: 'desc' } }),
    prisma.account.findMany({ orderBy: { code: 'asc' } }),
    prisma.journalEntry.findMany({ orderBy: { date: 'desc' } }),
    prisma.journalLine.findMany(),
    prisma.warehouse.findMany({ orderBy: { isDefault: 'desc' } }),
    prisma.category.findMany({ orderBy: { nameEn: 'asc' } }),
    prisma.product.findMany({ orderBy: { nameEn: 'asc' } }),
    prisma.warehouseStock.findMany(),
    prisma.inventoryMovement.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.stockTransfer.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.customer.findMany({ orderBy: { name: 'asc' } }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.financialAccount.findMany({ orderBy: { code: 'asc' } }),
    prisma.cashTransaction.findMany({ orderBy: { date: 'desc' } }),
    prisma.salesInvoice.findMany({ orderBy: { date: 'desc' } }),
    prisma.salesInvoiceItem.findMany(),
    prisma.purchaseInvoice.findMany({ orderBy: { date: 'desc' } }),
    prisma.purchaseInvoiceItem.findMany(),
    prisma.debtPayment.findMany({ orderBy: { date: 'desc' } }),
    prisma.expense.findMany({ orderBy: { date: 'desc' } }),
  ]);

  const payload = {
    activeUserId: users[0]?.id || null,
    settings,
    rateHistory,
    rolePermissions,
    users,
    auditLogs,
    periods,
    accounts,
    journals,
    journalLines,
    warehouses,
    categories,
    products,
    warehouseStocks,
    movements,
    transfers,
    customers,
    suppliers,
    financialAccounts,
    cashTransactions,
    salesInvoices,
    salesInvoiceItems,
    purchaseInvoices,
    purchaseInvoiceItems,
    debtPayments,
    expenses,
  };

  const storageDir = path.join(process.cwd(), 'public', 'api', 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  const jsonStr = JSON.stringify(payload, null, 2);
  fs.writeFileSync(path.join(storageDir, 'initial_seed.json'), jsonStr, 'utf-8');
  fs.writeFileSync(path.join(storageDir, 'erp_database.json'), jsonStr, 'utf-8');
  console.log('Exported clean PHP database state to public/api/storage/erp_database.json');
}

exportPhpSeed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
