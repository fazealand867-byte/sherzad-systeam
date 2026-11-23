'use client';

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Landmark,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  BookOpen,
  RotateCcw,
  Lock,
  Unlock,
  Download,
  ShieldCheck,
  XCircle,
  Wallet,
  Search,
  Trash2,
} from 'lucide-react';
import { LanguageCode, translations } from '@/lib/i18n';
import { exportToCsv, fmtIqd, locName } from '@/lib/client-utils';

/* ============================================================================
   1. CLEAN & SIMPLE CASH & BANK MANAGEMENT (IQD-ONLY)
   ============================================================================ */

export function CashBankModuleView({
  lang,
  cashBankData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  cashBankData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const accounts = cashBankData?.accounts || [];
  const transactions = cashBankData?.transactions || [];
  const [modal, setModal] = useState<null | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'RECONCILE' | 'NEW_ACCOUNT'>(null);
  const [selectedAccFilter, setSelectedAccFilter] = useState<string>('ALL');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [txSearch, setTxSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [primaryAccId, setPrimaryAccId] = useState(accounts[0]?.id || '');
  const [targetAccId, setTargetAccId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [amountIqd, setAmountIqd] = useState('');
  const [description, setDescription] = useState('');
  const [postAdj, setPostAdj] = useState(true);

  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('CASH_REGISTER');
  const [newAccBankName, setNewAccBankName] = useState('');

  const modalTitle = (m: typeof modal) => {
    if (m === 'DEPOSIT') return lang === 'ku' ? 'زیادکردنی پارە بۆ قاسە / بانک' : lang === 'ar' ? 'إيداع مبلغ' : 'Deposit Money';
    if (m === 'WITHDRAWAL') return lang === 'ku' ? 'ڕاکێشانی پارە لە قاسە / بانک' : lang === 'ar' ? 'سحب مبلغ' : 'Withdraw Money';
    if (m === 'TRANSFER') return lang === 'ku' ? 'گواستنەوەی پارە لە نێوان هەژمارەکان' : lang === 'ar' ? 'تحويل بين الحسابات' : 'Transfer Between Accounts';
    if (m === 'RECONCILE') return lang === 'ku' ? 'ڕێکخستنی باڵانسی قاسە / بانک' : lang === 'ar' ? 'مطابقة الرصيد' : 'Reconcile Balance';
    if (m === 'NEW_ACCOUNT') return lang === 'ku' ? 'زیادکردنی قاسە یان بانکی نوێ' : lang === 'ar' ? 'إضافة صندوق أو حساب بنكي' : 'Add Cash Safe / Bank Account';
    return '';
  };

  const totalLiquidIqd = useMemo(
    () => accounts.reduce((sum: number, a: any) => sum + Number(a.balanceIqd || 0), 0),
    [accounts]
  );

  const filteredTransactions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transactions.filter((tx: any) => {
      if (selectedAccFilter !== 'ALL' && tx.financialAccountId !== selectedAccFilter) return false;
      if (dirFilter !== 'ALL' && tx.direction !== dirFilter) return false;
      if (!q) return true;
      return (
        (tx.transactionNumber || '').toLowerCase().includes(q) ||
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.financialAccount ? locName(tx.financialAccount, lang) : '').toLowerCase().includes(q)
      );
    });
  }, [transactions, selectedAccFilter, dirFilter, txSearch, lang]);

  const openModal = (m: NonNullable<typeof modal>) => {
    setPrimaryAccId(accounts[0]?.id || '');
    setTargetAccId(accounts[1]?.id || accounts[0]?.id || '');
    setAmountIqd('');
    setDescription('');
    setNewAccName('');
    setNewAccBankName('');
    setModal(m);
  };

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modal === 'TRANSFER' && primaryAccId === targetAccId) {
      notify('error', lang === 'ku' ? 'تکایە دوو هەژماری جیاواز هەڵبژێرە' : lang === 'ar' ? 'اختر حسابين مختلفين' : 'Select two different accounts');
      return;
    }
    setSubmitting(true);
    try {
      let payload: any = {};
      if (modal === 'DEPOSIT' || modal === 'WITHDRAWAL') {
        payload = {
          action: modal === 'DEPOSIT' ? 'deposit' : 'withdrawal',
          financialAccountId: primaryAccId || accounts[0]?.id,
          amountIqd: Number(amountIqd),
          description,
        };
      } else if (modal === 'TRANSFER') {
        payload = {
          action: 'transfer',
          fromFinancialAccountId: primaryAccId,
          toFinancialAccountId: targetAccId,
          amountIqd: Number(amountIqd),
          description,
        };
      } else if (modal === 'RECONCILE') {
        payload = {
          action: 'reconcile',
          financialAccountId: primaryAccId,
          statementBalanceIqd: Number(amountIqd),
          postAdjustment: postAdj,
          notes: description,
        };
      } else if (modal === 'NEW_ACCOUNT') {
        payload = {
          action: 'createAccount',
          nameKu: newAccName.trim(),
          nameAr: newAccName.trim(),
          nameEn: newAccName.trim(),
          type: newAccType,
          bankName: newAccBankName.trim(),
        };
      }

      const res = await fetch('/api/cashbank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Operation failed');
      else {
        notify('success', `${t.nav.cashbank} ✓`);
        setModal(null);
        setAmountIqd('');
        setDescription('');
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <div>
          <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Landmark className="w-6 h-6 text-emerald-500" />
            {t.nav.cashbank}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ku' ? 'کۆی پارەی بەردەست:' : lang === 'ar' ? 'إجمالي النقد المتاح:' : 'Total Liquid Cash:'}{' '}
            <b className="text-emerald-500">{fmtIqd(totalLiquidIqd, lang)}</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => openModal('DEPOSIT')} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow transition">
            <ArrowDownLeft className="w-4 h-4" />
            {lang === 'ku' ? 'زیادکردنی پارە' : lang === 'ar' ? 'إيداع' : 'Deposit'}
          </button>
          <button onClick={() => openModal('WITHDRAWAL')} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow transition">
            <ArrowUpRight className="w-4 h-4" />
            {lang === 'ku' ? 'ڕاکێشانی پارە' : lang === 'ar' ? 'سحب' : 'Withdraw'}
          </button>
          <button onClick={() => openModal('TRANSFER')} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black shadow transition">
            <ArrowLeftRight className="w-4 h-4" />
            {lang === 'ku' ? 'گواستنەوە' : lang === 'ar' ? 'تحويل' : 'Transfer'}
          </button>
          <button onClick={() => openModal('RECONCILE')} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/30 text-xs font-bold">
            <Scale className="w-3.5 h-3.5" />
            {lang === 'ku' ? 'ڕێکخستنی باڵانس' : lang === 'ar' ? 'مطابقة' : 'Reconcile'}
          </button>
          <button
            onClick={() => openModal('NEW_ACCOUNT')}
            className="flex items-center gap-1 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 hover:bg-slate-200 dark:hover:bg-charcoal-700 text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            {lang === 'ku' ? 'هەژماری نوێ' : lang === 'ar' ? 'حساب جديد' : 'New Account'}
          </button>
        </div>
      </div>

      {/* Clickable Account Cards — Click any Safe/Bank to filter its transactions! */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {accounts.map((acc: any) => {
          const isSelected = selectedAccFilter === acc.id;
          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => setSelectedAccFilter(isSelected ? 'ALL' : acc.id)}
              className={`text-start p-5 rounded-2xl border shadow-sm space-y-3 transition ${
                isSelected
                  ? 'bg-emerald-500/10 border-emerald-500/60'
                  : 'bg-white dark:bg-charcoal-900 border-slate-200 dark:border-charcoal-800 hover:border-emerald-500/40'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={`px-2.5 py-0.5 rounded-full font-bold ${acc.type === 'BANK_ACCOUNT' ? 'bg-teal-500/15 text-teal-400' : 'bg-emerald-500/15 text-emerald-500'}`}>
                  {acc.type === 'BANK_ACCOUNT'
                    ? (lang === 'ku' ? 'بانک' : lang === 'ar' ? 'بنك' : 'Bank')
                    : (lang === 'ku' ? 'قاسە' : lang === 'ar' ? 'صندوق' : 'Safe')}
                </span>
                {isSelected && (
                  <span className="text-[11px] font-bold text-emerald-500">
                    {lang === 'ku' ? '✓ هەڵبژێردراو' : lang === 'ar' ? '✓ محدد' : '✓ Selected'}
                  </span>
                )}
              </div>
              <div className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="truncate">{locName(acc, lang)}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-charcoal-800 text-xl font-black text-emerald-500">
                {fmtIqd(acc.balanceIqd, lang)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black">{t.dashboard.recentActivity} ({filteredTransactions.length})</h3>
            <div className="flex items-center gap-1">
              {(['ALL', 'IN', 'OUT'] as const).map((df) => (
                <button
                  key={df}
                  onClick={() => setDirFilter(df)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    dirFilter === df
                      ? df === 'IN'
                        ? 'bg-emerald-600 text-white'
                        : df === 'OUT'
                        ? 'bg-rose-600 text-white'
                        : 'bg-charcoal-900 dark:bg-slate-700 text-white'
                      : 'bg-slate-100 dark:bg-charcoal-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {df === 'ALL'
                    ? t.all
                    : df === 'IN'
                    ? (lang === 'ku' ? 'هاتوو (+)' : lang === 'ar' ? 'وارد (+)' : 'In (+)')
                    : (lang === 'ku' ? 'ڕۆیشتوو (-)' : lang === 'ar' ? 'صادر (-)' : 'Out (-)')}
                </button>
              ))}
            </div>
            {selectedAccFilter !== 'ALL' && (
              <button
                onClick={() => setSelectedAccFilter('ALL')}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-500 text-xs font-bold"
              >
                {lang === 'ku' ? 'پیشاندانی هەموو هەژمارەکان ↺' : lang === 'ar' ? 'عرض كل الحسابات ↺' : 'All Accounts ↺'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52 sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full ps-9 pe-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs"
              />
            </div>
            <button
              onClick={() =>
                exportToCsv(
                  'cash-bank-iqd',
                  ['Tx #', 'Date', 'Account', 'Type', 'Direction', 'Amount IQD', 'Description'],
                  filteredTransactions.map((tx: any) => [
                    tx.transactionNumber,
                    tx.date ? new Date(tx.date).toISOString().slice(0, 10) : '',
                    tx.financialAccount ? locName(tx.financialAccount, lang) : '',
                    tx.type,
                    tx.direction,
                    tx.amountIqd,
                    tx.description,
                  ])
                )
              }
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
              <tr>
                <th className="py-3 px-4 text-start">#</th>
                <th className="py-3 px-4 text-start">{t.date}</th>
                <th className="py-3 px-4 text-start">{t.nav.cashbank}</th>
                <th className="py-3 px-4 text-start">{t.description}</th>
                <th className="py-3 px-4 text-end">{t.amount}</th>
                <th className="py-3 px-4 text-end">{lang === 'ku' ? 'باڵانسی نوێ' : lang === 'ar' ? 'الرصيد بعد' : 'Balance'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">{t.noData}</td>
                </tr>
              ) : (
                filteredTransactions.map((tx: any) => (
                  <tr key={tx.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{tx.transactionNumber}</td>
                    <td className="py-2.5 px-4 text-slate-500">{tx.date ? new Date(tx.date).toLocaleDateString() : '—'}</td>
                    <td className="py-2.5 px-4 font-semibold">{tx.financialAccount ? locName(tx.financialAccount, lang) : '—'}</td>
                    <td className="py-2.5 px-4 text-slate-500">{tx.description}</td>
                    <td className="py-2.5 px-4 text-end">
                      <span
                        dir="ltr"
                        className={`inline-block px-2.5 py-0.5 rounded-full font-black ${
                          tx.direction === 'IN'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {tx.direction === 'IN' ? '+' : '-'}{fmtIqd(tx.amountIqd, lang)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-end font-bold">{fmtIqd(tx.balanceAfterIqd, lang)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto">
          <form onSubmit={handleActionSubmit} className="bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 rounded-2xl p-6 max-w-md w-full space-y-4 my-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">{modalTitle(modal)}</h3>
              <button type="button" onClick={() => setModal(null)} className="p-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-slate-400">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {modal !== 'NEW_ACCOUNT' ? (
              <>
                <div>
                  <label className="block text-xs font-bold mb-1">
                    {modal === 'TRANSFER'
                      ? (lang === 'ku' ? 'لە هەژماری:' : lang === 'ar' ? 'من حساب:' : 'From Account:')
                      : t.nav.cashbank}
                  </label>
                  <select value={primaryAccId} onChange={(e) => setPrimaryAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{locName(a, lang)} ({fmtIqd(a.balanceIqd, lang)})</option>)}
                  </select>
                </div>

                {modal === 'TRANSFER' && (
                  <div>
                    <label className="block text-xs font-bold mb-1">
                      {lang === 'ku' ? 'بۆ هەژماری:' : lang === 'ar' ? 'إلى حساب:' : 'To Account:'}
                    </label>
                    <select value={targetAccId} onChange={(e) => setTargetAccId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                      {accounts.map((a: any) => <option key={a.id} value={a.id}>{locName(a, lang)} ({fmtIqd(a.balanceIqd, lang)})</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold mb-1">
                    {modal === 'RECONCILE'
                      ? (lang === 'ku' ? 'باڵانسی ڕاستەقینەی ئێستا (د.ع) *' : lang === 'ar' ? 'الرصيد الفعلي الحالي (د.ع) *' : 'Actual Balance Now (IQD) *')
                      : `${t.amount} *`}
                  </label>
                  <input type="number" step="any" min="0" required placeholder="0" value={amountIqd} onChange={(e) => setAmountIqd(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-base font-black text-emerald-500" />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">{t.notes}</label>
                  <input type="text" placeholder={lang === 'ku' ? 'تێبینی (ئارەزوومەندانە)...' : 'Notes (optional)...'} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
                </div>

                {modal === 'RECONCILE' && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={postAdj} onChange={(e) => setPostAdj(e.target.checked)} className="rounded text-emerald-600" />
                    <span>{lang === 'ku' ? 'تۆمارکردنی قەیدی ڕێکخستن بە خۆکارانە' : lang === 'ar' ? 'ترحيل قيد التسوية تلقائياً' : 'Auto-post adjustment journal'}</span>
                  </label>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold mb-1">
                    {lang === 'ku' ? 'ناوی قاسە یان بانک *' : lang === 'ar' ? 'اسم الصندوق أو البنك *' : 'Account Name *'}
                  </label>
                  <input type="text" required placeholder={lang === 'ku' ? 'نموونە: قاسەی دوکان، بانکی FIB...' : 'e.g. Main Safe, FIB Bank...'} value={newAccName} onChange={(e) => setNewAccName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{lang === 'ku' ? 'جۆر' : lang === 'ar' ? 'النوع' : 'Type'}</label>
                  <select value={newAccType} onChange={(e) => setNewAccType(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                    <option value="CASH_REGISTER">{lang === 'ku' ? 'قاسەی پارە (نەقد)' : lang === 'ar' ? 'صندوق نقدي' : 'Cash Safe'}</option>
                    <option value="BANK_ACCOUNT">{lang === 'ku' ? 'هەژماری بانکی' : lang === 'ar' ? 'حساب بنكي' : 'Bank Account'}</option>
                  </select>
                </div>
                {newAccType === 'BANK_ACCOUNT' && (
                  <div>
                    <label className="block text-xs font-bold mb-1">{lang === 'ku' ? 'ناوی بانک' : lang === 'ar' ? 'اسم البنك' : 'Bank Name'}</label>
                    <input type="text" placeholder="FIB, FastPay, Cihan Bank..." value={newAccBankName} onChange={(e) => setNewAccBankName(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs" />
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold">{t.cancel}</button>
              <button type="submit" disabled={submitting} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black">{submitting ? t.saving : t.confirm}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. DOUBLE-ENTRY ACCOUNTING ENGINE (ADMIN/ACCOUNTANT — IQD-NATIVE)
   ============================================================================ */

export function AccountingEngineModuleView({
  lang,
  accountingData,
  onRefresh,
  notify,
}: {
  lang: LanguageCode;
  accountingData: any;
  onRefresh: () => Promise<void>;
  notify: (type: 'success' | 'error' | 'warning', msg: string) => void;
}) {
  const t = translations[lang];
  const [tab, setTab] = useState<'JOURNALS' | 'MANUAL_ENTRY' | 'COA' | 'LEDGER' | 'TRIAL_BALANCE' | 'BALANCE_SHEET' | 'PERIODS'>('TRIAL_BALANCE');
  const [submitting, setSubmitting] = useState(false);

  const accounts = accountingData?.accounts || [];
  const journals = accountingData?.journals || [];
  const trialBalance = accountingData?.trialBalance;
  const balanceSheet = accountingData?.balanceSheet;
  const generalLedger = accountingData?.generalLedger || [];
  const periods = accountingData?.periods || [];

  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnSearch, setJrnSearch] = useState('');
  const [jrnLines, setJrnLines] = useState([
    { accountId: accounts[0]?.id || '', debitIqd: '100000', creditIqd: '0' },
    { accountId: accounts[1]?.id || '', debitIqd: '0', creditIqd: '100000' },
  ]);
  const [selectedLedgerCode, setSelectedLedgerCode] = useState('ALL');

  const accountTypeBadge = (type: string) => {
    const map: Record<string, { ku: string; ar: string; en: string; cls: string }> = {
      ASSET: { ku: 'سامان', ar: 'أصول', en: 'Asset', cls: 'bg-emerald-500/15 text-emerald-500' },
      LIABILITY: { ku: 'پابەندبوون', ar: 'التزامات', en: 'Liability', cls: 'bg-rose-500/15 text-rose-500' },
      EQUITY: { ku: 'سەرمایە', ar: 'ملكية', en: 'Equity', cls: 'bg-teal-500/15 text-teal-500' },
      REVENUE: { ku: 'داهات', ar: 'إيرادات', en: 'Revenue', cls: 'bg-blue-500/15 text-blue-500' },
      EXPENSE: { ku: 'خەرجی', ar: 'مصروفات', en: 'Expense', cls: 'bg-amber-500/15 text-amber-500' },
    };
    const info = map[type] || { ku: type, ar: type, en: type, cls: 'bg-slate-200 dark:bg-charcoal-800 text-slate-500' };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${info.cls}`}>
        {lang === 'ku' ? info.ku : lang === 'ar' ? info.ar : info.en}
      </span>
    );
  };

  const filteredJournals = useMemo(() => {
    const q = jrnSearch.trim().toLowerCase();
    if (!q) return journals;
    return journals.filter(
      (j: any) =>
        (j.entryNumber || '').toLowerCase().includes(q) ||
        (j.description || '').toLowerCase().includes(q)
    );
  }, [journals, jrnSearch]);

  const manualTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of jrnLines) {
      debit += Math.round(Number(l.debitIqd || 0));
      credit += Math.round(Number(l.creditIqd || 0));
    }
    return { debit, credit, isBalanced: debit === credit && debit > 0 };
  }, [jrnLines]);

  const handlePostManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTotals.isBalanced) return;
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
            debitIqd: Number(l.debitIqd || 0),
            creditIqd: Number(l.creditIqd || 0),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) notify('error', data.error || 'Failed');
      else {
        notify('success', `${data.entry.entryNumber} ✓`);
        setJrnDesc('');
        setTab('JOURNALS');
        await onRefresh();
      }
    } catch (err: any) {
      notify('error', err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const lblCode = lang === 'ku' ? 'کۆد' : lang === 'ar' ? 'الرمز' : 'Code';
  const lblAccount = lang === 'ku' ? 'هەژمار' : lang === 'ar' ? 'الحساب' : 'Account';
  const lblBalance = lang === 'ku' ? 'باڵانس' : lang === 'ar' ? 'الرصيد' : 'Balance';
  const lblBalanced = lang === 'ku' ? '✓ هاوسەنگە' : lang === 'ar' ? '✓ متوازن' : '✓ Balanced';
  const lblUnbalanced = lang === 'ku' ? '✕ ناهاوسەنگە' : lang === 'ar' ? '✕ غير متوازن' : '✕ Unbalanced';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 shadow-sm">
        <h2 className="text-xl font-black flex items-center gap-2.5 text-slate-900 dark:text-white">
          <BookOpen className="w-6 h-6 text-emerald-500" />
          {t.accounting.title}
        </h2>
        <span className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 text-xs font-bold">
          <ShieldCheck className="w-4 h-4" />
          {t.accounting.balancedBadge}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'TRIAL_BALANCE', label: t.accounting.trialBalance },
          { id: 'BALANCE_SHEET', label: t.accounting.balanceSheet },
          { id: 'JOURNALS', label: t.accounting.journalEntries },
          { id: 'LEDGER', label: t.accounting.generalLedger },
          { id: 'COA', label: t.accounting.chartOfAccounts },
          { id: 'MANUAL_ENTRY', label: `+ ${t.accounting.newManualJournal}` },
          { id: 'PERIODS', label: t.accounting.periods },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              tab === item.id ? 'bg-emerald-600 text-white shadow' : 'bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'TRIAL_BALANCE' && trialBalance && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-sm font-black">{t.accounting.trialBalance}</h3>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${trialBalance.isBalanced ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}`}>
                {trialBalance.isBalanced ? lblBalanced : lblUnbalanced}
              </span>
              <button
                onClick={() =>
                  exportToCsv(
                    'trial-balance-iqd',
                    [lblCode, lblAccount, t.accounting.debit, t.accounting.credit],
                    (trialBalance.rows || []).map((r: any) => [r.code, locName(r, lang), r.debitBalanceIqd || 0, r.creditBalanceIqd || 0])
                  )
                }
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">{lblCode}</th>
                  <th className="py-3 px-4 text-start">{lblAccount}</th>
                  <th className="py-3 px-4 text-end">{t.accounting.debit}</th>
                  <th className="py-3 px-4 text-end">{t.accounting.credit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {(trialBalance.rows || []).map((r: any) => (
                  <tr key={r.accountId} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{r.code}</td>
                    <td className="py-2.5 px-4 font-semibold">{locName(r, lang)}</td>
                    <td className="py-2.5 px-4 text-end tabular-nums font-bold">{r.debitBalanceIqd > 0 ? fmtIqd(r.debitBalanceIqd, lang) : '—'}</td>
                    <td className="py-2.5 px-4 text-end tabular-nums font-bold">{r.creditBalanceIqd > 0 ? fmtIqd(r.creditBalanceIqd, lang) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-charcoal-900 text-white font-black">
                <tr>
                  <td colSpan={2} className="py-3 px-4">{t.total}</td>
                  <td className="py-3 px-4 text-end tabular-nums text-emerald-400">{fmtIqd(trialBalance.totalDebitBalanceIqd, lang)}</td>
                  <td className="py-3 px-4 text-end tabular-nums text-emerald-400">{fmtIqd(trialBalance.totalCreditBalanceIqd, lang)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'BALANCE_SHEET' && balanceSheet && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-2">
            <h4 className="font-black text-sm text-emerald-500 border-b border-slate-200 dark:border-charcoal-800 pb-2">
              {lang === 'ku' ? 'سامانەکان (Assets)' : lang === 'ar' ? 'الأصول (Assets)' : 'Assets'}
            </h4>
            {(balanceSheet.assets || []).map((a: any) => (
              <div key={a.code} className="flex justify-between py-1">
                <span><b className="font-mono text-emerald-500 me-1.5">{a.code}</b>{locName(a, lang)}</span>
                <span className="font-bold">{fmtIqd(a.balanceIqd, lang)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-2">
              <span>{lang === 'ku' ? 'کۆی سامانەکان' : lang === 'ar' ? 'إجمالي الأصول' : 'TOTAL ASSETS'}</span>
              <span className="text-emerald-500">{fmtIqd(balanceSheet.totalAssetsIqd, lang)}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-3">
            <h4 className="font-black text-sm text-rose-500 border-b border-slate-200 dark:border-charcoal-800 pb-2">
              {lang === 'ku' ? 'پابەندبوون و سەرمایە (Liabilities & Equity)' : lang === 'ar' ? 'الالتزامات وحقوق الملكية' : 'Liabilities & Equity'}
            </h4>
            {(balanceSheet.liabilities || []).map((l: any) => (
              <div key={l.code} className="flex justify-between py-1">
                <span><b className="font-mono text-rose-500 me-1.5">{l.code}</b>{locName(l, lang)}</span>
                <span className="font-bold">{fmtIqd(l.balanceIqd, lang)}</span>
              </div>
            ))}
            {(balanceSheet.equity || []).map((eq: any) => (
              <div key={eq.code} className="flex justify-between py-1">
                <span><b className="font-mono text-teal-500 me-1.5">{eq.code}</b>{locName(eq, lang)}</span>
                <span className="font-bold">{fmtIqd(eq.balanceIqd, lang)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-black border-t-2 border-emerald-500 pt-2">
              <span>{lang === 'ku' ? 'کۆی پابەندبوون و سەرمایە' : lang === 'ar' ? 'الإجمالي' : 'TOTAL L + E'} {balanceSheet.isBalanced ? '✓' : ''}</span>
              <span className="text-emerald-500">{fmtIqd(balanceSheet.totalLiabilitiesAndEquityIqd, lang)}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'JOURNALS' && (
        <div className="space-y-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
            <input
              type="text"
              value={jrnSearch}
              onChange={(e) => setJrnSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full ps-9 pe-3 py-2 rounded-xl bg-white dark:bg-charcoal-900 border border-slate-200 dark:border-charcoal-800 text-xs"
            />
          </div>
          {filteredJournals.map((jrn: any) => (
            <div key={jrn.id} className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 p-4 space-y-2 text-xs">
              <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-100 dark:border-charcoal-800 pb-2">
                <div>
                  <span className="font-mono font-black text-emerald-500 me-2">{jrn.entryNumber}</span>
                  <span className="font-semibold">{jrn.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{jrn.date ? new Date(jrn.date).toLocaleDateString() : '—'}</span>
                  {jrn.status === 'POSTED' && jrn.referenceType !== 'REVERSAL' && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`${t.accounting.reverseEntry} ${jrn.entryNumber}?`)) return;
                        try {
                          const res = await fetch('/api/accounting', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'reverseJournal', journalEntryId: jrn.id, reason: 'Manual reversal' }),
                          });
                          if (res.ok) {
                            notify('success', `${jrn.entryNumber} ✓`);
                            await onRefresh();
                          } else notify('error', (await res.json()).error || 'Failed');
                        } catch (err: any) {
                          notify('error', err?.message || 'Network error');
                        }
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-500 font-bold"
                    >
                      <RotateCcw className="w-3 h-3" /> {t.accounting.reverseEntry}
                    </button>
                  )}
                </div>
              </div>
              <table className="w-full">
                <tbody>
                  {(jrn.lines || []).map((line: any) => (
                    <tr key={line.id}>
                      <td className="py-1 font-semibold">
                        <span className="font-mono text-emerald-500 me-1.5">{line.account?.code}</span>
                        {line.account ? locName(line.account, lang) : '—'}
                      </td>
                      <td className="py-1 text-end tabular-nums font-bold w-36">{Number(line.debitIqd) > 0 ? fmtIqd(line.debitIqd, lang) : '—'}</td>
                      <td className="py-1 text-end tabular-nums font-bold w-36">{Number(line.creditIqd) > 0 ? fmtIqd(line.creditIqd, lang) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'LEDGER' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-charcoal-800 flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-sm font-black">{t.accounting.generalLedger}</h3>
            <div className="flex items-center gap-2">
              <select value={selectedLedgerCode} onChange={(e) => setSelectedLedgerCode(e.target.value)} className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-bold">
                <option value="ALL">{t.all}</option>
                {accounts.map((a: any) => <option key={a.id} value={a.code}>{a.code} — {locName(a, lang)}</option>)}
              </select>
              <button
                onClick={() =>
                  exportToCsv(
                    'general-ledger-iqd',
                    [t.date, '#', lblAccount, t.accounting.debit, t.accounting.credit, lblBalance],
                    generalLedger
                      .filter((l: any) => selectedLedgerCode === 'ALL' || l.accountCode === selectedLedgerCode)
                      .map((l: any) => [
                        l.date ? new Date(l.date).toISOString().slice(0, 10) : '',
                        l.entryNumber,
                        `${l.accountCode} - ${lang === 'ku' ? l.accountNameKu : lang === 'ar' ? l.accountNameAr : l.accountNameEn}`,
                        l.debitIqd || 0,
                        l.creditIqd || 0,
                        l.runningBalanceIqd || 0,
                      ])
                  )
                }
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 text-start">{t.date}</th>
                  <th className="py-2.5 px-4 text-start">#</th>
                  <th className="py-2.5 px-4 text-start">{lblAccount}</th>
                  <th className="py-2.5 px-4 text-end">{t.accounting.debit}</th>
                  <th className="py-2.5 px-4 text-end">{t.accounting.credit}</th>
                  <th className="py-2.5 px-4 text-end">{lblBalance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {generalLedger
                  .filter((l: any) => selectedLedgerCode === 'ALL' || l.accountCode === selectedLedgerCode)
                  .map((l: any) => (
                    <tr key={l.lineId} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                      <td className="py-2 px-4 text-slate-500">{l.date ? new Date(l.date).toLocaleDateString() : '—'}</td>
                      <td className="py-2 px-4 font-mono text-emerald-500">{l.entryNumber}</td>
                      <td className="py-2 px-4 font-semibold">{l.accountCode} — {lang === 'ku' ? l.accountNameKu : lang === 'ar' ? l.accountNameAr : l.accountNameEn}</td>
                      <td className="py-2 px-4 text-end tabular-nums">{l.debitIqd > 0 ? fmtIqd(l.debitIqd, lang) : '—'}</td>
                      <td className="py-2 px-4 text-end tabular-nums">{l.creditIqd > 0 ? fmtIqd(l.creditIqd, lang) : '—'}</td>
                      <td className="py-2 px-4 text-end tabular-nums font-bold">{fmtIqd(l.runningBalanceIqd, lang)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'COA' && (
        <div className="bg-white dark:bg-charcoal-900 rounded-2xl border border-slate-200 dark:border-charcoal-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-charcoal-950 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">{lblCode}</th>
                  <th className="py-3 px-4 text-start">{lblAccount}</th>
                  <th className="py-3 px-4 text-center">{lang === 'ku' ? 'جۆر' : lang === 'ar' ? 'النوع' : 'Type'}</th>
                  <th className="py-3 px-4 text-end">{lblBalance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-charcoal-800">
                {accounts.map((acc: any) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70 dark:hover:bg-charcoal-800/40">
                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-500">{acc.code}</td>
                    <td className="py-2.5 px-4 font-semibold">{locName(acc, lang)}</td>
                    <td className="py-2.5 px-4 text-center">{accountTypeBadge(acc.type)}</td>
                    <td className="py-2.5 px-4 text-end tabular-nums font-bold">{fmtIqd(acc.balanceIqd, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'MANUAL_ENTRY' && (
        <form onSubmit={handlePostManual} className="bg-white dark:bg-charcoal-900 p-6 rounded-2xl border border-slate-200 dark:border-charcoal-800 space-y-4">
          <input type="text" required placeholder={t.description} value={jrnDesc} onChange={(e) => setJrnDesc(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-sm" />
          {jrnLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <select value={line.accountId || accounts[idx]?.id || accounts[0]?.id || ''} onChange={(e) => { const c = [...jrnLines]; c[idx].accountId = e.target.value; setJrnLines(c); }} className="col-span-5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs font-semibold">
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {locName(a, lang)}</option>)}
              </select>
              <input type="number" min="0" placeholder={t.accounting.debit} value={line.debitIqd} onChange={(e) => { const c = [...jrnLines]; c[idx].debitIqd = e.target.value; if (Number(e.target.value) > 0) c[idx].creditIqd = '0'; setJrnLines(c); }} className="col-span-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end tabular-nums font-bold" />
              <input type="number" min="0" placeholder={t.accounting.credit} value={line.creditIqd} onChange={(e) => { const c = [...jrnLines]; c[idx].creditIqd = e.target.value; if (Number(e.target.value) > 0) c[idx].debitIqd = '0'; setJrnLines(c); }} className="col-span-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-charcoal-950 border border-slate-200 dark:border-charcoal-800 text-xs text-end tabular-nums font-bold" />
              <div className="col-span-1 text-center">
                {jrnLines.length > 2 && (
                  <button type="button" onClick={() => setJrnLines(jrnLines.filter((_, i) => i !== idx))} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap justify-between items-center gap-2 text-xs">
            <button type="button" onClick={() => setJrnLines([...jrnLines, { accountId: accounts[0]?.id || '', debitIqd: '0', creditIqd: '0' }])} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-charcoal-800 font-bold">
              + {lang === 'ku' ? 'ڕیزی نوێ' : lang === 'ar' ? 'سطر جديد' : 'Add Line'}
            </button>
            <div className="flex items-center gap-3 tabular-nums font-bold">
              <span>{t.accounting.debit}: {fmtIqd(manualTotals.debit, lang)}</span>
              <span>{t.accounting.credit}: {fmtIqd(manualTotals.credit, lang)}</span>
              <span className={manualTotals.isBalanced ? 'text-emerald-500' : 'text-rose-500'}>
                {manualTotals.isBalanced ? lblBalanced : lblUnbalanced}
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={!manualTotals.isBalanced || submitting} className="px-6 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold">{t.save}</button>
          </div>
        </form>
      )}

      {tab === 'PERIODS' && (
        <div className="bg-white dark:bg-charcoal-900 p-5 rounded-2xl border border-slate-200 dark:border-charcoal-800 grid grid-cols-1 md:grid-cols-3 gap-4">
          {periods.map((p: any) => (
            <div key={p.id} className="p-4 rounded-xl border border-slate-200 dark:border-charcoal-800 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm">{p.name}</div>
                <div className="text-[11px] text-slate-400">
                  {p.startDate ? new Date(p.startDate).toLocaleDateString() : ''} — {p.endDate ? new Date(p.endDate).toLocaleDateString() : ''}
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/accounting', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'togglePeriodLock', periodId: p.id, isLocked: !p.isLocked }),
                    });
                    if (res.ok) {
                      notify('success', `${p.name} ✓`);
                      await onRefresh();
                    } else notify('error', (await res.json()).error || 'Failed');
                  } catch (err: any) {
                    notify('error', err?.message || 'Network error');
                  }
                }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold ${p.isLocked ? 'bg-rose-500/15 text-rose-500' : 'bg-emerald-500/15 text-emerald-500'}`}
              >
                {p.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                {p.isLocked ? (lang === 'ku' ? 'داخراو' : 'Locked') : (lang === 'ku' ? 'کراوە' : 'Open')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
