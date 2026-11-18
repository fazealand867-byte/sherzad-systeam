'use client';

import React, { useState, useMemo } from 'react';
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Landmark,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  BookOpen,
  RotateCcw,
  Lock,
  Unlock,
  TrendingUp,
  Download,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtMoney, fmtOriginal, locName } from '@/lib/client-utils';

/* ============================================================================
   1. EXPENSES MODULE VIEW
   ============================================================================ */

export function ExpensesModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  expenses,
  financialAccounts,
  suppliers,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  expenses: any[];
  financialAccounts: any[];
  suppliers: any[];
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const [showNew, setShowNew] = useState(false);
  const [catFilter, setCatFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);

  const [category, setCategory] = useState('SALARIES');
  const [title, setTitle] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'IQD'>('USD');
  const [amountOrig, setAmountOrig] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [financialAccountId, setFinancialAccountId] = useState(
    financialAccounts[0]?.id || ''
  );
  const [supplierId, setSupplierId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState('MONTHLY');
  const [attachmentName, setAttachmentName] = useState('');

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const effectiveFinAccId = financialAccountId || financialAccounts[0]?.id || null;
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createExpense',
          category,
          title,
          vendorName,
          currency,
          exchangeRate,
          amountOriginal: Number(amountOrig),
          paymentMethod,
          financialAccountId: paymentMethod === 'CREDIT' ? null : effectiveFinAccId,
          supplierId: paymentMethod === 'CREDIT' ? supplierId || null : null,
          isRecurring,
          recurringInterval: isRecurring ? recurringInterval : null,
          attachmentName: attachmentName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to record expense');
      } else {
        if (data.expense.status === 'PENDING_APPROVAL') {
          notify(
            'warning',
            `Expense ${data.expense.expenseNumber} exceeds automatic threshold and is queued for Management Approval.`
          );
        } else {
          notify(
            'success',
            `Expense ${data.expense.expenseNumber} posted to General Ledger!`
          );
        }
        setShowNew(false);
        setTitle('');
        setAmountOrig('');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveReject = async (
    expenseId: string,
    act: 'approveExpense' | 'rejectExpense'
  ) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, expenseId }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(
          'success',
          act === 'approveExpense'
            ? `Expense ${data.expense.expenseNumber} approved & posted!`
            : `Expense ${data.expense.expenseNumber} rejected.`
        );
        await onRefresh();
      } else {
        notify('error', data.error || 'Action failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pendingExpenses = expenses.filter((e) => e.status === 'PENDING_APPROVAL');
  const filteredExpenses = expenses.filter((e) =>
    catFilter === 'ALL' ? true : e.category === catFilter
  );

  const totalPostedUsd = expenses
    .filter((e) => e.status === 'POSTED')
    .reduce((sum, e) => sum + Number(e.amountUsd), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <Receipt className="w-6 h-6 text-emerald-500" />
            {t.expenses.title}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Categorized operating expenses, recurring schedules, receipt references, and multi-tier approval workflow
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">
            <span className="text-slate-400 me-1.5">Total Posted Expenses:</span>
            <span className="font-black text-rose-500">
              {fmtMoney(totalPostedUsd, displayCurrency, exchangeRate, lang)}
            </span>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            {t.expenses.newExpense}
          </button>
          <button
            onClick={() =>
              exportToCsv(
                'operating-expenses',
                ['Expense #', 'Date', 'Category', 'Title', 'Vendor', 'Status', 'Amount USD'],
                filteredExpenses.map((e) => [
                  e.expenseNumber,
                  new Date(e.date).toISOString().slice(0, 10),
                  e.category,
                  e.title,
                  e.vendorName || '',
                  e.status,
                  Number(e.amountUsd).toFixed(2),
                ])
              )
            }
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>
      </div>

      {/* Pending Approvals Banner */}
      {pendingExpenses.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-500 font-bold text-xs">
            <AlertCircle className="w-4 h-4" />
            {t.dashboard.pendingApprovals} ({pendingExpenses.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingExpenses.map((pe) => (
              <div
                key={pe.id}
                className="bg-white dark:bg-charcoal-900 p-3.5 rounded-xl border border-amber-500/20 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {pe.title} ({pe.expenseNumber})
                  </div>
                  <div className="text-slate-400">
                    {pe.category} • {pe.vendorName || 'Direct'} •{' '}
                    <b className="text-amber-500">
                      {fmtMoney(pe.amountUsd, displayCurrency, exchangeRate, lang)}
                    </b>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleApproveReject(pe.id, 'approveExpense')}
                    disabled={submitting}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[11px]"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.expenses.approve}
                  </button>
                  <button
                    onClick={() => handleApproveReject(pe.id, 'rejectExpense')}
                    disabled={submitting}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-500 font-bold text-[11px]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {t.expenses.reject}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expenses Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap gap-1.5">
          {[
            'ALL',
            'SALARIES',
            'RENT',
            'ELECTRICITY',
            'TRANSPORTATION',
            'MAINTENANCE',
            'MARKETING',
            'MISCELLANEOUS',
          ].map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition ${
                catFilter === c
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {c === 'ALL'
                ? t.all
                : (t.expenses.categories as Record<string, string>)[c] || c}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4 text-start">Expense #</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">{t.category}</th>
                <th className="py-3 px-4 text-start">{t.expenses.expenseTitle}</th>
                <th className="py-3 px-4 text-start">GL Account</th>
                <th className="py-3 px-4 text-center">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.amount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                  <td className="py-3 px-4 font-mono font-bold text-emerald-500">
                    {exp.expenseNumber}
                    {exp.isRecurring && (
                      <span className="ms-1.5 px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400 text-[9px]">
                        {exp.recurringInterval}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    {new Date(exp.date).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 font-semibold">
                    {(t.expenses.categories as Record<string, string>)[exp.category] ||
                      exp.category}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {exp.title}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {exp.vendorName || ''} {exp.attachmentName ? `• 📎 ${exp.attachmentName}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    {exp.expenseAccount?.code} — {locName(exp.expenseAccount, lang)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        exp.status === 'POSTED'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : exp.status === 'PENDING_APPROVAL'
                          ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {(t.statuses as Record<string, string>)[exp.status] || exp.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-end font-bold text-rose-500">
                    {fmtMoney(exp.amountUsd, displayCurrency, exchangeRate, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Expense Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateExpense}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">{t.expenses.newExpense}</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">{t.category}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              >
                {Object.keys(t.expenses.categories).map((k) => (
                  <option key={k} value={k}>
                    {(t.expenses.categories as Record<string, string>)[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                {t.expenses.expenseTitle} *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Monthly Warehouse Electricity Bill"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">{t.currency}</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as 'USD' | 'IQD')}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="USD">USD ($)</option>
                  <option value="IQD">IQD (د.ع)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {t.amount} ({currency}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={amountOrig}
                  onChange={(e) => setAmountOrig(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="CASH">Cash / Safe</option>
                  <option value="BANK_TRANSFER">Bank Account</option>
                  <option value="CREDIT">On Credit (Accrued Liability)</option>
                </select>
              </div>

              {paymentMethod !== 'CREDIT' ? (
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Paid From Account
                  </label>
                  <select
                    value={financialAccountId}
                    onChange={(e) => setFinancialAccountId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  >
                    {financialAccounts.map((fa) => (
                      <option key={fa.id} value={fa.id}>
                        {locName(fa, lang)} ({fa.currency})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Creditor / Supplier
                  </label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  >
                    <option value="">General Accrued Liability</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {t.expenses.vendor}
                </label>
                <input
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Receipt Attachment Ref
                </label>
                <input
                  type="text"
                  value={attachmentName}
                  onChange={(e) => setAttachmentName(e.target.value)}
                  placeholder="Receipt-049.jpg"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>{t.expenses.recurring}</span>
              </label>
              {isRecurring && (
                <select
                  value={recurringInterval}
                  onChange={(e) => setRecurringInterval(e.target.value)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-charcoal-800 text-xs"
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. CASH AND BANK MANAGEMENT MODULE VIEW
   ============================================================================ */

export function CashBankModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  cashBankData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  cashBankData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const accounts = cashBankData?.accounts || [];
  const transactions = cashBankData?.transactions || [];
  const [modal, setModal] = useState<
    null | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'RECONCILE' | 'NEW_ACCOUNT'
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const [primaryAccId, setPrimaryAccId] = useState(accounts[0]?.id || '');
  const [targetAccId, setTargetAccId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [amountOrig, setAmountOrig] = useState('');
  const [description, setDescription] = useState('');
  const [postAdj, setPostAdj] = useState(true);

  const [newAccNameEn, setNewAccNameEn] = useState('');
  const [newAccNameAr, setNewAccNameAr] = useState('');
  const [newAccType, setNewAccType] = useState('CASH_REGISTER');
  const [newAccCurrency, setNewAccCurrency] = useState('USD');
  const [newAccBankName, setNewAccBankName] = useState('');

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let payload: any = {};
      if (modal === 'DEPOSIT' || modal === 'WITHDRAWAL') {
        const selectedAcc = accounts.find((a: any) => a.id === primaryAccId);
        payload = {
          action: modal === 'DEPOSIT' ? 'deposit' : 'withdrawal',
          financialAccountId: primaryAccId,
          currency: selectedAcc?.currency || 'USD',
          exchangeRate,
          amountOriginal: Number(amountOrig),
          description:
            description ||
            (modal === 'DEPOSIT' ? 'Capital / Cash Deposit' : 'Cash Withdrawal'),
        };
      } else if (modal === 'TRANSFER') {
        payload = {
          action: 'transfer',
          fromFinancialAccountId: primaryAccId,
          toFinancialAccountId: targetAccId,
          amountOriginal: Number(amountOrig),
          exchangeRate,
          description: description || 'Internal funds transfer',
        };
      } else if (modal === 'RECONCILE') {
        payload = {
          action: 'reconcile',
          financialAccountId: primaryAccId,
          statementBalanceOriginal: Number(amountOrig),
          postAdjustment: postAdj,
          notes: description || 'Periodic bank/safe reconciliation',
        };
      } else if (modal === 'NEW_ACCOUNT') {
        payload = {
          action: 'createAccount',
          nameEn: newAccNameEn,
          nameAr: newAccNameAr || newAccNameEn,
          nameKu: newAccNameAr || newAccNameEn,
          type: newAccType,
          currency: newAccCurrency,
          bankName: newAccBankName,
        };
      }

      const res = await fetch('/api/cashbank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Operation failed');
      } else {
        notify('success', 'Cash/Bank transaction & General Ledger updated!');
        setModal(null);
        setAmountOrig('');
        setDescription('');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <Landmark className="w-6 h-6 text-emerald-500" />
            {t.nav.cashbank}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-currency cash registers, corporate bank accounts, internal transfers, and statement reconciliation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setPrimaryAccId(accounts[0]?.id || '');
              setModal('DEPOSIT');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => {
              setPrimaryAccId(accounts[0]?.id || '');
              setModal('WITHDRAWAL');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
          >
            <ArrowUpRight className="w-4 h-4" />
            Withdrawal
          </button>
          <button
            onClick={() => {
              setPrimaryAccId(accounts[0]?.id || '');
              setTargetAccId(accounts[1]?.id || accounts[0]?.id || '');
              setModal('TRANSFER');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
          >
            <ArrowLeftRight className="w-4 h-4" />
            Internal Transfer
          </button>
          <button
            onClick={() => {
              setPrimaryAccId(accounts[0]?.id || '');
              setModal('RECONCILE');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30 text-xs font-bold"
          >
            <Scale className="w-3.5 h-3.5" />
            Reconcile
          </button>
          <button
            onClick={() => setModal('NEW_ACCOUNT')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            + Account
          </button>
        </div>
      </div>

      {/* Cash Registers & Bank Account Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {accounts.map((acc: any) => (
          <div
            key={acc.id}
            className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm flex flex-col justify-between space-y-3"
          >
            <div>
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>
                  {acc.code} • GL #{acc.ledgerAccount?.code}
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-bold ${
                    acc.type === 'BANK_ACCOUNT'
                      ? 'bg-teal-500/15 text-teal-400'
                      : 'bg-emerald-500/15 text-emerald-500'
                  }`}
                >
                  {acc.type === 'BANK_ACCOUNT' ? 'BANK' : 'SAFE / REGISTER'}
                </span>
              </div>
              <div className="font-bold text-sm text-slate-900 dark:text-white mt-1.5">
                {locName(acc, lang)}
              </div>
              {acc.accountNumber && (
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                  Acc: {acc.accountNumber}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-charcoal-800">
              <div className="text-xl font-black text-emerald-500">
                {fmtOriginal(acc.balanceOriginal, acc.currency, lang)}
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between mt-1">
                <span>USD Equiv: ${Number(acc.balanceUsd).toLocaleString()}</span>
                {acc.lastReconciledAt && (
                  <span className="text-emerald-500">✓ Reconciled</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Cash & Bank Movement Ledger */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
          <h3 className="text-sm font-bold">Cash & Bank Movement Ledger</h3>
          <button
            onClick={() =>
              exportToCsv(
                'cash-bank-movements',
                ['Tx #', 'Date', 'Account', 'Type', 'Direction', 'Amount USD', 'Description'],
                transactions.map((tx: any) => [
                  tx.transactionNumber,
                  new Date(tx.date).toISOString().slice(0, 10),
                  tx.financialAccount?.nameEn,
                  tx.type,
                  tx.direction,
                  Number(tx.amountUsd).toFixed(2),
                  tx.description,
                ])
              )
            }
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportCsv}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
              <tr>
                <th className="py-3 px-4 text-start">Tx #</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">Financial Account</th>
                <th className="py-3 px-4 text-center">Type</th>
                <th className="py-3 px-4 text-start">{t.description}</th>
                <th className="py-3 px-4 text-end">{t.amount}</th>
                <th className="py-3 px-4 text-end">Balance After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {transactions.map((tx: any) => (
                <tr key={tx.id}>
                  <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">
                    {tx.transactionNumber}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500">
                    {new Date(tx.date).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 font-semibold">
                    {locName(tx.financialAccount, lang)}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                      {tx.type}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-500">{tx.description}</td>
                  <td
                    className={`py-2.5 px-4 text-end font-bold ${
                      tx.direction === 'IN' ? 'text-emerald-500' : 'text-rose-500'
                    }`}
                  >
                    {tx.direction === 'IN' ? '+' : '-'}
                    {fmtOriginal(tx.amountOriginal, tx.currency, lang)}
                  </td>
                  <td className="py-2.5 px-4 text-end font-semibold">
                    {fmtMoney(
                      tx.balanceAfterUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for Deposit, Withdrawal, Transfer, Reconcile, or New Account */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleActionSubmit}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">
              {modal === 'DEPOSIT'
                ? 'Record Cash / Bank Deposit'
                : modal === 'WITHDRAWAL'
                ? 'Record Cash / Bank Withdrawal'
                : modal === 'TRANSFER'
                ? 'Internal Funds Transfer (Multi-Currency Ready)'
                : modal === 'RECONCILE'
                ? 'Bank / Cash Statement Reconciliation'
                : 'New Cash Register / Bank Account'}
            </h3>

            {modal !== 'NEW_ACCOUNT' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {modal === 'TRANSFER' ? 'Source Account' : 'Financial Account'}
                  </label>
                  <select
                    value={primaryAccId}
                    onChange={(e) => setPrimaryAccId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  >
                    {accounts.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {locName(a, lang)} ({a.currency} —{' '}
                        {fmtOriginal(a.balanceOriginal, a.currency, lang)})
                      </option>
                    ))}
                  </select>
                </div>

                {modal === 'TRANSFER' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Destination Account
                    </label>
                    <select
                      value={targetAccId}
                      onChange={(e) => setTargetAccId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                    >
                      {accounts.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {locName(a, lang)} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {modal === 'RECONCILE'
                      ? 'Actual Physical / Bank Statement Balance'
                      : 'Amount (in Account Currency)'}{' '}
                    *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={amountOrig}
                    onChange={(e) => setAmountOrig(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold"
                  />
                </div>

                {modal === 'RECONCILE' && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={postAdj}
                      onChange={(e) => setPostAdj(e.target.checked)}
                      className="rounded text-emerald-600"
                    />
                    <span>
                      Auto-post Double-Entry Adjustment Journal if statement differs from book balance
                    </span>
                  </label>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    {t.description}
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Reason / Reference notes"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Account Name (EN) *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAccNameEn}
                    onChange={(e) => setNewAccNameEn(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Account Name (AR/KU)
                  </label>
                  <input
                    type="text"
                    value={newAccNameAr}
                    onChange={(e) => setNewAccNameAr(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Type</label>
                    <select
                      value={newAccType}
                      onChange={(e) => setNewAccType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                    >
                      <option value="CASH_REGISTER">Cash Register / Safe</option>
                      <option value="BANK_ACCOUNT">Bank Account</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Account Currency
                    </label>
                    <select
                      value={newAccCurrency}
                      onChange={(e) => setNewAccCurrency(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="IQD">IQD (د.ع)</option>
                    </select>
                  </div>
                </div>
                {newAccType === 'BANK_ACCOUNT' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Bank Name
                    </label>
                    <input
                      type="text"
                      value={newAccBankName}
                      onChange={(e) => setNewAccBankName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                    />
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.confirm}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   3. PROFIT AND LOSS (P&L) STATEMENT MODULE VIEW
   ============================================================================ */

export function ProfitAndLossModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  pnl,
}: {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  pnl: any;
}) {
  const t = translations[lang];
  if (!pnl) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <TrendingUp className="w-6 h-6 text-emerald-500" />
            {t.nav.pnl} — Accrual Income Statement
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Computed from posted Double-Entry General Ledger Revenue (4xxx), COGS (5000), and Operating Expense (51xx) accounts
          </p>
        </div>

        <button
          onClick={() =>
            exportToCsv(
              'profit-and-loss-statement',
              ['Line Item', 'Amount (USD)'],
              [
                ['Gross Sales Revenue', pnl.grossSalesRevenueUsd],
                ['Sales Returns & Allowances', -pnl.salesReturnsUsd],
                ['Sales Discounts', -pnl.salesDiscountsUsd],
                ['Net Sales Revenue', pnl.netSalesRevenueUsd],
                ['Cost of Goods Sold (COGS)', -pnl.totalCogsUsd],
                ['Gross Profit', pnl.grossProfitUsd],
                ['Total Operating Expenses', -pnl.operatingExpensesUsd],
                ['Net Profit', pnl.netProfitUsd],
              ]
            )
          }
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
        >
          <Download className="w-3.5 h-3.5" />
          {t.exportCsv}
        </button>
      </div>

      {/* Executive P&L KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">Net Revenue</div>
          <div className="text-2xl font-black text-emerald-500 mt-1">
            {fmtMoney(pnl.totalRevenueUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Gross Sales: {fmtMoney(pnl.grossSalesRevenueUsd, displayCurrency, exchangeRate, lang)}
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">Cost of Goods Sold (COGS)</div>
          <div className="text-2xl font-black text-amber-500 mt-1">
            {fmtMoney(pnl.totalCogsUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Matched to product costs at time of sale
          </div>
        </div>

        <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">Gross Profit</div>
          <div className="text-2xl font-black text-teal-500 mt-1">
            {fmtMoney(pnl.grossProfitUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-emerald-500 font-semibold mt-1">
            Gross Margin: {pnl.grossMarginPercent}%
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-5 rounded-2xl shadow-lg">
          <div className="text-xs text-emerald-100">Accounting Net Profit</div>
          <div className="text-2xl font-black mt-1">
            {fmtMoney(pnl.netProfitUsd, displayCurrency, exchangeRate, lang)}
          </div>
          <div className="text-[11px] text-emerald-100 font-semibold mt-1">
            Net Profit Margin: {pnl.netMarginPercent}%
          </div>
        </div>
      </div>

      {/* Formal Income Statement & Profit by Product */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-4 text-xs">
          <h3 className="text-sm font-bold border-b border-slate-200 dark:border-charcoal-800 pb-3">
            Formal Accrual Income Statement
          </h3>

          <div className="space-y-2">
            <div className="flex justify-between font-semibold">
              <span>4000 — Gross Sales Revenue</span>
              <span>
                {fmtMoney(pnl.grossSalesRevenueUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
            <div className="flex justify-between text-rose-500 ps-3">
              <span>Less: 4050 — Sales Returns & Allowances</span>
              <span>
                -{fmtMoney(pnl.salesReturnsUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
            <div className="flex justify-between text-rose-500 ps-3">
              <span>Less: 4100 — Sales Discounts</span>
              <span>
                -{fmtMoney(pnl.salesDiscountsUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-sm border-t border-slate-200 dark:border-charcoal-800 pt-2">
              <span>Net Revenue</span>
              <span className="text-emerald-500">
                {fmtMoney(pnl.totalRevenueUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-amber-500 font-semibold">
              <span>Less: 5000 — Cost of Goods Sold (COGS)</span>
              <span>
                -{fmtMoney(pnl.costOfGoodsSoldUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
            {pnl.inventoryAdjustmentsUsd !== 0 && (
              <div className="flex justify-between text-amber-500 ps-3">
                <span>5200 — Inventory Shrinkage / Adjustments</span>
                <span>
                  -{fmtMoney(pnl.inventoryAdjustmentsUsd, displayCurrency, exchangeRate, lang)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm border-t border-slate-200 dark:border-charcoal-800 pt-2">
              <span>Gross Profit ({pnl.grossMarginPercent}%)</span>
              <span className="text-teal-500">
                {fmtMoney(pnl.grossProfitUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="font-bold text-slate-400 uppercase text-[10px]">
              Operating Expenses
            </div>
            {(pnl.operatingExpenseBreakdown || []).map((exp: any) => (
              <div key={exp.code} className="flex justify-between ps-3 text-slate-500">
                <span>
                  {exp.code} — {locName(exp, lang)}
                </span>
                <span className="font-semibold text-rose-500">
                  -{fmtMoney(exp.amountUsd, displayCurrency, exchangeRate, lang)}
                </span>
              </div>
            ))}
            <div className="flex justify-between font-semibold border-t border-slate-200 dark:border-charcoal-800 pt-2">
              <span>Total Operating Expenses</span>
              <span className="text-rose-500">
                -{fmtMoney(pnl.operatingExpensesUsd, displayCurrency, exchangeRate, lang)}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center text-base font-black border-t-2 border-emerald-500 pt-3">
            <span>NET PROFIT / (LOSS)</span>
            <span className={pnl.netProfitUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
              {fmtMoney(pnl.netProfitUsd, displayCurrency, exchangeRate, lang)}
            </span>
          </div>
        </div>

        {/* Profit by Product & Category */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800">
            <h3 className="text-sm font-bold mb-4">Profitability by Product</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                  <tr>
                    <th className="py-2 px-3 text-start">Product</th>
                    <th className="py-2 px-3 text-center">Qty Sold</th>
                    <th className="py-2 px-3 text-end">Revenue</th>
                    <th className="py-2 px-3 text-end">COGS</th>
                    <th className="py-2 px-3 text-end">Gross Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {(pnl.profitByProduct || []).map((p: any) => (
                    <tr key={p.productId}>
                      <td className="py-2 px-3 font-semibold">
                        {locName(p, lang)}{' '}
                        <span className="text-[10px] font-mono text-slate-400">
                          ({p.sku})
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center font-bold">
                        {p.quantitySold}
                      </td>
                      <td className="py-2 px-3 text-end">
                        {fmtMoney(p.revenueUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                      <td className="py-2 px-3 text-end text-slate-400">
                        {fmtMoney(p.costUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                      <td className="py-2 px-3 text-end font-bold text-emerald-500">
                        {fmtMoney(p.profitUsd, displayCurrency, exchangeRate, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800">
            <h3 className="text-sm font-bold mb-3">Gross Profit by Product Category</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnl.profitByCategory || []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="nameEn" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="revenueUsd"
                    name="Revenue ($)"
                    fill="#14b8a6"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="profitUsd"
                    name="Gross Profit ($)"
                    fill="#10b981"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   4. DOUBLE-ENTRY ACCOUNTING ENGINE MODULE VIEW
   ============================================================================ */

export function AccountingEngineModuleView({
  lang,
  displayCurrency,
  exchangeRate,
  accountingData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  displayCurrency: 'USD' | 'IQD';
  exchangeRate: number;
  accountingData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const [tab, setTab] = useState<
    | 'JOURNALS'
    | 'MANUAL_ENTRY'
    | 'COA'
    | 'LEDGER'
    | 'TRIAL_BALANCE'
    | 'BALANCE_SHEET'
    | 'PERIODS'
  >('JOURNALS');
  const [submitting, setSubmitting] = useState(false);

  const accounts = accountingData?.accounts || [];
  const journals = accountingData?.journals || [];
  const trialBalance = accountingData?.trialBalance;
  const balanceSheet = accountingData?.balanceSheet;
  const generalLedger = accountingData?.generalLedger || [];
  const periods = accountingData?.periods || [];

  // Manual Journal State
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnLines, setJrnLines] = useState([
    { accountId: accounts[0]?.id || '', debitUsd: '100', creditUsd: '0' },
    { accountId: accounts[1]?.id || '', debitUsd: '0', creditUsd: '100' },
  ]);

  // New Account State
  const [showNewAcc, setShowNewAcc] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accNameEn, setAccNameEn] = useState('');
  const [accNameAr, setAccNameAr] = useState('');
  const [accType, setAccType] = useState('EXPENSE');

  // Filter for General Ledger
  const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState('ALL');

  const manualTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of jrnLines) {
      debit += Number(l.debitUsd || 0);
      credit += Number(l.creditUsd || 0);
    }
    const diff = Number((debit - credit).toFixed(2));
    return {
      debit: Number(debit.toFixed(2)),
      credit: Number(credit.toFixed(2)),
      isBalanced: diff === 0 && debit > 0,
    };
  }, [jrnLines]);

  const handlePostManualJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTotals.isBalanced) {
      notify('error', 'Total Debits must equal Total Credits');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manualJournal',
          description: jrnDesc,
          lines: jrnLines.map((l, idx) => ({
            accountId: l.accountId || accounts[idx]?.id || accounts[0]?.id,
            debitUsd: Number(l.debitUsd || 0),
            creditUsd: Number(l.creditUsd || 0),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to post manual journal');
      } else {
        notify('success', `Journal Entry ${data.entry.entryNumber} posted!`);
        setJrnDesc('');
        setTab('JOURNALS');
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverseJournal = async (entry: any) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reverseJournal',
          journalEntryId: entry.id,
          reason: `Reversal of ${entry.entryNumber}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Failed to reverse entry');
      } else {
        notify(
          'success',
          `Created Reversing Entry ${data.reversal.entryNumber} with opposite Debits & Credits!`
        );
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createAccount',
          code: accCode,
          nameEn: accNameEn,
          nameAr: accNameAr || accNameEn,
          nameKu: accNameAr || accNameEn,
          type: accType,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `Account ${data.account.code} added to Chart of Accounts!`);
        setShowNewAcc(false);
        setAccCode('');
        setAccNameEn('');
        await onRefresh();
      } else {
        notify('error', data.error || 'Could not create account');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePeriodLock = async (periodId: string, isLocked: boolean) => {
    const res = await fetch('/api/accounting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'togglePeriodLock',
        periodId,
        isLocked,
      }),
    });
    if (res.ok) {
      notify(
        'success',
        isLocked
          ? 'Accounting Period closed & locked!'
          : 'Accounting Period unlocked.'
      );
      await onRefresh();
    } else {
      const d = await res.json();
      notify('error', d.error || 'Failed to update period');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2.5">
            <BookOpen className="w-6 h-6 text-emerald-500" />
            {t.accounting.title}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict Double-Entry General Ledger (Total Debits = Total Credits), Reversing Entries, Trial Balance, and Balance Sheet
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 text-xs font-bold">
            <ShieldCheck className="w-4 h-4" />
            {t.accounting.balancedBadge}
          </span>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'JOURNALS', label: t.accounting.journalEntries },
          { id: 'MANUAL_ENTRY', label: `+ ${t.accounting.newManualJournal}` },
          { id: 'COA', label: t.accounting.chartOfAccounts },
          { id: 'LEDGER', label: t.accounting.generalLedger },
          { id: 'TRIAL_BALANCE', label: t.accounting.trialBalance },
          { id: 'BALANCE_SHEET', label: t.accounting.balanceSheet },
          { id: 'PERIODS', label: t.accounting.periods },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              tab === item.id
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                : 'bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 1. JOURNAL ENTRIES LIST */}
      {tab === 'JOURNALS' && (
        <div className="space-y-4">
          {journals.map((jrn: any) => (
            <div
              key={jrn.id}
              className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-4 shadow-sm space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-charcoal-800 pb-2.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono font-black text-emerald-500 text-sm">
                    {jrn.entryNumber}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                    {jrn.referenceType}
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {jrn.description}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-400">
                    {new Date(jrn.date).toLocaleString()}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      jrn.status === 'REVERSED'
                        ? 'bg-rose-500/15 text-rose-500'
                        : 'bg-emerald-500/15 text-emerald-500'
                    }`}
                  >
                    {jrn.status}
                  </span>
                  {jrn.status === 'POSTED' && jrn.referenceType !== 'REVERSAL' && (
                    <button
                      onClick={() => handleReverseJournal(jrn)}
                      disabled={submitting}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[11px] font-semibold"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t.accounting.reverseEntry}
                    </button>
                  )}
                </div>
              </div>

              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-1 text-start">Account Code & Name</th>
                    <th className="py-1 text-start">Line Description</th>
                    <th className="py-1 text-end w-36">{t.accounting.debit}</th>
                    <th className="py-1 text-end w-36">{t.accounting.credit}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-charcoal-800/60">
                  {(jrn.lines || []).map((line: any) => (
                    <tr key={line.id}>
                      <td className="py-1.5 font-semibold">
                        <span className="font-mono text-emerald-500 me-1.5">
                          {line.account?.code}
                        </span>
                        {locName(line.account, lang)}
                      </td>
                      <td className="py-1.5 text-slate-500">{line.description}</td>
                      <td className="py-1.5 text-end font-mono font-bold">
                        {Number(line.debitUsd) > 0
                          ? fmtMoney(line.debitUsd, displayCurrency, exchangeRate, lang)
                          : '—'}
                      </td>
                      <td className="py-1.5 text-end font-mono font-bold">
                        {Number(line.creditUsd) > 0
                          ? fmtMoney(line.creditUsd, displayCurrency, exchangeRate, lang)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* 2. MANUAL JOURNAL BUILDER */}
      {tab === 'MANUAL_ENTRY' && (
        <form
          onSubmit={handlePostManualJournal}
          className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-5"
        >
          <h3 className="text-base font-bold">{t.accounting.newManualJournal}</h3>
          <div>
            <label className="block text-xs font-semibold mb-1">
              Journal Entry Description *
            </label>
            <input
              type="text"
              required
              value={jrnDesc}
              onChange={(e) => setJrnDesc(e.target.value)}
              placeholder="e.g. Monthly depreciation or accrual adjustment"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
            />
          </div>

          <div className="space-y-2.5">
            {jrnLines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-6">
                  <select
                    value={line.accountId}
                    onChange={(e) => {
                      const copy = [...jrnLines];
                      copy[idx].accountId = e.target.value;
                      setJrnLines(copy);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                  >
                    {accounts.map((acc: any) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} — {locName(acc, lang)} ({acc.type})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Debit ($ USD)"
                    value={line.debitUsd}
                    onChange={(e) => {
                      const copy = [...jrnLines];
                      copy[idx].debitUsd = e.target.value;
                      if (Number(e.target.value) > 0) copy[idx].creditUsd = '0';
                      setJrnLines(copy);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end font-mono"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Credit ($ USD)"
                    value={line.creditUsd}
                    onChange={(e) => {
                      const copy = [...jrnLines];
                      copy[idx].creditUsd = e.target.value;
                      if (Number(e.target.value) > 0) copy[idx].debitUsd = '0';
                      setJrnLines(copy);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end font-mono"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() =>
                setJrnLines([
                  ...jrnLines,
                  { accountId: accounts[0]?.id || '', debitUsd: '0', creditUsd: '0' },
                ])
              }
              className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
            >
              + Add Journal Line
            </button>

            <div className="flex items-center gap-4 text-xs font-mono">
              <span>Total Debit: ${manualTotals.debit.toFixed(2)}</span>
              <span>Total Credit: ${manualTotals.credit.toFixed(2)}</span>
              <span
                className={`px-3 py-1 rounded-full font-bold ${
                  manualTotals.isBalanced
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-rose-500/15 text-rose-500'
                }`}
              >
                {manualTotals.isBalanced ? '✓ BALANCED' : '✕ UNBALANCED'}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!manualTotals.isBalanced || submitting}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold"
            >
              Post Balanced Journal Entry
            </button>
          </div>
        </form>
      )}

      {/* 3. CHART OF ACCOUNTS */}
      {tab === 'COA' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-bold">{t.accounting.chartOfAccounts}</h3>
            <button
              onClick={() => setShowNewAcc(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" />+ Add Account
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Code</th>
                  <th className="py-3 px-4 text-start">Account Name</th>
                  <th className="py-3 px-4 text-center">Type</th>
                  <th className="py-3 px-4 text-center">Normal Balance</th>
                  <th className="py-3 px-4 text-end">Current Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {accounts.map((acc: any) => (
                  <tr key={acc.id}>
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">
                      {acc.code}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      {locName(acc, lang)}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-charcoal-800 font-mono text-[10px]">
                        {acc.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono text-[11px]">
                      {acc.normalBalance}
                    </td>
                    <td className="py-2.5 px-4 text-end font-bold">
                      {fmtMoney(acc.balanceUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. GENERAL LEDGER */}
      {tab === 'LEDGER' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-3">
            <h3 className="text-sm font-bold">{t.accounting.generalLedger}</h3>
            <select
              value={selectedLedgerAccountId}
              onChange={(e) => setSelectedLedgerAccountId(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
            >
              <option value="ALL">All Accounts</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.code}>
                  {a.code} — {locName(a, lang)}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">Journal #</th>
                  <th className="py-3 px-4 text-start">Account</th>
                  <th className="py-3 px-4 text-start">{t.description}</th>
                  <th className="py-3 px-4 text-end">{t.accounting.debit}</th>
                  <th className="py-3 px-4 text-end">{t.accounting.credit}</th>
                  <th className="py-3 px-4 text-end">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {generalLedger
                  .filter((l: any) =>
                    selectedLedgerAccountId === 'ALL'
                      ? true
                      : l.accountCode === selectedLedgerAccountId
                  )
                  .map((l: any) => (
                    <tr key={l.lineId}>
                      <td className="py-2.5 px-4 text-slate-500">
                        {new Date(l.date).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">
                        {l.entryNumber}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        {l.accountCode} —{' '}
                        {lang === 'ar'
                          ? l.accountNameAr
                          : lang === 'ku'
                          ? l.accountNameKu
                          : l.accountNameEn}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{l.description}</td>
                      <td className="py-2.5 px-4 text-end font-mono">
                        {l.debitUsd > 0
                          ? fmtMoney(l.debitUsd, displayCurrency, exchangeRate, lang)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono">
                        {l.creditUsd > 0
                          ? fmtMoney(l.creditUsd, displayCurrency, exchangeRate, lang)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-end font-mono font-bold">
                        {fmtMoney(
                          l.runningBalanceUsd,
                          displayCurrency,
                          exchangeRate,
                          lang
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. TRIAL BALANCE */}
      {tab === 'TRIAL_BALANCE' && trialBalance && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <h3 className="text-sm font-bold">{t.accounting.trialBalance}</h3>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                trialBalance.isBalanced
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-rose-500/15 text-rose-500'
              }`}
            >
              {trialBalance.isBalanced
                ? '✓ Trial Balance Verified (Total Debits = Total Credits)'
                : '✕ Trial Balance Discrepancy'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 uppercase">
                <tr>
                  <th className="py-3 px-4 text-start">Code</th>
                  <th className="py-3 px-4 text-start">Account</th>
                  <th className="py-3 px-4 text-center">Type</th>
                  <th className="py-3 px-4 text-end">Total Debit</th>
                  <th className="py-3 px-4 text-end">Total Credit</th>
                  <th className="py-3 px-4 text-end">Net Debit Balance</th>
                  <th className="py-3 px-4 text-end">Net Credit Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {(trialBalance.rows || []).map((r: any) => (
                  <tr key={r.accountId}>
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">
                      {r.code}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{locName(r, lang)}</td>
                    <td className="py-2.5 px-4 text-center">{r.type}</td>
                    <td className="py-2.5 px-4 text-end font-mono">
                      {fmtMoney(r.totalDebitUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono">
                      {fmtMoney(r.totalCreditUsd, displayCurrency, exchangeRate, lang)}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono font-bold">
                      {r.debitBalanceUsd > 0
                        ? fmtMoney(r.debitBalanceUsd, displayCurrency, exchangeRate, lang)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-end font-mono font-bold">
                      {r.creditBalanceUsd > 0
                        ? fmtMoney(r.creditBalanceUsd, displayCurrency, exchangeRate, lang)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold">
                <tr>
                  <td colSpan={3} className="py-3 px-4">
                    TOTAL
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-emerald-400">
                    {fmtMoney(
                      trialBalance.totalDebitUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-emerald-400">
                    {fmtMoney(
                      trialBalance.totalCreditUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-teal-300">
                    {fmtMoney(
                      trialBalance.totalDebitBalanceUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-teal-300">
                    {fmtMoney(
                      trialBalance.totalCreditBalanceUsd,
                      displayCurrency,
                      exchangeRate,
                      lang
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 6. BALANCE SHEET */}
      {tab === 'BALANCE_SHEET' && balanceSheet && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800 flex justify-between items-center">
            <span className="font-bold text-sm">{t.accounting.balanceSheet}</span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                balanceSheet.isBalanced
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-rose-500/15 text-rose-500'
              }`}
            >
              {balanceSheet.isBalanced
                ? '✓ Assets = Liabilities + Equity Verified'
                : '✕ Balance Sheet Imbalance'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Assets Column */}
            <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <h4 className="font-black text-sm text-emerald-500 uppercase border-b border-slate-200 dark:border-charcoal-800 pb-2">
                  Assets (الأصول / سامانەکان)
                </h4>
                {(balanceSheet.assets || []).map((a: any) => (
                  <div key={a.code} className="flex justify-between py-1">
                    <span>
                      <b className="font-mono text-emerald-500 me-1.5">{a.code}</b>
                      {locName(a, lang)}
                    </span>
                    <span className="font-bold">
                      {fmtMoney(a.balanceUsd, displayCurrency, exchangeRate, lang)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-3">
                <span>TOTAL ASSETS</span>
                <span className="text-emerald-500">
                  {fmtMoney(
                    balanceSheet.totalAssetsUsd,
                    displayCurrency,
                    exchangeRate,
                    lang
                  )}
                </span>
              </div>
            </div>

            {/* Liabilities & Equity Column */}
            <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-black text-sm text-rose-500 uppercase border-b border-slate-200 dark:border-charcoal-800 pb-2">
                    Liabilities (الخصوم والالتزامات)
                  </h4>
                  {(balanceSheet.liabilities || []).map((l: any) => (
                    <div key={l.code} className="flex justify-between py-1">
                      <span>
                        <b className="font-mono text-rose-500 me-1.5">{l.code}</b>
                        {locName(l, lang)}
                      </span>
                      <span className="font-bold">
                        {fmtMoney(l.balanceUsd, displayCurrency, exchangeRate, lang)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t border-slate-200 dark:border-charcoal-800 pt-1.5">
                    <span>Total Liabilities</span>
                    <span>
                      {fmtMoney(
                        balanceSheet.totalLiabilitiesUsd,
                        displayCurrency,
                        exchangeRate,
                        lang
                      )}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <h4 className="font-black text-sm text-teal-500 uppercase border-b border-slate-200 dark:border-charcoal-800 pb-2">
                    Owner&apos;s Equity (حقوق الملكية)
                  </h4>
                  {(balanceSheet.equity || []).map((eq: any) => (
                    <div key={eq.code} className="flex justify-between py-1">
                      <span>
                        <b className="font-mono text-teal-500 me-1.5">{eq.code}</b>
                        {locName(eq, lang)}
                      </span>
                      <span className="font-bold">
                        {fmtMoney(eq.balanceUsd, displayCurrency, exchangeRate, lang)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t border-slate-200 dark:border-charcoal-800 pt-1.5">
                    <span>Total Equity</span>
                    <span>
                      {fmtMoney(
                        balanceSheet.totalEquityUsd,
                        displayCurrency,
                        exchangeRate,
                        lang
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-3">
                <span>TOTAL LIABILITIES & EQUITY</span>
                <span className="text-emerald-500">
                  {fmtMoney(
                    balanceSheet.totalLiabilitiesAndEquityUsd,
                    displayCurrency,
                    exchangeRate,
                    lang
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. ACCOUNTING PERIODS & LOCKING */}
      {tab === 'PERIODS' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-5 space-y-4">
          <h3 className="text-sm font-bold">{t.accounting.periods}</h3>
          <p className="text-xs text-slate-500">
            Closing and locking a fiscal period prevents any financial transaction or journal entry from being posted into that date range.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {periods.map((p: any) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-charcoal-800 flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-sm">{p.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(p.startDate).toLocaleDateString()} —{' '}
                    {new Date(p.endDate).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleTogglePeriodLock(p.id, !p.isLocked)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                    p.isLocked
                      ? 'bg-rose-500/15 text-rose-500'
                      : 'bg-emerald-500/15 text-emerald-500'
                  }`}
                >
                  {p.isLocked ? (
                    <>
                      <Lock className="w-3.5 h-3.5" /> Locked
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3.5 h-3.5" /> Open
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Chart of Account Modal */}
      {showNewAcc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateAccount}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-bold">Add Account to Chart of Accounts</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Account Code *</label>
                <input
                  type="text"
                  required
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  placeholder="e.g. 5195"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Account Type</label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                >
                  <option value="ASSET">ASSET</option>
                  <option value="LIABILITY">LIABILITY</option>
                  <option value="EQUITY">EQUITY</option>
                  <option value="REVENUE">REVENUE</option>
                  <option value="EXPENSE">EXPENSE</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Name (EN) *</label>
              <input
                type="text"
                required
                value={accNameEn}
                onChange={(e) => setAccNameEn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Name (AR/KU)</label>
              <input
                type="text"
                value={accNameAr}
                onChange={(e) => setAccNameAr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewAcc(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
