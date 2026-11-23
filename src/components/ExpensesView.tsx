'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Receipt,
  Plus,
  CheckCircle2,
  XCircle,
  Download,
  AlertCircle,
  Users,
  Printer,
  ChevronDown,
  ChevronUp,
  Phone,
  Briefcase,
  FolderPlus,
  Search,
  CalendarOff,
  Minus,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import {
  exportToCsv,
  fmtIqd,
  locName,
  todayDateStr,
  currentMonthStr,
  makeIdempotencyKey,
} from '@/lib/client-utils';
import { SearchableSelect } from './SearchableSelect';
import { PrintableDocument } from './PrintModal';
import { CustomDatePicker, CustomMonthPicker } from './CustomDatePicker';

interface ExpensesViewProps {
  lang: LanguageCode;
  expenses: any[];
  expenseCategories: any[];
  employees: any[];
  financialAccounts: any[];
  suppliers: any[];
  initialMode?: 'NORMAL' | 'SALARY' | null;
  onClearInitialMode?: () => void;
  onRefresh: () => Promise<void>;
  onPrint: (doc: PrintableDocument) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function ExpensesModuleView({
  lang,
  expenses,
  expenseCategories,
  employees,
  financialAccounts,
  suppliers,
  initialMode,
  onClearInitialMode,
  onRefresh,
  onPrint,
  notify,
}: ExpensesViewProps) {
  const t = translations[lang];
  const [showNew, setShowNew] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [catFilter, setCatFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey('exp'));

  // Core Simple Expense Fields (4 fields only!)
  const [category, setCategory] = useState('ELECTRICITY');
  const [amountIqd, setAmountIqd] = useState('');
  const [date, setDate] = useState(todayDateStr());
  const [notes, setNotes] = useState('');

  // Salary Payment Fields (auto-shown when category === 'SALARIES')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [salaryMonth, setSalaryMonth] = useState(currentMonthStr());
  const [monthEmployeesOverride, setMonthEmployeesOverride] = useState<any[] | null>(null);
  const [salaryPaymentType, setSalaryPaymentType] = useState<'FULL' | 'PARTIAL' | 'ADVANCE'>('FULL');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Inline Off Days + Optional Deduction inside Salary Payment
  const [salOffDays, setSalOffDays] = useState('0');
  const [salHasDeduction, setSalHasDeduction] = useState(false);
  const [salDeductionIqd, setSalDeductionIqd] = useState('');

  // Advanced optional fields (collapsed by default)
  const [titleOverride, setTitleOverride] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [financialAccountId, setFinancialAccountId] = useState(financialAccounts[0]?.id || '');
  const [supplierId, setSupplierId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState('MONTHLY');

  // New Custom Category Form
  const [newCatNameKu, setNewCatNameKu] = useState('');
  const [newCatNameAr, setNewCatNameAr] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');

  const openModal = (mode: 'NORMAL' | 'SALARY') => {
    setIdempotencyKey(makeIdempotencyKey('exp'));
    setDuplicateWarning(null);
    setDate(todayDateStr());
    setNotes('');
    setTitleOverride('');
    setVendorName('');
    setShowAdvanced(false);
    setFinancialAccountId(financialAccounts[0]?.id || '');
    setSalOffDays('0');
    setSalHasDeduction(false);
    setSalDeductionIqd('');
    if (mode === 'SALARY') {
      setCategory('SALARIES');
      setSalaryMonth(currentMonthStr());
      setSelectedEmployeeId('');
      setAmountIqd('');
      setSalaryPaymentType('FULL');
    } else {
      setCategory('ELECTRICITY');
      setAmountIqd('');
      setSelectedEmployeeId('');
    }
    setShowNew(true);
  };

  useEffect(() => {
    if (initialMode) {
      openModal(initialMode);
      onClearInitialMode?.();
    }
  }, [initialMode]);

  const isSalaryMode = category === 'SALARIES';
  const effectiveEmployees = monthEmployeesOverride || employees;
  const activeEmployees = useMemo(
    () => effectiveEmployees.filter((e) => (e.status || 'ACTIVE') !== 'INACTIVE'),
    [effectiveEmployees]
  );
  const selectedEmployee = useMemo(
    () => effectiveEmployees.find((e) => e.id === selectedEmployeeId) || null,
    [effectiveEmployees, selectedEmployeeId]
  );

  // When user picks a different salary month in the modal, load exact paid/remaining stats for that month
  useEffect(() => {
    if (!showNew || !isSalaryMode) return;
    if (salaryMonth === currentMonthStr()) {
      setMonthEmployeesOverride(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/employees?month=${encodeURIComponent(salaryMonth)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.employees) {
          setMonthEmployeesOverride(d.employees);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showNew, isSalaryMode, salaryMonth]);

  // Auto-fill remaining salary when picking an employee!
  const handleSelectEmployee = (empId: string) => {
    setSelectedEmployeeId(empId);
    setDuplicateWarning(null);
    setSalOffDays('0');
    setSalHasDeduction(false);
    setSalDeductionIqd('');
    const emp = effectiveEmployees.find((e) => e.id === empId);
    if (emp) {
      const rem = Number(emp.remainingSalaryIqd || 0);
      const monthly = Number(emp.monthlySalaryIqd || 0);
      if (rem > 0) {
        setAmountIqd(String(rem));
        setSalaryPaymentType('FULL');
      } else if (monthly > 0) {
        setAmountIqd('');
        setSalaryPaymentType('ADVANCE');
      } else {
        setAmountIqd('');
        setSalaryPaymentType('FULL');
      }
    }
  };

  const recalcSalaryAfterDeduction = (emp: any, daysVal: string, deductOn: boolean, customDedVal?: string) => {
    const days = Math.max(0, Number(daysVal || 0));
    const monthly = Number(emp?.monthlySalaryIqd || 0);
    const baseRem = Number(emp?.remainingSalaryIqd || monthly || 0);
    let ded = 0;
    if (deductOn && days > 0) {
      if (customDedVal !== undefined) {
        ded = Math.max(0, Math.round(Number(customDedVal || 0)));
      } else {
        ded = monthly > 0 ? Math.round((monthly / 30) * days) : 0;
        setSalDeductionIqd(ded > 0 ? String(ded) : '');
      }
    }
    if (salaryPaymentType === 'FULL' && baseRem > 0) {
      setAmountIqd(String(Math.max(0, baseRem - ded)));
    }
  };

  const categoryLabel = (code: string) => {
    const found = expenseCategories.find((c) => c.code === code);
    if (found) return locName(found, lang);
    return (t.expenses.categories as Record<string, string>)[code] || code;
  };

  const submitExpense = async (confirmDuplicate = false) => {
    if (isSalaryMode && !selectedEmployeeId) {
      notify('error', lang === 'ku' ? 'تکایە کارمەندێک هەڵبژێرە' : lang === 'ar' ? 'يرجى اختيار موظف' : 'Please select an employee');
      return;
    }
    if (!Number(amountIqd) || Number(amountIqd) <= 0) {
      notify('error', lang === 'ku' ? 'تکایە بڕی پارە بە دروستی بنووسە' : lang === 'ar' ? 'يرجى إدخال مبلغ صحيح' : 'Please enter a valid amount');
      return;
    }

    setSubmitting(true);
    try {
      // If off days were entered during salary payment, record them first so remaining salary & off-days history stay 100% accurate
      const offDaysNum = Math.max(0, Number(salOffDays || 0));
      const dedNum = salHasDeduction && offDaysNum > 0 ? Math.max(0, Math.round(Number(salDeductionIqd || 0))) : 0;
      if (isSalaryMode && offDaysNum > 0 && !confirmDuplicate) {
        await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recordOffDays',
            employeeId: selectedEmployeeId,
            salaryMonth,
            date,
            days: offDaysNum,
            hasDeduction: salHasDeduction && dedNum > 0,
            deductionIqd: dedNum,
            reason: notes.trim() || undefined,
          }),
        });
      }

      const payload: any = {
        action: 'createExpense',
        category,
        amountIqd: Number(amountIqd),
        date,
        notes:
          offDaysNum > 0
            ? `${notes.trim() ? notes.trim() + ' — ' : ''}${offDaysNum} ${lang === 'ku' ? 'ڕۆژ مۆڵەت' : lang === 'ar' ? 'يوم إجازة' : 'day(s) off'}${dedNum > 0 ? ` (-${fmtIqd(dedNum, lang)})` : ''}`
            : (notes.trim() || undefined),
        title: titleOverride.trim() || undefined,
        vendorName: vendorName.trim() || undefined,
        paymentMethod,
        financialAccountId: paymentMethod === 'CREDIT' ? null : (financialAccountId || financialAccounts[0]?.id),
        supplierId: paymentMethod === 'CREDIT' ? (supplierId || null) : null,
        isRecurring,
        recurringInterval: isRecurring ? recurringInterval : null,
        idempotencyKey,
      };

      if (isSalaryMode) {
        payload.employeeId = selectedEmployeeId;
        payload.salaryMonth = salaryMonth;
        payload.paymentType = salaryPaymentType;
        payload.confirmDuplicate = confirmDuplicate;
      }

      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.code === 'POSSIBLE_DUPLICATE') {
        setDuplicateWarning(data.error);
        return;
      }

      if (!res.ok) {
        notify('error', data.error || 'Failed to record expense');
      } else {
        setShowNew(false);
        setDuplicateWarning(null);
        if (data.salaryPayment) {
          notify(
            'success',
            lang === 'ku'
              ? `مووچەی ${data.salaryPayment.employeeName} (${fmtIqd(data.salaryPayment.amountIqd, lang)}) تۆمارکرا!`
              : lang === 'ar'
              ? `تم صرف راتب ${data.salaryPayment.employeeName} (${fmtIqd(data.salaryPayment.amountIqd, lang)}) بنجاح!`
              : `Salary payment for ${data.salaryPayment.employeeName} (${fmtIqd(data.salaryPayment.amountIqd, lang)}) saved!`
          );
          onPrint({ type: 'SALARY_RECEIPT', mode: 'A4', data: data.salaryPayment });
        } else if (data.expense?.status === 'PENDING_APPROVAL') {
          notify('warning', `${data.expense.expenseNumber} — ${t.statuses.PENDING_APPROVAL}`);
        } else {
          notify(
            'success',
            lang === 'ku'
              ? `خەرجی ${data.expense.expenseNumber} بە سەرکەوتوویی تۆمارکرا`
              : lang === 'ar'
              ? `تم تسجيل المصروف ${data.expense.expenseNumber} بنجاح`
              : `Expense ${data.expense.expenseNumber} recorded successfully`
          );
        }
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatNameKu.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createExpenseCategory',
          nameKu: newCatNameKu.trim(),
          nameAr: newCatNameAr.trim() || newCatNameKu.trim(),
          nameEn: newCatNameEn.trim() || newCatNameKu.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.category) {
        notify('success', `${locName(data.category, lang)} ✓`);
        setNewCatNameKu('');
        setNewCatNameAr('');
        setNewCatNameEn('');
        setShowNewCategory(false);
        setCategory(data.category.code);
        await onRefresh();
      } else {
        notify('error', data.error || 'Failed to add category');
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveReject = async (expenseId: string, act: 'approveExpense' | 'rejectExpense') => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, expenseId }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('success', `${data.expense.expenseNumber} ✓`);
        await onRefresh();
      } else {
        notify('error', data.error || 'Action failed');
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingExpenses = useMemo(
    () => expenses.filter((e) => e.status === 'PENDING_APPROVAL'),
    [expenses]
  );
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (catFilter !== 'ALL' && e.category !== catFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        (e.title || '').toLowerCase().includes(q) ||
        (e.expenseNumber || '').toLowerCase().includes(q) ||
        (e.employeeName || '').toLowerCase().includes(q) ||
        (e.vendorName || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    });
  }, [expenses, catFilter, search]);

  const totalPostedIqd = useMemo(
    () =>
      expenses
        .filter((e) => e.status === 'POSTED')
        .reduce((sum, e) => sum + Number(e.amountIqd || 0), 0),
    [expenses]
  );

  return (
    <div className="space-y-6">
      {/* Header & Big Clear Primary Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Receipt className="w-6 h-6 text-emerald-500" />
            {t.expenses.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.expenses.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">
            <span className="text-slate-400 me-1.5">{t.expenses.totalPosted}:</span>
            <span className="font-black text-rose-500 text-sm">{fmtIqd(totalPostedIqd, lang)}</span>
          </div>

          <button
            onClick={() => openModal('NORMAL')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            {t.expenses.newExpense}
          </button>

          <button
            onClick={() => setShowNewCategory(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-xs font-semibold"
          >
            <FolderPlus className="w-4 h-4 text-emerald-500" />
            {t.expenses.addCategoryBtn}
          </button>
        </div>
      </div>

      {/* Pending Approvals Banner */}
      {pendingExpenses.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-500 font-bold text-sm">
            <AlertCircle className="w-4 h-4" />
            {t.statuses.PENDING_APPROVAL} ({pendingExpenses.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingExpenses.map((pe) => (
              <div
                key={pe.id}
                className="bg-white dark:bg-charcoal-900 p-4 rounded-xl border border-amber-500/20 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white">
                    {pe.title} <span className="font-mono text-xs text-slate-400">({pe.expenseNumber})</span>
                  </div>
                  <div className="text-slate-400 mt-0.5">
                    {categoryLabel(pe.category)} • <b className="text-amber-500">{fmtIqd(pe.amountIqd, lang)}</b>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApproveReject(pe.id, 'approveExpense')}
                    disabled={submitting}
                    className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.expenses.approve}
                  </button>
                  <button
                    onClick={() => handleApproveReject(pe.id, 'rejectExpense')}
                    disabled={submitting}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-500/15 text-rose-500 font-bold text-xs"
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

      {/* Category Filter Pills & Expenses Table */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full ps-10 pe-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>

            <button
              onClick={() =>
                exportToCsv(
                  'expenses-iqd',
                  ['Expense #', 'Date', 'Category', 'Details', 'Employee / Payee', 'Status', 'Amount (IQD)'],
                  filteredExpenses.map((e) => [
                    e.expenseNumber,
                    new Date(e.date).toISOString().slice(0, 10),
                    categoryLabel(e.category),
                    e.title,
                    e.employeeName || e.vendorName || '',
                    e.status,
                    Math.round(Number(e.amountIqd || 0)),
                  ])
                )
              }
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              {t.exportCsv}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                catFilter === 'ALL'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.all} ({expenses.length})
            </button>
            {expenseCategories.map((c) => (
              <button
                key={c.code}
                onClick={() => setCatFilter(c.code)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                  catFilter === c.code
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {locName(c, lang)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
              <tr>
                <th className="py-3 px-4 text-start">#</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">{t.category}</th>
                <th className="py-3 px-4 text-start">{t.description}</th>
                <th className="py-3 px-4 text-center">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.amount}</th>
                <th className="py-3 px-4 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 text-sm">
                    {t.noData}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-500">
                      {exp.expenseNumber}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {new Date(exp.date).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                          exp.category === 'SALARIES'
                            ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                            : 'bg-slate-100 dark:bg-charcoal-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {categoryLabel(exp.category)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {exp.employeeName ? `${exp.employeeName} (${exp.employeePhone || ''})` : exp.title}
                      </div>
                      {(exp.description || exp.vendorName) && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {exp.description || exp.vendorName}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
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
                    <td className="py-3 px-4 text-end font-black text-rose-500">
                      {fmtIqd(exp.amountIqd, lang)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {exp.salaryPayment ? (
                        <button
                          onClick={() =>
                            onPrint({
                              type: 'SALARY_RECEIPT',
                              mode: 'A4',
                              data: exp.salaryPayment,
                            })
                          }
                          title={t.expenses.printReceipt}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-600 dark:text-teal-400 text-xs font-bold"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {t.print}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ULTRA-SIMPLE NEW EXPENSE / SALARY PAYMENT MODAL (IQD ONLY) */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitExpense(false);
            }}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-lg w-full space-y-5 my-8 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                {isSalaryMode ? (
                  <Users className="w-5 h-5 text-teal-500" />
                ) : (
                  <Receipt className="w-5 h-5 text-emerald-500" />
                )}
                {isSalaryMode ? t.expenses.paySalaryBtn : t.expenses.newExpense}
              </h3>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* 1. Expense Category */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  1. {t.category} *
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewCategory(true)}
                  className="text-xs text-emerald-500 hover:underline font-bold"
                >
                  {t.expenses.addCategoryBtn}
                </button>
              </div>
              <SearchableSelect
                value={category}
                onChange={(val) => {
                  setCategory(val);
                  setDuplicateWarning(null);
                }}
                options={expenseCategories.map((c) => ({
                  value: c.code,
                  label: locName(c, lang),
                  badge: c.code === 'SALARIES' ? '👤' : undefined,
                }))}
                searchPlaceholder={t.searchPlaceholder}
              />
            </div>

            {/* DYNAMIC SALARY PAYMENT SECTION WHEN 'SALARIES' IS SELECTED */}
            {isSalaryMode && (
              <div className="p-4 rounded-2xl bg-teal-500/10 border border-teal-500/30 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-teal-700 dark:text-teal-300 mb-1.5">
                    {t.expenses.selectEmployee} *
                  </label>
                  <SearchableSelect
                    value={selectedEmployeeId}
                    onChange={handleSelectEmployee}
                    placeholder={t.expenses.selectEmployee}
                    searchPlaceholder={t.searchPlaceholder}
                    options={activeEmployees.map((emp) => ({
                      value: emp.id,
                      label: emp.name,
                      sublabel: `${emp.phone}${emp.position ? ` • ${emp.position}` : ''}`,
                      badge:
                        Number(emp.monthlySalaryIqd) > 0
                          ? fmtIqd(emp.remainingSalaryIqd, lang)
                          : undefined,
                      badgeColor: Number(emp.remainingSalaryIqd) > 0 ? 'amber' : 'emerald',
                    }))}
                  />
                </div>

                {selectedEmployee && (
                  <div className="bg-white dark:bg-charcoal-950 rounded-xl p-3.5 border border-teal-500/20 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-black text-sm text-slate-900 dark:text-white">
                        {selectedEmployee.name}
                      </div>
                      <div className="flex items-center gap-3 text-slate-500 font-mono">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-teal-500" />
                          {selectedEmployee.phone}
                        </span>
                        {selectedEmployee.position && (
                          <span className="flex items-center gap-1 font-sans">
                            <Briefcase className="w-3.5 h-3.5 text-teal-500" />
                            {selectedEmployee.position}
                          </span>
                        )}
                      </div>
                    </div>

                    {Number(selectedEmployee.monthlySalaryIqd) > 0 && (
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-charcoal-800">
                        <div>
                          <div className="text-[11px] text-slate-400">{t.expenses.monthlySalary}</div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">
                            {fmtIqd(selectedEmployee.monthlySalaryIqd, lang)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">{t.expenses.paidSoFar}</div>
                          <div className="font-bold text-emerald-500">
                            {fmtIqd(selectedEmployee.paidThisMonthIqd, lang)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">{t.expenses.remainingBalance}</div>
                          <div className="font-black text-amber-500">
                            {fmtIqd(selectedEmployee.remainingSalaryIqd, lang)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Quick Full / Partial / Advance Buttons */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSalaryPaymentType('FULL');
                          if (Number(selectedEmployee.remainingSalaryIqd) > 0) {
                            setAmountIqd(String(selectedEmployee.remainingSalaryIqd));
                          } else if (Number(selectedEmployee.monthlySalaryIqd) > 0) {
                            setAmountIqd(String(selectedEmployee.monthlySalaryIqd));
                          }
                        }}
                        className={`py-2 rounded-xl text-xs font-bold transition ${
                          salaryPaymentType === 'FULL'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {t.expenses.fullPayment}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSalaryPaymentType('PARTIAL');
                          if (Number(selectedEmployee.remainingSalaryIqd) > 0) {
                            setAmountIqd(String(Math.round(Number(selectedEmployee.remainingSalaryIqd) / 2)));
                          }
                        }}
                        className={`py-2 rounded-xl text-xs font-bold transition ${
                          salaryPaymentType === 'PARTIAL'
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {t.expenses.partialPayment}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSalaryPaymentType('ADVANCE')}
                        className={`py-2 rounded-xl text-xs font-bold transition ${
                          salaryPaymentType === 'ADVANCE'
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {t.expenses.advancePayment}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {t.expenses.salaryMonth}
                  </label>
                  <CustomMonthPicker
                    value={salaryMonth}
                    onChange={setSalaryMonth}
                    lang={lang}
                  />
                </div>

                {/* OFF DAYS & OPTIONAL SALARY DEDUCTION RIGHT INSIDE PAY SALARY POPUP */}
                <div className={`p-3.5 rounded-xl border transition space-y-3 ${
                  Number(salOffDays || 0) > 0 && salHasDeduction
                    ? 'bg-rose-500/10 border-rose-500/40'
                    : 'bg-white/60 dark:bg-charcoal-950/70 border-teal-500/25'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-black text-amber-500 flex items-center gap-1.5">
                      <CalendarOff className="w-4 h-4" />
                      {lang === 'ku'
                        ? 'ڕۆژانی مۆڵەت / نەهاتن (ئارەزوومەندانە)'
                        : lang === 'ar'
                        ? 'أيام الإجازة / الغياب (اختياري)'
                        : 'Off Days / Leave (Optional)'}
                    </label>
                    {selectedEmployee && Number(selectedEmployee.offDaysThisMonth || 0) > 0 && (
                      <span className="text-[11px] font-bold text-amber-400">
                        {lang === 'ku' ? 'پێشتر تۆمارکراو:' : lang === 'ar' ? 'مسجل سابقاً:' : 'Already recorded:'}{' '}
                        {selectedEmployee.offDaysThisMonth} {lang === 'ku' ? 'ڕۆژ' : lang === 'ar' ? 'يوم' : 'd'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.max(0, Number(salOffDays || 0) - 1);
                          setSalOffDays(String(next));
                          recalcSalaryAfterDeduction(selectedEmployee, String(next), salHasDeduction);
                        }}
                        className="w-9 h-10 rounded-xl bg-slate-100 dark:bg-charcoal-800 flex items-center justify-center font-black"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={salOffDays}
                        onChange={(e) => {
                          setSalOffDays(e.target.value);
                          recalcSalaryAfterDeduction(selectedEmployee, e.target.value, salHasDeduction);
                        }}
                        placeholder="0"
                        className="w-full py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = Number(salOffDays || 0) + 1;
                          setSalOffDays(String(next));
                          recalcSalaryAfterDeduction(selectedEmployee, String(next), salHasDeduction);
                        }}
                        className="w-9 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center font-black"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const next = !salHasDeduction;
                        setSalHasDeduction(next);
                        const days = Number(salOffDays || 0) > 0 ? salOffDays : '1';
                        if (next && Number(salOffDays || 0) <= 0) setSalOffDays('1');
                        recalcSalaryAfterDeduction(selectedEmployee, days, next);
                      }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-black border transition ${
                        salHasDeduction
                          ? 'bg-rose-600 text-white border-rose-600 shadow'
                          : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-charcoal-700'
                      }`}
                    >
                      {salHasDeduction
                        ? (lang === 'ku' ? 'لێبڕین لە مووچە: کراوەیە ✓' : lang === 'ar' ? 'الخصم من الراتب: مفعّل ✓' : 'Salary Deduction: ON ✓')
                        : (lang === 'ku' ? 'لێبڕین لە مووچە (ئارەزوومەندانە)' : lang === 'ar' ? 'خصم من الراتب (اختياري)' : 'Deduct from Salary (Optional)')}
                    </button>
                  </div>

                  {salHasDeduction && (
                    <div className="space-y-1.5 pt-2 border-t border-rose-500/20">
                      <label className="block text-[11px] font-bold text-rose-500">
                        {lang === 'ku' ? 'بڕی لێبڕین (د.ع):' : lang === 'ar' ? 'مبلغ الخصم (د.ع):' : 'Deduction Amount (IQD):'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={salDeductionIqd}
                        onChange={(e) => {
                          setSalDeductionIqd(e.target.value);
                          recalcSalaryAfterDeduction(selectedEmployee, salOffDays, true, e.target.value);
                        }}
                        className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-rose-500/40 text-sm font-black text-rose-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. Amount (IQD) & 3. Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                  2. {t.amount} *
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={amountIqd}
                  onChange={(e) => {
                    setAmountIqd(e.target.value);
                    setDuplicateWarning(null);
                  }}
                  placeholder="250000"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-lg font-black text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                  3. {t.date}
                </label>
                <CustomDatePicker
                  value={date}
                  onChange={setDate}
                  lang={lang}
                />
              </div>
            </div>

            {/* 4. Optional Note */}
            <div>
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                4. {t.notes}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={lang === 'ku' ? 'تێبینییەکی کورت...' : lang === 'ar' ? 'ملاحظة قصيرة...' : 'Short note...'}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>

            {/* Duplicate Payment Guard Banner */}
            {duplicateWarning && (
              <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-xs space-y-2">
                <div className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {duplicateWarning}
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitExpense(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs"
                >
                  {lang === 'ku' ? 'بەڵێ، دڵنیام دووبارە بکرێتەوە' : lang === 'ar' ? 'نعم، تأكيد الصرف رغم التكرار' : 'Yes, Confirm & Pay Anyway'}
                </button>
              </div>
            )}

            {/* Collapsible Advanced Options */}
            <div className="border-t border-slate-100 dark:border-charcoal-800 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-500"
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {t.advancedOptions}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">
                        {lang === 'ku' ? 'قاسە / بانک' : lang === 'ar' ? 'الصندوق / البنك' : 'Paid From Account'}
                      </label>
                      <select
                        value={financialAccountId}
                        onChange={(e) => setFinancialAccountId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                      >
                        {financialAccounts.map((fa) => (
                          <option key={fa.id} value={fa.id}>
                            {locName(fa, lang)} ({fmtIqd(fa.balanceIqd, lang)})
                          </option>
                        ))}
                      </select>
                    </div>
                    {!isSalaryMode && (
                      <div>
                        <label className="block text-xs font-semibold mb-1">{t.sales.paymentType}</label>
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                        >
                          <option value="CASH">{t.sales.cash}</option>
                          <option value="BANK_TRANSFER">Bank</option>
                          <option value="CREDIT">{t.sales.credit}</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {!isSalaryMode && paymentMethod === 'CREDIT' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1">{t.purchases.supplier}</label>
                      <select
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                      >
                        <option value="">—</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {!isSalaryMode && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1">
                          {lang === 'ku' ? 'ناونیشانی خەرجی' : lang === 'ar' ? 'عنوان المصروف' : 'Custom Title'}
                        </label>
                        <input
                          type="text"
                          value={titleOverride}
                          onChange={(e) => setTitleOverride(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">
                          {lang === 'ku' ? 'لایەنی سودمەند' : lang === 'ar' ? 'الجهة المستفيدة' : 'Vendor / Payee'}
                        </label>
                        <input
                          type="text"
                          value={vendorName}
                          onChange={(e) => setVendorName(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {!isSalaryMode && (
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isRecurring}
                          onChange={(e) => setIsRecurring(e.target.checked)}
                          className="rounded text-emerald-600"
                        />
                        <span>{lang === 'ku' ? 'خەرجی دووبارەبووەوە' : lang === 'ar' ? 'مصروف متكرر' : 'Recurring Expense'}</span>
                      </label>
                      {isRecurring && (
                        <select
                          value={recurringInterval}
                          onChange={(e) => setRecurringInterval(e.target.value)}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
                        >
                          <option value="WEEKLY">Weekly</option>
                          <option value="MONTHLY">Monthly</option>
                          <option value="YEARLY">Yearly</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="px-5 py-3 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-7 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/25 transition"
              >
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* NEW CUSTOM EXPENSE CATEGORY MODAL */}
      {showNewCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateCategory}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4"
          >
            <h3 className="text-base font-black">{t.expenses.addCategoryBtn}</h3>
            <div>
              <label className="block text-xs font-bold mb-1">
                {lang === 'ku' ? 'ناوی بەش (کوردی) *' : lang === 'ar' ? 'اسم التصنيف *' : 'Category Name *'}
              </label>
              <input
                type="text"
                required
                value={newCatNameKu}
                onChange={(e) => setNewCatNameKu(e.target.value)}
                placeholder={lang === 'ku' ? 'نموونە: پاککردنەوە' : 'e.g. Cleaning Supplies'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-400">العربية (Optional)</label>
                <input
                  type="text"
                  value={newCatNameAr}
                  onChange={(e) => setNewCatNameAr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-400">English (Optional)</label>
                <input
                  type="text"
                  value={newCatNameEn}
                  onChange={(e) => setNewCatNameEn(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewCategory(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
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
