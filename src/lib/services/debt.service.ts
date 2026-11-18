import prisma from '../prisma';
import { D, Decimal, DecimalValue, fromUsd, roundCurrency, roundUsd, toUsd } from '../decimal';
import { postJournalEntryInTx } from './accounting.service';

export class DebtError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DebtError';
  }
}

export interface DebtorCollectionInput {
  customerId: string;
  salesInvoiceId?: string | null;
  financialAccountId?: string;
  paymentMethod?: string;
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  amountOriginal: DecimalValue;
  date?: Date;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

export interface CreditorPaymentInput {
  supplierId: string;
  purchaseInvoiceId?: string | null;
  financialAccountId?: string;
  paymentMethod?: string;
  currency?: 'USD' | 'IQD';
  exchangeRate?: DecimalValue;
  amountOriginal: DecimalValue;
  date?: Date;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey?: string;
  isDemo?: boolean;
  createdById?: string | null;
}

/**
 * Records a Debtor Collection (customer debt payment, partial or full settlement).
 * Atomically updates Customer balance, SalesInvoice status, Cash/Bank balance, and General Ledger (Debit Cash/Bank, Credit AR 1200).
 */
export async function recordDebtorCollection(input: DebtorCollectionInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.debtPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { customer: true, salesInvoice: true, financialAccount: true },
    });
    if (existing) {
      return existing;
    }
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new DebtError('Customer not found.');
    }

    const settings = await tx.companySettings.findFirst();
    const currency = input.currency || 'USD';
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);
    const amountOrig = roundCurrency(input.amountOriginal, currency);
    if (amountOrig.lte(0)) {
      throw new DebtError('Collection amount must be greater than zero.');
    }

    const amountUsd = toUsd(amountOrig, currency, exchangeRate);
    const currentCustomerDebt = roundUsd(customer.balanceUsd);

    if (amountUsd.gt(currentCustomerDebt.plus(0.01))) {
      throw new DebtError(
        `Collection amount ($${amountUsd.toFixed(
          2
        )}) exceeds customer outstanding debt ($${currentCustomerDebt.toFixed(2)}).`
      );
    }

    const effectiveAmountUsd = amountUsd.gt(currentCustomerDebt)
      ? currentCustomerDebt
      : amountUsd;

    let financialAccount = null;
    if (input.financialAccountId) {
      financialAccount = await tx.financialAccount.findUnique({
        where: { id: input.financialAccountId },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { currency, isActive: true },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { isActive: true },
      });
    }
    if (!financialAccount) {
      throw new DebtError('No active Cash or Bank account found.');
    }

    // Apply payment to specific salesInvoice or FIFO oldest unpaid invoices
    if (input.salesInvoiceId) {
      const inv = await tx.salesInvoice.findUnique({
        where: { id: input.salesInvoiceId },
      });
      if (!inv || inv.customerId !== customer.id) {
        throw new DebtError('Referenced sales invoice not found for this customer.');
      }
      const invDueUsd = roundUsd(inv.dueUsd);
      if (effectiveAmountUsd.gt(invDueUsd.plus(0.01))) {
        throw new DebtError(
          `Payment ($${effectiveAmountUsd.toFixed(2)}) exceeds invoice due balance ($${invDueUsd.toFixed(
            2
          )}).`
        );
      }
      const appliedUsd = effectiveAmountUsd.gt(invDueUsd) ? invDueUsd : effectiveAmountUsd;
      const newPaidUsd = roundUsd(D(inv.paidUsd).plus(appliedUsd));
      const newDueUsd = roundUsd(D(inv.totalUsd).minus(newPaidUsd));
      const newPaidOrig = fromUsd(newPaidUsd, inv.currency, inv.exchangeRate);
      const newDueOrig = fromUsd(newDueUsd, inv.currency, inv.exchangeRate);

      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          paidUsd: newPaidUsd.toNumber(),
          dueUsd: newDueUsd.toNumber(),
          paidOriginal: newPaidOrig.toNumber(),
          dueOriginal: newDueOrig.toNumber(),
          status: newDueUsd.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
    } else {
      // Auto-allocate FIFO across customer's unpaid invoices
      const unpaidInvoices = await tx.salesInvoice.findMany({
        where: {
          customerId: customer.id,
          status: { in: ['POSTED', 'PARTIALLY_PAID'] },
          dueUsd: { gt: 0 },
        },
        orderBy: { date: 'asc' },
      });

      let remainingToAllocate = effectiveAmountUsd;
      for (const inv of unpaidInvoices) {
        if (remainingToAllocate.lte(0)) break;
        const invDue = roundUsd(inv.dueUsd);
        const alloc = remainingToAllocate.gte(invDue) ? invDue : remainingToAllocate;
        const newPaidUsd = roundUsd(D(inv.paidUsd).plus(alloc));
        const newDueUsd = roundUsd(D(inv.totalUsd).minus(newPaidUsd));
        const newPaidOrig = fromUsd(newPaidUsd, inv.currency, inv.exchangeRate);
        const newDueOrig = fromUsd(newDueUsd, inv.currency, inv.exchangeRate);

        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: {
            paidUsd: newPaidUsd.toNumber(),
            dueUsd: newDueUsd.toNumber(),
            paidOriginal: newPaidOrig.toNumber(),
            dueOriginal: newDueOrig.toNumber(),
            status: newDueUsd.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
        remainingToAllocate = roundUsd(remainingToAllocate.minus(alloc));
      }
    }

    // Update customer balance
    const newCustomerBalance = roundUsd(currentCustomerDebt.minus(effectiveAmountUsd));
    await tx.customer.update({
      where: { id: customer.id },
      data: { balanceUsd: newCustomerBalance.toNumber() },
    });

    // Update FinancialAccount balance
    const amountInAccCurrency =
      financialAccount.currency === currency
        ? amountOrig
        : fromUsd(effectiveAmountUsd, financialAccount.currency, exchangeRate);

    const newAccBalOrig = roundCurrency(
      D(financialAccount.balanceOriginal).plus(amountInAccCurrency),
      financialAccount.currency
    );
    const newAccBalUsd = roundUsd(
      D(financialAccount.balanceUsd).plus(effectiveAmountUsd)
    );

    await tx.financialAccount.update({
      where: { id: financialAccount.id },
      data: {
        balanceOriginal: newAccBalOrig.toNumber(),
        balanceUsd: newAccBalUsd.toNumber(),
      },
    });

    const payCount = await tx.debtPayment.count();
    const paymentNumber = `RCV-${new Date().getFullYear()}-${String(payCount + 1).padStart(
      4,
      '0'
    )}-${Math.floor(10 + Math.random() * 89)}`;

    // Post Double-Entry Journal Entry: Debit Cash/Bank, Credit Accounts Receivable (1200)
    const jrn = await postJournalEntryInTx(tx, {
      date: input.date || new Date(),
      description: `Customer debt collection from ${customer.name} (${paymentNumber})`,
      referenceType: 'DEBTOR_COLLECTION',
      currency,
      exchangeRate,
      isDemo: input.isDemo ?? customer.isDemo,
      createdById: input.createdById || null,
      lines: [
        {
          accountId: financialAccount.ledgerAccountId,
          description: `Debt collection received into ${financialAccount.nameEn}`,
          debitUsd: effectiveAmountUsd,
          creditUsd: 0,
          customerId: customer.id,
        },
        {
          accountCode: '1200', // Accounts Receivable
          description: `AR reduction for ${customer.name}`,
          debitUsd: 0,
          creditUsd: effectiveAmountUsd,
          customerId: customer.id,
        },
      ],
    });

    const cashTxCount = await tx.cashTransaction.count();
    await tx.cashTransaction.create({
      data: {
        transactionNumber: `CSH-${new Date().getFullYear()}-${String(
          cashTxCount + 1
        ).padStart(5, '0')}-${Math.floor(10 + Math.random() * 89)}`,
        date: input.date || new Date(),
        type: 'DEBTOR_COLLECTION',
        financialAccountId: financialAccount.id,
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: effectiveAmountUsd.toNumber(),
        direction: 'IN',
        balanceAfterOriginal: newAccBalOrig.toNumber(),
        balanceAfterUsd: newAccBalUsd.toNumber(),
        category: 'DEBTOR_COLLECTION',
        description: `Customer debt collection from ${customer.name} (${paymentNumber})`,
        referenceType: 'DEBT_PAYMENT',
        journalEntryId: jrn.id,
        isDemo: input.isDemo ?? customer.isDemo,
        createdById: input.createdById || null,
      },
    });

    return tx.debtPayment.create({
      data: {
        paymentNumber,
        date: input.date || new Date(),
        type: 'DEBTOR_COLLECTION',
        customerId: customer.id,
        salesInvoiceId: input.salesInvoiceId || null,
        financialAccountId: financialAccount.id,
        paymentMethod: input.paymentMethod || 'CASH',
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: effectiveAmountUsd.toNumber(),
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        journalEntryId: jrn.id,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? customer.isDemo,
        createdById: input.createdById || null,
      },
      include: {
        customer: true,
        salesInvoice: true,
        financialAccount: true,
      },
    });
  });
}

/**
 * Records a Creditor Payment (paying a supplier/creditor liability, partial or full settlement).
 * Atomically updates Supplier balance, PurchaseInvoice status, Cash/Bank balance, and General Ledger (Debit AP 2100, Credit Cash/Bank).
 */
export async function recordCreditorPayment(input: CreditorPaymentInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.debtPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { supplier: true, purchaseInvoice: true, financialAccount: true },
    });
    if (existing) {
      return existing;
    }
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
    });
    if (!supplier) {
      throw new DebtError('Supplier/Creditor not found.');
    }

    const settings = await tx.companySettings.findFirst();
    const currency = input.currency || 'USD';
    const exchangeRate = D(input.exchangeRate || settings?.usdToIqdRate || 1500);
    const amountOrig = roundCurrency(input.amountOriginal, currency);
    if (amountOrig.lte(0)) {
      throw new DebtError('Payment amount must be greater than zero.');
    }

    const amountUsd = toUsd(amountOrig, currency, exchangeRate);
    const currentSupplierLiability = roundUsd(supplier.balanceUsd);

    if (amountUsd.gt(currentSupplierLiability.plus(0.01))) {
      throw new DebtError(
        `Payment amount ($${amountUsd.toFixed(
          2
        )}) exceeds supplier outstanding liability ($${currentSupplierLiability.toFixed(2)}).`
      );
    }

    const effectiveAmountUsd = amountUsd.gt(currentSupplierLiability)
      ? currentSupplierLiability
      : amountUsd;

    let financialAccount = null;
    if (input.financialAccountId) {
      financialAccount = await tx.financialAccount.findUnique({
        where: { id: input.financialAccountId },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { currency, isActive: true },
      });
    }
    if (!financialAccount) {
      financialAccount = await tx.financialAccount.findFirst({
        where: { isActive: true },
      });
    }
    if (!financialAccount) {
      throw new DebtError('No active Cash or Bank account found.');
    }

    if (D(financialAccount.balanceUsd).lt(effectiveAmountUsd)) {
      throw new DebtError(
        `Insufficient funds in '${financialAccount.nameEn}'. Available: $${D(
          financialAccount.balanceUsd
        ).toFixed(2)}, Required: $${effectiveAmountUsd.toFixed(2)}.`
      );
    }

    // Apply payment to specific purchaseInvoice or FIFO oldest unpaid purchase invoices
    if (input.purchaseInvoiceId) {
      const inv = await tx.purchaseInvoice.findUnique({
        where: { id: input.purchaseInvoiceId },
      });
      if (!inv || inv.supplierId !== supplier.id) {
        throw new DebtError('Referenced purchase invoice not found for this supplier.');
      }
      const invDueUsd = roundUsd(inv.dueUsd);
      if (effectiveAmountUsd.gt(invDueUsd.plus(0.01))) {
        throw new DebtError(
          `Payment ($${effectiveAmountUsd.toFixed(2)}) exceeds purchase invoice due balance ($${invDueUsd.toFixed(
            2
          )}).`
        );
      }
      const appliedUsd = effectiveAmountUsd.gt(invDueUsd) ? invDueUsd : effectiveAmountUsd;
      const newPaidUsd = roundUsd(D(inv.paidUsd).plus(appliedUsd));
      const newDueUsd = roundUsd(D(inv.totalUsd).minus(newPaidUsd));
      const newPaidOrig = fromUsd(newPaidUsd, inv.currency, inv.exchangeRate);
      const newDueOrig = fromUsd(newDueUsd, inv.currency, inv.exchangeRate);

      await tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: {
          paidUsd: newPaidUsd.toNumber(),
          dueUsd: newDueUsd.toNumber(),
          paidOriginal: newPaidOrig.toNumber(),
          dueOriginal: newDueOrig.toNumber(),
          status: newDueUsd.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
    } else {
      const unpaidInvoices = await tx.purchaseInvoice.findMany({
        where: {
          supplierId: supplier.id,
          status: { in: ['POSTED', 'PARTIALLY_PAID'] },
          dueUsd: { gt: 0 },
        },
        orderBy: { date: 'asc' },
      });

      let remainingToAllocate = effectiveAmountUsd;
      for (const inv of unpaidInvoices) {
        if (remainingToAllocate.lte(0)) break;
        const invDue = roundUsd(inv.dueUsd);
        const alloc = remainingToAllocate.gte(invDue) ? invDue : remainingToAllocate;
        const newPaidUsd = roundUsd(D(inv.paidUsd).plus(alloc));
        const newDueUsd = roundUsd(D(inv.totalUsd).minus(newPaidUsd));
        const newPaidOrig = fromUsd(newPaidUsd, inv.currency, inv.exchangeRate);
        const newDueOrig = fromUsd(newDueUsd, inv.currency, inv.exchangeRate);

        await tx.purchaseInvoice.update({
          where: { id: inv.id },
          data: {
            paidUsd: newPaidUsd.toNumber(),
            dueUsd: newDueUsd.toNumber(),
            paidOriginal: newPaidOrig.toNumber(),
            dueOriginal: newDueOrig.toNumber(),
            status: newDueUsd.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
        remainingToAllocate = roundUsd(remainingToAllocate.minus(alloc));
      }
    }

    // Update supplier balance
    const newSupplierBalance = roundUsd(
      currentSupplierLiability.minus(effectiveAmountUsd)
    );
    await tx.supplier.update({
      where: { id: supplier.id },
      data: { balanceUsd: newSupplierBalance.toNumber() },
    });

    // Update FinancialAccount balance
    const amountInAccCurrency =
      financialAccount.currency === currency
        ? amountOrig
        : fromUsd(effectiveAmountUsd, financialAccount.currency, exchangeRate);

    const newAccBalOrig = roundCurrency(
      D(financialAccount.balanceOriginal).minus(amountInAccCurrency),
      financialAccount.currency
    );
    const newAccBalUsd = roundUsd(
      D(financialAccount.balanceUsd).minus(effectiveAmountUsd)
    );

    await tx.financialAccount.update({
      where: { id: financialAccount.id },
      data: {
        balanceOriginal: newAccBalOrig.toNumber(),
        balanceUsd: newAccBalUsd.toNumber(),
      },
    });

    const payCount = await tx.debtPayment.count();
    const paymentNumber = `PAY-${new Date().getFullYear()}-${String(payCount + 1).padStart(
      4,
      '0'
    )}-${Math.floor(10 + Math.random() * 89)}`;

    // Post Double-Entry Journal Entry: Debit Accounts Payable (2100), Credit Cash/Bank
    const jrn = await postJournalEntryInTx(tx, {
      date: input.date || new Date(),
      description: `Supplier liability payment to ${supplier.name} (${paymentNumber})`,
      referenceType: 'CREDITOR_PAYMENT',
      currency,
      exchangeRate,
      isDemo: input.isDemo ?? supplier.isDemo,
      createdById: input.createdById || null,
      lines: [
        {
          accountCode: '2100', // Accounts Payable
          description: `AP settlement for ${supplier.name}`,
          debitUsd: effectiveAmountUsd,
          creditUsd: 0,
          supplierId: supplier.id,
        },
        {
          accountId: financialAccount.ledgerAccountId,
          description: `Creditor payment from ${financialAccount.nameEn}`,
          debitUsd: 0,
          creditUsd: effectiveAmountUsd,
          supplierId: supplier.id,
        },
      ],
    });

    const cashTxCount = await tx.cashTransaction.count();
    await tx.cashTransaction.create({
      data: {
        transactionNumber: `CSH-${new Date().getFullYear()}-${String(
          cashTxCount + 1
        ).padStart(5, '0')}-${Math.floor(10 + Math.random() * 89)}`,
        date: input.date || new Date(),
        type: 'CREDITOR_PAYMENT',
        financialAccountId: financialAccount.id,
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: effectiveAmountUsd.toNumber(),
        direction: 'OUT',
        balanceAfterOriginal: newAccBalOrig.toNumber(),
        balanceAfterUsd: newAccBalUsd.toNumber(),
        category: 'CREDITOR_PAYMENT',
        description: `Creditor payment to ${supplier.name} (${paymentNumber})`,
        referenceType: 'DEBT_PAYMENT',
        journalEntryId: jrn.id,
        isDemo: input.isDemo ?? supplier.isDemo,
        createdById: input.createdById || null,
      },
    });

    return tx.debtPayment.create({
      data: {
        paymentNumber,
        date: input.date || new Date(),
        type: 'CREDITOR_PAYMENT',
        supplierId: supplier.id,
        purchaseInvoiceId: input.purchaseInvoiceId || null,
        financialAccountId: financialAccount.id,
        paymentMethod: input.paymentMethod || 'CASH',
        currency,
        exchangeRate: exchangeRate.toNumber(),
        amountOriginal: amountOrig.toNumber(),
        amountUsd: effectiveAmountUsd.toNumber(),
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        journalEntryId: jrn.id,
        idempotencyKey: input.idempotencyKey || null,
        isDemo: input.isDemo ?? supplier.isDemo,
        createdById: input.createdById || null,
      },
      include: {
        supplier: true,
        purchaseInvoice: true,
        financialAccount: true,
      },
    });
  });
}

/**
 * Generates a chronological Customer Account Statement with running balance.
 */
export async function getCustomerStatement(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      salesInvoices: {
        where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID', 'RETURNED'] } },
        orderBy: { date: 'asc' },
      },
      debtPayments: {
        orderBy: { date: 'asc' },
      },
    },
  });

  if (!customer) {
    throw new DebtError('Customer not found.');
  }

  const events: {
    date: Date;
    type: string;
    reference: string;
    description: string;
    debitUsd: number;
    creditUsd: number;
  }[] = [];

  if (D(customer.openingBalanceUsd).gt(0)) {
    events.push({
      date: customer.createdAt,
      type: 'OPENING_BALANCE',
      reference: 'OPEN-BAL',
      description: 'Opening receivable balance',
      debitUsd: roundUsd(customer.openingBalanceUsd).toNumber(),
      creditUsd: 0,
    });
  }

  // Sum debtPayments per salesInvoiceId to separate initial checkout payment from subsequent collections
  const collectionsByInvoice = new Map<string, ReturnType<typeof D>>();
  for (const pay of customer.debtPayments) {
    if (pay.salesInvoiceId) {
      const prev = collectionsByInvoice.get(pay.salesInvoiceId) || D(0);
      collectionsByInvoice.set(pay.salesInvoiceId, prev.plus(D(pay.amountUsd)));
    }
  }

  for (const inv of customer.salesInvoices) {
    const subsequentCollections = collectionsByInvoice.get(inv.id) || D(0);
    const initialPaidOnInvoice = Decimal.max(
      0,
      roundUsd(D(inv.paidUsd).minus(subsequentCollections))
    );

    events.push({
      date: inv.date,
      type: 'SALES_INVOICE',
      reference: inv.invoiceNumber,
      description: `Sales Invoice (${inv.paymentType})`,
      debitUsd: roundUsd(inv.totalUsd).toNumber(),
      creditUsd: initialPaidOnInvoice.toNumber(),
    });
    if (inv.status === 'RETURNED') {
      const unpaidPortionReversed = Decimal.max(
        0,
        roundUsd(D(inv.totalUsd).minus(D(inv.paidUsd)))
      );
      events.push({
        date: inv.updatedAt,
        type: 'SALES_RETURN',
        reference: `${inv.invoiceNumber}-RET`,
        description: `Sales Return & AR Reversal for ${inv.invoiceNumber}`,
        debitUsd: 0,
        creditUsd: unpaidPortionReversed.toNumber(),
      });
    }
  }

  for (const pay of customer.debtPayments) {
    events.push({
      date: pay.date,
      type: 'COLLECTION',
      reference: pay.paymentNumber,
      description: pay.notes || `Debt collection (${pay.paymentMethod})`,
      debitUsd: 0,
      creditUsd: roundUsd(pay.amountUsd).toNumber(),
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = D(0);
  const lines = events.map((ev) => {
    running = roundUsd(running.plus(ev.debitUsd).minus(ev.creditUsd));
    return {
      ...ev,
      runningBalanceUsd: running.toNumber(),
    };
  });

  return {
    customer,
    lines,
    closingBalanceUsd: roundUsd(customer.balanceUsd).toNumber(),
  };
}

/**
 * Generates a chronological Supplier/Creditor Account Statement with running balance.
 */
export async function getSupplierStatement(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      purchaseInvoices: {
        where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID', 'RETURNED'] } },
        orderBy: { date: 'asc' },
      },
      debtPayments: {
        orderBy: { date: 'asc' },
      },
      expenses: {
        where: { status: 'POSTED', paymentMethod: 'CREDIT' },
        orderBy: { date: 'asc' },
      },
    },
  });

  if (!supplier) {
    throw new DebtError('Supplier not found.');
  }

  const events: {
    date: Date;
    type: string;
    reference: string;
    description: string;
    debitUsd: number; // Payment reduces liability
    creditUsd: number; // Invoice increases liability
  }[] = [];

  if (D(supplier.openingBalanceUsd).gt(0)) {
    events.push({
      date: supplier.createdAt,
      type: 'OPENING_BALANCE',
      reference: 'OPEN-BAL',
      description: 'Opening creditor balance',
      debitUsd: 0,
      creditUsd: roundUsd(supplier.openingBalanceUsd).toNumber(),
    });
  }

  const paymentsByPurchaseInvoice = new Map<string, ReturnType<typeof D>>();
  for (const pay of supplier.debtPayments) {
    if (pay.purchaseInvoiceId) {
      const prev = paymentsByPurchaseInvoice.get(pay.purchaseInvoiceId) || D(0);
      paymentsByPurchaseInvoice.set(pay.purchaseInvoiceId, prev.plus(D(pay.amountUsd)));
    }
  }

  for (const inv of supplier.purchaseInvoices) {
    const subsequentPayments = paymentsByPurchaseInvoice.get(inv.id) || D(0);
    const initialPaidOnPurchase = Decimal.max(
      0,
      roundUsd(D(inv.paidUsd).minus(subsequentPayments))
    );

    events.push({
      date: inv.date,
      type: 'PURCHASE_INVOICE',
      reference: inv.invoiceNumber,
      description: `Purchase Invoice (${inv.paymentType})`,
      debitUsd: initialPaidOnPurchase.toNumber(),
      creditUsd: roundUsd(inv.totalUsd).toNumber(),
    });
    if (inv.status === 'RETURNED') {
      const unpaidPortionReversed = Decimal.max(
        0,
        roundUsd(D(inv.totalUsd).minus(D(inv.paidUsd)))
      );
      events.push({
        date: inv.updatedAt,
        type: 'PURCHASE_RETURN',
        reference: `${inv.invoiceNumber}-RET`,
        description: `Purchase Return & AP Reversal for ${inv.invoiceNumber}`,
        debitUsd: unpaidPortionReversed.toNumber(),
        creditUsd: 0,
      });
    }
  }

  for (const exp of supplier.expenses) {
    events.push({
      date: exp.date,
      type: 'ACCRUED_EXPENSE',
      reference: exp.expenseNumber,
      description: `Credit Expense: ${exp.title}`,
      debitUsd: 0,
      creditUsd: roundUsd(exp.amountUsd).toNumber(),
    });
  }

  for (const pay of supplier.debtPayments) {
    events.push({
      date: pay.date,
      type: 'PAYMENT',
      reference: pay.paymentNumber,
      description: pay.notes || `Creditor payment (${pay.paymentMethod})`,
      debitUsd: roundUsd(pay.amountUsd).toNumber(),
      creditUsd: 0,
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = D(0);
  const lines = events.map((ev) => {
    running = roundUsd(running.plus(ev.creditUsd).minus(ev.debitUsd));
    return {
      ...ev,
      runningBalanceUsd: running.toNumber(),
    };
  });

  return {
    supplier,
    lines,
    closingBalanceUsd: roundUsd(supplier.balanceUsd).toNumber(),
  };
}
