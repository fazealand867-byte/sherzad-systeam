import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  createSalesInvoice,
  postSalesInvoice,
  returnSalesInvoice,
} from '@/lib/services/sales.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { hasPermission, logAudit } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('sales.view');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const customerId = searchParams.get('customerId') || undefined;

    const invoices = await prisma.salesInvoice.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(customerId ? { customerId } : {}),
      },
      include: {
        customer: true,
        warehouse: true,
        financialAccount: true,
        items: true,
      },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json({ invoices });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'createInvoice') {
      const user = await requireApiPermission('sales.create');
      if (body.status === 'POSTED' || !body.status) {
        await requireApiPermission('sales.post');
      }
      if (body.allowNegativeStock) {
        const canOverride = await hasPermission(user.role, 'sales.overrideStock');
        if (!canOverride) {
          return NextResponse.json(
            { error: 'Your role is not authorized to override stock availability limits.' },
            { status: 403 }
          );
        }
      }

      const invoice = await createSalesInvoice({
        customerId: body.customerId,
        warehouseId: body.warehouseId,
        date: body.date ? new Date(body.date) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: body.status || 'POSTED',
        paymentType: body.paymentType || 'CASH',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        items: body.items,
        invoiceDiscountOriginal: body.invoiceDiscountOriginal || 0,
        paidOriginal: body.paidOriginal,
        financialAccountId: body.financialAccountId || null,
        paymentMethod: body.paymentMethod || 'CASH',
        notes: body.notes,
        allowNegativeStock: Boolean(body.allowNegativeStock),
        overrideCreditLimit: Boolean(body.overrideCreditLimit),
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: invoice.status === 'DRAFT' ? 'SALE_DRAFT_SAVED' : 'SALE_POSTED',
        module: 'SALES',
        entityType: 'SalesInvoice',
        entityId: invoice.id,
        description: `Created Sales Invoice ${invoice.invoiceNumber} (${invoice.status}) for ${invoice.customer.name} — Total: $${Number(
          invoice.totalUsd
        ).toFixed(2)}`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'postInvoice') {
      const user = await requireApiPermission('sales.post');
      const { invoiceId, allowNegativeStock, overrideCreditLimit } = body;

      const invoice = await postSalesInvoice(invoiceId, {
        allowNegativeStock: Boolean(allowNegativeStock),
        overrideCreditLimit: Boolean(overrideCreditLimit),
        userId: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SALE_POSTED',
        module: 'SALES',
        entityType: 'SalesInvoice',
        entityId: invoice.id,
        description: `Posted Sales Invoice ${invoice.invoiceNumber} to Inventory and General Ledger`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'returnInvoice') {
      const user = await requireApiPermission('sales.return');
      const { invoiceId, reason } = body;

      const invoice = await returnSalesInvoice(
        invoiceId,
        reason || 'Customer return & refund',
        user.id
      );

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SALE_RETURNED',
        module: 'SALES',
        entityType: 'SalesInvoice',
        entityId: invoice.id,
        description: `Processed Sales Return for ${invoice.invoiceNumber} — Reason: ${reason}`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'cancelDraft') {
      const user = await requireApiPermission('sales.create');
      const { invoiceId } = body;
      const inv = await prisma.salesInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv || !['DRAFT', 'APPROVED'].includes(inv.status)) {
        return NextResponse.json(
          { error: 'Only unposted draft/approved invoices can be cancelled directly.' },
          { status: 400 }
        );
      }
      const cancelled = await prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: { status: 'CANCELLED' },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SALE_DRAFT_CANCELLED',
        module: 'SALES',
        entityType: 'SalesInvoice',
        entityId: cancelled.id,
        description: `Cancelled draft sales invoice ${cancelled.invoiceNumber}`,
      });
      return NextResponse.json({ invoice: cancelled });
    }

    return NextResponse.json({ error: 'Invalid sales action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
