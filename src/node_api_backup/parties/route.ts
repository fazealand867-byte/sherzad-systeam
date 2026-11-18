import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  getCustomerStatement,
  getSupplierStatement,
  recordCreditorPayment,
  recordDebtorCollection,
} from '@/lib/services/debt.service';
import { postJournalEntryInTx } from '@/lib/services/accounting.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { logAudit } from '@/lib/auth';
import { D, roundUsd } from '@/lib/decimal';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const statementCustomerId = searchParams.get('statementCustomerId');
    const statementSupplierId = searchParams.get('statementSupplierId');

    if (statementCustomerId) {
      await requireApiPermission('customers.view');
      const statement = await getCustomerStatement(statementCustomerId);
      return NextResponse.json({ statement });
    }

    if (statementSupplierId) {
      await requireApiPermission('suppliers.view');
      const statement = await getSupplierStatement(statementSupplierId);
      return NextResponse.json({ statement });
    }

    const [customers, suppliers, debtPayments, unpaidSalesInvoices, unpaidPurchaseInvoices] =
      await Promise.all([
        prisma.customer.findMany({
          where: { isActive: true },
          include: {
            salesInvoices: {
              where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
              orderBy: { date: 'desc' },
              take: 10,
            },
          },
          orderBy: { balanceUsd: 'desc' },
        }),
        prisma.supplier.findMany({
          where: { isActive: true },
          include: {
            purchaseInvoices: {
              where: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
              orderBy: { date: 'desc' },
              take: 10,
            },
          },
          orderBy: { balanceUsd: 'desc' },
        }),
        prisma.debtPayment.findMany({
          include: {
            customer: true,
            supplier: true,
            financialAccount: true,
            salesInvoice: true,
            purchaseInvoice: true,
          },
          orderBy: { date: 'desc' },
          take: 80,
        }),
        prisma.salesInvoice.findMany({
          where: {
            status: { in: ['POSTED', 'PARTIALLY_PAID'] },
            dueUsd: { gt: 0 },
          },
          include: { customer: true },
          orderBy: { dueDate: 'asc' },
        }),
        prisma.purchaseInvoice.findMany({
          where: {
            status: { in: ['POSTED', 'PARTIALLY_PAID'] },
            dueUsd: { gt: 0 },
          },
          include: { supplier: true },
          orderBy: { dueDate: 'asc' },
        }),
      ]);

    return NextResponse.json({
      customers,
      suppliers,
      debtPayments,
      unpaidSalesInvoices,
      unpaidPurchaseInvoices,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'createCustomer') {
      const user = await requireApiPermission('customers.manage');
      const count = await prisma.customer.count();
      const code = body.code || `CUST-${String(count + 1).padStart(3, '0')}`;
      const openingUsd = roundUsd(body.openingBalanceUsd || 0);

      const customer = await prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: {
            code,
            name: body.name.trim(),
            companyName: body.companyName || null,
            phone: body.phone || '',
            email: body.email || null,
            address: body.address || null,
            city: body.city || null,
            creditLimitUsd: Number(body.creditLimitUsd ?? 5000),
            openingBalanceUsd: openingUsd.toNumber(),
            balanceUsd: openingUsd.toNumber(),
            paymentTermDays: Number(body.paymentTermDays ?? 30),
            notes: body.notes || null,
          },
        });

        if (openingUsd.gt(0)) {
          await postJournalEntryInTx(tx, {
            description: `Opening receivable balance for customer ${created.name}`,
            referenceType: 'MANUAL',
            referenceId: created.id,
            createdById: user.id,
            lines: [
              {
                accountCode: '1200',
                debitUsd: openingUsd,
                creditUsd: 0,
                customerId: created.id,
              },
              {
                accountCode: '3000',
                debitUsd: 0,
                creditUsd: openingUsd,
                customerId: created.id,
              },
            ],
          });
        }
        return created;
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'CUSTOMER_CREATED',
        module: 'CUSTOMERS',
        entityType: 'Customer',
        entityId: customer.id,
        description: `Created customer profile '${customer.name}' (${customer.code})`,
      });

      return NextResponse.json({ customer });
    }

    if (action === 'updateCustomer') {
      const user = await requireApiPermission('customers.manage');
      const { id, name, companyName, phone, email, address, city, creditLimitUsd, paymentTermDays, notes } = body;
      const customer = await prisma.customer.update({
        where: { id },
        data: {
          name,
          companyName: companyName || null,
          phone,
          email: email || null,
          address: address || null,
          city: city || null,
          creditLimitUsd: Number(creditLimitUsd ?? 5000),
          paymentTermDays: Number(paymentTermDays ?? 30),
          notes: notes || null,
        },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'CUSTOMER_UPDATED',
        module: 'CUSTOMERS',
        entityType: 'Customer',
        entityId: customer.id,
        description: `Updated customer '${customer.name}'`,
      });
      return NextResponse.json({ customer });
    }

    if (action === 'createSupplier') {
      const user = await requireApiPermission('suppliers.manage');
      const count = await prisma.supplier.count();
      const code = body.code || `SUPP-${String(count + 1).padStart(3, '0')}`;
      const openingUsd = roundUsd(body.openingBalanceUsd || 0);

      const supplier = await prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: {
            code,
            name: body.name.trim(),
            companyName: body.companyName || null,
            contactPerson: body.contactPerson || null,
            phone: body.phone || '',
            email: body.email || null,
            address: body.address || null,
            city: body.city || null,
            taxNumber: body.taxNumber || null,
            openingBalanceUsd: openingUsd.toNumber(),
            balanceUsd: openingUsd.toNumber(),
            paymentTermDays: Number(body.paymentTermDays ?? 30),
            notes: body.notes || null,
          },
        });

        if (openingUsd.gt(0)) {
          await postJournalEntryInTx(tx, {
            description: `Opening creditor balance for supplier ${created.name}`,
            referenceType: 'MANUAL',
            referenceId: created.id,
            createdById: user.id,
            lines: [
              {
                accountCode: '3000',
                debitUsd: openingUsd,
                creditUsd: 0,
                supplierId: created.id,
              },
              {
                accountCode: '2100',
                debitUsd: 0,
                creditUsd: openingUsd,
                supplierId: created.id,
              },
            ],
          });
        }
        return created;
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SUPPLIER_CREATED',
        module: 'SUPPLIERS',
        entityType: 'Supplier',
        entityId: supplier.id,
        description: `Created supplier/creditor profile '${supplier.name}' (${supplier.code})`,
      });

      return NextResponse.json({ supplier });
    }

    if (action === 'updateSupplier') {
      const user = await requireApiPermission('suppliers.manage');
      const { id, name, companyName, contactPerson, phone, email, address, city, taxNumber, paymentTermDays, notes } = body;
      const supplier = await prisma.supplier.update({
        where: { id },
        data: {
          name,
          companyName: companyName || null,
          contactPerson: contactPerson || null,
          phone,
          email: email || null,
          address: address || null,
          city: city || null,
          taxNumber: taxNumber || null,
          paymentTermDays: Number(paymentTermDays ?? 30),
          notes: notes || null,
        },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SUPPLIER_UPDATED',
        module: 'SUPPLIERS',
        entityType: 'Supplier',
        entityId: supplier.id,
        description: `Updated supplier '${supplier.name}'`,
      });
      return NextResponse.json({ supplier });
    }

    if (action === 'collectDebt') {
      const user = await requireApiPermission('debtors.collect');
      const payment = await recordDebtorCollection({
        customerId: body.customerId,
        salesInvoiceId: body.salesInvoiceId || null,
        financialAccountId: body.financialAccountId,
        paymentMethod: body.paymentMethod || 'CASH',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        amountOriginal: body.amountOriginal,
        date: body.date ? new Date(body.date) : new Date(),
        referenceNumber: body.referenceNumber,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'DEBTOR_COLLECTION_RECORDED',
        module: 'DEBTORS',
        entityType: 'DebtPayment',
        entityId: payment.id,
        description: `Collected $${D(payment.amountUsd).toFixed(2)} from debtor ${payment.customer?.name} (${payment.paymentNumber})`,
      });

      return NextResponse.json({ payment });
    }

    if (action === 'payCreditor') {
      const user = await requireApiPermission('creditors.pay');
      const payment = await recordCreditorPayment({
        supplierId: body.supplierId,
        purchaseInvoiceId: body.purchaseInvoiceId || null,
        financialAccountId: body.financialAccountId,
        paymentMethod: body.paymentMethod || 'CASH',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        amountOriginal: body.amountOriginal,
        date: body.date ? new Date(body.date) : new Date(),
        referenceNumber: body.referenceNumber,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'CREDITOR_PAYMENT_RECORDED',
        module: 'CREDITORS',
        entityType: 'DebtPayment',
        entityId: payment.id,
        description: `Paid $${D(payment.amountUsd).toFixed(2)} to creditor ${payment.supplier?.name} (${payment.paymentNumber})`,
      });

      return NextResponse.json({ payment });
    }

    return NextResponse.json({ error: 'Invalid parties/debt action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
