import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  reconcileFinancialAccount,
  recordCashDepositOrWithdrawal,
  transferBetweenFinancialAccounts,
} from '@/lib/services/cashbank.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { logAudit } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('cashbank.view');
    const { searchParams } = new URL(request.url);
    const financialAccountId = searchParams.get('financialAccountId') || undefined;

    const [accounts, transactions] = await Promise.all([
      prisma.financialAccount.findMany({
        where: { isActive: true },
        include: { ledgerAccount: true },
        orderBy: { code: 'asc' },
      }),
      prisma.cashTransaction.findMany({
        where: financialAccountId ? { financialAccountId } : undefined,
        include: {
          financialAccount: true,
          targetFinancialAccount: true,
        },
        orderBy: { date: 'desc' },
        take: 100,
      }),
    ]);

    return NextResponse.json({
      accounts,
      transactions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'deposit' || action === 'withdrawal') {
      const user = await requireApiPermission('cashbank.manage');
      const tx = await recordCashDepositOrWithdrawal({
        financialAccountId: body.financialAccountId,
        type: action === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL',
        amountOriginal: body.amountOriginal,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        counterpartyAccountCode: body.counterpartyAccountCode,
        category: body.category,
        description: body.description,
        date: body.date ? new Date(body.date) : new Date(),
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: action === 'deposit' ? 'CASH_DEPOSIT' : 'CASH_WITHDRAWAL',
        module: 'CASH_BANK',
        entityType: 'CashTransaction',
        entityId: tx.id,
        description: `${action.toUpperCase()} of $${Number(tx.amountUsd).toFixed(2)} on ${tx.financialAccount.nameEn} (${tx.description})`,
      });

      return NextResponse.json({ transaction: tx });
    }

    if (action === 'transfer') {
      const user = await requireApiPermission('cashbank.manage');
      const tx = await transferBetweenFinancialAccounts({
        fromFinancialAccountId: body.fromFinancialAccountId,
        toFinancialAccountId: body.toFinancialAccountId,
        amountOriginal: body.amountOriginal,
        exchangeRate: body.exchangeRate,
        description: body.description,
        date: body.date ? new Date(body.date) : new Date(),
        idempotencyKey: body.idempotencyKey,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'INTERNAL_FUNDS_TRANSFER',
        module: 'CASH_BANK',
        entityType: 'CashTransaction',
        entityId: tx.id,
        description: `Transferred $${Number(tx.amountUsd).toFixed(2)} from ${tx.financialAccount.nameEn} to ${tx.targetFinancialAccount?.nameEn}`,
      });

      return NextResponse.json({ transaction: tx });
    }

    if (action === 'reconcile') {
      const user = await requireApiPermission('cashbank.reconcile');
      const account = await reconcileFinancialAccount({
        financialAccountId: body.financialAccountId,
        statementBalanceOriginal: body.statementBalanceOriginal,
        transactionIds: body.transactionIds,
        postAdjustment: Boolean(body.postAdjustment),
        notes: body.notes,
        userId: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'ACCOUNT_RECONCILED',
        module: 'CASH_BANK',
        entityType: 'FinancialAccount',
        entityId: account?.id,
        description: `Reconciled financial account ${account?.nameEn} against statement balance ${body.statementBalanceOriginal}`,
      });

      return NextResponse.json({ account });
    }

    if (action === 'createAccount') {
      const user = await requireApiPermission('cashbank.manage');
      const { code, nameEn, nameAr, nameKu, type, currency, bankName, accountNumber, iban } = body;

      const count = await prisma.account.count({
        where: { subType: type === 'BANK_ACCOUNT' ? 'BANK' : 'CASH' },
      });
      const ledgerCode =
        type === 'BANK_ACCOUNT' ? `102${count + 5}` : `101${count + 5}`;

      const ledgerAccount = await prisma.account.create({
        data: {
          code: ledgerCode,
          nameEn,
          nameAr: nameAr || nameEn,
          nameKu: nameKu || nameEn,
          type: 'ASSET',
          subType: type === 'BANK_ACCOUNT' ? 'BANK' : 'CASH',
          normalBalance: 'DEBIT',
        },
      });

      const finAcc = await prisma.financialAccount.create({
        data: {
          code: (code || `ACC-${Date.now().toString().slice(-4)}`).toUpperCase(),
          nameEn,
          nameAr: nameAr || nameEn,
          nameKu: nameKu || nameEn,
          type: type || 'CASH_REGISTER',
          currency: currency || 'USD',
          bankName: bankName || null,
          accountNumber: accountNumber || null,
          iban: iban || null,
          ledgerAccountId: ledgerAccount.id,
        },
        include: { ledgerAccount: true },
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'FINANCIAL_ACCOUNT_CREATED',
        module: 'CASH_BANK',
        entityType: 'FinancialAccount',
        entityId: finAcc.id,
        description: `Created ${finAcc.type} '${finAcc.nameEn}' (${finAcc.currency})`,
      });

      return NextResponse.json({ account: finAcc });
    }

    return NextResponse.json({ error: 'Invalid cash/bank action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
