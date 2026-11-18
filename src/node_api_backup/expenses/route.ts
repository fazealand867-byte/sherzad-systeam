import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  approveExpense,
  createExpense,
  rejectExpense,
} from '@/lib/services/expense.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { hasPermission, logAudit } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('expenses.view');
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const status = searchParams.get('status') || undefined;

    const expenses = await prisma.expense.findMany({
      where: {
        ...(category && category !== 'ALL' ? { category } : {}),
        ...(status && status !== 'ALL' ? { status } : {}),
      },
      include: {
        expenseAccount: true,
        financialAccount: true,
        supplier: true,
      },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json({ expenses });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'createExpense') {
      const user = await requireApiPermission('expenses.create');
      const canAutoApprove = await hasPermission(user.role, 'expenses.approve');

      const expense = await createExpense({
        date: body.date ? new Date(body.date) : new Date(),
        category: body.category || 'MISCELLANEOUS',
        title: body.title,
        description: body.description,
        vendorName: body.vendorName,
        expenseAccountId: body.expenseAccountId,
        financialAccountId: body.financialAccountId || null,
        supplierId: body.supplierId || null,
        paymentMethod: body.paymentMethod || 'CASH',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        amountOriginal: body.amountOriginal,
        isRecurring: Boolean(body.isRecurring),
        recurringInterval: body.recurringInterval || null,
        attachmentName: body.attachmentName,
        attachmentUrl: body.attachmentUrl,
        bypassApprovalThreshold: Boolean(body.bypassApprovalThreshold && canAutoApprove),
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action:
          expense.status === 'PENDING_APPROVAL'
            ? 'EXPENSE_SUBMITTED_FOR_APPROVAL'
            : 'EXPENSE_POSTED',
        module: 'EXPENSES',
        entityType: 'Expense',
        entityId: expense.id,
        description: `Recorded expense ${expense.expenseNumber}: '${expense.title}' ($${Number(
          expense.amountUsd
        ).toFixed(2)}) — Status: ${expense.status}`,
      });

      return NextResponse.json({ expense });
    }

    if (action === 'approveExpense') {
      const user = await requireApiPermission('expenses.approve');
      const { expenseId } = body;

      const expense = await approveExpense(expenseId, user.id);

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'EXPENSE_APPROVED_AND_POSTED',
        module: 'EXPENSES',
        entityType: 'Expense',
        entityId: expense.id,
        description: `Approved and posted expense ${expense.expenseNumber}: '${expense.title}' ($${Number(
          expense.amountUsd
        ).toFixed(2)})`,
      });

      return NextResponse.json({ expense });
    }

    if (action === 'rejectExpense') {
      const user = await requireApiPermission('expenses.approve');
      const { expenseId } = body;

      const expense = await rejectExpense(expenseId, user.id);

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'EXPENSE_REJECTED',
        module: 'EXPENSES',
        entityType: 'Expense',
        entityId: expense.id,
        description: `Rejected pending expense ${expense.expenseNumber}: '${expense.title}'`,
      });

      return NextResponse.json({ expense });
    }

    return NextResponse.json({ error: 'Invalid expense action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
