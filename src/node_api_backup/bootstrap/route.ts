import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureSystemSeeded } from '@/lib/services/seed.service';
import { getSessionUser, handleApiError } from '@/lib/server-auth';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, UserRole } from '@/lib/auth';
import { D, roundUsd } from '@/lib/decimal';

export async function GET() {
  try {
    await ensureSystemSeeded();

    const user = await getSessionUser();
    const settings = await prisma.companySettings.findFirst();

    let permissions: string[] = [...ALL_PERMISSIONS];
    if (user) {
      if (user.role === 'SUPER_ADMIN' || user.role === 'BUSINESS_OWNER') {
        permissions = [...ALL_PERMISSIONS];
      } else {
        const customPerm = await prisma.rolePermission.findUnique({
          where: { role: user.role },
        });
        if (customPerm) {
          try {
            permissions = JSON.parse(customPerm.permissionsJson);
          } catch {
            permissions = DEFAULT_ROLE_PERMISSIONS[user.role as UserRole] || [];
          }
        } else {
          permissions = DEFAULT_ROLE_PERMISSIONS[user.role as UserRole] || [];
        }
      }
    }

    const [warehouses, categories, financialAccounts, products, customers, suppliers, pendingExpenses, unpaidSales, unpaidPurchases] =
      await Promise.all([
        prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { isDefault: 'desc' } }),
        prisma.category.findMany({ orderBy: { nameEn: 'asc' } }),
        prisma.financialAccount.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
        prisma.product.findMany({
          where: { isActive: true },
          include: { category: true, warehouseStocks: true },
          orderBy: { nameEn: 'asc' },
        }),
        prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.expense.findMany({
          where: { status: 'PENDING_APPROVAL' },
          orderBy: { date: 'desc' },
        }),
        prisma.salesInvoice.findMany({
          where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] }, dueUsd: { gt: 0 } },
          include: { customer: true },
        }),
        prisma.purchaseInvoice.findMany({
          where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] }, dueUsd: { gt: 0 } },
          include: { supplier: true },
        }),
      ]);

    // Build real-time Notification Center alerts
    const notifications: {
      id: string;
      type: 'LOW_STOCK' | 'OVERDUE_DEBT' | 'OVERDUE_PAYABLE' | 'EXPENSE_APPROVAL';
      severity: 'warning' | 'danger' | 'info';
      titleEn: string;
      titleAr: string;
      titleKu: string;
      descEn: string;
      descAr: string;
      descKu: string;
      module: string;
    }[] = [];

    for (const p of products) {
      const qty = D(p.totalStock);
      const min = D(p.minStockLevel);
      if (qty.lte(min)) {
        notifications.push({
          id: `low-stock-${p.id}`,
          type: 'LOW_STOCK',
          severity: qty.lte(0) ? 'danger' : 'warning',
          titleEn: qty.lte(0) ? `Out of Stock: ${p.nameEn}` : `Low Stock Alert: ${p.nameEn}`,
          titleAr: qty.lte(0) ? `نفاد المخزون: ${p.nameAr}` : `تنبيه انخفاض المخزون: ${p.nameAr}`,
          titleKu: qty.lte(0) ? `نەمانی کاڵا لە کۆگا: ${p.nameKu}` : `ئاگاداری کەمی کاڵا: ${p.nameKu}`,
          descEn: `Remaining stock: ${qty.toNumber()} ${p.unit} (Minimum threshold: ${min.toNumber()})`,
          descAr: `الكمية المتبقية: ${qty.toNumber()} ${p.unit} (الحد الأدنى: ${min.toNumber()})`,
          descKu: `بڕی ماوە: ${qty.toNumber()} ${p.unit} (کەمترین ئاست: ${min.toNumber()})`,
          module: 'inventory',
        });
      }
    }

    for (const exp of pendingExpenses) {
      notifications.push({
        id: `exp-approval-${exp.id}`,
        type: 'EXPENSE_APPROVAL',
        severity: 'info',
        titleEn: `Approval Required: ${exp.title}`,
        titleAr: `يتطلب موافقة الإدارة: ${exp.title}`,
        titleKu: `پێویستی بە پەسەندکردنە: ${exp.title}`,
        descEn: `Expense ${exp.expenseNumber} ($${roundUsd(exp.amountUsd).toFixed(2)}) exceeds automatic threshold.`,
        descAr: `المصروف ${exp.expenseNumber} ($${roundUsd(exp.amountUsd).toFixed(2)}) بانتظار الاعتماد.`,
        descKu: `خەرجی ${exp.expenseNumber} ($${roundUsd(exp.amountUsd).toFixed(2)}) چاوەڕوانی پەسەندکردنە.`,
        module: 'expenses',
      });
    }

    for (const inv of unpaidSales) {
      notifications.push({
        id: `ar-due-${inv.id}`,
        type: 'OVERDUE_DEBT',
        severity: 'warning',
        titleEn: `Outstanding Receivable: ${inv.invoiceNumber}`,
        titleAr: `ذمة عميل مستحقة: ${inv.invoiceNumber}`,
        titleKu: `قەرزی کڕیار: ${inv.invoiceNumber}`,
        descEn: `${inv.customer.name} — Balance due: $${roundUsd(inv.dueUsd).toFixed(2)}`,
        descAr: `${inv.customer.name} — المبلغ المتبقي: $${roundUsd(inv.dueUsd).toFixed(2)}`,
        descKu: `${inv.customer.name} — بڕی ماوە: $${roundUsd(inv.dueUsd).toFixed(2)}`,
        module: 'debtors',
      });
    }

    for (const pur of unpaidPurchases) {
      notifications.push({
        id: `ap-due-${pur.id}`,
        type: 'OVERDUE_PAYABLE',
        severity: 'warning',
        titleEn: `Supplier Liability Due: ${pur.invoiceNumber}`,
        titleAr: `التزام مورد مستحق: ${pur.invoiceNumber}`,
        titleKu: `قەرزی دابینکەر: ${pur.invoiceNumber}`,
        descEn: `${pur.supplier.name} — Balance payable: $${roundUsd(pur.dueUsd).toFixed(2)}`,
        descAr: `${pur.supplier.name} — الرصيد المستحق: $${roundUsd(pur.dueUsd).toFixed(2)}`,
        descKu: `${pur.supplier.name} — بڕی قەرز: $${roundUsd(pur.dueUsd).toFixed(2)}`,
        module: 'creditors',
      });
    }

    return NextResponse.json({
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            role: user.role,
            preferredLanguage: user.preferredLanguage,
            preferredCurrency: user.preferredCurrency,
          }
        : null,
      permissions,
      settings,
      warehouses,
      categories,
      financialAccounts,
      products,
      customers,
      suppliers,
      notifications,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
