import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { handleApiError, requireApiPermission } from '@/lib/server-auth';
import { hashPassword, logAudit } from '@/lib/auth';
import { D } from '@/lib/decimal';

export async function GET() {
  try {
    await requireApiPermission('settings.view');

    const [settings, rateHistory, users, rolePermissions, auditLogs] =
      await Promise.all([
        prisma.companySettings.findFirst(),
        prisma.exchangeRateHistory.findMany({
          orderBy: { effectiveDate: 'desc' },
          take: 25,
        }),
        prisma.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            phone: true,
            isActive: true,
            preferredLanguage: true,
            preferredCurrency: true,
            lastLoginAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.rolePermission.findMany(),
        prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);

    return NextResponse.json({
      settings,
      rateHistory,
      users,
      rolePermissions: rolePermissions.map((rp) => ({
        ...rp,
        permissions: JSON.parse(rp.permissionsJson),
      })),
      auditLogs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'updateSettings') {
      const user = await requireApiPermission('settings.manage');
      const existing = await prisma.companySettings.findFirst();
      if (!existing) {
        return NextResponse.json({ error: 'Settings record not found' }, { status: 404 });
      }

      const newRate = Number(body.usdToIqdRate ?? existing.usdToIqdRate);
      const oldRate = D(existing.usdToIqdRate).toNumber();

      const updated = await prisma.companySettings.update({
        where: { id: existing.id },
        data: {
          companyNameEn: body.companyNameEn ?? existing.companyNameEn,
          companyNameAr: body.companyNameAr ?? existing.companyNameAr,
          companyNameKu: body.companyNameKu ?? existing.companyNameKu,
          phone: body.phone ?? existing.phone,
          email: body.email ?? existing.email,
          addressEn: body.addressEn ?? existing.addressEn,
          addressAr: body.addressAr ?? existing.addressAr,
          addressKu: body.addressKu ?? existing.addressKu,
          taxNumber: body.taxNumber ?? existing.taxNumber,
          usdToIqdRate: newRate,
          defaultTaxRate: Number(body.defaultTaxRate ?? existing.defaultTaxRate),
          salesInvoicePrefix: body.salesInvoicePrefix ?? existing.salesInvoicePrefix,
          purchaseInvoicePrefix:
            body.purchaseInvoicePrefix ?? existing.purchaseInvoicePrefix,
          expensePrefix: body.expensePrefix ?? existing.expensePrefix,
          invoiceFooterEn: body.invoiceFooterEn ?? existing.invoiceFooterEn,
          invoiceFooterAr: body.invoiceFooterAr ?? existing.invoiceFooterAr,
          invoiceFooterKu: body.invoiceFooterKu ?? existing.invoiceFooterKu,
          allowNegativeStock:
            body.allowNegativeStock !== undefined
              ? Boolean(body.allowNegativeStock)
              : existing.allowNegativeStock,
          expenseApprovalThresholdUsd: Number(
            body.expenseApprovalThresholdUsd ??
              existing.expenseApprovalThresholdUsd
          ),
          defaultLanguage: body.defaultLanguage ?? existing.defaultLanguage,
          defaultDisplayCurrency:
            body.defaultDisplayCurrency ?? existing.defaultDisplayCurrency,
        },
      });

      if (newRate !== oldRate) {
        await prisma.exchangeRateHistory.create({
          data: {
            fromCurrency: 'USD',
            toCurrency: 'IQD',
            rate: newRate,
            notes: `Updated exchange rate from ${oldRate} to ${newRate} IQD/USD`,
            createdById: user.id,
          },
        });
      }

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'SETTINGS_UPDATED',
        module: 'SETTINGS',
        entityType: 'CompanySettings',
        entityId: updated.id,
        description: `Updated company settings (Exchange rate: 1 USD = ${newRate} IQD)`,
      });

      return NextResponse.json({ settings: updated });
    }

    if (action === 'createUser') {
      const admin = await requireApiPermission('users.manage');
      const { name, email, username, password, role, phone } = body;

      const created = await prisma.user.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          username: username.trim(),
          passwordHash: hashPassword(password || 'Employee@123'),
          role: role || 'SALES_EMPLOYEE',
          phone: phone || null,
          isActive: true,
        },
      });

      await logAudit({
        userId: admin.id,
        userName: admin.name,
        userRole: admin.role,
        action: 'EMPLOYEE_USER_CREATED',
        module: 'USERS',
        entityType: 'User',
        entityId: created.id,
        description: `Created employee account '${created.name}' (@${created.username}) with role ${created.role}`,
      });

      return NextResponse.json({
        user: {
          id: created.id,
          name: created.name,
          email: created.email,
          username: created.username,
          role: created.role,
          isActive: created.isActive,
        },
      });
    }

    if (action === 'toggleUserActive') {
      const admin = await requireApiPermission('users.manage');
      const { userId, isActive } = body;

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { isActive: Boolean(isActive) },
      });

      if (!isActive) {
        await prisma.session.deleteMany({ where: { userId } });
      }

      await logAudit({
        userId: admin.id,
        userName: admin.name,
        userRole: admin.role,
        action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        module: 'USERS',
        entityType: 'User',
        entityId: updated.id,
        description: `${isActive ? 'Activated' : 'Deactivated'} user account @${updated.username}`,
      });

      return NextResponse.json({ user: updated });
    }

    if (action === 'updateUserRole') {
      const admin = await requireApiPermission('users.manage');
      const { userId, role } = body;

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { role },
      });

      await logAudit({
        userId: admin.id,
        userName: admin.name,
        userRole: admin.role,
        action: 'USER_ROLE_CHANGED',
        module: 'USERS',
        entityType: 'User',
        entityId: updated.id,
        description: `Updated @${updated.username} role to ${role}`,
      });

      return NextResponse.json({ user: updated });
    }

    if (action === 'updateRolePermissions') {
      const admin = await requireApiPermission('users.manage');
      const { role, permissions } = body;

      const updated = await prisma.rolePermission.update({
        where: { role },
        data: {
          permissionsJson: JSON.stringify(permissions),
        },
      });

      await logAudit({
        userId: admin.id,
        userName: admin.name,
        userRole: admin.role,
        action: 'ROLE_PERMISSIONS_UPDATED',
        module: 'USERS',
        entityType: 'RolePermission',
        entityId: updated.id,
        description: `Updated permission policy for role ${role} (${permissions.length} permissions granted)`,
      });

      return NextResponse.json({ rolePermission: updated });
    }

    if (action === 'createBackup') {
      const admin = await requireApiPermission('settings.manage');

      const [
        settings,
        accounts,
        journals,
        products,
        warehouses,
        warehouseStocks,
        customers,
        suppliers,
        salesInvoices,
        purchaseInvoices,
        expenses,
        debtPayments,
        financialAccounts,
        cashTransactions,
      ] = await Promise.all([
        prisma.companySettings.findMany(),
        prisma.account.findMany(),
        prisma.journalEntry.findMany({ include: { lines: true } }),
        prisma.product.findMany(),
        prisma.warehouse.findMany(),
        prisma.warehouseStock.findMany(),
        prisma.customer.findMany(),
        prisma.supplier.findMany(),
        prisma.salesInvoice.findMany({ include: { items: true } }),
        prisma.purchaseInvoice.findMany({ include: { items: true } }),
        prisma.expense.findMany(),
        prisma.debtPayment.findMany(),
        prisma.financialAccount.findMany(),
        prisma.cashTransaction.findMany(),
      ]);

      const settingsFirst = settings[0];
      if (settingsFirst) {
        await prisma.companySettings.update({
          where: { id: settingsFirst.id },
          data: { lastBackupAt: new Date() },
        });
      }

      await logAudit({
        userId: admin.id,
        userName: admin.name,
        userRole: admin.role,
        action: 'SYSTEM_BACKUP_EXPORTED',
        module: 'SETTINGS',
        entityType: 'Backup',
        description: 'Generated full encrypted-ready JSON database snapshot backup',
      });

      return NextResponse.json({
        backup: {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          exportedBy: admin.username,
          counts: {
            accounts: accounts.length,
            journals: journals.length,
            products: products.length,
            customers: customers.length,
            suppliers: suppliers.length,
            salesInvoices: salesInvoices.length,
            purchaseInvoices: purchaseInvoices.length,
            expenses: expenses.length,
          },
          data: {
            settings,
            accounts,
            journals,
            products,
            warehouses,
            warehouseStocks,
            customers,
            suppliers,
            salesInvoices,
            purchaseInvoices,
            expenses,
            debtPayments,
            financialAccounts,
            cashTransactions,
          },
        },
      });
    }

    return NextResponse.json({ error: 'Invalid settings action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
