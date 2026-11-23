'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Edit3,
  Trash2,
  Banknote,
  Printer,
  Search,
  Phone,
  Briefcase,
  Shield,
  AlertCircle,
  Check,
  CalendarOff,
  Plus,
  Minus,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import {
  fmtIqd,
  todayDateStr,
  currentMonthStr,
  makeIdempotencyKey,
} from '@/lib/client-utils';
import { ALL_PERMISSIONS } from '@/lib/auth';
import { PrintableDocument } from './PrintModal';
import { CustomDatePicker, CustomMonthPicker } from './CustomDatePicker';

interface EmployeesPayrollProps {
  lang: LanguageCode;
  employeesData: any;
  settingsData: any;
  financialAccounts: any[];
  currentUserRole?: string;
  onRefresh: () => Promise<void>;
  onPrint: (doc: PrintableDocument) => void;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}

export function EmployeesPayrollView({
  lang,
  employeesData,
  settingsData,
  financialAccounts,
  currentUserRole = 'SUPER_ADMIN',
  onRefresh,
  onPrint,
  notify,
}: EmployeesPayrollProps) {
  const t = translations[lang];
  const [tab, setTab] = useState<'EMPLOYEES' | 'OFF_DAYS' | 'HISTORY' | 'SYSTEM_USERS'>('EMPLOYEES');
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr());
  const [monthData, setMonthData] = useState<any>(employeesData);
  const [search, setSearch] = useState('');
  const [historyEmpFilter, setHistoryEmpFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);

  // Add/Edit Employee Modal
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empPosition, setEmpPosition] = useState('');
  const [empSalary, setEmpSalary] = useState('');
  const [empStartDate, setEmpStartDate] = useState(todayDateStr());
  const [empStatus, setEmpStatus] = useState<'ACTIVE' | 'ON_LEAVE' | 'INACTIVE'>('ACTIVE');
  const [empNotes, setEmpNotes] = useState('');

  // Quick Pay Salary Modal
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payType, setPayType] = useState<'FULL' | 'PARTIAL' | 'ADVANCE'>('FULL');
  const [payDate, setPayDate] = useState(todayDateStr());
  const [payNotes, setPayNotes] = useState('');
  const [payIdemKey, setPayIdemKey] = useState(() => makeIdempotencyKey('sal'));
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [payOffDays, setPayOffDays] = useState('0');
  const [payHasDeduction, setPayHasDeduction] = useState(false);
  const [payDeductionIqd, setPayDeductionIqd] = useState('');

  // Off Days & Optional Deduction Modal
  const [offTarget, setOffTarget] = useState<any | null>(null);
  const [offDaysCount, setOffDaysCount] = useState('1');
  const [offDate, setOffDate] = useState(todayDateStr());
  const [offHasDeduction, setOffHasDeduction] = useState(false);
  const [offDeductionIqd, setOffDeductionIqd] = useState('');
  const [offReason, setOffReason] = useState('');

  // Admin System Users state
  const [selectedRoleMatrix, setSelectedRoleMatrix] = useState('SALES_EMPLOYEE');
  const [showNewUser, setShowNewUser] = useState(false);
  const [uName, setUName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState('SALES_EMPLOYEE');

  useEffect(() => {
    if (employeesData && (!employeesData.month || employeesData.month === selectedMonth)) {
      setMonthData(employeesData);
    }
  }, [employeesData, selectedMonth]);

  const reloadMonth = async (monthStr: string) => {
    setSelectedMonth(monthStr);
    try {
      const res = await fetch(`/api/employees?month=${encodeURIComponent(monthStr)}`);
      if (res.ok) setMonthData(await res.json());
    } catch {}
  };

  const employees = monthData?.employees || [];
  const salaryPayments = monthData?.salaryPayments || [];
  const employeeLeaves = monthData?.employeeLeaves || [];
  const monthLeaves = useMemo(
    () => employeeLeaves.filter((lv: any) => !selectedMonth || lv.salaryMonth === selectedMonth),
    [employeeLeaves, selectedMonth]
  );
  const summary = monthData?.summary || {
    activeEmployees: 0,
    totalPayrollIqd: 0,
    totalPaidIqd: 0,
    totalRemainingIqd: 0,
  };

  const openOffDaysModal = (emp: any) => {
    setOffTarget(emp);
    setOffDaysCount('1');
    setOffDate(todayDateStr());
    setOffHasDeduction(false);
    const dailyRate = Math.round(Number(emp.monthlySalaryIqd || 0) / 30);
    setOffDeductionIqd(dailyRate > 0 ? String(dailyRate) : '');
    setOffReason('');
  };

  const handleSaveOffDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offTarget) return;
    const days = Math.max(0.5, Number(offDaysCount || 1));
    const ded = offHasDeduction ? Math.max(0, Math.round(Number(offDeductionIqd || 0))) : 0;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recordOffDays',
          employeeId: offTarget.id,
          salaryMonth: selectedMonth,
          date: offDate,
          days,
          hasDeduction: offHasDeduction && ded > 0,
          deductionIqd: ded,
          reason: offReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Could not record off days');
      else {
        notify(
          'success',
          `${offTarget.name} — ${days} ${lang === 'ku' ? 'ڕۆژ مۆڵەت' : lang === 'ar' ? 'يوم إجازة' : 'day(s) off'}${
            ded > 0 ? ` (-${fmtIqd(ded, lang)})` : ''
          } ✓`
        );
        setOffTarget(null);
        await onRefresh();
        await reloadMonth(selectedMonth);
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOffDays = async (leaveId: string) => {
    if (!window.confirm(lang === 'ku' ? 'دڵنیایت لە سڕینەوەی ئەم تۆمارە؟' : lang === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Delete this off-day record?')) return;
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteOffDays', leaveId }),
      });
      if (res.ok) {
        notify('success', '✓');
        await onRefresh();
        await reloadMonth(selectedMonth);
      }
    } catch {}
  };

  const openAddEmployee = () => {
    setEditingEmpId(null);
    setEmpName('');
    setEmpPhone('');
    setEmpPosition('');
    setEmpSalary('');
    setEmpStartDate(todayDateStr());
    setEmpStatus('ACTIVE');
    setEmpNotes('');
    setShowEmpModal(true);
  };

  const openEditEmployee = (emp: any) => {
    setEditingEmpId(emp.id);
    setEmpName(emp.name);
    setEmpPhone(emp.phone || '');
    setEmpPosition(emp.position || '');
    setEmpSalary(String(emp.monthlySalaryIqd || ''));
    setEmpStartDate(emp.startDate || todayDateStr());
    setEmpStatus(emp.status || 'ACTIVE');
    setEmpNotes(emp.notes || '');
    setShowEmpModal(true);
  };

  const openPaySalary = (emp: any) => {
    setPayTarget(emp);
    setPayIdemKey(makeIdempotencyKey('sal'));
    setDupWarning(null);
    setPayDate(todayDateStr());
    setPayNotes('');
    setPayOffDays('0');
    setPayHasDeduction(false);
    setPayDeductionIqd('');
    const rem = Number(emp.remainingSalaryIqd || 0);
    if (rem > 0) {
      setPayAmount(String(rem));
      setPayType('FULL');
    } else {
      setPayAmount('');
      setPayType('ADVANCE');
    }
  };

  const recalcPayModalDeduction = (emp: any, daysVal: string, deductOn: boolean, customDed?: string) => {
    const days = Math.max(0, Number(daysVal || 0));
    const monthly = Number(emp?.monthlySalaryIqd || 0);
    const baseRem = Number(emp?.remainingSalaryIqd || monthly || 0);
    let ded = 0;
    if (deductOn && days > 0) {
      if (customDed !== undefined) {
        ded = Math.max(0, Math.round(Number(customDed || 0)));
      } else {
        ded = monthly > 0 ? Math.round((monthly / 30) * days) : 0;
        setPayDeductionIqd(ded > 0 ? String(ded) : '');
      }
    }
    if (payType === 'FULL' && baseRem > 0) {
      setPayAmount(String(Math.max(0, baseRem - ded)));
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empPhone.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingEmpId
            ? {
                action: 'updateEmployee',
                employeeId: editingEmpId,
                name: empName.trim(),
                phone: empPhone.trim(),
                position: empPosition.trim() || null,
                monthlySalaryIqd: Number(empSalary || 0),
                startDate: empStartDate || null,
                status: empStatus,
                notes: empNotes.trim() || null,
              }
            : {
                action: 'createEmployee',
                name: empName.trim(),
                phone: empPhone.trim(),
                position: empPosition.trim() || null,
                monthlySalaryIqd: Number(empSalary || 0),
                startDate: empStartDate || null,
                status: empStatus,
                notes: empNotes.trim() || null,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Could not save employee');
      else {
        notify('success', `${data.employee.name} ✓`);
        setShowEmpModal(false);
        await onRefresh();
        if (selectedMonth !== currentMonthStr()) await reloadMonth(selectedMonth);
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaySalary = async (confirmDuplicate = false) => {
    if (!payTarget || Number(payAmount) <= 0) return;
    setSubmitting(true);
    try {
      const offDaysNum = Math.max(0, Number(payOffDays || 0));
      const dedNum = payHasDeduction && offDaysNum > 0 ? Math.max(0, Math.round(Number(payDeductionIqd || 0))) : 0;
      if (offDaysNum > 0 && !confirmDuplicate) {
        await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recordOffDays',
            employeeId: payTarget.id,
            salaryMonth: selectedMonth,
            date: payDate,
            days: offDaysNum,
            hasDeduction: payHasDeduction && dedNum > 0,
            deductionIqd: dedNum,
            reason: payNotes.trim() || undefined,
          }),
        });
      }

      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'paySalary',
          employeeId: payTarget.id,
          amountIqd: Number(payAmount),
          paymentType: payType,
          salaryMonth: selectedMonth,
          date: payDate,
          notes:
            offDaysNum > 0
              ? `${payNotes.trim() ? payNotes.trim() + ' — ' : ''}${offDaysNum} ${lang === 'ku' ? 'ڕۆژ مۆڵەت' : lang === 'ar' ? 'يوم إجازة' : 'day(s) off'}${dedNum > 0 ? ` (-${fmtIqd(dedNum, lang)})` : ''}`
              : (payNotes.trim() || undefined),
          financialAccountId: financialAccounts[0]?.id,
          idempotencyKey: payIdemKey,
          confirmDuplicate,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'POSSIBLE_DUPLICATE') {
        setDupWarning(data.error);
        return;
      }
      if (!res.ok) notify('error', data.error || 'Salary payment failed');
      else {
        notify('success', `${data.salaryPayment.receiptNumber} — ${fmtIqd(data.salaryPayment.amountIqd, lang)} ✓`);
        setPayTarget(null);
        setDupWarning(null);
        onPrint({ type: 'SALARY_RECEIPT', mode: 'A4', data: data.salaryPayment });
        await onRefresh();
        if (selectedMonth !== currentMonthStr()) await reloadMonth(selectedMonth);
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEmployee = async (emp: any) => {
    if (!window.confirm(`${t.delete} ${emp.name}?`)) return;
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteEmployee', employeeId: emp.id }),
      });
      const d = await res.json();
      if (res.ok) {
        notify('success', `${emp.name} ✓`);
        await onRefresh();
        if (selectedMonth !== currentMonthStr()) await reloadMonth(selectedMonth);
      } else {
        notify('error', d.error || 'Cannot delete employee');
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e: any) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.phone || '').toLowerCase().includes(q) ||
        (e.position || '').toLowerCase().includes(q) ||
        (e.code || '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  const filteredHistory = useMemo(() => {
    return salaryPayments.filter((sp: any) =>
      historyEmpFilter === 'ALL' ? true : sp.employeeId === historyEmpFilter
    );
  }, [salaryPayments, historyEmpFilter]);

  const isAdmin = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'BUSINESS_OWNER';
  const users = settingsData?.users || [];
  const rolePermissions = settingsData?.rolePermissions || [];
  const activeRoleRecord = rolePermissions.find((rp: any) => rp.role === selectedRoleMatrix);
  const currentRolePerms: string[] = activeRoleRecord?.permissions || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Users className="w-6 h-6 text-emerald-500" />
            {t.employees.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.employees.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <CustomMonthPicker
            value={selectedMonth}
            onChange={(val) => reloadMonth(val)}
            lang={lang}
            className="w-44"
          />
          <button
            onClick={openAddEmployee}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/25 transition"
          >
            <UserPlus className="w-4 h-4" />
            {t.employees.addEmployee}
          </button>
        </div>
      </div>

      {/* Monthly Payroll KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.employees.directoryTab}</div>
          <div className="text-2xl font-black mt-1">{summary.activeEmployees}</div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.employees.totalMonthlyPayroll}</div>
          <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
            {fmtIqd(summary.totalPayrollIqd, lang)}
          </div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.employees.paidThisMonth} ({selectedMonth})</div>
          <div className="text-xl font-black text-emerald-500 mt-1">
            {fmtIqd(summary.totalPaidIqd, lang)}
          </div>
        </div>
        <div className="bg-white dark:bg-charcoal-900 p-4 rounded-2xl border border-slate-200 dark:border-charcoal-800">
          <div className="text-xs text-slate-400">{t.employees.remainingThisMonth}</div>
          <div className="text-xl font-black text-amber-500 mt-1">
            {fmtIqd(summary.totalRemainingIqd, lang)}
          </div>
        </div>
      </div>

      {/* Tabs Card */}
      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setTab('EMPLOYEES')}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${
                tab === 'EMPLOYEES' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              {t.employees.directoryTab} ({employees.length})
            </button>
            <button
              onClick={() => setTab('OFF_DAYS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                tab === 'OFF_DAYS' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              <CalendarOff className="w-3.5 h-3.5" />
              {lang === 'ku' ? 'مۆڵەت و نەهاتن' : lang === 'ar' ? 'الإجازات والغياب' : 'Off Days'} ({monthLeaves.length})
            </button>
            <button
              onClick={() => setTab('HISTORY')}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${
                tab === 'HISTORY' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
              }`}
            >
              {t.employees.historyTab} ({salaryPayments.length})
            </button>
            {isAdmin && (
              <button
                onClick={() => setTab('SYSTEM_USERS')}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                  tab === 'SYSTEM_USERS' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                {t.employees.systemUsersTab}
              </button>
            )}
          </div>

          {tab === 'EMPLOYEES' && (
            <div className="relative w-64">
              <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
          )}

          {tab === 'HISTORY' && (
            <select
              value={historyEmpFilter}
              onChange={(e) => setHistoryEmpFilter(e.target.value)}
              className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-semibold"
            >
              <option value="ALL">{t.all}</option>
              {employees.map((e: any) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* 1. EMPLOYEE DIRECTORY */}
        {tab === 'EMPLOYEES' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">{t.employees.name}</th>
                  <th className="py-3 px-4 text-start">{t.employees.phone}</th>
                  <th className="py-3 px-4 text-end">{t.employees.monthlySalary}</th>
                  <th className="py-3 px-4 text-end">{t.employees.paidThisMonth}</th>
                  <th className="py-3 px-4 text-end">{t.employees.remainingThisMonth}</th>
                  <th className="py-3 px-4 text-center">{t.status}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredEmployees.map((emp: any) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{emp.name}</div>
                      {emp.position && (
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Briefcase className="w-3 h-3" /> {emp.position}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-emerald-500" /> {emp.phone}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end font-semibold">
                      <div>{Number(emp.monthlySalaryIqd) > 0 ? fmtIqd(emp.monthlySalaryIqd, lang) : '—'}</div>
                      {(Number(emp.offDaysThisMonth || 0) > 0 || Number(emp.deductionsThisMonthIqd || 0) > 0) && (
                        <div className="text-[11px] font-bold text-rose-500 mt-0.5">
                          {emp.offDaysThisMonth}{' '}
                          {lang === 'ku' ? 'ڕۆژ مۆڵەت' : lang === 'ar' ? 'يوم إجازة' : 'off'}
                          {Number(emp.deductionsThisMonthIqd || 0) > 0
                            ? ` (-${fmtIqd(emp.deductionsThisMonthIqd, lang)})`
                            : ` (${lang === 'ku' ? 'بێ لێبڕین' : lang === 'ar' ? 'بدون خصم' : 'no deduction'})`}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-end font-bold text-emerald-500">
                      {fmtIqd(emp.paidThisMonthIqd, lang)}
                    </td>
                    <td className="py-3 px-4 text-end font-black text-amber-500">
                      {Number(emp.monthlySalaryIqd) > 0 ? fmtIqd(emp.remainingSalaryIqd, lang) : '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          emp.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : emp.status === 'ON_LEAVE'
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-slate-200 dark:bg-charcoal-800 text-slate-500'
                        }`}
                      >
                        {(t.statuses as Record<string, string>)[emp.status] || emp.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openPaySalary(emp)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-sm"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          {t.employees.paySalary}
                        </button>
                        <button
                          onClick={() => openOffDaysModal(emp)}
                          title={lang === 'ku' ? 'تۆمارکردنی مۆڵەت / نەهاتن' : lang === 'ar' ? 'تسجيل إجازة / غياب' : 'Record Off Days'}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 text-xs font-bold"
                        >
                          <CalendarOff className="w-3.5 h-3.5" />
                          {lang === 'ku' ? 'مۆڵەت' : lang === 'ar' ? 'إجازة' : 'Off Day'}
                        </button>
                        <button
                          onClick={() => openEditEmployee(emp)}
                          className="p-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:text-emerald-500"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp)}
                          className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 1B. OFF DAYS & DEDUCTIONS LOG */}
        {tab === 'OFF_DAYS' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.employees.name}</th>
                  <th className="py-3 px-4 text-center">{lang === 'ku' ? 'ژمارەی ڕۆژ' : lang === 'ar' ? 'عدد الأيام' : 'Off Days'}</th>
                  <th className="py-3 px-4 text-end">{lang === 'ku' ? 'لێبڕین (د.ع)' : lang === 'ar' ? 'الخصم (د.ع)' : 'Deduction'}</th>
                  <th className="py-3 px-4 text-start">{t.notes}</th>
                  <th className="py-3 px-4 text-center">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {monthLeaves.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      {lang === 'ku' ? 'هیچ مۆڵەتێک بۆ ئەم مانگە تۆمار نەکراوە' : lang === 'ar' ? 'لا توجد إجازات مسجلة لهذا الشهر' : 'No off days recorded for this month'}
                    </td>
                  </tr>
                ) : (
                  monthLeaves.map((lv: any) => (
                    <tr key={lv.id}>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500">{lv.date}</td>
                      <td className="py-3 px-4 font-bold">{lv.employeeName}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-500 text-xs font-black">
                          {lv.days} {lang === 'ku' ? 'ڕۆژ' : lang === 'ar' ? 'يوم' : 'day(s)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-black">
                        {lv.hasDeduction && Number(lv.deductionIqd) > 0 ? (
                          <span className="text-rose-500">-{fmtIqd(lv.deductionIqd, lang)}</span>
                        ) : (
                          <span className="text-emerald-500 text-xs font-bold">
                            {lang === 'ku' ? 'بێ لێبڕین' : lang === 'ar' ? 'بدون خصم' : 'No Deduction'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400">{lv.reason || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDeleteOffDays(lv.id)}
                          className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. SALARY PAYMENT HISTORY */}
        {tab === 'HISTORY' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500 text-xs">
                <tr>
                  <th className="py-3 px-4 text-start">#</th>
                  <th className="py-3 px-4 text-start">{t.date}</th>
                  <th className="py-3 px-4 text-start">{t.employees.name}</th>
                  <th className="py-3 px-4 text-center">{t.expenses.salaryMonth}</th>
                  <th className="py-3 px-4 text-center">{t.status}</th>
                  <th className="py-3 px-4 text-end">{t.amount}</th>
                  <th className="py-3 px-4 text-end">{t.expenses.remainingBalance}</th>
                  <th className="py-3 px-4 text-center">{t.print}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">{t.noData}</td>
                  </tr>
                ) : (
                  filteredHistory.map((sp: any) => (
                    <tr key={sp.id}>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-teal-500">{sp.receiptNumber}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{new Date(sp.date).toLocaleDateString()}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold">{sp.employeeName}</div>
                        <div className="text-xs font-mono text-slate-400">{sp.employeePhone}</div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs font-bold">{sp.salaryMonth}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-500 text-[11px] font-bold">
                          {sp.paymentType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-black text-emerald-500">{fmtIqd(sp.amountIqd, lang)}</td>
                      <td className="py-3 px-4 text-end text-xs font-bold text-amber-500">
                        {fmtIqd(sp.remainingAfterIqd, lang)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => onPrint({ type: 'SALARY_RECEIPT', mode: 'A4', data: sp })}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {t.print}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. ADMIN SYSTEM LOGIN USERS & RBAC (PRESERVED!) */}
        {tab === 'SYSTEM_USERS' && isAdmin && (
          <div className="p-5 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold">System Login Accounts ({users.length})</h3>
              <button
                onClick={() => setShowNewUser(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
              >
                + Add Login User
              </button>
            </div>
            <div className="overflow-x-auto border border-slate-200 dark:border-charcoal-800 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4 text-start">Name</th>
                    <th className="py-2.5 px-4 text-start">Username / Email</th>
                    <th className="py-2.5 px-4 text-center">Role</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                  {users.map((u: any) => (
                    <tr key={u.id}>
                      <td className="py-2.5 px-4 font-bold">{u.name}</td>
                      <td className="py-2.5 px-4 text-slate-500">@{u.username} • {u.email}</td>
                      <td className="py-2.5 px-4 text-center font-mono font-bold text-emerald-500">{u.role}</td>
                      <td className="py-2.5 px-4 text-center">
                        {u.role !== 'SUPER_ADMIN' ? (
                          <button
                            onClick={async () => {
                              await fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'toggleUserActive', userId: u.id, isActive: !u.isActive }),
                              });
                              await onRefresh();
                            }}
                            className={`px-2.5 py-1 rounded-lg font-bold ${
                              u.isActive ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                            }`}
                          >
                            {u.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </button>
                        ) : (
                          <span className="text-emerald-500 font-bold">ACTIVE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold">Role Permissions Matrix</h4>
                <div className="flex flex-wrap gap-1.5">
                  {['ACCOUNTANT', 'SALES_EMPLOYEE', 'INVENTORY_MANAGER', 'VIEWER'].map((r) => (
                    <button
                      key={r}
                      onClick={() => setSelectedRoleMatrix(r)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold ${
                        selectedRoleMatrix === r ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ALL_PERMISSIONS.map((perm) => {
                  const enabled = currentRolePerms.includes(perm);
                  return (
                    <button
                      key={perm}
                      type="button"
                      onClick={async () => {
                        const updated = enabled
                          ? currentRolePerms.filter((p) => p !== perm)
                          : [...currentRolePerms, perm];
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'updateRolePermissions', role: selectedRoleMatrix, permissions: updated }),
                        });
                        await onRefresh();
                      }}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-xl border text-[11px] font-mono ${
                        enabled
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500 font-bold'
                          : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800 text-slate-400'
                      }`}
                    >
                      <span className="truncate">{perm}</span>
                      {enabled && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {showEmpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form onSubmit={handleSaveEmployee} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-black">
              {editingEmpId ? t.employees.editEmployee : t.employees.addEmployee}
            </h3>
            <div>
              <label className="block text-xs font-bold mb-1">{t.employees.name} *</label>
              <input type="text" required value={empName} onChange={(e) => setEmpName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-semibold" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">{t.employees.phone} *</label>
              <input type="text" required value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} placeholder="0750XXXXXXX" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.employees.position}</label>
                <input type="text" value={empPosition} onChange={(e) => setEmpPosition(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.employees.monthlySalary}</label>
                <input type="number" min="0" step="any" value={empSalary} onChange={(e) => setEmpSalary(e.target.value)} placeholder="750000" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold text-emerald-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.employees.startDate}</label>
                <CustomDatePicker value={empStartDate} onChange={setEmpStartDate} lang={lang} />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.status}</label>
                <select value={empStatus} onChange={(e) => setEmpStatus(e.target.value as any)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                  <option value="ACTIVE">{t.statuses.ACTIVE}</option>
                  <option value="ON_LEAVE">{t.statuses.ON_LEAVE}</option>
                  <option value="INACTIVE">{t.statuses.INACTIVE}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowEmpModal(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* QUICK PAY SALARY MODAL */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handlePaySalary(false);
            }}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-black flex items-center gap-2 text-teal-500">
              <Banknote className="w-5 h-5" />
              {t.employees.paySalary}
            </h3>

            <div className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/25 space-y-1 text-xs">
              <div className="text-base font-black text-slate-900 dark:text-white">{payTarget.name}</div>
              <div className="font-mono text-slate-500">{payTarget.phone} • {selectedMonth}</div>
              {Number(payTarget.monthlySalaryIqd) > 0 && (
                <div className="pt-2 border-t border-teal-500/20 space-y-1 font-bold">
                  <div className="flex justify-between text-slate-400">
                    <span>{t.employees.monthlySalary}:</span>
                    <span>{fmtIqd(payTarget.monthlySalaryIqd, lang)}</span>
                  </div>
                  {Number(payTarget.deductionsThisMonthIqd || 0) > 0 && (
                    <div className="flex justify-between text-rose-500">
                      <span>
                        {lang === 'ku' ? 'لێبڕینی مۆڵەت' : lang === 'ar' ? 'خصم الإجازات' : 'Off-Day Deduction'} ({payTarget.offDaysThisMonth}):
                      </span>
                      <span>-{fmtIqd(payTarget.deductionsThisMonthIqd, lang)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>{t.expenses.remainingBalance}:</span>
                    <span className="text-amber-500 font-black">{fmtIqd(payTarget.remainingSalaryIqd, lang)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(['FULL', 'PARTIAL', 'ADVANCE'] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => {
                    setPayType(pt);
                    if (pt === 'FULL' && Number(payTarget.remainingSalaryIqd) > 0) {
                      const ded = payHasDeduction && Number(payOffDays || 0) > 0 ? Math.round(Number(payDeductionIqd || 0)) : 0;
                      setPayAmount(String(Math.max(0, Number(payTarget.remainingSalaryIqd) - ded)));
                    }
                  }}
                  className={`py-2 rounded-xl text-xs font-bold ${
                    payType === pt ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-charcoal-800'
                  }`}
                >
                  {pt === 'FULL' ? t.expenses.fullPayment : pt === 'PARTIAL' ? t.expenses.partialPayment : t.expenses.advancePayment}
                </button>
              ))}
            </div>

            {/* Inline Off Days + Optional Deduction inside Pay Salary Modal */}
            <div className={`p-3 rounded-xl border space-y-2.5 ${
              Number(payOffDays || 0) > 0 && payHasDeduction
                ? 'bg-rose-500/10 border-rose-500/40'
                : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
            }`}>
              <div className="text-xs font-black text-amber-500 flex items-center gap-1.5">
                <CalendarOff className="w-3.5 h-3.5" />
                {lang === 'ku' ? 'ڕۆژانی مۆڵەت / نەهاتن (ئارەزوومەندانە)' : lang === 'ar' ? 'أيام الإجازة / الغياب (اختياري)' : 'Off Days (Optional)'}
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(0, Number(payOffDays || 0) - 1);
                      setPayOffDays(String(next));
                      recalcPayModalDeduction(payTarget, String(next), payHasDeduction);
                    }}
                    className="w-8 h-9 rounded-xl bg-slate-200 dark:bg-charcoal-800 flex items-center justify-center"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={payOffDays}
                    onChange={(e) => {
                      setPayOffDays(e.target.value);
                      recalcPayModalDeduction(payTarget, e.target.value, payHasDeduction);
                    }}
                    className="w-full py-1.5 text-center rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-sm font-black"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = Number(payOffDays || 0) + 1;
                      setPayOffDays(String(next));
                      recalcPayModalDeduction(payTarget, String(next), payHasDeduction);
                    }}
                    className="w-8 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !payHasDeduction;
                    setPayHasDeduction(next);
                    const days = Number(payOffDays || 0) > 0 ? payOffDays : '1';
                    if (next && Number(payOffDays || 0) <= 0) setPayOffDays('1');
                    recalcPayModalDeduction(payTarget, days, next);
                  }}
                  className={`py-2 px-2.5 rounded-xl text-[11px] font-black border transition ${
                    payHasDeduction
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-700 text-slate-500 dark:text-slate-300'
                  }`}
                >
                  {payHasDeduction
                    ? (lang === 'ku' ? 'بە لێبڕین ✓' : lang === 'ar' ? 'مع خصم ✓' : 'Deduct ON ✓')
                    : (lang === 'ku' ? 'لێبڕین (ئارەزوومەندانە)' : lang === 'ar' ? 'خصم (اختياري)' : 'Deduct (Optional)')}
                </button>
              </div>
              {payHasDeduction && (
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder={lang === 'ku' ? 'بڕی لێبڕین (د.ع)' : lang === 'ar' ? 'مبلغ الخصم (د.ع)' : 'Deduction IQD'}
                  value={payDeductionIqd}
                  onChange={(e) => {
                    setPayDeductionIqd(e.target.value);
                    recalcPayModalDeduction(payTarget, payOffDays, true, e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-rose-500/40 text-sm font-black text-rose-500"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">{t.amount} *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={payAmount}
                  onChange={(e) => {
                    setPayAmount(e.target.value);
                    setDupWarning(null);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t.date}</label>
                <CustomDatePicker value={payDate} onChange={setPayDate} lang={lang} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">{t.notes}</label>
              <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
            </div>

            {dupWarning && (
              <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-xs space-y-2">
                <div className="font-bold text-amber-500 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {dupWarning}
                </div>
                <button type="button" onClick={() => handlePaySalary(true)} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold">
                  {t.confirm}
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayTarget(null)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* RECORD OFF DAYS & OPTIONAL SALARY DEDUCTION MODAL */}
      {offTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSaveOffDays}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-black flex items-center gap-2 text-amber-500">
              <CalendarOff className="w-5 h-5" />
              {lang === 'ku' ? 'تۆمارکردنی مۆڵەت و ڕۆژی نەهاتن' : lang === 'ar' ? 'تسجيل إجازة / أيام الغياب' : 'Record Employee Off Days'}
            </h3>

            {/* Employee Salary Summary */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1 text-xs">
              <div className="text-base font-black text-slate-900 dark:text-white">{offTarget.name}</div>
              <div className="flex justify-between text-slate-500 pt-1">
                <span>{t.employees.monthlySalary}:</span>
                <span className="font-black text-slate-800 dark:text-white">
                  {fmtIqd(offTarget.monthlySalaryIqd || 0, lang)}
                </span>
              </div>
              {Number(offTarget.monthlySalaryIqd || 0) > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>{lang === 'ku' ? 'نرخی یەک ڕۆژ (مووچە ÷ ٣٠):' : lang === 'ar' ? 'أجر اليوم الواحد:' : 'Daily Rate (Salary ÷ 30):'}</span>
                  <span className="font-bold text-amber-500">
                    {fmtIqd(Math.round(Number(offTarget.monthlySalaryIqd) / 30), lang)}
                  </span>
                </div>
              )}
            </div>

            {/* Days Count & Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1.5">
                  {lang === 'ku' ? 'ژمارەی ڕۆژانی مۆڵەت *' : lang === 'ar' ? 'عدد أيام الإجازة *' : 'Number of Off Days *'}
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(0.5, Number(offDaysCount || 1) - 1);
                      setOffDaysCount(String(next));
                      if (offHasDeduction && Number(offTarget.monthlySalaryIqd) > 0) {
                        setOffDeductionIqd(String(Math.round((Number(offTarget.monthlySalaryIqd) / 30) * next)));
                      }
                    }}
                    className="w-9 h-10 rounded-xl bg-slate-100 dark:bg-charcoal-800 flex items-center justify-center font-black"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    required
                    value={offDaysCount}
                    onChange={(e) => {
                      setOffDaysCount(e.target.value);
                      const d = Number(e.target.value || 0);
                      if (offHasDeduction && d > 0 && Number(offTarget.monthlySalaryIqd) > 0) {
                        setOffDeductionIqd(String(Math.round((Number(offTarget.monthlySalaryIqd) / 30) * d)));
                      }
                    }}
                    className="w-full py-2 text-center rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = Number(offDaysCount || 0) + 1;
                      setOffDaysCount(String(next));
                      if (offHasDeduction && Number(offTarget.monthlySalaryIqd) > 0) {
                        setOffDeductionIqd(String(Math.round((Number(offTarget.monthlySalaryIqd) / 30) * next)));
                      }
                    }}
                    className="w-9 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center font-black"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5">{t.date}</label>
                <CustomDatePicker value={offDate} onChange={setOffDate} lang={lang} />
              </div>
            </div>

            {/* OPTIONAL SALARY DEDUCTION TOGGLE BOX */}
            <div className={`p-4 rounded-2xl border transition space-y-3 ${
              offHasDeduction
                ? 'bg-rose-500/10 border-rose-500/40'
                : 'bg-slate-50 dark:bg-charcoal-950 border-slate-200 dark:border-charcoal-800'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black text-slate-900 dark:text-white">
                    {lang === 'ku'
                      ? 'لێبڕین لە مووچە (ئارەزوومەندانە)'
                      : lang === 'ar'
                      ? 'خصم من الراتب (اختياري)'
                      : 'Deduct from Salary (Optional)'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {offHasDeduction
                      ? (lang === 'ku' ? 'ئەم بڕە لە مووچەی ئەم مانگەی کەم دەکرێتەوە' : lang === 'ar' ? 'سيتم خصم هذا المبلغ من راتب هذا الشهر' : 'This amount will be deducted from monthly salary')
                      : (lang === 'ku' ? 'بێ لێبڕین — مووچەکەی کەم ناکاتەوە' : lang === 'ar' ? 'بدون خصم — يحصل على راتبه كاملاً' : 'No deduction — employee keeps full salary')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !offHasDeduction;
                    setOffHasDeduction(next);
                    if (next && Number(offTarget.monthlySalaryIqd) > 0) {
                      const suggested = Math.round((Number(offTarget.monthlySalaryIqd) / 30) * Number(offDaysCount || 1));
                      setOffDeductionIqd(String(suggested));
                    }
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition shrink-0 ${
                    offHasDeduction
                      ? 'bg-rose-600 text-white shadow'
                      : 'bg-slate-200 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {offHasDeduction
                    ? (lang === 'ku' ? 'بە لێبڕین ✓' : lang === 'ar' ? 'مع خصم ✓' : 'Deduct ON')
                    : (lang === 'ku' ? 'بێ لێبڕین' : lang === 'ar' ? 'بدون خصم' : 'Deduct OFF')}
                </button>
              </div>

              {offHasDeduction && (
                <div className="space-y-2 pt-2 border-t border-rose-500/20">
                  <label className="block text-xs font-bold text-rose-500">
                    {lang === 'ku' ? 'بڕی لێبڕین (د.ع):' : lang === 'ar' ? 'مبلغ الخصم (د.ع):' : 'Deduction Amount (IQD):'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="20000"
                    value={offDeductionIqd}
                    onChange={(e) => setOffDeductionIqd(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-charcoal-900 border border-rose-500/40 text-base font-black text-rose-500"
                  />
                  {Number(offTarget.remainingSalaryIqd || 0) > 0 && (
                    <div className="flex justify-between text-xs font-bold pt-1">
                      <span className="text-slate-400">
                        {lang === 'ku' ? 'مووچەی ماوە دوای لێبڕین:' : lang === 'ar' ? 'المتبقي بعد الخصم:' : 'Remaining After Deduction:'}
                      </span>
                      <span className="text-emerald-500 font-black">
                        {fmtIqd(Math.max(0, Number(offTarget.remainingSalaryIqd) - Math.round(Number(offDeductionIqd || 0))), lang)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                {lang === 'ku' ? 'هۆکار / تێبینی (ئارەزوومەندانە)' : lang === 'ar' ? 'السبب / ملاحظة (اختياري)' : 'Reason / Notes (Optional)'}
              </label>
              <input
                type="text"
                value={offReason}
                onChange={(e) => setOffReason(e.target.value)}
                placeholder={lang === 'ku' ? 'نموونە: نەخۆشی، مۆڵەتی کەسی...' : lang === 'ar' ? 'مثال: مرض، إجازة خاصة...' : 'e.g. Personal leave, sick day...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOffTarget(null)} className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-sm font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-black shadow-lg shadow-amber-600/20">
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* NEW SYSTEM USER MODAL (ADMIN) */}
      {showNewUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                const res = await fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'createUser', name: uName, username: uUsername, email: uEmail, role: uRole }),
                });
                if (res.ok) {
                  setShowNewUser(false);
                  setUName('');
                  setUUsername('');
                  setUEmail('');
                  await onRefresh();
                }
              } finally {
                setSubmitting(false);
              }
            }}
            className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-3"
          >
            <h3 className="text-base font-bold">Add System Login User</h3>
            <input type="text" required placeholder="Full Name" value={uName} onChange={(e) => setUName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            <input type="text" required placeholder="Username" value={uUsername} onChange={(e) => setUUsername(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            <input type="email" required placeholder="Email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
            <select value={uRole} onChange={(e) => setURole(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs">
              <option value="BUSINESS_OWNER">BUSINESS_OWNER</option>
              <option value="ACCOUNTANT">ACCOUNTANT</option>
              <option value="SALES_EMPLOYEE">SALES_EMPLOYEE</option>
              <option value="INVENTORY_MANAGER">INVENTORY_MANAGER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewUser(false)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
