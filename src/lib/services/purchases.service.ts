import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { D, Decimal, DecimalValue, fromUsd, roundCurrency, roundUsd, toUsd } from '../decimal';
import { postJournalEntryInTx } from './accounting.service';
import { applyStockChangeInTx } from './inventory.service';

export class PurchaseError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export interface PurchaseInvoiceItemInput {
  productId: string;
  quantity: DecimalValue;
  unitCostOriginal?: DecimalValue;
  discountOriginal?: DecimalValue;
}

export interface CreatePurchaseInvoiceInput {
  supplierId: string;
  supplierInvoiceRef?: string;
  warehouseId?: string;
  date?: Date;
  dueDate?: Date | null;
  status?: 'DRAFT' | 'APPROVED' | 'POSTED';
  paymentType?: 'CASH' | 'CREDIT' | 'PARTIAL';
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  items: PurchaseInvoiceItemInput[];
  invoiceDiscountOriginal?: DecimalValue;
  taxOriginal?: DecimalValue;
  shippingOriginal?: DecimalValue;
  paidOriginal?: DecimalValue;
  financialAccountId?: string | null;
  paymentMethod?: string;
  notes?: string;
  attachmentName?: string;
  attachmentUrl?: string;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

async function generatePurchaseInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await tx.companySettings.findFirst();
  const prefix = settings?.purchaseInvoicePrefix || 'PUR-';
  const count = await tx.purchaseInvoice.count();
  const year = new Date().getFullYear();
  const candidate = `${prefix}${year}-${String(count + 1).padStart(4, '0')}`;
  const existing = await tx.purchaseInvoice.findUnique({ where: { invoiceNumber: candidate } });
  if (existing) {
    return `${candidate}-${Math.floor(100 + Math.random() * 900)}`;
  }
  return candidate;
}

/**
 * Posts a DRAFT or APPROVED purchase invoice inside a transaction:
 * 1. Updates product weighted-average purchase cost and increases warehouse stock
 * 2. Updates Supplier AP balance and/or deducts from Cash/Bank account
 * 3. Creates Double-Entry Journal Entry (Debit Inventory 1300, Credit Cash/Bank and/or Accounts Payable 2100)
 */
export async function postPurchaseInvoiceInTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  userId?: string | null
) {
  const invoice = await tx.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      supplier: true,
    },
  });

  if (!invoice) {
    throw new PurchaseError('Purchase invoice not found.');
  }

  if (!['DRAFT', 'APPROVED'].includes(invoice.status)) {
    throw new PurchaseError(
      `Purchase invoice ${invoice.invoiceNumber} is already '${invoice.status}' and cannot be posted again.`
    );
  }

  const totalUsd = roundUsd(invoice.totalUsd);
  const paidUsd = roundUsd(invoice.paidUsd);
  const dueUsd = roundUsd(totalUsd.minus(paidUsd));

  // 1. Resolve and validate Financial Account if cash/partial payment is made
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
      throw new PurchaseError('No active Cash or Bank account found to pay purchase.');
    }

    const currentBalanceUsd = D(financialAccount.balanceUsd);
    if (currentBalanceUsd.lt(paidUsd)) {
      throw new PurchaseError(
        `Insufficient funds in '${financialAccount.nameEn}'. Available: $${currentBalanceUsd.toFixed(
          2
        )}, Required: $${paidUsd.toFixed(2)}.`
      );
    }

    const paidInAccountCurrency =
      financialAccount.currency === invoice.currency
        ? D(invoice.paidOriginal)
        : fromUsd(paidUsd, financialAccount.currency, invoice.exchangeRate);

    const newBalanceOrig = roundCurrency(
      D(financialAccount.balanceOriginal).minus(paidInAccountCurrency),
      financialAccount.currency
    );
    const newBalanceUsd = roundUsd(currentBalanceUsd.minus(paidUsd));

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
        type: 'PURCHASE_PAYMENT',
        financialAccountId: financialAccount.id,
        currency: invoice.currency,
        exchangeRate: D(invoice.exchangeRate).toNumber(),
        amountOriginal: D(invoice.paidOriginal).toNumber(),
        amountUsd: paidUsd.toNumber(),
        direction: 'OUT',
        balanceAfterOriginal: newBalanceOrig.toNumber(),
        balanceAfterUsd: newBalanceUsd.toNumber(),
        category: 'PURCHASES',
        description: `Payment for Purchase Invoice ${invoice.invoiceNumber}`,
        referenceType: 'PURCHASE_INVOICE',
        referenceId: invoice.id,
        isDemo: invoice.isDemo,
        createdById: userId || invoice.createdById,
      },
    });
  }

  // 2. Receive items into warehouse inventory & update weighted-average cost
  for (const item of invoice.items) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (product) {
      const existingQty = D(product.totalStock);
      const existingCost = D(product.purchaseCostUsd);
      const incomingQty = D(item.quantity);
      const incomingCost = D(item.unitCostUsd);

      let newAvgCost = incomingCost;
      if (existingQty.gt(0) && existingQty.plus(incomingQty).gt(0)) {
        const totalVal = existingQty
          .mul(existingCost)
          .plus(incomingQty.mul(incomingCost));
        newAvgCost = roundUsd(totalVal.div(existingQty.plus(incomingQty)));
      }

      await tx.product.update({
        where: { id: product.id },
        data: { purchaseCostUsd: newAvgCost.toNumber() },
      });
    }

    await applyStockChangeInTx(tx, {
      productId: item.productId,
      warehouseId: invoice.warehouseId,
      quantityDelta: item.quantity,
      type: 'PURCHASE_RECEIPT',
      unitCostUsd: item.unitCostUsd,
      referenceType: 'PURCHASE_INVOICE',
      referenceId: invoice.id,
      reason: `Purchase Invoice ${invoice.invoiceNumber}`,
      postJournalForAdjustment: false,
      createdById: userId || invoice.createdById,
      isDemo: invoice.isDemo,
    });
  }

  // 3. Update Supplier Accounts Payable balance if dueUsd > 0
  if (dueUsd.gt(0)) {
    const newSuppBalance = roundUsd(D(invoice.supplier.balanceUsd).plus(dueUsd));
    await tx.supplier.update({
      where: { id: invoice.supplierId },
      data: { balanceUsd: newSuppBalance.toNumber() },
    });
  }

  // 4. Create Double-Entry Journal Entry
  const journalLines = [];

  if (totalUsd.gt(0)) {
    journalLines.push({
      accountCode: '1300', // Merchandise Inventory Asset
      description: `Inventory received on ${invoice.invoiceNumber}`,
      debitUsd: totalUsd,
      creditUsd: 0,
      supplierId: invoice.supplierId,
    });
  }

  if (paidUsd.gt(0) && financialAccount) {
    journalLines.push({
      accountId: financialAccount.ledgerAccountId,
      description: `Cash/Bank payment for ${invoice.invoiceNumber}`,
      debitUsd: 0,
      creditUsd: paidUsd,
      supplierId: invoice.supplierId,
    });
  }

  if (dueUsd.gt(0)) {
    journalLines.push({
      accountCode: '2100', // Accounts Payable
      description: `Payable to ${invoice.supplier.name} (${invoice.invoiceNumber})`,
      debitUsd: 0,
      creditUsd: dueUsd,
      supplierId: invoice.supplierId,
    });
  }

  let journalEntryId: string | null = null;
  if (journalLines.length >= 2) {
    const jrn = await postJournalEntryInTx(tx, {
      date: invoice.date,
      description: `Purchase Invoice ${invoice.invoiceNumber} — ${invoice.supplier.name}`,
      referenceType: 'PURCHASE',
      referenceId: invoice.id,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      lines: journalLines,
      isDemo: invoice.isDemo,
      createdById: userId || invoice.createdById,
    });
    journalEntryId = jrn.id;
  }

  const finalStatus = dueUsd.eq(0)
    ? 'PAID'
    : paidUsd.gt(0)
    ? 'PARTIALLY_PAID'
    : 'POSTED';

  return tx.purchaseInvoice.update({
    where: { id: invoice.id },
    data: {
      status: finalStatus,
      financialAccountId: financialAccount?.id || invoice.financialAccountId,
      journalEntryId,
      postedAt: new Date(),
    },
    include: {
      items: true,
      supplier: true,
      warehouse: true,
      financialAccount: true,
    },
  });
}

/**
 * Creates a Purchase Invoice (either as DRAFT or immediately POSTED).
 */
export async function createPurchaseInvoice(input: CreatePurchaseInvoiceInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.purchaseInvoice.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        items: true,
        supplier: true,
        warehouse: true,
        financialAccount: true,
      },
    });
    if (existing) {
      return existing;
    }
  }

  if (!input.items || input.items.length === 0) {
    throw new PurchaseError('Purchase invoice must contain at least one product.');
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
        throw new PurchaseError('No warehouse configured.');
      }
      warehouseId = defaultWh.id;
    }

    let subtotalOriginal = new Decimal(0);
    let lineDiscountsOriginal = new Decimal(0);

    const preparedItems: {
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      unitCostOriginal: number;
      unitCostUsd: number;
      discountOriginal: number;
      discountUsd: number;
      lineTotalOriginal: number;
      lineTotalUsd: number;
    }[] = [];

    for (const rawItem of input.items) {
      const qty = D(rawItem.quantity);
      if (qty.lte(0)) {
        throw new PurchaseError('Item quantity must be greater than zero.');
      }

      const product = await tx.product.findUnique({
        where: { id: rawItem.productId },
      });
      if (!product) {
        throw new PurchaseError(`Product not found (${rawItem.productId}).`);
      }

      const defaultCostOrig =
        currency === 'USD'
          ? D(product.purchaseCostUsd)
          : fromUsd(product.purchaseCostUsd, 'IQD', exchangeRate);

      const unitCostOrig =
        rawItem.unitCostOriginal !== undefined
          ? roundCurrency(rawItem.unitCostOriginal, currency)
          : defaultCostOrig;
      const unitCostUsd = toUsd(unitCostOrig, currency, exchangeRate);

      const itemDiscOrig = roundCurrency(rawItem.discountOriginal || 0, currency);
      const itemDiscUsd = toUsd(itemDiscOrig, currency, exchangeRate);

      const lineGrossOrig = roundCurrency(qty.mul(unitCostOrig), currency);
      const lineTotalOrig = roundCurrency(lineGrossOrig.minus(itemDiscOrig), currency);
      const lineTotalUsd = toUsd(lineTotalOrig, currency, exchangeRate);

      subtotalOriginal = subtotalOriginal.plus(lineGrossOrig);
      lineDiscountsOriginal = lineDiscountsOriginal.plus(itemDiscOrig);

      preparedItems.push({
        productId: product.id,
        productName: product.nameEn,
        sku: product.sku,
        quantity: qty.toNumber(),
        unitCostOriginal: unitCostOrig.toNumber(),
        unitCostUsd: unitCostUsd.toNumber(),
        discountOriginal: itemDiscOrig.toNumber(),
        discountUsd: itemDiscUsd.toNumber(),
        lineTotalOriginal: lineTotalOrig.toNumber(),
        lineTotalUsd: lineTotalUsd.toNumber(),
      });
    }

    const extraDiscOrig = roundCurrency(input.invoiceDiscountOriginal || 0, currency);
    const totalDiscountOriginal = roundCurrency(
      lineDiscountsOriginal.plus(extraDiscOrig),
      currency
    );
    const taxOriginal = roundCurrency(input.taxOriginal || 0, currency);
    const shippingOriginal = roundCurrency(input.shippingOriginal || 0, currency);

    const totalOriginal = roundCurrency(
      subtotalOriginal
        .minus(totalDiscountOriginal)
        .plus(taxOriginal)
        .plus(shippingOriginal),
      currency
    );

    if (totalOriginal.lt(0)) {
      throw new PurchaseError('Purchase total cannot be negative.');
    }

    const subtotalUsd = toUsd(subtotalOriginal, currency, exchangeRate);
    const discountUsd = toUsd(totalDiscountOriginal, currency, exchangeRate);
    const taxUsd = toUsd(taxOriginal, currency, exchangeRate);
    const shippingUsd = toUsd(shippingOriginal, currency, exchangeRate);
    const totalUsd = roundUsd(
      subtotalUsd.minus(discountUsd).plus(taxUsd).plus(shippingUsd)
    );

    let paidOriginal: Decimal;
    if (input.paymentType === 'CASH' && input.paidOriginal === undefined) {
      paidOriginal = totalOriginal;
    } else if (input.paymentType === 'CREDIT' && input.paidOriginal === undefined) {
      paidOriginal = new Decimal(0);
    } else {
      paidOriginal = roundCurrency(input.paidOriginal ?? totalOriginal, currency);
    }

    if (paidOriginal.gt(totalOriginal)) {
      throw new PurchaseError('Paid amount cannot exceed purchase invoice total.');
    }

    const dueOriginal = roundCurrency(totalOriginal.minus(paidOriginal), currency);
    const paidUsd = paidOriginal.equals(totalOriginal)
      ? totalUsd
      : toUsd(paidOriginal, currency, exchangeRate);
    const dueUsd = roundUsd(totalUsd.minus(paidUsd));

    const paymentType = dueUsd.eq(0)
      ? 'CASH'
      : paidUsd.eq(0)
      ? 'CREDIT'
      : 'PARTIAL';

    const invoiceNumber = await generatePurchaseInvoiceNumber(tx);

    const created = await tx.purchaseInvoice.create({
      data: {
        invoiceNumber,
        supplierInvoiceRef: input.supplierInvoiceRef || null,
        supplierId: input.supplierId,
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
        shippingOriginal: shippingOriginal.toNumber(),
        totalOriginal: totalOriginal.toNumber(),
        paidOriginal: paidOriginal.toNumber(),
        dueOriginal: dueOriginal.toNumber(),
        subtotalUsd: subtotalUsd.toNumber(),
        discountUsd: discountUsd.toNumber(),
        taxUsd: taxUsd.toNumber(),
        shippingUsd: shippingUsd.toNumber(),
        totalUsd: totalUsd.toNumber(),
        paidUsd: paidUsd.toNumber(),
        dueUsd: dueUsd.toNumber(),
        financialAccountId: input.financialAccountId || null,
        paymentMethod: input.paymentMethod || (dueUsd.eq(0) ? 'CASH' : 'CREDIT'),
        notes: input.notes || null,
        attachmentName: input.attachmentName || null,
        attachmentUrl: input.attachmentUrl || null,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? false,
        createdById: input.createdById || null,
        items: {
          create: preparedItems,
        },
      },
      include: {
        items: true,
        supplier: true,
        warehouse: true,
        financialAccount: true,
      },
    });

    const targetStatus = input.status || 'POSTED';
    if (targetStatus === 'POSTED') {
      return postPurchaseInvoiceInTx(tx, created.id, input.createdById);
    }

    if (targetStatus === 'APPROVED') {
      return tx.purchaseInvoice.update({
        where: { id: created.id },
        data: { status: 'APPROVED' },
        include: {
          items: true,
          supplier: true,
          warehouse: true,
          financialAccount: true,
        },
      });
    }

    return created;
  });
}

export async function postPurchaseInvoice(invoiceId: string, userId?: string | null) {
  return prisma.$transaction(async (tx) => {
    return postPurchaseInvoiceInTx(tx, invoiceId, userId);
  });
}

/**
 * Processes a Purchase Return for a posted Purchase Invoice:
 * 1. Deducts returned stock from warehouse
 * 2. Reduces Supplier AP balance and/or refunds Cash/Bank
 * 3. Creates reversing Double-Entry Journal Entry (Debit AP 2100 / Cash, Credit Inventory 1300)
 */
export async function returnPurchaseInvoice(
  invoiceId: string,
  reason: string,
  userId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        supplier: true,
        financialAccount: true,
      },
    });

    if (!invoice) {
      throw new PurchaseError('Purchase invoice not found.');
    }

    if (!['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
      throw new PurchaseError(
        `Only posted purchase invoices can be returned. Current status: ${invoice.status}.`
      );
    }

    // 1. Deduct returned stock from warehouse
    for (const item of invoice.items) {
      const remainingQty = D(item.quantity).minus(D(item.returnedQty));
      if (remainingQty.gt(0)) {
        await applyStockChangeInTx(tx, {
          productId: item.productId,
          warehouseId: invoice.warehouseId,
          quantityDelta: remainingQty.neg(),
          type: 'PURCHASE_RETURN',
          unitCostUsd: item.unitCostUsd,
          referenceType: 'PURCHASE_RETURN',
          referenceId: invoice.id,
          reason: `Purchase Return for ${invoice.invoiceNumber}: ${reason}`,
          allowNegativeStock: true,
          postJournalForAdjustment: false,
          createdById: userId,
          isDemo: invoice.isDemo,
        });

        await tx.purchaseInvoiceItem.update({
          where: { id: item.id },
          data: { returnedQty: D(item.quantity).toNumber() },
        });
      }
    }

    const totalUsd = roundUsd(invoice.totalUsd);
    const paidUsd = roundUsd(invoice.paidUsd);
    const dueUsd = roundUsd(invoice.dueUsd);

    // 2. Reduce Supplier AP balance for unpaid portion
    if (dueUsd.gt(0)) {
      const newSuppBal = roundUsd(D(invoice.supplier.balanceUsd).minus(dueUsd));
      await tx.supplier.update({
        where: { id: invoice.supplierId },
        data: { balanceUsd: newSuppBal.toNumber() },
      });
    }

    // 3. Receive refund into Financial Account for paid portion
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
          D(financialAccount.balanceOriginal).plus(refundOrig),
          financialAccount.currency
        );
        const newBalUsd = roundUsd(D(financialAccount.balanceUsd).plus(paidUsd));

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
            type: 'DEPOSIT',
            financialAccountId: financialAccount.id,
            currency: invoice.currency,
            exchangeRate: D(invoice.exchangeRate).toNumber(),
            amountOriginal: D(invoice.paidOriginal).toNumber(),
            amountUsd: paidUsd.toNumber(),
            direction: 'IN',
            balanceAfterOriginal: newBalOrig.toNumber(),
            balanceAfterUsd: newBalUsd.toNumber(),
            category: 'PURCHASE_RETURN',
            description: `Supplier refund for returned Purchase Invoice ${invoice.invoiceNumber}`,
            referenceType: 'PURCHASE_RETURN',
            referenceId: invoice.id,
            isDemo: invoice.isDemo,
            createdById: userId || null,
          },
        });
      }
    }

    // 4. Post Purchase Return Double-Entry Journal Entry
    const returnLines = [];

    if (dueUsd.gt(0)) {
      returnLines.push({
        accountCode: '2100', // Accounts Payable reduced
        description: `AP reduction for returned ${invoice.invoiceNumber}`,
        debitUsd: dueUsd,
        creditUsd: 0,
        supplierId: invoice.supplierId,
      });
    }

    if (paidUsd.gt(0) && financialAccount) {
      returnLines.push({
        accountId: financialAccount.ledgerAccountId,
        description: `Supplier refund received for ${invoice.invoiceNumber}`,
        debitUsd: paidUsd,
        creditUsd: 0,
        supplierId: invoice.supplierId,
      });
    }

    if (totalUsd.gt(0)) {
      returnLines.push({
        accountCode: '1300', // Merchandise Inventory reduced
        description: `Inventory returned on ${invoice.invoiceNumber}`,
        debitUsd: 0,
        creditUsd: totalUsd,
        supplierId: invoice.supplierId,
      });
    }

    if (returnLines.length >= 2) {
      await postJournalEntryInTx(tx, {
        date: new Date(),
        description: `Purchase Return for ${invoice.invoiceNumber} — ${reason}`,
        referenceType: 'PURCHASE_RETURN',
        referenceId: invoice.id,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        lines: returnLines,
        isDemo: invoice.isDemo,
        createdById: userId || null,
      });
    }

    return tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'RETURNED',
        dueOriginal: 0,
        dueUsd: 0,
        notes: `${invoice.notes ? invoice.notes + ' | ' : ''}RETURNED: ${reason}`,
      },
      include: {
        items: true,
        supplier: true,
        warehouse: true,
      },
    });
  });
}
