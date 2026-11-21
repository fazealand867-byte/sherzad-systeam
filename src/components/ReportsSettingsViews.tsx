'use client';

import React, { useState, useMemo } from 'react';
import {
  FileBarChart2,
  Printer,
  Download,
  Settings,
  DatabaseBackup,
  TrendingUp,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtIqd, fmtQty, locName } from '@/lib/client-utils';
import { CustomDatePicker } from './CustomDatePicker';

/* ============================================================================
   1. REPORTS & PROFIT HUB (IQD-ONLY)
   ============================================================================ */

export function ReportsModuleView({
  lang,
  salesInvoices,
  purchaseInvoices,
  expenses,
  inventoryData,
  partiesData,
  accountingData,
  cashBankData,
  employeesData,
  productionData,
}: {
  lang: LanguageCode;
  salesInvoices: any[];
  purchaseInvoices: any[];
  expenses: any[];
  inventoryData: any;
  partiesData: any;
  accountingData: any;
  cashBankData: any;
  employeesData?: any;
  productionData?: any;
}) {
  const t = translations[lang];
  const [selectedReport, setSelectedReport] = useState<string>('PNL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const REPORT_TYPES = [
    { id: 'PNL', nameKu: '١. قازانج و زیان (داهات و خەرجی)', nameAr: '1. الأرباح والخسائر', nameEn: '1. Profit & Loss' },
    { id: 'DAILY_SUMMARY', nameKu: '٢. پوختەی دارایی گشتی', nameAr: '2. الملخص المالي العام', nameEn: '2. Executive Financial Summary' },
    { id: 'SALES', nameKu: '٣. ڕاپۆرتی فرۆشتن', nameAr: '3. تقرير المبيعات', nameEn: '3. Sales Report' },
    { id: 'PURCHASES', nameKu: '٤. ڕاپۆرتی کڕین', nameAr: '4. تقرير المشتريات', nameEn: '4. Purchases Report' },
    { id: 'EXPENSES', nameKu: '٥. ڕاپۆرتی خەرجییەکان', nameAr: '5. تقرير المصروفات', nameEn: '5. Expenses Report' },
    { id: 'SALARIES', nameKu: '٦. ڕاپۆرتی مووچەی کارمەندان', nameAr: '6. تقرير رواتب الموظفين', nameEn: '6. Employee Salaries Report' },
    { id: 'PRODUCTION', nameKu: '٧. ڕاپۆرتی بەرهەمهێنان', nameAr: '7. تقرير الإنتاج الغذائي', nameEn: '7. Food Production Report' },
    { id: 'INVENTORY', nameKu: '٨. ڕاپۆرتی کۆگا و بەرهەمەکان', nameAr: '8. تقرير المخزون', nameEn: '8. Inventory Valuation' },
    { id: 'DEBTORS', nameKu: '٩. قەرزی لای کڕیاران', nameAr: '9. ديون العملاء', nameEn: '9. Customer Debts' },
    { id: 'CREDITORS', nameKu: '١٠. قەرزمان لای دابینکەران', nameAr: '10. مستحقات الموردين', nameEn: '10. Supplier Debts' },
    { id: 'CASH_FLOW', nameKu: '١١. جووڵەی قاسە و بانک', nameAr: '11. حركة الصندوق والبنك', nameEn: '11. Cash & Bank Flow' },
    { id: 'BALANCE_SHEET', nameKu: '١٢. بیلانسی گشتی', nameAr: '12. الميزانية العمومية', nameEn: '12. Balance Sheet' },
    { id: 'TRIAL_BALANCE', nameKu: '١٣. تەرازووی پێداچوونەوە', nameAr: '13. ميزان المراجعة', nameEn: '13. Trial Balance' },
  ];

  const inDateRange = (dateVal: string | Date) => {
    if (!dateVal) return true;
    const d = new Date(dateVal).getTime();
    if (startDate && d < new Date(startDate).getTime()) return false;
    if (endDate && d > new Date(endDate + 'T23:59:59').getTime()) return false;
    return true;
  };

  const filteredSales = useMemo(() => (salesInvoices || []).filter((s) => inDateRange(s.date)), [salesInvoices, startDate, endDate]);
  const filteredPurchases = useMemo(() => (purchaseInvoices || []).filter((p) => inDateRange(p.date)), [purchaseInvoices, startDate, endDate]);
  const filteredExpenses = useMemo(() => (expenses || []).filter((e) => inDateRange(e.date)), [expenses, startDate, endDate]);
  const filteredSalaries = useMemo(() => (employeesData?.salaryPayments || []).filter((sp: any) => inDateRange(sp.date)), [employeesData, startDate, endDate]);
  const filteredBatches = useMemo(() => (productionData?.batches || []).filter((b: any) => inDateRange(b.date)), [productionData, startDate, endDate]);
  const cashTxs = useMemo(() => (cashBankData?.transactions || []).filter((c: any) => inDateRange(c.date)), [cashBankData, startDate, endDate]);
  const pnl = accountingData?.profitAndLoss || {};

  const buildReportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    switch (selectedReport) {
      case 'PNL':
        return {
          headers: [t.description, t.amount],
          rows: [
            ['Gross Sales Revenue / کۆی فرۆشتن', fmtIqd(pnl.grossSalesRevenueIqd, lang)],
            ['Sales Returns & Discounts / گەڕاوە و داشکاندن', fmtIqd(-((pnl.salesReturnsIqd || 0) + (pnl.salesDiscountsIqd || 0)), lang)],
            ['Net Sales Revenue / سافی فرۆشتن', fmtIqd(pnl.netSalesRevenueIqd, lang)],
            ['Cost of Goods Sold (COGS) / تێچووی فرۆشراو', fmtIqd(-(pnl.totalCogsIqd || 0), lang)],
            [`Gross Profit (${pnl.grossMarginPercent || 0}%) / قازانجی گشتی`, fmtIqd(pnl.grossProfitIqd, lang)],
            ...(pnl.operatingExpenseBreakdown || []).map((ex: any) => [
              `  • ${locName(ex, lang)}`,
              fmtIqd(-(ex.amountIqd || 0), lang),
            ]),
            ['Total Operating Expenses / کۆی خەرجییەکان', fmtIqd(-(pnl.operatingExpensesIqd || 0), lang)],
            [`NET PROFIT (${pnl.netMarginPercent || 0}%) / قازانجی سافی`, fmtIqd(pnl.netProfitIqd, lang)],
          ],
        };
      case 'SALES':
        return {
          headers: ['#', t.date, t.sales.customer, t.status, t.total, t.paid, t.due],
          rows: filteredSales.map((s) => [
            s.invoiceNumber,
            new Date(s.date).toLocaleDateString(),
            s.customer?.name || '',
            (t.statuses as Record<string, string>)[s.status] || s.status,
            fmtIqd(s.totalIqd, lang),
            fmtIqd(s.paidIqd, lang),
            fmtIqd(s.dueIqd, lang),
          ]),
        };
      case 'PURCHASES':
        return {
          headers: ['#', t.date, t.purchases.supplier, t.status, t.total, t.paid, t.due],
          rows: filteredPurchases.map((p) => [
            p.invoiceNumber,
            new Date(p.date).toLocaleDateString(),
            p.supplier?.name || '',
            (t.statuses as Record<string, string>)[p.status] || p.status,
            fmtIqd(p.totalIqd, lang),
            fmtIqd(p.paidIqd, lang),
            fmtIqd(p.dueIqd, lang),
          ]),
        };
      case 'EXPENSES':
        return {
          headers: ['#', t.date, t.category, t.description, t.status, t.amount],
          rows: filteredExpenses.map((e) => [
            e.expenseNumber,
            new Date(e.date).toLocaleDateString(),
            e.categoryObj ? locName(e.categoryObj, lang) : ((t.expenses.categories as Record<string, string>)[e.category] || e.category),
            e.employeeName ? `${e.employeeName} (${e.employeePhone || ''})` : e.title,
            (t.statuses as Record<string, string>)[e.status] || e.status,
            fmtIqd(e.amountIqd, lang),
          ]),
        };
      case 'SALARIES':
        return {
          headers: ['#', t.date, t.employees.name, t.employees.phone, t.expenses.salaryMonth, t.status, t.amount, t.expenses.remainingBalance],
          rows: filteredSalaries.map((sp: any) => [
            sp.receiptNumber,
            new Date(sp.date).toLocaleDateString(),
            sp.employeeName,
            sp.employeePhone || '',
            sp.salaryMonth,
            sp.paymentType,
            fmtIqd(sp.amountIqd, lang),
            fmtIqd(sp.remainingAfterIqd, lang),
          ]),
        };
      case 'PRODUCTION':
        return {
          headers: ['#', t.date, t.production.finishedProduct, t.production.quantityProduced, t.status, t.products.costPrice],
          rows: filteredBatches.map((b: any) => [
            b.batchNumber,
            new Date(b.date).toLocaleDateString(),
            locName(b.finishedProduct, lang),
            `${fmtQty(b.quantityProduced)} ${b.unit}`,
            b.status,
            fmtIqd(b.totalBatchValueIqd, lang),
          ]),
        };
      case 'INVENTORY':
        return {
          headers: ['SKU', t.products.productName, t.sales.qty, t.unit, t.products.costPrice, t.products.sellingPrice, t.total],
          rows: (inventoryData?.valuation?.items || []).map((i: any) => [
            i.sku,
            locName(i, lang),
            fmtQty(i.quantity),
            i.unit,
            fmtIqd(i.purchaseCostIqd, lang),
            fmtIqd(i.sellingPriceIqd, lang),
            fmtIqd(i.costValueIqd, lang),
          ]),
        };
      case 'DEBTORS':
        return {
          headers: ['#', t.sales.customer, t.employees.phone, t.due],
          rows: (partiesData?.customers || [])
            .filter((c: any) => Number(c.balanceIqd || 0) > 0)
            .map((c: any) => [c.code, c.name, c.phone || '—', fmtIqd(c.balanceIqd, lang)]),
        };
      case 'CREDITORS':
        return {
          headers: ['#', t.purchases.supplier, t.employees.phone, t.due],
          rows: (partiesData?.suppliers || [])
            .filter((s: any) => Number(s.balanceIqd || 0) > 0)
            .map((s: any) => [s.code, s.name, s.phone || '—', fmtIqd(s.balanceIqd, lang)]),
        };
      case 'CASH_FLOW':
        return {
          headers: ['#', t.date, t.nav.cashbank, t.description, t.amount, 'Balance'],
          rows: cashTxs.map((c: any) => [
            c.transactionNumber,
            new Date(c.date).toLocaleDateString(),
            locName(c.financialAccount, lang),
            c.description,
            `${c.direction === 'IN' ? '+' : '-'}${fmtIqd(c.amountIqd, lang)}`,
            fmtIqd(c.balanceAfterIqd, lang),
          ]),
        };
      case 'BALANCE_SHEET': {
        const bs = accountingData?.balanceSheet || {};
        return {
          headers: ['Type', 'Account', t.amount],
          rows: [
            ...(bs.assets || []).map((a: any) => ['ASSET', `${a.code} — ${locName(a, lang)}`, fmtIqd(a.balanceIqd, lang)]),
            ['TOTAL ASSETS', '', fmtIqd(bs.totalAssetsIqd, lang)],
            ...(bs.liabilities || []).map((l: any) => ['LIABILITY', `${l.code} — ${locName(l, lang)}`, fmtIqd(l.balanceIqd, lang)]),
            ...(bs.equity || []).map((eq: any) => ['EQUITY', `${eq.code} — ${locName(eq, lang)}`, fmtIqd(eq.balanceIqd, lang)]),
            ['TOTAL L + E', bs.isBalanced ? '✓ Balanced' : '', fmtIqd(bs.totalLiabilitiesAndEquityIqd, lang)],
          ],
        };
      }
      case 'TRIAL_BALANCE': {
        const tb = accountingData?.trialBalance || {};
        return {
          headers: ['Code', 'Account', t.accounting.debit, t.accounting.credit],
          rows: [
            ...(tb.rows || []).map((r: any) => [
              r.code,
              locName(r, lang),
              r.debitBalanceIqd > 0 ? fmtIqd(r.debitBalanceIqd, lang) : '—',
              r.creditBalanceIqd > 0 ? fmtIqd(r.creditBalanceIqd, lang) : '—',
            ]),
            ['TOTAL', tb.isBalanced ? '✓ Balanced' : '✕', fmtIqd(tb.totalDebitBalanceIqd, lang), fmtIqd(tb.totalCreditBalanceIqd, lang)],
          ],
        };
      }
      default: {
        const bs = accountingData?.balanceSheet || {};
        const invVal = inventoryData?.valuation || {};
        return {
          headers: [t.description, t.amount],
          rows: [
            [t.dashboard.totalSales, fmtIqd(pnl.netSalesRevenueIqd, lang)],
            [t.dashboard.grossProfit, fmtIqd(pnl.grossProfitIqd, lang)],
            [t.dashboard.totalExpenses, fmtIqd(pnl.operatingExpensesIqd, lang)],
            [t.dashboard.netProfit, fmtIqd(pnl.netProfitIqd, lang)],
            [t.dashboard.inventoryValue, fmtIqd(invVal.totalCostValueIqd, lang)],
            ['Total Assets', fmtIqd(bs.totalAssetsIqd, lang)],
          ],
        };
      }
    }
  };

  const currentTable = buildReportRows();
  const activeReportMeta = REPORT_TYPES.find((r) => r.id === selectedReport);

  return (
    <div className="space-y-6">
      {/* Top P&L KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.totalSales}</div>
          <div className="text-xl font-black text-emerald-500 mt-1">{fmtIqd(pnl.netSalesRevenueIqd, lang)}</div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.grossProfit}</div>
          <div className="text-xl font-black text-teal-500 mt-1">{fmtIqd(pnl.grossProfitIqd, lang)}</div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.dashboard.totalExpenses}</div>
          <div className="text-xl font-black text-rose-500 mt-1">{fmtIqd(pnl.operatingExpensesIqd, lang)}</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-4 rounded-2xl shadow-lg">
          <div className="text-xs text-emerald-100 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> {t.dashboard.netProfit}
          </div>
          <div className="text-xl font-black mt-1">{fmtIqd(pnl.netProfitIqd, lang)}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
          <FileBarChart2 className="w-6 h-6 text-emerald-500" />
          {t.nav.reports}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <CustomDatePicker value={startDate} onChange={setStartDate} lang={lang} className="w-40" />
          <CustomDatePicker value={endDate} onChange={setEndDate} lang={lang} className="w-40" />
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
            <Printer className="w-3.5 h-3.5" /> {t.print}
          </button>
          <button
            onClick={() => exportToCsv(`report-${selectedReport.toLowerCase()}`, currentTable.headers, currentTable.rows)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-bold"
          >
            <Download className="w-3.5 h-3.5" /> {t.exportCsv}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-1.5">
          {REPORT_TYPES.map((rep) => (
            <button
              key={rep.id}
              onClick={() => setSelectedReport(rep.id)}
              className={`w-full text-start px-3.5 py-2.5 rounded-xl text-xs font-bold transition ${selectedReport === rep.id
                ? 'bg-emerald-600 text-white shadow'
                : 'hover:bg-slate-100 dark:hover:bg-charcoal-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {locName(rep, lang)}
            </button>
          ))}
        </div>

        <div id="printable-document-area" className="lg:col-span-8 bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <div>
              <h3 className="text-base font-black">{locName(activeReportMeta, lang)}</h3>
              <div className="text-xs text-slate-400">{t.currencyLabel} • {new Date().toLocaleDateString()}</div>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-500 text-xs font-bold">
              {currentTable.rows.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  {currentTable.headers.map((h, i) => (
                    <th key={i} className="py-3 px-4 text-start">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {currentTable.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 font-semibold">{cell}</td>
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
   2. SIMPLIFIED SETTINGS & DATABASE BACKUP (IQD-ONLY)
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

  const [companyNameKu, setCompanyNameKu] = useState(s.companyNameKu || '');
  const [companyNameAr, setCompanyNameAr] = useState(s.companyNameAr || '');
  const [companyNameEn, setCompanyNameEn] = useState(s.companyNameEn || '');
  const [phone, setPhone] = useState(s.phone || '');
  const [addressKu, setAddressKu] = useState(s.addressKu || '');
  const [expenseThresholdIqd, setExpenseThresholdIqd] = useState(String(s.expenseApprovalThresholdIqd ?? 1500000));
  const [allowNegativeStock, setAllowNegativeStock] = useState(Boolean(s.allowNegativeStock));
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (settingsData?.settings) {
      const st = settingsData.settings;
      setCompanyNameKu(st.companyNameKu || '');
      setCompanyNameAr(st.companyNameAr || '');
      setCompanyNameEn(st.companyNameEn || '');
      setPhone(st.phone || '');
      setAddressKu(st.addressKu || '');
      setExpenseThresholdIqd(String(st.expenseApprovalThresholdIqd ?? 1500000));
      setAllowNegativeStock(Boolean(st.allowNegativeStock));
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
          companyNameKu,
          companyNameAr,
          companyNameEn,
          phone,
          addressKu,
          expenseApprovalThresholdIqd: Number(expenseThresholdIqd || 0),
          allowNegativeStock,
        }),
      });
      if (res.ok) {
        notify('success', `${t.nav.settings} ✓`);
        await onRefresh();
      } else notify('error', (await res.json()).error || 'Failed');
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
        const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `food-factory-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        notify('success', 'Database backup downloaded ✓');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
          <Settings className="w-6 h-6 text-emerald-500" />
          {t.nav.settings}
        </h2>
        <button
          onClick={handleExportBackup}
          disabled={submitting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow"
        >
          <DatabaseBackup className="w-4 h-4" />
          {lang === 'ku' ? 'داگرتنی باکئەپی داتابەیس (JSON)' : lang === 'ar' ? 'تحميل نسخة احتياطية' : 'Download Backup (JSON)'}
        </button>
      </div>

      <form onSubmit={handleSaveSettings} className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1">ناوی کارگە / کۆمپانیا (کوردی)</label>
            <input type="text" value={companyNameKu} onChange={(e) => setCompanyNameKu(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">اسم المصنع (العربية)</label>
            <input type="text" value={companyNameAr} onChange={(e) => setCompanyNameAr(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">Factory Name (English)</label>
            <input type="text" value={companyNameEn} onChange={(e) => setCompanyNameEn(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1">{t.employees.phone}</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1">
              {lang === 'ku' ? 'سنووری پەسەندکردنی خەرجی (د.ع)' : 'Expense Approval Threshold (IQD)'}
            </label>
            <input type="number" min="0" value={expenseThresholdIqd} onChange={(e) => setExpenseThresholdIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold mb-1">{lang === 'ku' ? 'ناونیشان' : lang === 'ar' ? 'العنوان' : 'Address'}</label>
          <input type="text" value={addressKu} onChange={(e) => setAddressKu(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-600 dark:text-emerald-400">
          {t.currencyLabel} — {lang === 'ku' ? 'هەموو مامەڵە داراییەکان تەنها بە دیناری عێراقی (IQD) تۆمار دەکرێن.' : lang === 'ar' ? 'جميع المعاملات المالية مسجلة بالدينار العراقي فقط.' : 'All financial transactions are recorded strictly in Iraqi Dinar (IQD).'}
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
          <input type="checkbox" checked={allowNegativeStock} onChange={(e) => setAllowNegativeStock(e.target.checked)} className="rounded text-emerald-600" />
          <span>{lang === 'ku' ? 'ڕێگەدان بە فرۆشتن کاتێک بڕی کۆگا سفر بێت' : 'Allow sales when stock reaches zero'}</span>
        </label>

        <div className="flex justify-end">
          <button type="submit" disabled={submitting} className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25">
            {submitting ? t.saving : t.save}
          </button>
        </div>
      </form>
    </div>
  );
}
