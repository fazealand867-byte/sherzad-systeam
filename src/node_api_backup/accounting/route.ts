import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  getBalanceSheet,
  getGeneralLedger,
  getProfitAndLoss,
  getTrialBalance,
  postJournalEntry,
  reverseJournalEntry,
} from '@/lib/services/accounting.service';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { logAudit } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    await requireApiPermission('accounting.view');
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : undefined;
    const endDate = searchParams.get('endDate')
      ? new Date(searchParams.get('endDate')!)
      : undefined;
    const accountId = searchParams.get('accountId') || undefined;

    const [
      accounts,
      journals,
      trialBalance,
      profitAndLoss,
      balanceSheet,
      generalLedger,
      periods,
    ] = await Promise.all([
      prisma.account.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      }),
      prisma.journalEntry.findMany({
        take: 100,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
          lines: {
            include: { account: true },
          },
        },
      }),
      getTrialBalance({ startDate, endDate }),
      getProfitAndLoss({ startDate, endDate }),
      getBalanceSheet({ asOfDate: endDate }),
      getGeneralLedger({ accountId, startDate, endDate }),
      prisma.accountingPeriod.findMany({ orderBy: { startDate: 'desc' } }),
    ]);

    return NextResponse.json({
      accounts,
      journals,
      trialBalance,
      profitAndLoss,
      balanceSheet,
      generalLedger,
      periods,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'manualJournal') {
      const user = await requireApiPermission('accounting.manualJournal');
      const entry = await postJournalEntry({
        date: body.date ? new Date(body.date) : new Date(),
        description: body.description,
        referenceType: 'MANUAL',
        currency: body.currency || 'USD',
        exchangeRate: body.exchangeRate,
        lines: body.lines,
        createdById: user.id,
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'MANUAL_JOURNAL_POSTED',
        module: 'ACCOUNTING',
        entityType: 'JournalEntry',
        entityId: entry.id,
        description: `Posted Manual Journal ${entry.entryNumber}: '${entry.description}' ($${Number(
          entry.totalDebitUsd
        ).toFixed(2)})`,
      });

      return NextResponse.json({ entry });
    }

    if (action === 'reverseJournal') {
      const user = await requireApiPermission('accounting.reverseJournal');
      const { journalEntryId, reason } = body;

      const reversal = await reverseJournalEntry(
        journalEntryId,
        reason || 'Accounting adjustment reversal',
        user.id
      );

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'JOURNAL_REVERSED',
        module: 'ACCOUNTING',
        entityType: 'JournalEntry',
        entityId: reversal.id,
        description: `Reversed journal entry via ${reversal.entryNumber} — Reason: ${reason}`,
      });

      return NextResponse.json({ reversal });
    }

    if (action === 'createAccount') {
      const user = await requireApiPermission('accounting.manualJournal');
      const { code, nameEn, nameAr, nameKu, type, subType, normalBalance } = body;
      const defaultNormal =
        normalBalance ||
        (['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT');

      const account = await prisma.account.create({
        data: {
          code: code.trim(),
          nameEn: nameEn.trim(),
          nameAr: (nameAr || nameEn).trim(),
          nameKu: (nameKu || nameEn).trim(),
          type,
          subType: subType || type,
          normalBalance: defaultNormal,
        },
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'CHART_ACCOUNT_CREATED',
        module: 'ACCOUNTING',
        entityType: 'Account',
        entityId: account.id,
        description: `Added account ${account.code} — ${account.nameEn} (${account.type})`,
      });

      return NextResponse.json({ account });
    }

    if (action === 'togglePeriodLock') {
      const user = await requireApiPermission('accounting.lockPeriod');
      const { periodId, isLocked } = body;

      const period = await prisma.accountingPeriod.update({
        where: { id: periodId },
        data: {
          isLocked: Boolean(isLocked),
          isClosed: Boolean(isLocked),
          closedById: isLocked ? user.id : null,
          closedAt: isLocked ? new Date() : null,
        },
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: isLocked ? 'PERIOD_LOCKED' : 'PERIOD_UNLOCKED',
        module: 'ACCOUNTING',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        description: `${isLocked ? 'Closed & Locked' : 'Unlocked'} accounting period ${period.name}`,
      });

      return NextResponse.json({ period });
    }

    if (action === 'createPeriod') {
      const user = await requireApiPermission('accounting.lockPeriod');
      const { name, startDate, endDate, isLocked } = body;
      const period = await prisma.accountingPeriod.create({
        data: {
          name,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          isLocked: Boolean(isLocked),
          isClosed: Boolean(isLocked),
          closedById: isLocked ? user.id : null,
          closedAt: isLocked ? new Date() : null,
        },
      });
      return NextResponse.json({ period });
    }

    return NextResponse.json({ error: 'Invalid accounting action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
