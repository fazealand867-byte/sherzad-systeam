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
  History,
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
  const [tab, setTab] = useState<'EMPLOYEES' | 'HISTORY' | 'SYSTEM_USERS'>('EMPLOYEES');
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
  const summary = monthData?.summary || {
    activeEmployees: 0,
    totalPayrollIqd: 0,
    totalPaidIqd: 0,
    totalRemainingIqd: 0,
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
    const rem = Number(emp.remainingSalaryIqd || 0);
    if (rem > 0) {
      setPayAmount(String(rem));
      setPayType('FULL');
    } else {
      setPayAmount('');
      setPayType('ADVANCE');
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
          notes: payNotes.trim() || undefined,
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
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => reloadMonth(e.target.value)}
            className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-mono font-bold"
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
                      {Number(emp.monthlySalaryIqd) > 0 ? fmtIqd(emp.monthlySalaryIqd, lang) : '—'}
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
                <input type="date" value={empStartDate} onChange={(e) => setEmpStartDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
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
                <div className="flex justify-between pt-2 border-t border-teal-500/20 font-bold">
                  <span>{t.expenses.remainingBalance}:</span>
                  <span className="text-amber-500">{fmtIqd(payTarget.remainingSalaryIqd, lang)}</span>
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
                      setPayAmount(String(payTarget.remainingSalaryIqd));
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
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
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
