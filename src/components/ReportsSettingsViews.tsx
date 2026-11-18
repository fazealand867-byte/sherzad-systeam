'use client';

import React, { useState } from 'react';
import {
  FileBarChart2,
  Printer,
  Download,
  Shield,
  Users,
  Settings,
  DatabaseBackup,
  History,
  Check,
  UserPlus,
  RefreshCw,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtMoney, locName } from '@/lib/client-utils';
import { ALL_PERMISSIONS } from '@/lib/auth';

/* ============================================================================
   1. COMPREHENSIVE 14-REPORTS HUB
   ============================================================================ */

export function ReportsModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  salesInvoices,
  purchaseInvoices,
  expenses,
  inventoryData,
  partiesData,
  accountingData,
  cashBankData,
}: {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  salesInvoices: any[];
  purchaseInvoices: any[];
  expenses: any[];
  inventoryData: any;
  partiesData: any;
  accountingData: any;
  cashBankData: any;
}) {
  const t = translations[lang];
  const [selectedReport, setSelectedReport] = useState<string>('DAILY_SUMMARY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const REPORT_TYPES = [
    { id: 'DAILY_SUMMARY', nameEn: '1. Daily Financial Summary (Z-Report)', nameAr: '1. الملخص المالي اليومي الشامل', nameKu: '١. پوختەی دارایی ڕۆژانە' },
    { id: 'SALES', nameEn: '2. Sales & Profitability Report', nameAr: '2. تقرير المبيعات والأرباح', nameKu: '٢. ڕاپۆرتی فرۆشتن و قازانج' },
    { id: 'PURCHASES', nameEn: '3. Purchases & Procurement Report', nameAr: '3. تقرير المشتريات والتوريد', nameKu: '٣. ڕاپۆرتی کڕین و دابینکردن' },
    { id: 'EXPENSES', nameEn: '4. Operating Expenses Report', nameAr: '4. تقرير المصروفات التشغيلية', nameKu: '٤. ڕاپۆرتی خەرجییەکان' },
    { id: 'INVENTORY', nameEn: '5. Inventory Valuation & Stock Status', nameAr: '5. تقرير تقييم المخزون والأرصدة', nameKu: '٥. ڕاپۆرتی هەڵسەنگاندنی کۆگا' },
    { id: 'CUSTOMERS', nameEn: '6. Customers Summary Report', nameAr: '6. تقرير العملاء الشامل', nameKu: '٦. ڕاپۆرتی کڕیاران' },
    { id: 'SUPPLIERS', nameEn: '7. Suppliers Summary Report', nameAr: '7. تقرير الموردين الشامل', nameKu: '٧. ڕاپۆرتی دابینکەران' },
    { id: 'DEBTORS', nameEn: '8. Debtors (Accounts Receivable Aging)', nameAr: '8. تقرير المدينين وأعمار الديون', nameKu: '٨. ڕاپۆرتی قەرزداران (قەرزی کڕیار)' },
    { id: 'CREDITORS', nameEn: '9. Creditors (Accounts Payable Liabilities)', nameAr: '9. تقرير الدائنين ومستحقات الموردين', nameKu: '٩. ڕاپۆرتی خاوەن قەرزەکان' },
    { id: 'CASH_FLOW', nameEn: '10. Cash Flow & Treasury Report', nameAr: '10. تقرير التدفقات النقدية والخزينة', nameKu: '١٠. ڕاپۆرتی لێشاوی نەقدی و قاسە' },
    { id: 'PNL', nameEn: '11. Profit and Loss (Income Statement)', nameAr: '11. قائمة الأرباح والخسائر (الدخل)', nameKu: '١١. لیستی قازانج و زیان' },
    { id: 'BALANCE_SHEET', nameEn: '12. Balance Sheet (Statement of Position)', nameAr: '12. الميزانية العمومية (المركز المالي)', nameKu: '١٢. بیلانسی گشتی' },
    { id: 'TRIAL_BALANCE', nameEn: '13. Trial Balance Report', nameAr: '13. ميزان المراجعة بالمجاميع والأرصدة', nameKu: '١٣. تەرازووی پێداچوونەوە' },
    { id: 'GENERAL_LEDGER', nameEn: '14. General Ledger Statement', nameAr: '14. تقرير دفتر الأستاذ العام', nameKu: '١٤. ڕاپۆرتی دەفتەری گشتی' },
  ];

  const inDateRange = (dateVal: string | Date) => {
    const d = new Date(dateVal).getTime();
    if (startDate && d < new Date(startDate).getTime()) return false;
    if (endDate && d > new Date(endDate + 'T23:59:59').getTime()) return false;
    return true;
  };

  const filteredSales = (salesInvoices || []).filter((s) => inDateRange(s.date));
  const filteredPurchases = (purchaseInvoices || []).filter((p) => inDateRange(p.date));
  const filteredExpenses = (expenses || []).filter((e) => inDateRange(e.date));
  const cashTxs = (cashBankData?.transactions || []).filter((c: any) =>
    inDateRange(c.date)
  );

  const buildReportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    switch (selectedReport) {
      case 'SALES':
        return {
          headers: ['Invoice #', 'Date', 'Customer', 'Status', 'Payment', 'Total', 'Paid', 'Due', 'Gross Profit'],
          rows: filteredSales.map((s) => [
            s.invoiceNumber,
            new Date(s.date).toLocaleDateString(),
            s.customer?.name || '',
            s.status,
            s.paymentType,
            fmtMoney(s.totalUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(s.paidUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(s.dueUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(s.grossProfitUsd, displayCurrency, exchangeRate, lang),
          ]),
        };
      case 'PURCHASES':
        return {
          headers: ['Invoice #', 'Supplier Ref', 'Date', 'Supplier', 'Status', 'Total', 'Paid', 'Due'],
          rows: filteredPurchases.map((p) => [
            p.invoiceNumber,
            p.supplierInvoiceRef || '—',
            new Date(p.date).toLocaleDateString(),
            p.supplier?.name || '',
            p.status,
            fmtMoney(p.totalUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(p.paidUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(p.dueUsd, displayCurrency, exchangeRate, lang),
          ]),
        };
      case 'EXPENSES':
        return {
          headers: ['Expense #', 'Date', 'Category', 'Title', 'Vendor', 'Status', 'Amount'],
          rows: filteredExpenses.map((e) => [
            e.expenseNumber,
            new Date(e.date).toLocaleDateString(),
            e.category,
            e.title,
            e.vendorName || '—',
            e.status,
            fmtMoney(e.amountUsd, displayCurrency, exchangeRate, lang),
          ]),
        };
      case 'INVENTORY':
        return {
          headers: ['SKU', 'Product', 'Category', 'Qty', 'Unit', 'Unit Cost', 'Selling Price', 'Total Cost Valuation'],
          rows: (inventoryData?.valuation?.items || []).map((i: any) => [
            i.sku,
            locName(i, lang),
            i.categoryNameEn,
            i.quantity,
            i.unit,
            fmtMoney(i.purchaseCostUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(i.sellingPriceUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(i.costValueUsd, displayCurrency, exchangeRate, lang),
          ]),
        };
      case 'CUSTOMERS':
      case 'DEBTORS':
        return {
          headers: ['Code', 'Customer Name', 'Company', 'Phone', 'City', 'Credit Limit', 'Receivable Debt Balance'],
          rows: (partiesData?.customers || [])
            .filter((c: any) => (selectedReport === 'DEBTORS' ? Number(c.balanceUsd) > 0 : true))
            .map((c: any) => [
              c.code,
              c.name,
              c.companyName || '—',
              c.phone,
              c.city || '—',
              fmtMoney(c.creditLimitUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(c.balanceUsd, displayCurrency, exchangeRate, lang),
            ]),
        };
      case 'SUPPLIERS':
      case 'CREDITORS':
        return {
          headers: ['Code', 'Supplier Name', 'Company', 'Phone', 'City', 'Payable Liability Balance'],
          rows: (partiesData?.suppliers || [])
            .filter((s: any) => (selectedReport === 'CREDITORS' ? Number(s.balanceUsd) > 0 : true))
            .map((s: any) => [
              s.code,
              s.name,
              s.companyName || '—',
              s.phone,
              s.city || '—',
              fmtMoney(s.balanceUsd, displayCurrency, exchangeRate, lang),
            ]),
        };
      case 'CASH_FLOW':
        return {
          headers: ['Tx #', 'Date', 'Account', 'Type', 'Direction', 'Amount', 'Balance After', 'Description'],
          rows: cashTxs.map((c: any) => [
            c.transactionNumber,
            new Date(c.date).toLocaleDateString(),
            locName(c.financialAccount, lang),
            c.type,
            c.direction,
            fmtMoney(c.amountUsd, displayCurrency, exchangeRate, lang),
            fmtMoney(c.balanceAfterUsd, displayCurrency, exchangeRate, lang),
            c.description,
          ]),
        };
      case 'PNL': {
        const pnl = accountingData?.profitAndLoss || {};
        return {
          headers: ['Income Statement Line', 'Amount'],
          rows: [
            ['4000 — Gross Sales Revenue', fmtMoney(pnl.grossSalesRevenueUsd, displayCurrency, exchangeRate, lang)],
            ['4050 — Less: Sales Returns', fmtMoney(-pnl.salesReturnsUsd, displayCurrency, exchangeRate, lang)],
            ['4100 — Less: Sales Discounts', fmtMoney(-pnl.salesDiscountsUsd, displayCurrency, exchangeRate, lang)],
            ['Net Sales Revenue', fmtMoney(pnl.netSalesRevenueUsd, displayCurrency, exchangeRate, lang)],
            ['5000 — Less: Cost of Goods Sold (COGS)', fmtMoney(-pnl.totalCogsUsd, displayCurrency, exchangeRate, lang)],
            [`Gross Profit (${pnl.grossMarginPercent || 0}%)`, fmtMoney(pnl.grossProfitUsd, displayCurrency, exchangeRate, lang)],
            ['51xx — Less: Operating Expenses', fmtMoney(-pnl.operatingExpensesUsd, displayCurrency, exchangeRate, lang)],
            [`NET PROFIT (${pnl.netMarginPercent || 0}%)`, fmtMoney(pnl.netProfitUsd, displayCurrency, exchangeRate, lang)],
          ],
        };
      }
      case 'BALANCE_SHEET': {
        const bs = accountingData?.balanceSheet || {};
        return {
          headers: ['Category', 'Account Code & Name', 'Balance'],
          rows: [
            ...(bs.assets || []).map((a: any) => [
              'ASSET',
              `${a.code} — ${locName(a, lang)}`,
              fmtMoney(a.balanceUsd, displayCurrency, exchangeRate, lang),
            ]),
            ['TOTAL ASSETS', 'All Assets', fmtMoney(bs.totalAssetsUsd, displayCurrency, exchangeRate, lang)],
            ...(bs.liabilities || []).map((l: any) => [
              'LIABILITY',
              `${l.code} — ${locName(l, lang)}`,
              fmtMoney(l.balanceUsd, displayCurrency, exchangeRate, lang),
            ]),
            ...(bs.equity || []).map((eq: any) => [
              'EQUITY',
              `${eq.code} — ${locName(eq, lang)}`,
              fmtMoney(eq.balanceUsd, displayCurrency, exchangeRate, lang),
            ]),
            [
              'TOTAL LIABILITIES & EQUITY',
              bs.isBalanced ? 'Verified Balanced' : 'Check',
              fmtMoney(bs.totalLiabilitiesAndEquityUsd, displayCurrency, exchangeRate, lang),
            ],
          ],
        };
      }
      case 'TRIAL_BALANCE': {
        const tb = accountingData?.trialBalance || {};
        return {
          headers: ['Code', 'Account', 'Type', 'Total Debit', 'Total Credit', 'Net Debit Bal', 'Net Credit Bal'],
          rows: [
            ...(tb.rows || []).map((r: any) => [
              r.code,
              locName(r, lang),
              r.type,
              fmtMoney(r.totalDebitUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(r.totalCreditUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(r.debitBalanceUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(r.creditBalanceUsd, displayCurrency, exchangeRate, lang),
            ]),
            [
              'TOTAL',
              tb.isBalanced ? 'BALANCED (Debits = Credits)' : 'UNBALANCED',
              '',
              fmtMoney(tb.totalDebitUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(tb.totalCreditUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(tb.totalDebitBalanceUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(tb.totalCreditBalanceUsd, displayCurrency, exchangeRate, lang),
            ],
          ],
        };
      }
      case 'GENERAL_LEDGER':
        return {
          headers: ['Date', 'Journal #', 'Account', 'Description', 'Debit', 'Credit', 'Running Balance'],
          rows: (accountingData?.generalLedger || [])
            .filter((l: any) => inDateRange(l.date))
            .map((l: any) => [
              new Date(l.date).toLocaleDateString(),
              l.entryNumber,
              `${l.accountCode} — ${l.accountNameEn}`,
              l.description,
              fmtMoney(l.debitUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(l.creditUsd, displayCurrency, exchangeRate, lang),
              fmtMoney(l.runningBalanceUsd, displayCurrency, exchangeRate, lang),
            ]),
        };
      default: {
        // DAILY_SUMMARY
        const pnl = accountingData?.profitAndLoss || {};
        const bs = accountingData?.balanceSheet || {};
        const invVal = inventoryData?.valuation || {};
        return {
          headers: ['Executive Financial Metric', 'Value', 'Accounting Verification'],
          rows: [
            ['Net Sales Revenue', fmtMoney(pnl.netSalesRevenueUsd, displayCurrency, exchangeRate, lang), 'Accrual Revenue (Account 4000 - 4050 - 4100)'],
            ['Cost of Goods Sold (COGS)', fmtMoney(pnl.totalCogsUsd, displayCurrency, exchangeRate, lang), 'Account 5000 & 5200'],
            ['Gross Profit', fmtMoney(pnl.grossProfitUsd, displayCurrency, exchangeRate, lang), `Gross Margin: ${pnl.grossMarginPercent || 0}%`],
            ['Operating Expenses', fmtMoney(pnl.operatingExpensesUsd, displayCurrency, exchangeRate, lang), 'Accounts 5110..5190'],
            ['Accounting Net Profit', fmtMoney(pnl.netProfitUsd, displayCurrency, exchangeRate, lang), `Net Margin: ${pnl.netMarginPercent || 0}%`],
            ['Inventory Asset Value (Cost)', fmtMoney(invVal.totalCostValueUsd, displayCurrency, exchangeRate, lang), `${invVal.totalUnits || 0} Total Units in Stock`],
            ['Total Balance Sheet Assets', fmtMoney(bs.totalAssetsUsd, displayCurrency, exchangeRate, lang), bs.isBalanced ? 'Verified Assets = Liabilities + Equity' : ''],
          ],
        };
      }
    }
  };

  const currentTable = buildReportRows();
  const activeReportMeta = REPORT_TYPES.find((r) => r.id === selectedReport);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <FileBarChart2 className="w-6 h-6 text-emerald-500" />
            {t.nav.reports} (14 Enterprise Financial & Operational Reports)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select any report below, filter by date range, view in USD or IQD, print/save PDF, or export to Excel CSV
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
          />

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            <Printer className="w-3.5 h-3.5" />
            {t.print} / PDF
          </button>

          <button
            onClick={() =>
              exportToCsv(
                `report-${selectedReport.toLowerCase()}`,
                currentTable.headers,
                currentTable.rows
              )
            }
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 text-xs font-bold"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Report Selector Sidebar */}
        <div className="lg:col-span-4 bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-1.5">
          {REPORT_TYPES.map((rep) => (
            <button
              key={rep.id}
              onClick={() => setSelectedReport(rep.id)}
              className={`w-full text-start px-3.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                selectedReport === rep.id
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'hover:bg-slate-100 dark:hover:bg-charcoal-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {locName(rep, lang)}
            </button>
          ))}
        </div>

        {/* Active Report Table */}
        <div
          id="printable-document-area"
          className="lg:col-span-8 bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold">
                {locName(activeReportMeta, lang)}
              </h3>
              <div className="text-[11px] text-slate-400">
                Display Currency: {displayCurrency} (Rate: 1 USD = {exchangeRate}{' '}
                IQD) • Generated: {new Date().toLocaleString()}
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-500 text-xs font-bold">
              {currentTable.rows.length} Records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  {currentTable.headers.map((h, i) => (
                    <th key={i} className="py-3 px-4 text-start">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {currentTable.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40"
                  >
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 font-medium">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   2. EMPLOYEES, PERMISSIONS & AUDIT LOGS MODULE
   ============================================================================ */

export function EmployeesPermissionsView({
  lang,
  settingsData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  settingsData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const [tab, setTab] = useState<'USERS' | 'PERMISSIONS' | 'AUDIT'>('USERS');
  const [showNewUser, setShowNewUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const users = settingsData?.users || [];
  const rolePermissions = settingsData?.rolePermissions || [];
  const auditLogs = settingsData?.auditLogs || [];

  const [uName, setUName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('Employee@123');
  const [uRole, setURole] = useState('SALES_EMPLOYEE');
  const [uPhone, setUPhone] = useState('');

  const [selectedRoleForMatrix, setSelectedRoleForMatrix] =
    useState('SALES_EMPLOYEE');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createUser',
          name: uName,
          username: uUsername,
          email: uEmail,
          password: uPassword,
          role: uRole,
          phone: uPhone,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Employee account @${data.user.username} created!`);
        setShowNewUser(false);
        setUName('');
        setUUsername('');
        setUEmail('');
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to create user');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleUserActive = async (userId: string, isActive: boolean) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleUserActive', userId, isActive }),
    });
    if (res.ok) {
      notify('success', `User status updated.`);
      await onRefresh();
    } else {
      const d = await res.json();
      notify('error', d.error || 'Failed to update status');
    }
  };

  const activeRoleRecord = rolePermissions.find(
    (rp: any) => rp.role === selectedRoleForMatrix
  );
  const currentRolePerms: string[] = activeRoleRecord?.permissions || [];

  const handleToggleRolePermission = async (perm: string) => {
    const updated = currentRolePerms.includes(perm)
      ? currentRolePerms.filter((p) => p !== perm)
      : [...currentRolePerms, perm];

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateRolePermissions',
        role: selectedRoleForMatrix,
        permissions: updated,
      }),
    });
    if (res.ok) {
      notify('success', `Updated permissions for ${selectedRoleForMatrix}`);
      await onRefresh();
    } else {
      const d = await res.json();
      notify('error', d.error || 'Failed to update permission');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-emerald-500" />
            {t.nav.employees}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Role-Based Access Control (6 Enterprise Roles), employee accounts, and immutable security audit logs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('USERS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === 'USERS'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            Employees ({users.length})
          </button>
          <button
            onClick={() => setTab('PERMISSIONS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === 'PERMISSIONS'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            Role Permissions Matrix
          </button>
          <button
            onClick={() => setTab('AUDIT')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${
              tab === 'AUDIT'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-charcoal-800'
            }`}
          >
            Audit Trail ({auditLogs.length})
          </button>
        </div>
      </div>

      {tab === 'USERS' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-bold">Employee Directory & Access Roles</h3>
            <button
              onClick={() => setShowNewUser(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
            >
              <UserPlus className="w-4 h-4" />+ Add Employee
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Employee Name</th>
                  <th className="py-3 px-4 text-start">Username / Email</th>
                  <th className="py-3 px-4 text-center">Assigned Role</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-bold">{u.name}</td>
                    <td className="py-3 px-4 text-slate-500">
                      @{u.username} • {u.email}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-500 font-mono text-[10px] font-bold">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          u.isActive
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {u.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {u.role !== 'SUPER_ADMIN' && (
                        <button
                          onClick={() => handleToggleUserActive(u.id, !u.isActive)}
                          className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-charcoal-800 text-[11px] font-semibold"
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'PERMISSIONS' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold">
              Configurable Role Permissions Matrix
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[
                'ACCOUNTANT',
                'SALES_EMPLOYEE',
                'INVENTORY_MANAGER',
                'VIEWER',
              ].map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRoleForMatrix(r)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    selectedRoleForMatrix === r
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-charcoal-800'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-2">
            {ALL_PERMISSIONS.map((perm) => {
              const enabled = currentRolePerms.includes(perm);
              return (
                <button
                  key={perm}
                  type="button"
                  onClick={() => handleToggleRolePermission(perm)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs font-mono transition ${
                    enabled
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500 font-bold'
                      : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800 text-slate-400'
                  }`}
                >
                  <span>{perm}</span>
                  {enabled && <Check className="w-4 h-4" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'AUDIT' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-500" />
              Immutable Financial & Security Audit Trail
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Timestamp</th>
                  <th className="py-3 px-4 text-start">Employee</th>
                  <th className="py-3 px-4 text-center">Role</th>
                  <th className="py-3 px-4 text-center">Module</th>
                  <th className="py-3 px-4 text-start">Action</th>
                  <th className="py-3 px-4 text-start">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {auditLogs.map((log: any) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{log.userName}</td>
                    <td className="py-2.5 px-4 text-center font-mono text-[10px]">
                      {log.userRole}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                        {log.module}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">{log.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNewUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateUser}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">Create Employee User Account</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={uName}
                onChange={(e) => setUName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Username *</label>
                <input
                  type="text"
                  required
                  value={uUsername}
                  onChange={(e) => setUUsername(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={uPassword}
                  onChange={(e) => setUPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Role</label>
                <select
                  value={uRole}
                  onChange={(e) => setURole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="BUSINESS_OWNER">BUSINESS_OWNER</option>
                  <option value="ACCOUNTANT">ACCOUNTANT</option>
                  <option value="SALES_EMPLOYEE">SALES_EMPLOYEE</option>
                  <option value="INVENTORY_MANAGER">INVENTORY_MANAGER</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewUser(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   3. SETTINGS, CURRENCY EXCHANGE RATES & DATABASE BACKUP MODULE
   ============================================================================ */

export function SettingsModuleView({
  lang,
  settingsData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  settingsData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const s = settingsData?.settings || {};
  const rateHistory = settingsData?.rateHistory || [];

  const [companyNameEn, setCompanyNameEn] = useState(s.companyNameEn || '');
  const [companyNameAr, setCompanyNameAr] = useState(s.companyNameAr || '');
  const [companyNameKu, setCompanyNameKu] = useState(s.companyNameKu || '');
  const [phone, setPhone] = useState(s.phone || '');
  const [email, setEmail] = useState(s.email || '');
  const [taxNumber, setTaxNumber] = useState(s.taxNumber || '');
  const [usdToIqdRate, setUsdToIqdRate] = useState(String(s.usdToIqdRate || 1500));
  const [expenseThreshold, setExpenseThreshold] = useState(
    String(s.expenseApprovalThresholdUsd || 1000)
  );
  const [allowNegativeStock, setAllowNegativeStock] = useState(
    Boolean(s.allowNegativeStock)
  );
  const [salesPrefix, setSalesPrefix] = useState(s.salesInvoicePrefix || 'INV-');
  const [purchasePrefix, setPurchasePrefix] = useState(
    s.purchaseInvoicePrefix || 'PUR-'
  );
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (settingsData?.settings) {
      const st = settingsData.settings;
      setCompanyNameEn(st.companyNameEn || '');
      setCompanyNameAr(st.companyNameAr || '');
      setCompanyNameKu(st.companyNameKu || '');
      setPhone(st.phone || '');
      setEmail(st.email || '');
      setTaxNumber(st.taxNumber || '');
      setUsdToIqdRate(String(st.usdToIqdRate || 1500));
      setExpenseThreshold(String(st.expenseApprovalThresholdUsd || 1000));
      setAllowNegativeStock(Boolean(st.allowNegativeStock));
      setSalesPrefix(st.salesInvoicePrefix || 'INV-');
      setPurchasePrefix(st.purchaseInvoicePrefix || 'PUR-');
    }
  }, [settingsData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateSettings',
          companyNameEn,
          companyNameAr,
          companyNameKu,
          phone,
          email,
          taxNumber,
          usdToIqdRate: Number(usdToIqdRate),
          expenseApprovalThresholdUsd: Number(expenseThreshold),
          allowNegativeStock,
          salesInvoicePrefix: salesPrefix,
          purchaseInvoicePrefix: purchasePrefix,
        }),
      });
      if (res.ok) {
        notify('success', 'System & Currency Settings updated!');
        await onRefresh();
      } else {
        const d = await res.json();
        notify('error', d.error || 'Could not update settings');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportBackup = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createBackup' }),
      });
      const data = await res.json();
      if (res.ok && data.backup) {
        const blob = new Blob([JSON.stringify(data.backup, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sherzad-erp-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        notify('success', 'Full system database snapshot exported!');
        await onRefresh();
      } else {
        notify('error', data.error || 'Backup failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-emerald-500" />
            {t.nav.settings}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Company identity, USD/IQD central exchange rate, accounting controls, and database snapshot backup
          </p>
        </div>

        <button
          onClick={handleExportBackup}
          disabled={submitting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-lg shadow-teal-600/20"
        >
          <DatabaseBackup className="w-4 h-4" />
          Download Full Database JSON Backup
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveSettings}
          className="lg:col-span-8 bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-5"
        >
          <h3 className="text-sm font-bold border-b border-slate-200 dark:border-charcoal-800 pb-3">
            Enterprise Identity & Financial Configuration
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">
                Company Name (English)
              </label>
              <input
                type="text"
                value={companyNameEn}
                onChange={(e) => setCompanyNameEn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Company Name (العربية)
              </label>
              <input
                type="text"
                value={companyNameAr}
                onChange={(e) => setCompanyNameAr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Company Name (کوردی)
              </label>
              <input
                type="text"
                value={companyNameKu}
                onChange={(e) => setCompanyNameKu(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Tax Registration #
              </label>
              <input
                type="text"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold mb-1 text-emerald-500">
                Exchange Rate (1 USD = X IQD)
              </label>
              <input
                type="number"
                step="any"
                value={usdToIqdRate}
                onChange={(e) => setUsdToIqdRate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-xs font-black text-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Expense Approval Threshold ($ USD)
              </label>
              <input
                type="number"
                step="any"
                value={expenseThreshold}
                onChange={(e) => setExpenseThreshold(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Sales Invoice Prefix
              </label>
              <input
                type="text"
                value={salesPrefix}
                onChange={(e) => setSalesPrefix(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Purchase Invoice Prefix
              </label>
              <input
                type="text"
                value={purchasePrefix}
                onChange={(e) => setPurchasePrefix(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>
                Allow sales when warehouse stock is zero/negative by default
              </span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              {t.save}
            </button>
          </div>
        </form>

        {/* Exchange Rate Audit History */}
        <div className="lg:col-span-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-3">
          <h3 className="text-sm font-bold">USD / IQD Exchange Rate History</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {rateHistory.map((rh: any) => (
              <div
                key={rh.id}
                className="p-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                <div className="flex justify-between font-bold text-emerald-500">
                  <span>1 USD = {Number(rh.rate).toLocaleString()} IQD</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(rh.effectiveDate).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {rh.notes || 'Rate update'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
