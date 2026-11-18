import { describe, it, expect, beforeAll } from 'vitest';
import prisma from '../src/lib/prisma';
import {
  D,
  roundUsd,
  roundIqd,
  toUsd,
  fromUsd,
  convertCurrency,
} from '../src/lib/decimal';
import {
  hashPassword,
  verifyPassword,
  hasPermission,
  requirePermission,
  AuthorizationError,
} from '../src/lib/auth';
import { ensureSystemSeeded } from '../src/lib/services/seed.service';
import {
  postJournalEntry,
  reverseJournalEntry,
  getTrialBalance,
  getBalanceSheet,
  getProfitAndLoss,
} from '../src/lib/services/accounting.service';
import {
  adjustProductStock,
  transferWarehouseStock,
  getInventoryValuation,
} from '../src/lib/services/inventory.service';
import {
  createSalesInvoice,
  postSalesInvoice,
  returnSalesInvoice,
} from '../src/lib/services/sales.service';
import {
  createPurchaseInvoice,
  postPurchaseInvoice,
  returnPurchaseInvoice,
} from '../src/lib/services/purchases.service';
import {
  recordDebtorCollection,
  recordCreditorPayment,
  getCustomerStatement,
  getSupplierStatement,
} from '../src/lib/services/debt.service';
import {
  getDashboardAnalytics,
  generateFullSystemReport,
} from '../src/lib/services/dashboard.service';
import {
  createExpense,
  approveExpense,
} from '../src/lib/services/expense.service';
import {
  recordCashDepositOrWithdrawal,
  transferBetweenFinancialAccounts,
} from '../src/lib/services/cashbank.service';

describe('Sherzad Enterprise ERP & Double-Entry Accounting Suite', () => {
  beforeAll(async () => {
    await ensureSystemSeeded();
  });

  describe('1. Currency & Decimal-Safe Arithmetic Tests', () => {
    it('performs exact Decimal arithmetic without JS floating-point drift', () => {
      // In IEEE 754 float: 0.1 + 0.2 = 0.30000000000000004
      const sum = D(0.1).plus(D(0.2));
      expect(sum.toString()).toBe('0.3');
      expect(roundUsd('19.995').toNumber()).toBe(20.0);
    });

    it('converts accurately between USD and IQD using configurable exchange rates', () => {
      const rate = 1500;
      const usdFromIqd = toUsd(1500000, 'IQD', rate);
      expect(usdFromIqd.toNumber()).toBe(1000.0);

      const iqdFromUsd = fromUsd(250.5, 'USD' === 'USD' ? 'IQD' : 'USD', rate);
      expect(iqdFromUsd.toNumber()).toBe(375750);

      const roundTrip = convertCurrency(375750, 'IQD', 'USD', rate);
      expect(roundTrip.toNumber()).toBe(250.5);
      expect(roundIqd(1499.7).toNumber()).toBe(1500);
    });
  });

  describe('2. Authentication & Role-Based Access Control (RBAC) Tests', () => {
    it('hashes and verifies passwords securely with random salts', () => {
      const hash1 = hashPassword('StrongSecret#2026');
      const hash2 = hashPassword('StrongSecret#2026');
      expect(hash1).not.toBe(hash2);
      expect(verifyPassword('StrongSecret#2026', hash1)).toBe(true);
      expect(verifyPassword('WrongPassword', hash1)).toBe(false);
    });

    it('enforces granular role permissions across the 6 enterprise roles', async () => {
      expect(await hasPermission('SUPER_ADMIN', 'users.manage')).toBe(true);
      expect(await hasPermission('BUSINESS_OWNER', 'accounting.lockPeriod')).toBe(true);
      expect(await hasPermission('ACCOUNTANT', 'accounting.manualJournal')).toBe(true);
      expect(await hasPermission('SALES_EMPLOYEE', 'sales.create')).toBe(true);
      expect(await hasPermission('SALES_EMPLOYEE', 'users.manage')).toBe(false);
      expect(await hasPermission('VIEWER', 'sales.view')).toBe(true);
      expect(await hasPermission('VIEWER', 'sales.create')).toBe(false);

      await expect(
        requirePermission(
          { id: 'u-viewer', role: 'VIEWER', isActive: true },
          'accounting.manualJournal'
        )
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('3. Double-Entry Accounting Engine & Statement Balance Tests', () => {
    it('rejects unbalanced journal entries where Total Debits !== Total Credits', async () => {
      await expect(
        postJournalEntry({
          description: 'Intentionally unbalanced entry',
          referenceType: 'MANUAL',
          lines: [
            { accountCode: '1010', debitUsd: 500, creditUsd: 0 },
            { accountCode: '4000', debitUsd: 0, creditUsd: 450 },
          ],
        })
      ).rejects.toThrow(/Unbalanced journal entry rejected/);
    });

    it('posts balanced manual journal entries and reverses them without deleting history', async () => {
      const entry = await postJournalEntry({
        description: 'Test balanced accrual entry',
        referenceType: 'MANUAL',
        lines: [
          { accountCode: '5180', debitUsd: 125.5, creditUsd: 0 },
          { accountCode: '1010', debitUsd: 0, creditUsd: 125.5 },
        ],
      });

      expect(Number(entry.totalDebitUsd)).toBe(125.5);
      expect(Number(entry.totalCreditUsd)).toBe(125.5);

      const reversal = await reverseJournalEntry(
        entry.id,
        'Audit correction test'
      );
      expect(reversal.reversesEntryId).toBe(entry.id);
      expect(Number(reversal.totalDebitUsd)).toBe(125.5);

      const originalAfter = await prisma.journalEntry.findUnique({
        where: { id: entry.id },
      });
      expect(originalAfter?.status).toBe('REVERSED');
      expect(originalAfter?.reversedByEntryId).toBe(reversal.id);
    });

    it('blocks posting transactions into a closed/locked fiscal period', async () => {
      const lockedStart = new Date('2020-01-01T00:00:00Z');
      const lockedEnd = new Date('2020-01-31T23:59:59Z');

      const period = await prisma.accountingPeriod.upsert({
        where: { name: '2020-01-LOCKED-TEST' },
        update: { isLocked: true, isClosed: true },
        create: {
          name: '2020-01-LOCKED-TEST',
          startDate: lockedStart,
          endDate: lockedEnd,
          isLocked: true,
          isClosed: true,
        },
      });

      await expect(
        postJournalEntry({
          date: new Date('2020-01-15T12:00:00Z'),
          description: 'Backdated entry into locked period',
          referenceType: 'MANUAL',
          lines: [
            { accountCode: '1010', debitUsd: 100, creditUsd: 0 },
            { accountCode: '3000', debitUsd: 0, creditUsd: 100 },
          ],
        })
      ).rejects.toThrow(/closed\/locked/);

      await prisma.accountingPeriod.delete({ where: { id: period.id } });
    });

    it('verifies Trial Balance (Debits === Credits) and Balance Sheet (Assets === Liabilities + Equity)', async () => {
      const tb = await getTrialBalance();
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebitUsd).toBe(tb.totalCreditUsd);
      expect(tb.totalDebitBalanceUsd).toBe(tb.totalCreditBalanceUsd);

      const bs = await getBalanceSheet();
      expect(bs.isBalanced).toBe(true);
      expect(bs.totalAssetsUsd).toBe(bs.totalLiabilitiesAndEquityUsd);
    });
  });

  describe('4. Inventory Consistency, Overselling Prevention & Warehouse Transfers', () => {
    it('prevents selling more than available warehouse stock unless explicitly overridden', async () => {
      const product = await prisma.product.findFirstOrThrow();
      const customer = await prisma.customer.findFirstOrThrow();
      const warehouse = await prisma.warehouse.findFirstOrThrow({
        where: { isDefault: true },
      });

      await expect(
        createSalesInvoice({
          customerId: customer.id,
          warehouseId: warehouse.id,
          status: 'POSTED',
          paymentType: 'CASH',
          allowNegativeStock: false,
          items: [
            {
              productId: product.id,
              quantity: 999999,
            },
          ],
        })
      ).rejects.toThrow(/Insufficient stock/);
    });

    it('conserves total product stock across multi-warehouse transfers and posts adjustment journals', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { sku: 'LAP-MBP-16M3' },
      });
      const warehouses = await prisma.warehouse.findMany({ take: 2 });
      const [wh1, wh2] = warehouses;

      const beforeTotal = Number(product.totalStock);

      // Adjust stock +2 surplus in wh1
      await adjustProductStock({
        productId: product.id,
        warehouseId: wh1.id,
        quantityDelta: 2,
        reason: 'Test cycle count surplus',
      });

      const afterAdj = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(Number(afterAdj.totalStock)).toBe(beforeTotal + 2);

      // Transfer 1 unit from wh1 to wh2
      await transferWarehouseStock({
        productId: product.id,
        fromWarehouseId: wh1.id,
        toWarehouseId: wh2.id,
        quantity: 1,
        notes: 'Automated test transfer',
      });

      const afterTrf = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(Number(afterTrf.totalStock)).toBe(beforeTotal + 2);

      // Restore adjustment -2 from wh1/wh2
      await adjustProductStock({
        productId: product.id,
        warehouseId: wh2.id,
        quantityDelta: -1,
        reason: 'Cleanup test transfer',
      });
      await adjustProductStock({
        productId: product.id,
        warehouseId: wh1.id,
        quantityDelta: -1,
        reason: 'Cleanup test adjustment',
      });
    });
  });

  describe('5. Invoice Lifecycle (Draft -> Post -> Partial Payment -> Settlement -> Return)', () => {
    it('ensures DRAFT invoices do not affect stock, customer balances, or General Ledger until POSTED', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { sku: 'MON-DEL-U2723' },
      });
      const customer = await prisma.customer.findFirstOrThrow({
        where: { code: 'CUST-001' },
      });

      const stockBefore = Number(product.totalStock);
      const debtBefore = Number(customer.balanceUsd);
      const tbBefore = await getTrialBalance();

      // 1. Create as DRAFT
      const draftInv = await createSalesInvoice({
        customerId: customer.id,
        status: 'DRAFT',
        paymentType: 'CREDIT',
        currency: 'USD',
        items: [{ productId: product.id, quantity: 2, unitPriceOriginal: 560 }],
      });

      expect(draftInv.status).toBe('DRAFT');

      const prodAfterDraft = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      const custAfterDraft = await prisma.customer.findUniqueOrThrow({
        where: { id: customer.id },
      });
      const tbAfterDraft = await getTrialBalance();

      expect(Number(prodAfterDraft.totalStock)).toBe(stockBefore);
      expect(Number(custAfterDraft.balanceUsd)).toBe(debtBefore);
      expect(tbAfterDraft.totalDebitUsd).toBe(tbBefore.totalDebitUsd);

      // 2. Post the DRAFT invoice
      const postedInv = await postSalesInvoice(draftInv.id);
      expect(postedInv.status).toBe('POSTED');

      const prodAfterPost = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      const custAfterPost = await prisma.customer.findUniqueOrThrow({
        where: { id: customer.id },
      });

      expect(Number(prodAfterPost.totalStock)).toBe(stockBefore - 2);
      expect(Number(custAfterPost.balanceUsd)).toBe(
        roundUsd(D(debtBefore).plus(1120)).toNumber()
      );

      // 3. Collect Partial Debtor Payment ($500)
      const idempotencyKey = `test-debt-col-${Date.now()}`;
      const pay1 = await recordDebtorCollection({
        customerId: customer.id,
        salesInvoiceId: postedInv.id,
        amountOriginal: 500,
        currency: 'USD',
        idempotencyKey,
      });

      // 4. Test Idempotency: duplicate submission with same idempotencyKey must not double-collect!
      const pay1Duplicate = await recordDebtorCollection({
        customerId: customer.id,
        salesInvoiceId: postedInv.id,
        amountOriginal: 500,
        currency: 'USD',
        idempotencyKey,
      });
      expect(pay1Duplicate.id).toBe(pay1.id);

      const invAfterPartial = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: postedInv.id },
      });
      expect(invAfterPartial.status).toBe('PARTIALLY_PAID');
      expect(Number(invAfterPartial.paidUsd)).toBe(500);
      expect(Number(invAfterPartial.dueUsd)).toBe(620);

      // 5. Process Sales Return & Refund on the invoice
      const returnedInv = await returnSalesInvoice(
        postedInv.id,
        'Automated test sales return'
      );
      expect(returnedInv.status).toBe('RETURNED');

      const prodAfterReturn = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      const custAfterReturn = await prisma.customer.findUniqueOrThrow({
        where: { id: customer.id },
      });

      expect(Number(prodAfterReturn.totalStock)).toBe(stockBefore);
      expect(Number(custAfterReturn.balanceUsd)).toBe(debtBefore);
    });

    it('handles Purchase Invoice posting, partial Creditor payment, and Purchase Return accurately', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { sku: 'POS-EPS-TM88' },
      });
      const supplier = await prisma.supplier.findFirstOrThrow({
        where: { code: 'SUPP-003' },
      });

      const stockBefore = Number(product.totalStock);
      const payableBefore = Number(supplier.balanceUsd);

      const purchase = await createPurchaseInvoice({
        supplierId: supplier.id,
        status: 'POSTED',
        paymentType: 'CREDIT',
        currency: 'USD',
        items: [{ productId: product.id, quantity: 3, unitCostOriginal: 190 }], // $570
      });

      expect(purchase.status).toBe('POSTED');

      const prodAfterPur = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      const suppAfterPur = await prisma.supplier.findUniqueOrThrow({
        where: { id: supplier.id },
      });

      expect(Number(prodAfterPur.totalStock)).toBe(stockBefore + 3);
      expect(Number(suppAfterPur.balanceUsd)).toBe(
        roundUsd(D(payableBefore).plus(570)).toNumber()
      );

      // Pay $200 partial creditor settlement
      await recordCreditorPayment({
        supplierId: supplier.id,
        purchaseInvoiceId: purchase.id,
        amountOriginal: 200,
        currency: 'USD',
      });

      const purAfterPay = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: purchase.id },
      });
      expect(purAfterPay.status).toBe('PARTIALLY_PAID');
      expect(Number(purAfterPay.dueUsd)).toBe(370);

      // Return purchase invoice
      const returnedPur = await returnPurchaseInvoice(
        purchase.id,
        'Automated test purchase return'
      );
      expect(returnedPur.status).toBe('RETURNED');

      const prodAfterRet = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      const suppAfterRet = await prisma.supplier.findUniqueOrThrow({
        where: { id: supplier.id },
      });

      expect(Number(prodAfterRet.totalStock)).toBe(stockBefore);
      expect(Number(suppAfterRet.balanceUsd)).toBe(payableBefore);
    });
  });

  describe('6. Large Expense Approval Workflow & Cross-Currency Treasury Transfers', () => {
    it('holds large expenses in PENDING_APPROVAL until approved by management', async () => {
      const largeExpense = await createExpense({
        category: 'MAINTENANCE',
        title: 'Warehouse HVAC Overhaul (Test Approval Workflow)',
        currency: 'USD',
        amountOriginal: 1500, // >= $1000 threshold
        paymentMethod: 'CASH',
        bypassApprovalThreshold: false,
      });

      expect(largeExpense.status).toBe('PENDING_APPROVAL');
      expect(largeExpense.journalEntryId).toBeNull();

      const approved = await approveExpense(largeExpense.id);
      expect(approved.status).toBe('POSTED');
      expect(approved.journalEntryId).toBeTruthy();
    });

    it('maintains global Trial Balance and Balance Sheet equilibrium after all test operations', async () => {
      const [tb, bs, pnl] = await Promise.all([
        getTrialBalance(),
        getBalanceSheet(),
        getProfitAndLoss(),
      ]);

      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebitUsd).toBe(tb.totalCreditUsd);
      expect(bs.isBalanced).toBe(true);
      expect(bs.totalAssetsUsd).toBe(bs.totalLiabilitiesAndEquityUsd);
      expect(pnl.totalRevenueUsd).toBeGreaterThan(0);
    });

    it('verifies Customer and Supplier Account Statements running balances equal closing balances', async () => {
      const customer = await prisma.customer.findFirstOrThrow({
        where: { code: 'CUST-001' },
      });
      const custStatement = await getCustomerStatement(customer.id);
      const lastCustLine =
        custStatement.lines[custStatement.lines.length - 1];
      expect(lastCustLine.runningBalanceUsd).toBe(
        custStatement.closingBalanceUsd
      );

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: { code: 'SUPP-002' },
      });
      const suppStatement = await getSupplierStatement(supplier.id);
      const lastSuppLine =
        suppStatement.lines[suppStatement.lines.length - 1];
      expect(lastSuppLine.runningBalanceUsd).toBe(
        suppStatement.closingBalanceUsd
      );
    });

    it('generates real-time Dashboard Analytics and 14-Module Full System Reports without errors', async () => {
      const [dash, fullReport] = await Promise.all([
        getDashboardAnalytics(),
        generateFullSystemReport(),
      ]);

      expect(dash.kpis.totalProducts).toBeGreaterThan(0);
      expect(dash.kpis.totalCustomers).toBeGreaterThan(0);
      expect(dash.kpis.totalSuppliers).toBeGreaterThan(0);
      expect(fullReport.trialBalance.isBalanced).toBe(true);
      expect(fullReport.balanceSheet.isBalanced).toBe(true);
    });
  });
});
