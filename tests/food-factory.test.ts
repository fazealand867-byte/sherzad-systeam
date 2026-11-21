import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import {
  DEFAULT_UNITS,
  areUnitsCompatible,
  convertQuantity,
  convertUnitPrice,
  getCompatibleUnits,
  normalizeUnitCode,
} from '../src/lib/units';
import { fmtIqd, fmtQty } from '../src/lib/client-utils';

describe('1. Decimal-Safe Measurement Unit Conversions & IQD Formatting', () => {
  it('converts compatible weight units accurately with zero float drift', () => {
    expect(convertQuantity(1, 'kg', 'g')).toBe(1000);
    expect(convertQuantity(500, 'g', 'kg')).toBe(0.5);
    expect(convertQuantity(250, 'g', 'kg')).toBe(0.25);
    expect(convertQuantity(1.5, 'kg', 'g')).toBe(1500);
    expect(convertQuantity('0.1', 'kg', 'g')).toBe(100);
    expect(convertQuantity('0.2', 'kg', 'g')).toBe(200);
    expect(convertQuantity(300, 'g', 'kg')).toBe(0.3);
  });

  it('converts unit prices proportionally between compatible units', () => {
    // 12,000 IQD per kg => 12 IQD per gram
    expect(convertUnitPrice(12000, 'kg', 'g')).toBe(12);
    // 15 IQD per gram => 15,000 IQD per kg
    expect(convertUnitPrice(15, 'g', 'kg')).toBe(15000);
  });

  it('blocks invalid conversions between incompatible measurement units', () => {
    expect(areUnitsCompatible('kg', 'g')).toBe(true);
    expect(areUnitsCompatible('kg', 'piece')).toBe(false);
    expect(areUnitsCompatible('piece', 'box')).toBe(false);
    expect(areUnitsCompatible('tray', 'g')).toBe(false);

    expect(() => convertQuantity(5, 'kg', 'piece')).toThrow(/Incompatible unit conversion/);
    expect(() => convertQuantity(10, 'piece', 'kg')).toThrow(/Incompatible unit conversion/);
    expect(() => convertQuantity(2, 'box', 'tray')).toThrow(/Incompatible unit conversion/);
  });

  it('supports custom units linked to an existing base unit while isolating standalone custom units', () => {
    const customUnits = [
      ...DEFAULT_UNITS,
      {
        id: 'u_sack',
        code: 'sack',
        symbol: 'فەردە',
        nameKu: 'فەردە',
        nameAr: 'كيس 50كغ',
        nameEn: '50kg Sack',
        family: 'WEIGHT',
        baseUnitCode: 'g',
        toBaseFactor: 50000,
        allowDecimal: true,
      },
      {
        id: 'u_bottle',
        code: 'bottle',
        symbol: 'بتڵ',
        nameKu: 'بتڵ',
        nameAr: 'قنينة',
        nameEn: 'Bottle',
        family: 'CUSTOM_BOTTLE',
        baseUnitCode: 'bottle',
        toBaseFactor: 1,
        allowDecimal: false,
      },
    ];

    expect(convertQuantity(2, 'sack', 'kg', customUnits)).toBe(100);
    expect(convertQuantity(25, 'kg', 'sack', customUnits)).toBe(0.5);
    expect(() => convertQuantity(1, 'bottle', 'kg', customUnits)).toThrow(/Incompatible/);
    expect(getCompatibleUnits('kg', customUnits).map((u) => u.code)).toContain('sack');
    expect(getCompatibleUnits('kg', customUnits).map((u) => u.code)).not.toContain('bottle');
  });

  it('normalizes legacy unit codes cleanly and formats IQD & quantities', () => {
    expect(normalizeUnitCode('PCS')).toBe('piece');
    expect(normalizeUnitCode('KG')).toBe('kg');
    expect(normalizeUnitCode('BOX')).toBe('box');
    expect(fmtIqd(750000, 'ku')).toBe('750,000 د.ع');
    expect(fmtIqd(750000, 'en')).toBe('750,000 IQD');
    expect(fmtQty(2.5)).toBe('2.5');
    expect(fmtQty(150)).toBe('150');
  });
});

describe('2. End-to-End Food Factory PHP 8 API & Safe Migration Verification', () => {
  let tmpDir: string;
  let phpProc: ChildProcess;
  const port = 18923;
  const baseUrl = `http://127.0.0.1:${port}/api/index.php`;

  async function apiGet(route: string, query = '') {
    const res = await fetch(`${baseUrl}?route=${route}${query ? '&' + query : ''}`);
    const text = await res.text();
    try {
      return { status: res.status, ok: res.ok, data: JSON.parse(text) };
    } catch (err) {
      throw new Error(`Invalid JSON from GET ${route} (${res.status}): ${text.slice(0, 600)}`);
    }
  }

  async function apiPost(route: string, body: Record<string, any>) {
    const res = await fetch(`${baseUrl}?route=${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, ok: res.ok, data: JSON.parse(text) };
    } catch (err) {
      throw new Error(`Invalid JSON from POST ${route} (${res.status}): ${text.slice(0, 600)}`);
    }
  }

  beforeAll(async () => {
    // Create an isolated copy of api/ + REAL historical pre-v2 database backup so we test
    // live migration + every workflow safely without touching production storage!
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherzad-food-test-'));
    const apiDir = path.join(tmpDir, 'api');
    const storageDir = path.join(apiDir, 'storage');
    fs.mkdirSync(storageDir, { recursive: true });

    const repoRoot = process.cwd();
    for (const file of ['config.php', 'Engine.php', 'index.php']) {
      fs.copyFileSync(path.join(repoRoot, 'public', 'api', file), path.join(apiDir, file));
    }
    const backupDb = path.join(repoRoot, 'api', 'storage', 'backups', 'erp_database_pre_v2_backup.json');
    const sourceDb = fs.existsSync(backupDb)
      ? backupDb
      : path.join(repoRoot, 'api', 'storage', 'erp_database.json');
    fs.copyFileSync(sourceDb, path.join(storageDir, 'erp_database.json'));

    phpProc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', tmpDir], {
      stdio: 'ignore',
    });

    // Wait for PHP server to respond
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${baseUrl}?route=bootstrap`);
        if (res.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 20000);

  afterAll(() => {
    if (phpProc) phpProc.kill();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('safely migrates existing v1 database to IQD-only v2 while preserving historical data & balanced GL', async () => {
    const boot = await apiGet('bootstrap');
    expect(boot.ok).toBe(true);
    expect(boot.data.settings.baseCurrency).toBe('IQD');
    expect(boot.data.settings.defaultLanguage).toBe('ku');
    expect(boot.data.units.length).toBeGreaterThanOrEqual(6);
    expect(boot.data.expenseCategories.length).toBeGreaterThanOrEqual(9);
    expect(boot.data.employees.length).toBeGreaterThanOrEqual(4);
    // Historical 6 products + starter food products all preserved!
    expect(boot.data.products.length).toBeGreaterThanOrEqual(15);

    // Check historical accounting statements remain 100% balanced in IQD!
    const acc = await apiGet('accounting');
    expect(acc.ok).toBe(true);
    expect(acc.data.trialBalance.isBalanced).toBe(true);
    expect(acc.data.trialBalance.totalDebitIqd).toBe(509610000);
    expect(acc.data.trialBalance.totalCreditIqd).toBe(509610000);
    expect(acc.data.balanceSheet.isBalanced).toBe(true);
    expect(acc.data.balanceSheet.totalAssetsIqd).toBe(acc.data.balanceSheet.totalLiabilitiesAndEquityIqd);
  });

  it('adds products, converts compatible measurement units, records fractional quantities, and safely deletes unused products', async () => {
    // 1. Add a new raw material with fractional opening stock entered in grams (2500 g => 2.5 kg!)
    const created = await apiPost('inventory', {
      action: 'createProduct',
      nameKu: 'گۆشتی بەرخ',
      nameEn: 'Lamb Meat',
      productType: 'RAW_MATERIAL',
      unit: 'kg',
      purchaseCostIqd: 18000,
      sellingPriceIqd: 22000,
      initialStock: 2500,
      initialStockUnit: 'g',
      minStockLevel: 1,
    });
    expect(created.ok).toBe(true);
    expect(created.data.product.totalStock).toBe(2.5);
    const lambId = created.data.product.id;

    // 2. Reject incompatible unit conversion on stock adjustment (piece -> kg)
    const badAdj = await apiPost('inventory', {
      action: 'adjustStock',
      productId: lambId,
      quantityDelta: 5,
      unit: 'piece',
      reason: 'Invalid test',
    });
    expect(badAdj.ok).toBe(false);
    expect(badAdj.data.error).toMatch(/Incompatible unit conversion/);

    // 3. Compatible unit adjustment: +500 g => +0.5 kg (total becomes 3.0 kg)
    const goodAdj = await apiPost('inventory', {
      action: 'adjustStock',
      productId: lambId,
      quantityDelta: 500,
      unit: 'g',
      reason: 'Added 500g',
      idempotencyKey: 'adj-lamb-500g',
    });
    expect(goodAdj.ok).toBe(true);
    expect(goodAdj.data.totalStock).toBe(3);

    // 4. Duplicate idempotencyKey must NOT double-adjust stock
    const dupAdj = await apiPost('inventory', {
      action: 'adjustStock',
      productId: lambId,
      quantityDelta: 500,
      unit: 'g',
      reason: 'Added 500g',
      idempotencyKey: 'adj-lamb-500g',
    });
    expect(dupAdj.ok).toBe(true);
    expect(dupAdj.data.totalStock).toBe(3);

    // 5. Switch product unit from kg -> g safely (3 kg => 3000 g!)
    const unitSwitch = await apiPost('inventory', {
      action: 'updateProduct',
      productId: lambId,
      unit: 'g',
    });
    expect(unitSwitch.ok).toBe(true);
    expect(unitSwitch.data.product.unit).toBe('g');
    expect(unitSwitch.data.product.totalStock).toBe(3000);

    // 6. Attempt to delete used product -> must be rejected!
    const delUsed = await apiPost('inventory', { action: 'deleteProduct', productId: lambId });
    expect(delUsed.ok).toBe(false);

    // 7. Create an unused product and safely delete it -> succeeds!
    const unused = await apiPost('inventory', {
      action: 'createProduct',
      nameKu: 'تاقیکردنەوە',
      unit: 'piece',
      purchaseCostIqd: 1000,
      sellingPriceIqd: 2000,
      initialStock: 0,
    });
    expect(unused.ok).toBe(true);
    const delUnused = await apiPost('inventory', { action: 'deleteProduct', productId: unused.data.product.id });
    expect(delUnused.ok).toBe(true);
    expect(delUnused.data.deleted).toBe(true);
  });

  it('creates custom expense categories, records simple IQD expenses, and pays employee salaries (partial, full, advance, remaining balance, duplicate guard, zero double counting)', async () => {
    // 1. Add custom expense category
    const catRes = await apiPost('expenses', {
      action: 'createExpenseCategory',
      nameKu: 'پاککردنەوە',
      nameEn: 'Cleaning',
    });
    expect(catRes.ok).toBe(true);

    // 2. Record normal simple IQD expense (only category, amount, date, note!)
    const expRes = await apiPost('expenses', {
      action: 'createExpense',
      category: 'GAS',
      amountIqd: 75000,
      date: '2026-11-21',
      notes: 'Gas cylinders refill',
      idempotencyKey: 'exp-gas-1',
    });
    expect(expRes.ok).toBe(true);
    expect(expRes.data.expense.amountIqd).toBe(75000);
    expect(expRes.data.expense.currency).toBe('IQD');

    // 3. Register a new employee: Ahmed (750,000 IQD monthly salary)
    const empRes = await apiPost('employees', {
      action: 'createEmployee',
      name: 'Ahmed Test',
      phone: '07501234567',
      position: 'Shawarma Chef',
      monthlySalaryIqd: 750000,
    });
    expect(empRes.ok).toBe(true);
    const ahmedId = empRes.data.employee.id;
    expect(empRes.data.employee.remainingSalaryIqd).toBe(750000);

    // Snapshot P&L operating expenses BEFORE salary payment
    const pnlBefore = (await apiGet('accounting')).data.profitAndLoss.operatingExpensesIqd;

    // 4. Pay partial salary via Expenses endpoint (300,000 IQD)
    const sal1 = await apiPost('expenses', {
      action: 'createExpense',
      category: 'SALARIES',
      employeeId: ahmedId,
      amountIqd: 300000,
      paymentType: 'PARTIAL',
      salaryMonth: '2026-11',
      date: '2026-11-21',
      notes: 'First half salary',
      idempotencyKey: 'sal-ahmed-1',
    });
    expect(sal1.ok).toBe(true);
    expect(sal1.data.salaryPayment.employeeName).toBe('Ahmed Test');
    expect(sal1.data.salaryPayment.employeePhone).toBe('07501234567');
    expect(sal1.data.salaryPayment.remainingAfterIqd).toBe(450000);

    // 5. Verify ZERO double-counting: P&L operatingExpenses increased by EXACTLY 300,000 IQD!
    const pnlAfter1 = (await apiGet('accounting')).data.profitAndLoss.operatingExpensesIqd;
    expect(pnlAfter1 - pnlBefore).toBe(300000);

    // 6. Accidental duplicate payment (same employee + same amount + same day without confirmDuplicate) must be blocked with 409!
    const dupSal = await apiPost('expenses', {
      action: 'createExpense',
      category: 'SALARIES',
      employeeId: ahmedId,
      amountIqd: 300000,
      paymentType: 'PARTIAL',
      salaryMonth: '2026-11',
      date: '2026-11-21',
      idempotencyKey: 'sal-ahmed-dup-new-key',
    });
    expect(dupSal.status).toBe(409);
    expect(dupSal.data.code).toBe('POSSIBLE_DUPLICATE');

    // 7. Pay remaining 450,000 IQD -> remaining balance becomes 0!
    const sal2 = await apiPost('employees', {
      action: 'paySalary',
      employeeId: ahmedId,
      amountIqd: 450000,
      paymentType: 'FULL',
      salaryMonth: '2026-11',
      date: '2026-11-21',
      idempotencyKey: 'sal-ahmed-2',
    });
    expect(sal2.ok).toBe(true);
    expect(sal2.data.salaryPayment.remainingAfterIqd).toBe(0);
    expect(sal2.data.employee.paidThisMonthIqd).toBe(750000);
    expect(sal2.data.employee.salaryStatus).toBe('PAID');

    // 8. Salary advance (100,000 IQD) works cleanly
    const adv = await apiPost('employees', {
      action: 'paySalary',
      employeeId: ahmedId,
      amountIqd: 100000,
      paymentType: 'ADVANCE',
      salaryMonth: '2026-11',
      date: '2026-11-21',
      idempotencyKey: 'sal-ahmed-adv',
    });
    expect(adv.ok).toBe(true);
    expect(adv.data.employee.advancesThisMonthIqd).toBe(100000);
  });

  it('records purchases, recipe-based food production without double-deducting, spoilage waste, sales with unit conversion, and maintains balanced accounting statements', async () => {
    const boot = (await apiGet('bootstrap')).data;
    const chicken = boot.products.find((p: any) => p.sku === 'RAW-CHICKEN');
    const spices = boot.products.find((p: any) => p.sku === 'RAW-SPICES');
    const oil = boot.products.find((p: any) => p.sku === 'RAW-OIL');
    const shawarma = boot.products.find((p: any) => p.sku === 'FOOD-SHAWARMA');
    const supplier = boot.suppliers[0];
    const customer = boot.customers[0];

    expect(chicken).toBeTruthy();
    expect(shawarma).toBeTruthy();

    // 1. Purchase raw materials (25 kg Chicken, 2 kg Spices [stored in g -> +2000 g!], 5 kg Oil) with partial payment
    const pur = await apiPost('purchases', {
      action: 'createInvoice',
      supplierId: supplier.id,
      paymentType: 'PARTIAL',
      paidIqd: 100000,
      idempotencyKey: 'pur-raw-1',
      items: [
        { productId: chicken.id, quantity: 25, unit: 'kg', unitCostIqd: 6000 }, // 150,000
        { productId: spices.id, quantity: 2, unit: 'kg', unitCostIqd: 15000 }, // 30,000 (+2000 g)
        { productId: oil.id, quantity: 5, unit: 'kg', unitCostIqd: 2500 }, // 12,500
      ],
    });
    expect(pur.ok).toBe(true);
    expect(pur.data.invoice.totalIqd).toBe(192500);
    expect(pur.data.invoice.dueIqd).toBe(92500);

    // Verify spices stock converted accurately from 2 kg -> 2000 g!
    const invAfterPur = (await apiGet('inventory')).data.valuation.items;
    const spicesItem = invAfterPur.find((i: any) => i.productId === spices.id);
    expect(spicesItem.quantity).toBe(2000);

    // 2. Record Recipe-Based Production: 10 kg Shawarma (consumes 10.5 kg chicken, 250 g spices, 500 g = 0.5 kg oil)
    const prodBatch = await apiPost('production', {
      action: 'recordProduction',
      mode: 'RECIPE',
      finishedProductId: shawarma.id,
      quantityProduced: 10,
      unit: 'kg',
      idempotencyKey: 'prd-shawarma-1',
    });
    expect(prodBatch.ok).toBe(true);

    // Duplicate idempotencyKey must NOT deduct raw materials twice!
    const dupBatch = await apiPost('production', {
      action: 'recordProduction',
      mode: 'RECIPE',
      finishedProductId: shawarma.id,
      quantityProduced: 10,
      unit: 'kg',
      idempotencyKey: 'prd-shawarma-1',
    });
    expect(dupBatch.ok).toBe(true);
    expect(dupBatch.data.batch.id).toBe(prodBatch.data.batch.id);

    const invAfterProd = (await apiGet('inventory')).data.valuation.items;
    expect(invAfterProd.find((i: any) => i.productId === chicken.id).quantity).toBe(14.5); // 25 - 10.5
    expect(invAfterProd.find((i: any) => i.productId === spices.id).quantity).toBe(1750); // 2000 - 250
    expect(invAfterProd.find((i: any) => i.productId === oil.id).quantity).toBe(4.5); // 5 - 0.5
    expect(invAfterProd.find((i: any) => i.productId === shawarma.id).quantity).toBe(10);

    // 3. Record 500 g spoilage waste on Shawarma (10 kg -> 9.5 kg)
    const waste = await apiPost('inventory', {
      action: 'recordSpoilage',
      productId: shawarma.id,
      quantity: 500,
      unit: 'g',
      reason: 'COOKING_LOSS',
      idempotencyKey: 'wst-shawarma-1',
    });
    expect(waste.ok).toBe(true);

    // 4. Sell 1,500 g (= 1.5 kg) Shawarma at 12 IQD/g (= 18,000 IQD) on credit!
    const sale = await apiPost('sales', {
      action: 'createInvoice',
      customerId: customer.id,
      paymentType: 'CREDIT',
      idempotencyKey: 'sale-shawarma-1',
      items: [
        { productId: shawarma.id, quantity: 1500, unit: 'g', unitPriceIqd: 12 },
      ],
    });
    expect(sale.ok).toBe(true);
    expect(sale.data.invoice.totalIqd).toBe(18000);
    expect(sale.data.invoice.dueIqd).toBe(18000);

    // Shawarma stock must now be 10 - 0.5 (waste) - 1.5 (sale) = 8.0 kg!
    const invFinal = (await apiGet('inventory')).data.valuation.items;
    expect(invFinal.find((i: any) => i.productId === shawarma.id).quantity).toBe(8);

    // 5. Collect 10,000 IQD partial debt from customer
    const col = await apiPost('parties', {
      action: 'collectDebt',
      customerId: customer.id,
      salesInvoiceId: sale.data.invoice.id,
      amountIqd: 10000,
      idempotencyKey: 'col-1',
    });
    expect(col.ok).toBe(true);

    // 6. Verify Global Trial Balance & Balance Sheet remain 100% BALANCED in IQD after ALL workflows!
    const accFinal = (await apiGet('accounting')).data;
    expect(accFinal.trialBalance.isBalanced).toBe(true);
    expect(accFinal.trialBalance.totalDebitIqd).toBe(accFinal.trialBalance.totalCreditIqd);
    expect(accFinal.balanceSheet.isBalanced).toBe(true);
    expect(accFinal.balanceSheet.totalAssetsIqd).toBe(accFinal.balanceSheet.totalLiabilitiesAndEquityIqd);
  });

  it('serves all remaining endpoints cleanly with zero PHP warnings (dashboard, statements, cashbank, production reversal, employee lifecycle, settings, auth) and static RTL Kurdish export', async () => {
    // 1. Dashboard, Expenses GET, Employees GET, Production GET, Sales GET, Purchases GET, CashBank GET, Settings GET, Auth GET
    const dash = await apiGet('dashboard');
    expect(dash.ok).toBe(true);
    expect(dash.data.kpis).toBeTruthy();

    const expList = await apiGet('expenses');
    expect(expList.ok).toBe(true);
    expect(expList.data.expenses.length).toBeGreaterThan(0);

    const empList = await apiGet('employees');
    expect(empList.ok).toBe(true);
    expect(empList.data.summary.totalEmployees).toBeGreaterThanOrEqual(5);

    const prodList = await apiGet('production');
    expect(prodList.ok).toBe(true);
    expect(prodList.data.recipes.length).toBeGreaterThanOrEqual(2);
    expect(prodList.data.batches.length).toBeGreaterThanOrEqual(1);

    const salesList = await apiGet('sales');
    expect(salesList.ok).toBe(true);
    expect(salesList.data.invoices.length).toBeGreaterThan(0);

    const purList = await apiGet('purchases');
    expect(purList.ok).toBe(true);
    expect(purList.data.invoices.length).toBeGreaterThan(0);

    const cb = await apiGet('cashbank');
    expect(cb.ok).toBe(true);
    expect(cb.data.accounts.length).toBeGreaterThan(0);

    const settings = await apiGet('settings');
    expect(settings.ok).toBe(true);
    expect(settings.data.users.length).toBeGreaterThanOrEqual(6); // Existing 6 user accounts preserved!

    const authRes = await apiPost('auth', { action: 'switchRole', role: 'ACCOUNTANT' });
    expect(authRes.ok).toBe(true);
    expect(authRes.data.user.role).toBe('ACCOUNTANT');
    const authBack = await apiPost('auth', { action: 'switchRole', role: 'SUPER_ADMIN' });
    expect(authBack.ok).toBe(true);
    expect(authBack.data.user.role).toBe('SUPER_ADMIN');

    // 2. Customer & Supplier Statements + Supplier Debt Payment
    const parties = await apiGet('parties');
    expect(parties.ok).toBe(true);
    const custId = parties.data.customers[0].id;
    const suppId = parties.data.suppliers[0].id;
    const custStmt = await apiGet('parties', `statementCustomerId=${custId}`);
    expect(custStmt.ok).toBe(true);
    expect(custStmt.data.statement.lines.length).toBeGreaterThan(0);
    const suppStmt = await apiGet('parties', `statementSupplierId=${suppId}`);
    expect(suppStmt.ok).toBe(true);
    expect(suppStmt.data.statement.lines.length).toBeGreaterThan(0);

    const paySupp = await apiPost('parties', {
      action: 'payCreditor',
      supplierId: suppId,
      amountIqd: 25000,
      idempotencyKey: 'pay-supp-1',
    });
    expect(paySupp.ok).toBe(true);

    // 3. Employee safe delete: employee WITH salary payments cannot be deleted; employee WITHOUT can be deleted
    const paidEmp = empList.data.employees.find((e: any) => e.name === 'Ahmed Test');
    const delPaidEmp = await apiPost('employees', { action: 'deleteEmployee', employeeId: paidEmp.id });
    expect(delPaidEmp.ok).toBe(false);

    const tempEmp = await apiPost('employees', { action: 'createEmployee', name: 'Temp Worker', phone: '07700001111' });
    expect(tempEmp.ok).toBe(true);
    expect(tempEmp.data.employee.status).toBe('ACTIVE');
    const updEmp = await apiPost('employees', { action: 'updateEmployee', employeeId: tempEmp.data.employee.id, position: 'Helper', monthlySalaryIqd: 450000 });
    expect(updEmp.ok).toBe(true);
    expect(updEmp.data.employee.monthlySalaryIqd).toBe(450000);
    const delTempEmp = await apiPost('employees', { action: 'deleteEmployee', employeeId: tempEmp.data.employee.id });
    expect(delTempEmp.ok).toBe(true);

    // 4. Reverse a production batch cleanly (restores raw materials & reverses GL)
    const batchId = prodList.data.batches[0].id;
    const revBatch = await apiPost('production', { action: 'reverseProduction', batchId });
    expect(revBatch.ok).toBe(true);
    expect(revBatch.data.batch.status).toBe('REVERSED');

    // 5. Create Backup cleanly
    const bkp = await apiPost('settings', { action: 'createBackup' });
    expect(bkp.ok).toBe(true);
    expect(bkp.data.backup.version).toBe('2.0.0-FOOD-FACTORY-IQD');

    // 6. Final Trial Balance & Balance Sheet check after reversals & payments
    const accEnd = (await apiGet('accounting')).data;
    expect(accEnd.trialBalance.isBalanced).toBe(true);
    expect(accEnd.balanceSheet.isBalanced).toBe(true);

    // 7. Verify ultra-fast unified /api/snapshot returns ALL 12 sections in ONE single request cleanly & quickly!
    const t0 = Date.now();
    const snap = await apiGet('snapshot');
    const elapsedMs = Date.now() - t0;
    expect(snap.ok).toBe(true);
    expect(snap.data.bootstrap.products.length).toBeGreaterThanOrEqual(15);
    expect(snap.data.dashboard.kpis).toBeTruthy();
    expect(snap.data.sales.invoices.length).toBeGreaterThan(0);
    expect(snap.data.purchases.invoices.length).toBeGreaterThan(0);
    expect(snap.data.expenses.expenses.length).toBeGreaterThan(0);
    expect(snap.data.inventory.valuation.items.length).toBeGreaterThanOrEqual(15);
    expect(snap.data.production.recipes.length).toBeGreaterThanOrEqual(2);
    expect(snap.data.employees.employees.length).toBeGreaterThanOrEqual(5);
    expect(snap.data.parties.customers.length).toBeGreaterThan(0);
    expect(snap.data.cashbank.accounts.length).toBeGreaterThan(0);
    expect(snap.data.accounting.trialBalance.isBalanced).toBe(true);
    expect(snap.data.accounting.balanceSheet.isBalanced).toBe(true);
    expect(snap.data.settings.users.length).toBeGreaterThanOrEqual(6);
    expect(elapsedMs).toBeLessThan(1500);

    // 8. Verify compiled static HTML defaults to Kurdish Sorani RTL
    const htmlPath = path.join(process.cwd(), 'hostinger_public_html', 'index.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      expect(html).toContain('lang="ku"');
      expect(html).toContain('dir="rtl"');
    }
  });
});
