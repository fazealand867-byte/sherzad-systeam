import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  createPurchaseInvoice,
  postPurchaseInvoice,
  returnPurchaseInvoice,
} from '@/lib/services/purchases.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { logAudit } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('purchases.view');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const supplierId = searchParams.get('supplierId') || undefined;

    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(supplierId ? { supplierId } : {}),
      },
      include: {
        supplier: true,
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
      const user = await requireApiPermission('purchases.create');
      if (body.status === 'POSTED' || !body.status) {
        await requireApiPermission('purchases.post');
      }

      const invoice = await createPurchaseInvoice({
        supplierId: body.supplierId,
        supplierInvoiceRef: body.supplierInvoiceRef,
        warehouseId: body.warehouseId,
        date: body.date ? new Date(body.date) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: body.status || 'POSTED',
        paymentType: body.paymentType || 'CASH',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        items: body.items,
        invoiceDiscountOriginal: body.invoiceDiscountOriginal || 0,
        taxOriginal: body.taxOriginal || 0,
        shippingOriginal: body.shippingOriginal || 0,
        paidOriginal: body.paidOriginal,
        financialAccountId: body.financialAccountId || null,
        paymentMethod: body.paymentMethod || 'CASH',
        notes: body.notes,
        attachmentName: body.attachmentName,
        attachmentUrl: body.attachmentUrl,
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: invoice.status === 'DRAFT' ? 'PURCHASE_DRAFT_SAVED' : 'PURCHASE_POSTED',
        module: 'PURCHASES',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        description: `Created Purchase Invoice ${invoice.invoiceNumber} (${invoice.status}) from ${invoice.supplier.name} — Total: $${Number(
          invoice.totalUsd
        ).toFixed(2)}`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'postInvoice') {
      const user = await requireApiPermission('purchases.post');
      const { invoiceId } = body;

      const invoice = await postPurchaseInvoice(invoiceId, user.id);

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PURCHASE_POSTED',
        module: 'PURCHASES',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        description: `Posted Purchase Invoice ${invoice.invoiceNumber} to Inventory and General Ledger`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'returnInvoice') {
      const user = await requireApiPermission('purchases.return');
      const { invoiceId, reason } = body;

      const invoice = await returnPurchaseInvoice(
        invoiceId,
        reason || 'Supplier purchase return',
        user.id
      );

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PURCHASE_RETURNED',
        module: 'PURCHASES',
        entityType: 'PurchaseInvoice',
        entityId: invoice.id,
        description: `Processed Purchase Return for ${invoice.invoiceNumber} — Reason: ${reason}`,
      });

      return NextResponse.json({ invoice });
    }

    if (action === 'cancelDraft') {
      const user = await requireApiPermission('purchases.create');
      const { invoiceId } = body;
      const inv = await prisma.purchaseInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv || !['DRAFT', 'APPROVED'].includes(inv.status)) {
        return NextResponse.json(
          { error: 'Only unposted draft purchase invoices can be cancelled directly.' },
          { status: 400 }
        );
      }
      const cancelled = await prisma.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: 'CANCELLED' },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PURCHASE_DRAFT_CANCELLED',
        module: 'PURCHASES',
        entityType: 'PurchaseInvoice',
        entityId: cancelled.id,
        description: `Cancelled draft purchase invoice ${cancelled.invoiceNumber}`,
      });
      return NextResponse.json({ invoice: cancelled });
    }

    return NextResponse.json({ error: 'Invalid purchase action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
