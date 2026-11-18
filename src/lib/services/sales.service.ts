import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { D, Decimal, DecimalValue, fromUsd, roundCurrency, roundUsd, toUsd } from '../decimal';
import { postJournalEntryInTx } from './accounting.service';
import { applyStockChangeInTx } from './inventory.service';

export class SalesError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SalesError';
  }
}

export interface SalesInvoiceItemInput {
  productId: string;
  quantity: DecimalValue;
  unitPriceOriginal?: DecimalValue;
  discountOriginal?: DecimalValue;
  taxRate?: DecimalValue;
}

export interface CreateSalesInvoiceInput {
  customerId: string;
  warehouseId?: string;
  date?: Date;
  dueDate?: Date | null;
  status?: 'DRAFT' | 'APPROVED' | 'POSTED';
  paymentType?: 'CASH' | 'CREDIT' | 'PARTIAL';
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  items: SalesInvoiceItemInput[];
  invoiceDiscountOriginal?: DecimalValue;
  paidOriginal?: DecimalValue;
  financialAccountId?: string | null;
  paymentMethod?: string;
  notes?: string;
  allowNegativeStock?: boolean;
  overrideCreditLimit?: boolean;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

async function generateSalesInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.companySettings.findFirst();
  const prefix = settings?.salesInvoicePrefix || 'INV-';
  const count = await tx.salesInvoice.count();
  const year = new Date().getFullYear();
  const candidate = `${prefix}${year}-${String(count + 1).padStart(4, '0')}`;
  const existing = await tx.salesInvoice.findUnique({ where: { invoiceNumber: candidate } });
  if (existing) {
    return `${candidate}-${Math.floor(100 + Math.random() * 900)}`;
  }
  return candidate;
}

/**
 * Posts a DRAFT or APPROVED sales invoice inside a transaction:
 * 1. Deducts warehouse stock
 * 2. Updates customer AR balance and/or Cash/Bank account balance
 * 3. Creates Double-Entry Journal Entry (Revenue, AR/Cash, Discount, Tax, COGS, Inventory)
 */
export async function postSalesInvoiceInTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  options?: {
    allowNegativeStock?: boolean;
    overrideCreditLimit?: boolean;
    userId?: string | null;
  }
) {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      customer: true,
    },
  });

  if (!invoice) {
    throw new SalesError('Sales invoice not found.');
  }

  if (!['DRAFT', 'APPROVED'].includes(invoice.status)) {
    throw new SalesError(
      `Invoice ${invoice.invoiceNumber} is already '${invoice.status}' and cannot be posted again.`
    );
  }

  const subtotalUsd = roundUsd(invoice.subtotalUsd);
  const discountUsd = roundUsd(invoice.discountUsd);
  const taxUsd = roundUsd(invoice.taxUsd);
  const totalUsd = roundUsd(subtotalUsd.minus(discountUsd).plus(taxUsd));
  const paidUsd = roundUsd(invoice.paidUsd);
  const dueUsd = roundUsd(totalUsd.minus(paidUsd));
  const totalCostUsd = roundUsd(invoice.totalCostUsd);

  if (paidUsd.gt(totalUsd)) {
    throw new SalesError('Paid amount cannot exceed invoice total.');
  }

  // Verify customer credit limit for credit / partial sales
  if (dueUsd.gt(0) && !options?.overrideCreditLimit) {
    const projectedBalance = D(invoice.customer.balanceUsd).plus(dueUsd);
    const creditLimit = D(invoice.customer.creditLimitUsd);
    if (creditLimit.gt(0) && projectedBalance.gt(creditLimit)) {
      throw new SalesError(
        `Credit limit exceeded for customer '${
          invoice.customer.name
        }'. Current debt: $${D(invoice.customer.balanceUsd).toFixed(
          2
        )}, New credit: $${dueUsd.toFixed(2)}, Credit Limit: $${creditLimit.toFixed(2)}.`
      );
    }
  }

  // 1. Deduct inventory stock for every line item
  for (const item of invoice.items) {
    await applyStockChangeInTx(tx, {
      productId: item.productId,
      warehouseId: invoice.warehouseId,
      quantityDelta: D(item.quantity).neg(),
      type: 'SALE_DISPATCH',
      unitCostUsd: item.unitCostUsd,
      referenceType: 'SALES_INVOICE',
      referenceId: invoice.id,
      reason: `Sales Invoice ${invoice.invoiceNumber}`,
      allowNegativeStock: options?.allowNegativeStock,
      postJournalForAdjustment: false,
      createdById: options?.userId || invoice.createdById,
      isDemo: invoice.isDemo,
    });
  }

  // 2. Resolve Financial Account if cash/partial payment was received
  let financialAccount = null;
  if (paidUsd.gt(0)) {
    if (invoice.financialAccountId) {
      financialAccount = await tx.financialAccount.findUnique({
        where: { id: invoice.financialAccountId },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { currency: invoice.currency, isActive: true },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { isActive: true },
      });
    }
    if (!financialAccount) {
      throw new SalesError('No active Cash or Bank financial account found to receive payment.');
    }

    const paidInAccountCurrency =
      financialAccount.currency === invoice.currency
        ? D(invoice.paidOriginal)
        : fromUsd(paidUsd, financialAccount.currency, invoice.exchangeRate);

    const newBalanceOrig = roundCurrency(
      D(financialAccount.balanceOriginal).plus(paidInAccountCurrency),
      financialAccount.currency
    );
    const newBalanceUsd = roundUsd(D(financialAccount.balanceUsd).plus(paidUsd));

    await tx.financialAccount.update({
      where: { id: financialAccount.id },
      data: {
        balanceOriginal: newBalanceOrig.toNumber(),
        balanceUsd: newBalanceUsd.toNumber(),
      },
    });

    const cashTxCount = await tx.cashTransaction.count();
    await tx.cashTransaction.create({
      data: {
        transactionNumber: `CSH-${new Date().getFullYear()}-${String(
          cashTxCount + 1
        ).padStart(5, '0')}-${Math.floor(10 + Math.random() * 89)}`,
        date: invoice.date,
        type: 'SALE_RECEIPT',
        financialAccountId: financialAccount.id,
        currency: invoice.currency,
        exchangeRate: D(invoice.exchangeRate).toNumber(),
        amountOriginal: D(invoice.paidOriginal).toNumber(),
        amountUsd: paidUsd.toNumber(),
        direction: 'IN',
        balanceAfterOriginal: newBalanceOrig.toNumber(),
        balanceAfterUsd: newBalanceUsd.toNumber(),
        category: 'SALES',
        description: `Payment received for Sales Invoice ${invoice.invoiceNumber}`,
        referenceType: 'SALES_INVOICE',
        referenceId: invoice.id,
        isDemo: invoice.isDemo,
        createdById: options?.userId || invoice.createdById,
      },
    });
  }

  // 3. Update Customer Accounts Receivable balance if dueUsd > 0
  if (dueUsd.gt(0)) {
    const newCustBalance = roundUsd(D(invoice.customer.balanceUsd).plus(dueUsd));
    await tx.customer.update({
      where: { id: invoice.customerId },
      data: { balanceUsd: newCustBalance.toNumber() },
    });
  }

  // 4. Create Double-Entry Journal Entry
  const journalLines = [];

  if (paidUsd.gt(0) && financialAccount) {
    journalLines.push({
      accountId: financialAccount.ledgerAccountId,
      description: `Cash/Bank receipt for ${invoice.invoiceNumber}`,
      debitUsd: paidUsd,
      creditUsd: 0,
      customerId: invoice.customerId,
    });
  }

  if (dueUsd.gt(0)) {
    journalLines.push({
      accountCode: '1200', // Accounts Receivable
      description: `Receivable for ${invoice.invoiceNumber} (${invoice.customer.name})`,
      debitUsd: dueUsd,
      creditUsd: 0,
      customerId: invoice.customerId,
    });
  }

  if (discountUsd.gt(0)) {
    journalLines.push({
      accountCode: '4100', // Sales Discounts
      description: `Sales discount on ${invoice.invoiceNumber}`,
      debitUsd: discountUsd,
      creditUsd: 0,
      customerId: invoice.customerId,
    });
  }

  if (subtotalUsd.gt(0)) {
    journalLines.push({
      accountCode: '4000', // Sales Revenue
      description: `Sales revenue for ${invoice.invoiceNumber}`,
      debitUsd: 0,
      creditUsd: subtotalUsd,
      customerId: invoice.customerId,
    });
  }

  if (taxUsd.gt(0)) {
    journalLines.push({
      accountCode: '2200', // Sales Tax Payable
      description: `Sales tax on ${invoice.invoiceNumber}`,
      debitUsd: 0,
      creditUsd: taxUsd,
      customerId: invoice.customerId,
    });
  }

  if (totalCostUsd.gt(0)) {
    journalLines.push({
      accountCode: '5000', // Cost of Goods Sold
      description: `COGS for ${invoice.invoiceNumber}`,
      debitUsd: totalCostUsd,
      creditUsd: 0,
      customerId: invoice.customerId,
    });
    journalLines.push({
      accountCode: '1300', // Merchandise Inventory
      description: `Inventory reduction for ${invoice.invoiceNumber}`,
      debitUsd: 0,
      creditUsd: totalCostUsd,
      customerId: invoice.customerId,
    });
  }

  let journalEntryId: string | null = null;
  if (journalLines.length >= 2) {
    const jrn = await postJournalEntryInTx(tx, {
      date: invoice.date,
      description: `Sales Invoice ${invoice.invoiceNumber} — ${invoice.customer.name}`,
      referenceType: 'SALE',
      referenceId: invoice.id,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      lines: journalLines,
      isDemo: invoice.isDemo,
      createdById: options?.userId || invoice.createdById,
    });
    journalEntryId = jrn.id;
  }

  const finalStatus = dueUsd.eq(0)
    ? 'PAID'
    : paidUsd.gt(0)
    ? 'PARTIALLY_PAID'
    : 'POSTED';

  const updatedInvoice = await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      status: finalStatus,
      financialAccountId: financialAccount?.id || invoice.financialAccountId,
      journalEntryId,
      postedAt: new Date(),
    },
    include: {
      items: true,
      customer: true,
      warehouse: true,
      financialAccount: true,
    },
  });

  return updatedInvoice;
}

/**
 * Creates a Sales Invoice (either saving as DRAFT or immediately posting to Inventory & General Ledger).
 */
export async function createSalesInvoice(input: CreateSalesInvoiceInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.salesInvoice.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        items: true,
        customer: true,
        warehouse: true,
        financialAccount: true,
      },
    });
    if (existing) {
      return existing;
    }
  }

  if (!input.items || input.items.length === 0) {
    throw new SalesError('Sales invoice must contain at least one product.');
  }

  return prisma.$transaction(async (tx) => {
    const settings = await tx.companySettings.findFirst();
    const currency = input.currency || 'USD';
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);

    let warehouseId = input.warehouseId;
    if (!warehouseId) {
      const defaultWh =
        (await tx.warehouse.findFirst({ where: { isDefault: true } })) ||
        (await tx.warehouse.findFirst());
      if (!defaultWh) {
        throw new SalesError('No warehouse configured.');
      }
      warehouseId = defaultWh.id;
    }

    let subtotalOriginal = new Decimal(0);
    let lineDiscountsOriginal = new Decimal(0);
    let taxOriginal = new Decimal(0);
    let totalCostUsd = new Decimal(0);

    const preparedItems: {
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      unitPriceOriginal: number;
      unitPriceUsd: number;
      unitCostUsd: number;
      discountOriginal: number;
      discountUsd: number;
      taxRate: number;
      taxOriginal: number;
      taxUsd: number;
      lineTotalOriginal: number;
      lineTotalUsd: number;
      lineProfitUsd: number;
    }[] = [];

    for (const rawItem of input.items) {
      const qty = D(rawItem.quantity);
      if (qty.lte(0)) {
        throw new SalesError('Item quantity must be greater than zero.');
      }

      const product = await tx.product.findUnique({
        where: { id: rawItem.productId },
      });
      if (!product) {
        throw new SalesError(`Product not found (${rawItem.productId}).`);
      }

      const defaultUnitPriceOrig =
        currency === 'USD'
          ? D(product.sellingPriceUsd)
          : fromUsd(product.sellingPriceUsd, 'IQD', exchangeRate);

      const unitPriceOrig =
        rawItem.unitPriceOriginal !== undefined
          ? roundCurrency(rawItem.unitPriceOriginal, currency)
          : defaultUnitPriceOrig;
      const unitPriceUsd = toUsd(unitPriceOrig, currency, exchangeRate);
      const unitCostUsd = roundUsd(product.purchaseCostUsd);

      const itemDiscOrig = roundCurrency(rawItem.discountOriginal || 0, currency);
      const itemDiscUsd = toUsd(itemDiscOrig, currency, exchangeRate);

      const lineGrossOrig = roundCurrency(qty.mul(unitPriceOrig), currency);
      const lineNetOrig = roundCurrency(lineGrossOrig.minus(itemDiscOrig), currency);

      const taxRate =
        rawItem.taxRate !== undefined ? D(rawItem.taxRate) : D(product.taxRate || 0);
      const itemTaxOrig = roundCurrency(lineNetOrig.mul(taxRate).div(100), currency);
      const itemTaxUsd = toUsd(itemTaxOrig, currency, exchangeRate);

      const lineTotalOrig = roundCurrency(lineNetOrig.plus(itemTaxOrig), currency);
      const lineTotalUsd = toUsd(lineTotalOrig, currency, exchangeRate);

      const itemCostTotalUsd = roundUsd(qty.mul(unitCostUsd));
      const itemNetRevUsd = roundUsd(qty.mul(unitPriceUsd).minus(itemDiscUsd));
      const lineProfitUsd = roundUsd(itemNetRevUsd.minus(itemCostTotalUsd));

      subtotalOriginal = subtotalOriginal.plus(lineGrossOrig);
      lineDiscountsOriginal = lineDiscountsOriginal.plus(itemDiscOrig);
      taxOriginal = taxOriginal.plus(itemTaxOrig);
      totalCostUsd = totalCostUsd.plus(itemCostTotalUsd);

      preparedItems.push({
        productId: product.id,
        productName: product.nameEn,
        sku: product.sku,
        quantity: qty.toNumber(),
        unitPriceOriginal: unitPriceOrig.toNumber(),
        unitPriceUsd: unitPriceUsd.toNumber(),
        unitCostUsd: unitCostUsd.toNumber(),
        discountOriginal: itemDiscOrig.toNumber(),
        discountUsd: itemDiscUsd.toNumber(),
        taxRate: taxRate.toNumber(),
        taxOriginal: itemTaxOrig.toNumber(),
        taxUsd: itemTaxUsd.toNumber(),
        lineTotalOriginal: lineTotalOrig.toNumber(),
        lineTotalUsd: lineTotalUsd.toNumber(),
        lineProfitUsd: lineProfitUsd.toNumber(),
      });
    }

    const extraInvoiceDiscountOrig = roundCurrency(
      input.invoiceDiscountOriginal || 0,
      currency
    );
    const totalDiscountOriginal = roundCurrency(
      lineDiscountsOriginal.plus(extraInvoiceDiscountOrig),
      currency
    );
    const totalOriginal = roundCurrency(
      subtotalOriginal.minus(totalDiscountOriginal).plus(taxOriginal),
      currency
    );

    if (totalOriginal.lt(0)) {
      throw new SalesError('Invoice total cannot be negative after discounts.');
    }

    const subtotalUsd = toUsd(subtotalOriginal, currency, exchangeRate);
    const discountUsd = toUsd(totalDiscountOriginal, currency, exchangeRate);
    const taxUsd = toUsd(taxOriginal, currency, exchangeRate);
    const totalUsd = roundUsd(subtotalUsd.minus(discountUsd).plus(taxUsd));

    let paidOriginal: Decimal;
    if (input.paymentType === 'CASH' && input.paidOriginal === undefined) {
      paidOriginal = totalOriginal;
    } else if (input.paymentType === 'CREDIT' && input.paidOriginal === undefined) {
      paidOriginal = new Decimal(0);
    } else {
      paidOriginal = roundCurrency(input.paidOriginal ?? totalOriginal, currency);
    }

    if (paidOriginal.gt(totalOriginal)) {
      throw new SalesError('Paid amount cannot exceed invoice total.');
    }

    const dueOriginal = roundCurrency(totalOriginal.minus(paidOriginal), currency);
    const paidUsd = paidOriginal.equals(totalOriginal)
      ? totalUsd
      : toUsd(paidOriginal, currency, exchangeRate);
    const dueUsd = roundUsd(totalUsd.minus(paidUsd));

    const netRevenueUsd = roundUsd(subtotalUsd.minus(discountUsd));
    const grossProfitUsd = roundUsd(netRevenueUsd.minus(totalCostUsd));

    const paymentType = dueUsd.eq(0)
      ? 'CASH'
      : paidUsd.eq(0)
      ? 'CREDIT'
      : 'PARTIAL';

    const invoiceNumber = await generateSalesInvoiceNumber(tx);

    const created = await tx.salesInvoice.create({
      data: {
        invoiceNumber,
        customerId: input.customerId,
        warehouseId,
        date: input.date || new Date(),
        dueDate:
          input.dueDate ||
          (dueUsd.gt(0)
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            : null),
        status: 'DRAFT',
        paymentType,
        currency,
        exchangeRate: exchangeRate.toNumber(),
        subtotalOriginal: subtotalOriginal.toNumber(),
        discountOriginal: totalDiscountOriginal.toNumber(),
        taxOriginal: taxOriginal.toNumber(),
        totalOriginal: totalOriginal.toNumber(),
        paidOriginal: paidOriginal.toNumber(),
        dueOriginal: dueOriginal.toNumber(),
        subtotalUsd: subtotalUsd.toNumber(),
        discountUsd: discountUsd.toNumber(),
        taxUsd: taxUsd.toNumber(),
        totalUsd: totalUsd.toNumber(),
        paidUsd: paidUsd.toNumber(),
        dueUsd: dueUsd.toNumber(),
        totalCostUsd: roundUsd(totalCostUsd).toNumber(),
        grossProfitUsd: grossProfitUsd.toNumber(),
        financialAccountId: input.financialAccountId || null,
        paymentMethod: input.paymentMethod || (dueUsd.eq(0) ? 'CASH' : 'CREDIT'),
        notes: input.notes || null,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
        items: {
          create: preparedItems,
        },
      },
      include: {
        items: true,
        customer: true,
        warehouse: true,
        financialAccount: true,
      },
    });

    const targetStatus = input.status || 'POSTED';
    if (targetStatus === 'POSTED') {
      return postSalesInvoiceInTx(tx, created.id, {
        allowNegativeStock: input.allowNegativeStock,
        overrideCreditLimit: input.overrideCreditLimit,
        userId: input.createdById,
      });
    }

    if (targetStatus === 'APPROVED') {
      return tx.salesInvoice.update({
        where: { id: created.id },
        data: { status: 'APPROVED' },
        include: {
          items: true,
          customer: true,
          warehouse: true,
          financialAccount: true,
        },
      });
    }

    return created;
  });
}

/**
 * Posts an existing DRAFT or APPROVED sales invoice.
 */
export async function postSalesInvoice(
  invoiceId: string,
  options?: {
    allowNegativeStock?: boolean;
    overrideCreditLimit?: boolean;
    userId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    return postSalesInvoiceInTx(tx, invoiceId, options);
  });
}

/**
 * Processes a full Sales Return & Refund for a posted Sales Invoice:
 * 1. Restores product stock to warehouse
 * 2. Reduces Customer AR balance (for unpaid portion) and refunds Cash/Bank (for paid portion)
 * 3. Creates reversing Double-Entry Journal Entry (Sales Returns 4050, Tax 2200, AR 1200/Cash, Inventory 1300, COGS 5000)
 */
export async function returnSalesInvoice(
  invoiceId: string,
  reason: string,
  userId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        customer: true,
        financialAccount: true,
      },
    });

    if (!invoice) {
      throw new SalesError('Sales invoice not found.');
    }

    if (!['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
      throw new SalesError(
        `Only posted/paid invoices can be returned. Current status: ${invoice.status}.`
      );
    }

    // 1. Restore stock to warehouse
    for (const item of invoice.items) {
      const remainingQty = D(item.quantity).minus(D(item.returnedQty));
      if (remainingQty.gt(0)) {
        await applyStockChangeInTx(tx, {
          productId: item.productId,
          warehouseId: invoice.warehouseId,
          quantityDelta: remainingQty,
          type: 'SALE_RETURN',
          unitCostUsd: item.unitCostUsd,
          referenceType: 'SALES_RETURN',
          referenceId: invoice.id,
          reason: `Sales Return for ${invoice.invoiceNumber}: ${reason}`,
          postJournalForAdjustment: false,
          createdById: userId,
          isDemo: invoice.isDemo,
        });

        await tx.salesInvoiceItem.update({
          where: { id: item.id },
          data: { returnedQty: D(item.quantity).toNumber() },
        });
      }
    }

    const subtotalUsd = roundUsd(invoice.subtotalUsd);
    const discountUsd = roundUsd(invoice.discountUsd);
    const netRevenueUsd = roundUsd(subtotalUsd.minus(discountUsd));
    const taxUsd = roundUsd(invoice.taxUsd);
    const paidUsd = roundUsd(invoice.paidUsd);
    const dueUsd = roundUsd(invoice.dueUsd);
    const totalCostUsd = roundUsd(invoice.totalCostUsd);

    // 2. Reduce Customer AR balance for unpaid portion
    if (dueUsd.gt(0)) {
      const newCustBalance = roundUsd(D(invoice.customer.balanceUsd).minus(dueUsd));
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { balanceUsd: newCustBalance.toNumber() },
      });
    }

    // 3. Refund paid portion from Financial Account
    let financialAccount = invoice.financialAccount;
    if (paidUsd.gt(0)) {
      if (!financialAccount) {
        financialAccount = await tx.financialAccount.findFirst({
          where: { isActive: true },
        });
      }
      if (financialAccount) {
        const refundOrig =
          financialAccount.currency === invoice.currency
            ? D(invoice.paidOriginal)
            : fromUsd(paidUsd, financialAccount.currency, invoice.exchangeRate);

        const newBalOrig = roundCurrency(
          D(financialAccount.balanceOriginal).minus(refundOrig),
          financialAccount.currency
        );
        const newBalUsd = roundUsd(D(financialAccount.balanceUsd).minus(paidUsd));

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
            date: new Date(),
            type: 'WITHDRAWAL',
            financialAccountId: financialAccount.id,
            currency: invoice.currency,
            exchangeRate: D(invoice.exchangeRate).toNumber(),
            amountOriginal: D(invoice.paidOriginal).toNumber(),
            amountUsd: paidUsd.toNumber(),
            direction: 'OUT',
            balanceAfterOriginal: newBalOrig.toNumber(),
            balanceAfterUsd: newBalUsd.toNumber(),
            category: 'SALES_RETURN',
            description: `Cash refund for returned Sales Invoice ${invoice.invoiceNumber}`,
            referenceType: 'SALES_RETURN',
            referenceId: invoice.id,
            isDemo: invoice.isDemo,
            createdById: userId || null,
          },
        });
      }
    }

    // 4. Post Sales Return Double-Entry Journal Entry
    const returnLines = [];

    if (netRevenueUsd.gt(0)) {
      returnLines.push({
        accountCode: '4050', // Sales Returns & Allowances
        description: `Sales return for ${invoice.invoiceNumber}`,
        debitUsd: netRevenueUsd,
        creditUsd: 0,
        customerId: invoice.customerId,
      });
    }

    if (taxUsd.gt(0)) {
      returnLines.push({
        accountCode: '2200', // Sales Tax Payable reversal
        description: `Tax reversal for ${invoice.invoiceNumber}`,
        debitUsd: taxUsd,
        creditUsd: 0,
        customerId: invoice.customerId,
      });
    }

    if (paidUsd.gt(0) && financialAccount) {
      returnLines.push({
        accountId: financialAccount.ledgerAccountId,
        description: `Refund paid for ${invoice.invoiceNumber}`,
        debitUsd: 0,
        creditUsd: paidUsd,
        customerId: invoice.customerId,
      });
    }

    if (dueUsd.gt(0)) {
      returnLines.push({
        accountCode: '1200', // Accounts Receivable credit
        description: `AR reduction for returned ${invoice.invoiceNumber}`,
        debitUsd: 0,
        creditUsd: dueUsd,
        customerId: invoice.customerId,
      });
    }

    if (totalCostUsd.gt(0)) {
      returnLines.push({
        accountCode: '1300', // Inventory restored
        description: `Inventory restored from ${invoice.invoiceNumber}`,
        debitUsd: totalCostUsd,
        creditUsd: 0,
        customerId: invoice.customerId,
      });
      returnLines.push({
        accountCode: '5000', // COGS reversed
        description: `COGS reversal for ${invoice.invoiceNumber}`,
        debitUsd: 0,
        creditUsd: totalCostUsd,
        customerId: invoice.customerId,
      });
    }

    if (returnLines.length >= 2) {
      await postJournalEntryInTx(tx, {
        date: new Date(),
        description: `Sales Return for ${invoice.invoiceNumber} — ${reason}`,
        referenceType: 'SALE_RETURN',
        referenceId: invoice.id,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        lines: returnLines,
        isDemo: invoice.isDemo,
        createdById: userId || null,
      });
    }

    return tx.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'RETURNED',
        dueOriginal: 0,
        dueUsd: 0,
        notes: `${invoice.notes ? invoice.notes + ' | ' : ''}RETURNED: ${reason}`,
      },
      include: {
        items: true,
        customer: true,
        warehouse: true,
      },
    });
  });
}
